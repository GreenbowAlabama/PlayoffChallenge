#!/usr/bin/env node

/**
 * AUDIT SCRIPT: Verify Round Drift Hypothesis
 *
 * HYPOTHESIS:
 * DB is accumulating stale/premature round contributions, causing score drift vs ESPN
 *
 * ESPN "score" = CURRENT TOTAL (through latest completed round)
 * DB = SUM(all stored rounds)
 *
 * If DB contains round 1+2+3 (partial) while ESPN shows 1+2 only → DB drifts lower
 *
 * READ-ONLY: No mutations, no assumptions, clear structured logs
 */

const { Pool } = require('pg');

async function auditRoundDrift() {
  const contestInstanceId = process.argv[2];

  if (!contestInstanceId) {
    console.error('Usage: node verifyRoundDrift.js <contest_instance_id>');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL_TEST || process.env.DATABASE_URL,
    statement_timeout: 30000,
  });

  try {
    console.log(`\n========================================`);
    console.log(`ROUND DRIFT AUDIT`);
    console.log(`Contest Instance: ${contestInstanceId}`);
    console.log(`========================================\n`);

    // Query 1: Get all golfer_event_scores for this contest
    console.log(`[STEP 1] Fetching golfer_event_scores...`);
    const scoresResult = await pool.query(
      `
      SELECT
        golfer_id,
        round_number,
        hole_points,
        bonus_points,
        finish_bonus,
        total_points,
        created_at
      FROM golfer_event_scores
      WHERE contest_instance_id = $1
      ORDER BY golfer_id, round_number
      `,
      [contestInstanceId]
    );

    if (scoresResult.rows.length === 0) {
      console.log(`No golfer_event_scores found for this contest.\n`);
      process.exit(0);
    }

    console.log(`Found ${scoresResult.rows.length} score entries\n`);

    // Group by golfer_id
    const golferMap = {};

    for (const row of scoresResult.rows) {
      const golferId = row.golfer_id;

      if (!golferMap[golferId]) {
        golferMap[golferId] = {
          golfer_id: golferId,
          rounds_present: [],
          round_totals: {},
          db_total: 0,
          entry_count: 0, // Track how many DB entries
        };
      }

      // Track unique rounds
      if (!golferMap[golferId].rounds_present.includes(row.round_number)) {
        golferMap[golferId].rounds_present.push(row.round_number);
      }

      // Sum points for this round (accumulate if multiple entries per round)
      if (!golferMap[golferId].round_totals[row.round_number]) {
        golferMap[golferId].round_totals[row.round_number] = 0;
      }
      golferMap[golferId].round_totals[row.round_number] += row.total_points;

      // Track DB total (sum of all total_points)
      golferMap[golferId].db_total += row.total_points;
      golferMap[golferId].entry_count += 1;
    }

    // Sort rounds_present
    for (const golferId in golferMap) {
      golferMap[golferId].rounds_present.sort((a, b) => a - b);
    }

    // Output structured results
    console.log(`[STEP 2] Aggregated Results by Golfer:\n`);

    const golferArray = Object.values(golferMap).sort((a, b) =>
      a.golfer_id.localeCompare(b.golfer_id)
    );

    for (const golfer of golferArray) {
      console.log(`${golfer.golfer_id}:`);
      console.log(`  rounds_present: [${golfer.rounds_present.join(', ')}]`);
      console.log(`  round_totals: ${JSON.stringify(golfer.round_totals)}`);
      console.log(`  db_total: ${golfer.db_total}`);
      console.log(`  entry_count: ${golfer.entry_count}`);
      console.log();
    }

    // Query 2: Get normalized_scores (what ESPN sees)
    console.log(`\n[STEP 3] Fetching normalized_scores (ESPN source)...\n`);
    const espnResult = await pool.query(
      `
      SELECT
        golfer_id,
        normalized_scores,
        score
      FROM golfer_scores
      WHERE contest_instance_id = $1
      ORDER BY golfer_id
      `,
      [contestInstanceId]
    );

    if (espnResult.rows.length === 0) {
      console.log(`No golfer_scores (ESPN) found for this contest.\n`);
    } else {
      console.log(`ESPN Golfer Scores:\n`);
      for (const row of espnResult.rows) {
        const normalizedScores = row.normalized_scores || [];
        const roundsInEspn = normalizedScores
          .map((score) => score.round_number)
          .sort((a, b) => a - b);

        console.log(`${row.golfer_id}:`);
        console.log(`  rounds_in_espn: [${roundsInEspn.join(', ')}]`);
        console.log(`  espn_total_score: ${row.score}`);
        console.log(`  normalized_scores: ${JSON.stringify(normalizedScores.slice(0, 3))}${normalizedScores.length > 3 ? '...' : ''}`);
        console.log();
      }
    }

    // Summary comparison
    console.log(`\n[STEP 4] Comparison Summary:\n`);
    console.log(`Total unique golfers in DB: ${golferArray.length}`);
    console.log(`Total unique golfers in ESPN: ${espnResult.rows.length}`);

    // Check for round mismatches
    let mismatchCount = 0;
    for (const golfer of golferArray) {
      const espnRow = espnResult.rows.find((r) => r.golfer_id === golfer.golfer_id);
      if (espnRow) {
        const normalizedScores = espnRow.normalized_scores || [];
        const espnRounds = normalizedScores
          .map((score) => score.round_number)
          .sort((a, b) => a - b);

        if (JSON.stringify(golfer.rounds_present) !== JSON.stringify(espnRounds)) {
          mismatchCount++;
          console.log(`MISMATCH: ${golfer.golfer_id}`);
          console.log(`  DB rounds: [${golfer.rounds_present.join(', ')}]`);
          console.log(`  ESPN rounds: [${espnRounds.join(', ')}]`);
          console.log();
        }
      }
    }

    if (mismatchCount === 0) {
      console.log(`✓ No round mismatches found. Hypothesis is likely FALSE.\n`);
    } else {
      console.log(`✗ Found ${mismatchCount} golfers with mismatched rounds. Hypothesis is likely TRUE.\n`);
    }

    console.log(`========================================\n`);

  } catch (err) {
    console.error('Error during audit:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

auditRoundDrift();
