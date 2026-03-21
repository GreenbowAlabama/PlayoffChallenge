#!/usr/bin/env node

/**
 * ROUND PARITY SNAPSHOT VALIDATOR
 *
 * Purpose:
 * Verify that all rounds in golfer_event_scores match the baseline field size.
 *
 * Checks for parity violations in real data:
 * - Baseline from field_selections.selection_json.primary
 * - Actual golfer counts per round from golfer_event_scores
 * - Reports any mismatches (parity violations)
 *
 * READ-ONLY: No mutations, no side effects
 */

'use strict';

const { Pool } = require('pg');

async function validateRoundParitySnapshot() {
  const contestInstanceId = process.argv[2];

  if (!contestInstanceId) {
    console.error('Usage: node validateRoundParitySnapshot.js <contest_instance_id>');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL_TEST || process.env.DATABASE_URL,
    statement_timeout: 30000,
  });

  try {
    console.log(`\n========================================`);
    console.log(`ROUND PARITY SNAPSHOT VALIDATOR`);
    console.log(`Contest Instance: ${contestInstanceId}`);
    console.log(`========================================\n`);

    // Step 1: Fetch baseline from field_selections
    console.log(`[STEP 1] Fetching baseline from field_selections...`);

    const baselineResult = await pool.query(
      `
      SELECT jsonb_array_length(selection_json->'primary') as baseline
      FROM field_selections
      WHERE contest_instance_id = $1
      `,
      [contestInstanceId]
    );

    let baseline = null;

    if (baselineResult.rows.length === 0) {
      console.log(`⚠️  field_selections not found for this contest`);
      baseline = null;
    } else if (baselineResult.rows[0].baseline === null) {
      console.log(`⚠️  field_selections exists but primary array is null/empty`);
      baseline = null;
    } else {
      baseline = baselineResult.rows[0].baseline;
      console.log(`✓ Baseline: ${baseline} golfers\n`);
    }

    // Step 2: Fetch round distribution from golfer_event_scores
    console.log(`[STEP 2] Fetching round distribution from golfer_event_scores...\n`);

    const roundsResult = await pool.query(
      `
      SELECT
        round_number,
        COUNT(DISTINCT golfer_id) as golfer_count
      FROM golfer_event_scores
      WHERE contest_instance_id = $1
      GROUP BY round_number
      ORDER BY round_number
      `,
      [contestInstanceId]
    );

    if (roundsResult.rows.length === 0) {
      console.log(`ℹ️  No golfer_event_scores found for this contest`);
    }

    // Step 3: Compare and build output
    const rounds = roundsResult.rows.map(row => ({
      round_number: row.round_number,
      golfer_count: parseInt(row.golfer_count),
      matches_baseline: baseline !== null ? parseInt(row.golfer_count) === baseline : null
    }));

    // Step 4: Generate output
    const output = {
      baseline,
      rounds
    };

    console.log(`[STEP 3] Results:\n`);
    console.log(JSON.stringify(output, null, 2));
    console.log();

    // Step 5: Parity violation detection
    let violationDetected = false;

    if (baseline === null) {
      console.log(`⚠️  BASELINE NOT SET: Cannot validate parity (field_selections missing/empty)`);
    } else {
      for (const round of rounds) {
        if (!round.matches_baseline) {
          violationDetected = true;
          console.log(
            `❌ PARITY VIOLATION: Round ${round.round_number} has ${round.golfer_count} golfers ` +
            `(expected baseline ${baseline})`
          );
        }
      }

      if (!violationDetected && rounds.length > 0) {
        console.log(`✅ ALL ROUNDS VALID: All ${rounds.length} rounds match baseline ${baseline}`);
      } else if (violationDetected) {
        console.log(`\n⛔ PARITY VIOLATION DETECTED`);
      }
    }

    console.log(`\n========================================\n`);

    process.exit(0);

  } catch (err) {
    console.error('Error during validation:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

validateRoundParitySnapshot();
