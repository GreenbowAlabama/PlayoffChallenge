/**
 * Verify Full PGA Scoring Pipeline
 *
 * End-to-end validation: INGESTION → SCORING → DB → AGGREGATION INPUT → LEADERBOARD READINESS
 *
 * Usage:
 * node backend/debug/verifyFullPipeline.js
 *
 * Hardcoded contest for testing: f6d203fc-bd90-4351-915f-6bb44c292480
 */

'use strict';

const { Pool } = require('pg');

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost/playoff_challenge'
  });

  const contestInstanceId = 'f6d203fc-bd90-4351-915f-6bb44c292480';

  console.log(`\n${'='.repeat(80)}`);
  console.log('PGA SCORING PIPELINE VERIFICATION');
  console.log(`${'='.repeat(80)}`);
  console.log(`Contest: ${contestInstanceId}\n`);

  try {
    // STEP 1: Count scores by round
    console.log('[VERIFY] STEP 1 — Scores by Round');
    console.log('-'.repeat(80));

    const roundsResult = await pool.query(`
      SELECT round_number, COUNT(*) as golfers
      FROM golfer_event_scores
      WHERE contest_instance_id = $1
      GROUP BY round_number
      ORDER BY round_number
    `, [contestInstanceId]);

    const roundsMap = {};
    const roundsDetected = [];
    roundsResult.rows.forEach(row => {
      roundsMap[row.round_number] = row.golfers;
      roundsDetected.push(Number(row.round_number));
      console.log(`  - Round ${row.round_number}: ${row.golfers} golfers`);
    });

    if (roundsResult.rows.length === 0) {
      console.log('  - No rounds found');
    }
    console.log();

    // STEP 2: Zero score check
    console.log('[VERIFY] STEP 2 — Zero Score Check');
    console.log('-'.repeat(80));

    const zeroScoresResult = await pool.query(`
      SELECT COUNT(*) as zero_scores
      FROM golfer_event_scores
      WHERE contest_instance_id = $1
      AND total_points = 0
    `, [contestInstanceId]);

    const zeroScores = parseInt(zeroScoresResult.rows[0].zero_scores);
    console.log(`  - Zero scores: ${zeroScores}`);
    console.log();

    // STEP 3: Sample player check
    console.log('[VERIFY] STEP 3 — Sample Player Verification');
    console.log('-'.repeat(80));

    const sampleGolferResult = await pool.query(`
      SELECT DISTINCT golfer_id
      FROM golfer_event_scores
      WHERE contest_instance_id = $1
      LIMIT 1
    `, [contestInstanceId]);

    if (sampleGolferResult.rows.length > 0) {
      const sampleGolferId = sampleGolferResult.rows[0].golfer_id;
      console.log(`  - Sample golfer: ${sampleGolferId}`);

      const sampleScoresResult = await pool.query(`
        SELECT golfer_id, round_number, hole_points, bonus_points, finish_bonus, total_points
        FROM golfer_event_scores
        WHERE contest_instance_id = $1
        AND golfer_id = $2
        ORDER BY round_number
      `, [contestInstanceId, sampleGolferId]);

      sampleScoresResult.rows.forEach(row => {
        console.log(
          `    Round ${row.round_number}: ` +
          `hole=${row.hole_points} bonus=${row.bonus_points} finish=${row.finish_bonus} total=${row.total_points}`
        );
      });
    } else {
      console.log('  - No golfers found');
    }
    console.log();

    // STEP 4: Total row count
    console.log('[VERIFY] STEP 4 — Total Row Count');
    console.log('-'.repeat(80));

    const totalResult = await pool.query(`
      SELECT COUNT(*) as total_rows
      FROM golfer_event_scores
      WHERE contest_instance_id = $1
    `, [contestInstanceId]);

    const totalRows = parseInt(totalResult.rows[0].total_rows);
    console.log(`  - Total rows: ${totalRows}`);
    console.log();

    // STEP 5: Duplicate check (CRITICAL)
    console.log('[VERIFY] STEP 5 — Duplicate Check');
    console.log('-'.repeat(80));

    const duplicatesResult = await pool.query(`
      SELECT contest_instance_id, golfer_id, round_number, COUNT(*) as count
      FROM golfer_event_scores
      WHERE contest_instance_id = $1
      GROUP BY contest_instance_id, golfer_id, round_number
      HAVING COUNT(*) > 1
    `, [contestInstanceId]);

    if (duplicatesResult.rows.length === 0) {
      console.log('  ✅ [PASS] No duplicates detected');
    } else {
      console.log('  ❌ [FAIL] Duplicate rows found:');
      duplicatesResult.rows.forEach(row => {
        console.log(
          `    - golfer ${row.golfer_id} round ${row.round_number}: ${row.count} rows`
        );
      });
    }
    console.log();

    // STEP 6: Final verdict
    console.log('[VERIFY] STEP 6 — Final Verdict');
    console.log('-'.repeat(80));

    const hasDuplicates = duplicatesResult.rows.length > 0;
    const golfersPerRound = {};
    Object.entries(roundsMap).forEach(([round, count]) => {
      golfersPerRound[`round_${round}`] = count;
    });

    console.log(`[RESULT] Pipeline Status:`);
    console.log(`  - rounds_detected: [${roundsDetected.join(', ')}]`);
    console.log(`  - golfers_per_round: ${JSON.stringify(golfersPerRound)}`);
    console.log(`  - zero_scores: ${zeroScores}`);
    console.log(`  - duplicates: ${hasDuplicates}`);
    console.log(`  - total_rows: ${totalRows}`);
    console.log();

    // Verdict with STRICT validation
    const onlyValidRounds =
      roundsDetected.length === 2 &&
      roundsDetected.includes(1) &&
      roundsDetected.includes(2);

    const duplicatePass = !hasDuplicates;
    const zeroScorePass = zeroScores <= 5;
    const rowCountPass = totalRows >= 230 && totalRows <= 275;

    console.log('[VERDICT]');
    if (!onlyValidRounds) {
      console.log('  ❌ [FAIL] Invalid rounds detected (must be exactly [1,2])');
      process.exit(0);
    }

    if (!duplicatePass) {
      console.log('  ❌ [FAIL] Duplicate scores detected');
      process.exit(0);
    }

    if (!zeroScorePass) {
      console.log(`  ❌ [FAIL] Too many zero scores (${zeroScores}, max 5)`);
      process.exit(0);
    }

    if (!rowCountPass) {
      console.log(`  ❌ [FAIL] Invalid row count (${totalRows}, expected 230-275)`);
      process.exit(0);
    }

    console.log('  ✅ [PASS] Scoring pipeline producing valid data');
    console.log();
    console.log('  Pipeline is READY for:');
    console.log('    - golfer_scores aggregation');
    console.log('    - entry-level scoring');
    console.log('    - leaderboard display');
    console.log('    - settlement processing');
    console.log();

  } catch (err) {
    console.error('[ERROR] Verification failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
