#!/usr/bin/env node

/**
 * INSPECT ROUND 3 WRITES
 *
 * Purpose:
 * Determine if round 3 partial data was written historically (one-time)
 * OR if it's still being written over time (validator not working/deployed).
 *
 * Analyzes write timestamps to infer ingestion pattern:
 * - Single burst → old bug (validator now preventing)
 * - Continuous writes → validator failing/not deployed
 *
 * READ-ONLY: No mutations, no side effects
 */

'use strict';

const { Pool } = require('pg');

async function inspectRound3Writes() {
  const contestInstanceId = process.argv[2];

  if (!contestInstanceId) {
    console.error('Usage: node inspectRound3Writes.js <contest_instance_id>');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL_TEST || process.env.DATABASE_URL,
    statement_timeout: 30000,
  });

  try {
    console.log(`\n========================================`);
    console.log(`INSPECT ROUND 3 WRITES`);
    console.log(`Contest Instance: ${contestInstanceId}`);
    console.log(`========================================\n`);

    // Query all round 3 writes
    console.log(`[STEP 1] Querying round 3 writes...`);

    const allRound3Result = await pool.query(
      `
      SELECT
        golfer_id,
        created_at
      FROM golfer_event_scores
      WHERE contest_instance_id = $1 AND round_number = 3
      ORDER BY created_at ASC
      `,
      [contestInstanceId]
    );

    const totalRows = allRound3Result.rows.length;

    console.log(`✓ Found ${totalRows} round 3 entries\n`);

    if (totalRows === 0) {
      console.log(`ℹ️  No round 3 data found. Contest may not have reached round 3 yet.\n`);
      console.log(`========================================\n`);
      process.exit(0);
    }

    // Analyze timestamp range
    const earliestCreated = allRound3Result.rows[0].created_at;
    const latestCreated = allRound3Result.rows[totalRows - 1].created_at;

    const createdAtDate = new Date(earliestCreated);
    const latestCreatedDate = new Date(latestCreated);

    const timespanMs = latestCreatedDate - createdAtDate;
    const timespanSec = Math.round(timespanMs / 1000);
    const timespanMin = Math.round(timespanMs / 60000);

    console.log(`[STEP 2] Timestamp Analysis:\n`);
    console.log(`  Earliest created_at: ${earliestCreated}`);
    console.log(`  Latest created_at:   ${latestCreated}`);
    console.log(`  Timespan: ${timespanSec}s (${timespanMin}m)\n`);

    // Sample first 10 rows
    const sampleSize = Math.min(10, totalRows);
    const sample = allRound3Result.rows.slice(0, sampleSize);

    console.log(`[STEP 3] Sample (first ${sampleSize} of ${totalRows} rows):\n`);
    sample.forEach((row, index) => {
      console.log(`  ${index + 1}. golfer_id: ${row.golfer_id}`);
      console.log(`     created_at: ${row.created_at}\n`);
    });

    // Analysis and diagnosis
    console.log(`[STEP 4] Write Pattern Analysis:\n`);

    if (timespanSec <= 10) {
      console.log(`✅ SINGLE BURST PATTERN (≤10s timespan)`);
      console.log(`   → All round 3 writes happened in one ingestion cycle`);
      console.log(`   → DIAGNOSIS: Old bug, historical data`);
      console.log(`   → ACTION: Deploy validator + cleanup old round 3\n`);
    } else if (timespanMin <= 2) {
      console.log(`⚠️  CLUSTERED PATTERN (10s - 2m timespan)`);
      console.log(`   → Round 3 writes clustered in short time window`);
      console.log(`   → DIAGNOSIS: Likely single ingestion with batch`);
      console.log(`   → ACTION: Deploy validator + monitor for new writes\n`);
    } else {
      console.log(`❌ CONTINUOUS WRITE PATTERN (>2m timespan)`);
      console.log(`   → Round 3 writes spread over extended period`);
      console.log(`   → DIAGNOSIS: Validator may be failing or not deployed`);
      console.log(`   → ACTION: Verify validator in production, investigate ingestion logs\n`);
    }

    // Additional checks
    console.log(`[STEP 5] Additional Diagnostics:\n`);

    // Check for recent writes (last 24h)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentWrites = allRound3Result.rows.filter(
      row => new Date(row.created_at) > twentyFourHoursAgo
    );

    if (recentWrites.length > 0) {
      console.log(`⚠️  RECENT WRITES DETECTED (last 24h): ${recentWrites.length} rows`);
      console.log(`   Latest: ${recentWrites[recentWrites.length - 1].created_at}`);
      console.log(`   → Validator may not be deployed\n`);
    } else {
      console.log(`✓ No recent writes (last 24h)\n`);
    }

    console.log(`========================================\n`);

    process.exit(0);

  } catch (err) {
    console.error('Error during inspection:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

inspectRound3Writes();
