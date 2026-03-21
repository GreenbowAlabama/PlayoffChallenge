#!/usr/bin/env node

/**
 * Trace Golfer Scores Write Path
 *
 * Audits golfer_event_scores vs golfer_scores to find write anomalies:
 * - which rounds exist in each table
 * - score values across rounds
 * - evidence of cleanup/deletion
 *
 * Usage: node debug/traceGolferScoresWrite.js <contestInstanceId>
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

async function traceWrites(contestInstanceId) {
  try {
    if (!contestInstanceId) {
      console.error('Usage: node debug/traceGolferScoresWrite.js <contestInstanceId>');
      process.exit(1);
    }

    console.log('\n========================================');
    console.log('TRACE GOLFER SCORES WRITE PATH');
    console.log('========================================\n');

    // Fetch contest metadata
    const contestResult = await pool.query(
      `SELECT id, provider_event_id, contest_name, status FROM contest_instances WHERE id = $1`,
      [contestInstanceId]
    );

    if (contestResult.rows.length === 0) {
      console.error(`[ERROR] Contest not found: ${contestInstanceId}`);
      process.exit(1);
    }

    const contest = contestResult.rows[0];
    console.log('[CONTEST METADATA]');
    console.log(`  contest_id: ${contest.id}`);
    console.log(`  provider_event_id: ${contest.provider_event_id}`);
    console.log(`  status: ${contest.status}\n`);

    // Step 1: Check golfer_event_scores (intermediate write table)
    const eventScoresResult = await pool.query(
      `SELECT
        golfer_id,
        round_number,
        hole_points,
        bonus_points,
        finish_bonus,
        total_points,
        COUNT(*) as row_count
      FROM golfer_event_scores
      WHERE contest_instance_id = $1
      GROUP BY golfer_id, round_number, hole_points, bonus_points, finish_bonus, total_points
      ORDER BY golfer_id, round_number`,
      [contestInstanceId]
    );

    console.log('[GOLFER_EVENT_SCORES TABLE]');
    console.log(`  Total rows: ${eventScoresResult.rows.length}`);

    const eventRounds = new Set();
    const eventGolfers = new Set();

    eventScoresResult.rows.forEach(row => {
      eventRounds.add(row.round_number);
      eventGolfers.add(row.golfer_id);
      console.log(
        `  ${row.golfer_id} | R${row.round_number} | hole=${row.hole_points} bonus=${row.bonus_points} finish=${row.finish_bonus} total=${row.total_points}`
      );
    });

    console.log(`  Rounds found: ${Array.from(eventRounds).sort().join(', ')}`);
    console.log(`  Golfers found: ${eventGolfers.size}\n`);

    // Step 2: Check golfer_scores (final user score table)
    const userScoresResult = await pool.query(
      `SELECT
        user_id,
        golfer_id,
        round_number,
        hole_points,
        bonus_points,
        finish_bonus,
        total_points,
        COUNT(*) as row_count
      FROM golfer_scores
      WHERE contest_instance_id = $1
      GROUP BY user_id, golfer_id, round_number, hole_points, bonus_points, finish_bonus, total_points
      ORDER BY user_id, golfer_id, round_number`,
      [contestInstanceId]
    );

    console.log('[GOLFER_SCORES TABLE (FINAL)]\n');
    console.log(`  Total rows: ${userScoresResult.rows.length}`);

    const userRounds = new Set();
    const userGolfers = new Set();
    const usersByGolfer = new Map();

    userScoresResult.rows.forEach(row => {
      userRounds.add(row.round_number);
      userGolfers.add(row.golfer_id);

      if (!usersByGolfer.has(row.golfer_id)) {
        usersByGolfer.set(row.golfer_id, []);
      }
      usersByGolfer.get(row.golfer_id).push({
        user_id: row.user_id,
        round: row.round_number,
        total: row.total_points,
      });

      console.log(
        `  ${row.golfer_id.padEnd(15)} R${row.round_number} user=${row.user_id.slice(0, 8)}... | hole=${row.hole_points} bonus=${row.bonus_points} finish=${row.finish_bonus} total=${row.total_points}`
      );
    });

    console.log(`  Rounds found: ${Array.from(userRounds).sort().join(', ')}`);
    console.log(`  Golfers found: ${userGolfers.size}\n`);

    // Step 3: Compare tables
    console.log('[COMPARISON]');
    console.log(`  golfer_event_scores rounds: ${Array.from(eventRounds).sort().join(', ')}`);
    console.log(`  golfer_scores rounds: ${Array.from(userRounds).sort().join(', ')}`);

    const missingRounds = Array.from(eventRounds).filter(r => !userRounds.has(r));
    const extraRounds = Array.from(userRounds).filter(r => !eventRounds.has(r));

    if (missingRounds.length > 0) {
      console.log(`  [ALERT] Rounds deleted: ${missingRounds.join(', ')}`);
    }
    if (extraRounds.length > 0) {
      console.log(`  [ALERT] Rounds added (shouldn't happen): ${extraRounds.join(', ')}`);
    }

    // Step 4: Check for accumulation patterns
    console.log('\n[ACCUMULATION CHECK]');

    for (const [golferId, userScores] of usersByGolfer.entries()) {
      const roundTotals = new Map();
      userScores.forEach(s => {
        if (!roundTotals.has(s.round)) {
          roundTotals.set(s.round, []);
        }
        roundTotals.get(s.round).push(s.total);
      });

      console.log(`  ${golferId}:`);
      Array.from(roundTotals.entries())
        .sort((a, b) => a[0] - b[0])
        .forEach(([round, totals]) => {
          console.log(`    R${round}: ${totals.join(', ')}`);
        });
    }

    // Step 5: Check for hard-deleted rounds (round > 2)
    console.log('\n[ROUND > 2 CHECK]');
    if (userRounds.has(3) || userRounds.has(4)) {
      console.log('  ✓ Rounds 3+ exist in golfer_scores (hard delete did not run OR tournament < 4 rounds)');
    } else {
      console.log('  ⚠️  No rounds 3+ found in golfer_scores (may have been hard-deleted)');
    }

    console.log('\n========================================\n');

    await pool.end();
  } catch (err) {
    console.error('[ERROR]', err.message);
    process.exit(1);
  }
}

const contestInstanceId = process.argv[2];
traceWrites(contestInstanceId);
