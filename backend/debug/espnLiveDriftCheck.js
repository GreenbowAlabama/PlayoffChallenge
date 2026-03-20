/**
 * ESPN Live Drift Check
 *
 * Queries ingestion_events 5 times over ~60s to prove ESPN data
 * is changing in real-time during LIVE contests.
 *
 * Usage:
 *   node backend/debug/espnLiveDriftCheck.js
 *
 * Requires DATABASE_URL env var.
 */

'use strict';

const { Pool } = require('pg');

const RUNS = 5;
const INTERVAL_MS = 15000; // 15s between runs

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // Step 1: Find the most recent LIVE PGA contest
    const contestResult = await pool.query(
      `SELECT ci.id AS contest_id, ci.contest_name, ci.status, ci.provider_event_id
       FROM contest_instances ci
       JOIN contest_templates ct ON ct.id = ci.template_id
       WHERE ct.sport IN ('PGA', 'pga', 'GOLF', 'golf')
         AND ci.status = 'LIVE'
       ORDER BY ci.tournament_start_time DESC
       LIMIT 1`
    );

    if (contestResult.rows.length === 0) {
      console.log('NO LIVE PGA CONTEST FOUND');
      console.log('Falling back to most recent LIVE or COMPLETE contest for data shape verification...');

      const fallbackResult = await pool.query(
        `SELECT ci.id AS contest_id, ci.contest_name, ci.status, ci.provider_event_id
         FROM contest_instances ci
         JOIN contest_templates ct ON ct.id = ci.template_id
         WHERE ct.sport IN ('PGA', 'pga', 'GOLF', 'golf')
           AND ci.status IN ('LIVE', 'COMPLETE')
         ORDER BY ci.tournament_start_time DESC
         LIMIT 1`
      );

      if (fallbackResult.rows.length === 0) {
        console.log('NO PGA CONTESTS AT ALL. Cannot verify data path.');
        process.exit(1);
      }

      const contest = fallbackResult.rows[0];
      console.log(`\nUsing ${contest.status} contest: ${contest.contest_name} (${contest.contest_id})`);
      console.log(`Provider Event: ${contest.provider_event_id || 'NONE'}\n`);

      // Single run to verify data shape exists
      await runSingleCheck(pool, contest.contest_id, 1);
      console.log('\n--- DATA SHAPE VERIFICATION COMPLETE (contest not LIVE, cannot measure drift) ---');
      process.exit(0);
    }

    const contest = contestResult.rows[0];
    console.log(`\n=== ESPN LIVE DRIFT CHECK ===`);
    console.log(`Contest: ${contest.contest_name} (${contest.contest_id})`);
    console.log(`Status: ${contest.status}`);
    console.log(`Provider Event: ${contest.provider_event_id || 'NONE'}`);
    console.log(`Runs: ${RUNS} | Interval: ${INTERVAL_MS / 1000}s`);
    console.log(`Total duration: ~${(RUNS - 1) * INTERVAL_MS / 1000}s\n`);

    const snapshots = [];

    for (let i = 1; i <= RUNS; i++) {
      const snapshot = await runSingleCheck(pool, contest.contest_id, i);
      snapshots.push(snapshot);

      if (i < RUNS) {
        console.log(`  Waiting ${INTERVAL_MS / 1000}s...\n`);
        await sleep(INTERVAL_MS);
      }
    }

    // Analyze drift
    console.log('\n=== DRIFT ANALYSIS ===\n');

    const timestamps = snapshots.map(s => s.timestamp);
    const uniqueTimestamps = new Set(timestamps);

    if (uniqueTimestamps.size > 1) {
      console.log('RESULT: ESPN DATA CHANGING');
      console.log(`  Unique ingestion timestamps: ${uniqueTimestamps.size} across ${RUNS} runs`);
      console.log(`  Timestamps: ${[...uniqueTimestamps].join(', ')}`);
    } else if (uniqueTimestamps.size === 1) {
      console.log('RESULT: ESPN DATA STATIC');
      console.log(`  Same ingestion timestamp across all ${RUNS} runs: ${[...uniqueTimestamps][0]}`);
      console.log('  This may indicate: tournament not actively in play, or ingestion worker not running');
    } else {
      console.log('RESULT: NO DATA');
    }

    // Check score changes
    const scoreSignatures = snapshots.map(s => s.scoreSignature);
    const uniqueScores = new Set(scoreSignatures);

    console.log(`\nScore signatures: ${uniqueScores.size} unique across ${RUNS} runs`);
    if (uniqueScores.size > 1) {
      console.log('SCORES ARE CHANGING between ingestion events');
    } else {
      console.log('Scores are the same across all runs (may be between round breaks)');
    }

  } finally {
    await pool.end();
  }
}

async function runSingleCheck(pool, contestId, runNumber) {
  // CRITICAL: Use COALESCE to avoid NULL-first ordering in DESC.
  // PostgreSQL sorts NULLs FIRST in DESC, which returns stale placeholder rows.
  const result = await pool.query(
    `SELECT
       id,
       COALESCE(validated_at, created_at) AS ingested_at,
       provider_data_json
     FROM ingestion_events
     WHERE contest_instance_id = $1
       AND provider = 'pga_espn'
       AND (validated_at IS NOT NULL OR created_at IS NOT NULL)
     ORDER BY COALESCE(validated_at, created_at) DESC
     LIMIT 1`,
    [contestId]
  );

  if (result.rows.length === 0) {
    console.log(`RUN ${runNumber}: NO INGESTION EVENTS FOUND`);
    return { timestamp: null, scoreSignature: null, competitors: 0 };
  }

  const row = result.rows[0];
  const rawData = typeof row.provider_data_json === 'string'
    ? JSON.parse(row.provider_data_json)
    : row.provider_data_json;

  // Extract competitors from all known ESPN formats
  let competitors = [];
  if (Array.isArray(rawData?.competitors)) {
    competitors = rawData.competitors;
  } else if (Array.isArray(rawData?.events)) {
    const event = rawData.events[0];
    if (event?.competitions?.[0]?.competitors) {
      competitors = event.competitions[0].competitors;
    }
  }

  // Extract top 5 scores for display
  const topScores = competitors
    .slice(0, 5)
    .map(c => ({
      golfer_id: `espn_${c.id}`,
      score: c.score ?? 'N/A',
      displayName: c.athlete?.displayName || c.displayName || 'Unknown'
    }));

  // Build score signature for drift detection
  const scoreSignature = competitors
    .map(c => `${c.id}:${c.score ?? 'null'}`)
    .sort()
    .join('|');

  const timestamp = row.ingested_at;

  console.log(`RUN ${runNumber}: [${timestamp}]`);
  console.log(`  Ingestion ID: ${row.id}`);
  console.log(`  Competitors: ${competitors.length}`);
  console.log(`  Has competitor.score field: ${competitors.length > 0 && competitors[0].score !== undefined ? 'YES' : 'NO'}`);
  console.log(`  Top 5 scores:`);
  topScores.forEach(s => {
    console.log(`    ${s.displayName} (${s.golfer_id}): score=${s.score}`);
  });

  return { timestamp, scoreSignature, competitors: competitors.length };
}

run().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
