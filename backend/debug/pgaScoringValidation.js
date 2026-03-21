#!/usr/bin/env node

/**
 * PGA Scoring Validation — Deterministic Score Verification
 *
 * Validates PGA scoring using golfer_event_scores as the single source of truth.
 * Provides per-round breakdown, aggregated scores, and top-10 leaderboard.
 *
 * Usage: node debug/pgaScoringValidation.js <contestInstanceId> [golferId]
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

async function validatePgaScoring(contestInstanceId, golferId) {
  try {
    if (!contestInstanceId) {
      console.error('Usage: node debug/pgaScoringValidation.js <contestInstanceId> [golferId]');
      process.exit(1);
    }

    console.log('\n=== PGA SCORING VALIDATION ===\n');

    // Query 1: PER ROUND BREAKDOWN (if golfer_id provided)
    if (golferId) {
      console.log('--- PER ROUND (GOLFER: ' + golferId + ') ---\n');
      const perRoundResult = await pool.query(
        `SELECT
          golfer_id,
          round_number,
          hole_points,
          bonus_points,
          finish_bonus,
          (hole_points + bonus_points + finish_bonus) as round_total
        FROM golfer_event_scores
        WHERE contest_instance_id = $1 AND golfer_id = $2
        ORDER BY round_number ASC`,
        [contestInstanceId, golferId]
      );

      if (perRoundResult.rows.length === 0) {
        console.log('NO DATA\n');
      } else {
        console.table(perRoundResult.rows.map(r => ({
          golfer_id: r.golfer_id,
          round_number: r.round_number,
          hole_points: r.hole_points,
          bonus_points: r.bonus_points,
          finish_bonus: r.finish_bonus,
          round_total: r.round_total,
        })));
        console.log();
      }

      // Query 2: AGGREGATED SCORE (single golfer)
      console.log('--- AGGREGATED (GOLFER: ' + golferId + ') ---\n');
      const aggregatedResult = await pool.query(
        `SELECT
          golfer_id,
          SUM(hole_points + bonus_points + finish_bonus) as computed_score
        FROM golfer_event_scores
        WHERE contest_instance_id = $1 AND golfer_id = $2
        GROUP BY golfer_id`,
        [contestInstanceId, golferId]
      );

      if (aggregatedResult.rows.length === 0) {
        console.log('NO DATA\n');
      } else {
        console.table(aggregatedResult.rows.map(r => ({
          golfer_id: r.golfer_id,
          computed_score: r.computed_score,
        })));
        console.log();
      }
    }

    // Query 3: TOP 10 LEADERBOARD (ALL golfers)
    console.log('--- TOP 10 COMPUTED LEADERBOARD ---\n');
    const leaderboardResult = await pool.query(
      `SELECT
        golfer_id,
        SUM(hole_points + bonus_points + finish_bonus) as computed_score
      FROM golfer_event_scores
      WHERE contest_instance_id = $1
      GROUP BY golfer_id
      ORDER BY computed_score DESC, golfer_id ASC
      LIMIT 10`,
      [contestInstanceId]
    );

    if (leaderboardResult.rows.length === 0) {
      console.log('NO DATA\n');
    } else {
      console.table(leaderboardResult.rows.map((r, idx) => ({
        rank: idx + 1,
        golfer_id: r.golfer_id,
        computed_score: r.computed_score,
      })));
      console.log();
    }

    console.log('=== END VALIDATION ===\n');

    await pool.end();
  } catch (err) {
    console.error('[ERROR]', err.message);
    process.exit(1);
  }
}

// Run validation
const contestInstanceId = process.argv[2];
const golferId = process.argv[3] || null;
validatePgaScoring(contestInstanceId, golferId);
