#!/usr/bin/env node

/**
 * PGA Scoring Debug Trace
 *
 * Traces the scoring pipeline end-to-end for a given contest instance.
 * READ-ONLY — no mutations, no side effects.
 *
 * Usage:
 *   node backend/scripts/debug/pgaScoringDebug.js <contest_instance_id>
 */

const { Pool } = require('pg');

let contestInstanceId = process.argv[2];

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function run() {
  const client = await pool.connect();
  try {
    if (!contestInstanceId) {
      console.log('[AUTO-SELECT] No contest_id provided. Fetching LIVE contest with most participants...\n');

      const contestResult = await client.query(`
        SELECT
          ci.id,
          ci.status,
          COUNT(cp.user_id) as participant_count
        FROM contest_instances ci
        LEFT JOIN contest_participants cp
          ON cp.contest_instance_id = ci.id
        WHERE ci.status = 'LIVE'
        GROUP BY ci.id, ci.status
        ORDER BY participant_count DESC
        LIMIT 1
      `);

      if (contestResult.rows.length === 0) {
        console.error('[AUTO-SELECT] No LIVE contests found.');
        process.exit(1);
      }

      contestInstanceId = contestResult.rows[0].id;

      console.log('[AUTO-SELECT] Using contest:', contestInstanceId,
        '| Status:', contestResult.rows[0].status,
        '| Participants:', contestResult.rows[0].participant_count, '\n'
      );
    }

    // 1. Entry Rosters
    console.log('\n--- ENTRY ROSTERS ---\n');
    const rosters = await client.query(
      `SELECT
        er.user_id,
        u.username,
        er.player_ids
      FROM entry_rosters er
      LEFT JOIN users u ON u.id = er.user_id
      WHERE er.contest_instance_id = $1`,
      [contestInstanceId]
    );
    console.dir(rosters.rows, { depth: null });

    // 2. Raw Golfer Scores
    console.log('\n--- RAW GOLFER SCORES ---\n');
    const rawScores = await client.query(
      `SELECT
        user_id,
        golfer_id,
        hole_points,
        bonus_points,
        finish_bonus
      FROM golfer_scores
      WHERE contest_instance_id = $1
      ORDER BY user_id, golfer_id`,
      [contestInstanceId]
    );
    console.dir(rawScores.rows, { depth: null });

    // 3. Aggregated Golfer Totals
    console.log('\n--- AGGREGATED TOTALS ---\n');
    const aggregated = await client.query(
      `SELECT
        user_id,
        golfer_id,
        SUM(COALESCE(hole_points,0) + COALESCE(bonus_points,0) + COALESCE(finish_bonus,0)) AS total_points
      FROM golfer_scores
      WHERE contest_instance_id = $1
      GROUP BY user_id, golfer_id
      ORDER BY user_id, total_points DESC`,
      [contestInstanceId]
    );
    console.dir(aggregated.rows, { depth: null });

    // 4. Best 6 of 7
    console.log('\n--- BEST 6 ---\n');
    const best6 = await client.query(
      `WITH golfer_totals AS (
        SELECT
          user_id,
          golfer_id,
          SUM(COALESCE(hole_points,0) + COALESCE(bonus_points,0) + COALESCE(finish_bonus,0)) AS total_points
        FROM golfer_scores
        WHERE contest_instance_id = $1
        GROUP BY user_id, golfer_id
      ),
      ranked AS (
        SELECT *,
          ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY total_points DESC) as rnk
        FROM golfer_totals
      )
      SELECT
        user_id,
        SUM(total_points) as best_6_total
      FROM ranked
      WHERE rnk <= 6
      GROUP BY user_id
      ORDER BY best_6_total DESC`,
      [contestInstanceId]
    );
    console.dir(best6.rows, { depth: null });

    // 5. Contest Participants
    console.log('\n--- PARTICIPANTS ---\n');
    const participants = await client.query(
      `SELECT *
      FROM contest_participants
      WHERE contest_instance_id = $1`,
      [contestInstanceId]
    );
    console.dir(participants.rows, { depth: null });

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Debug script failed:', err);
  process.exit(1);
});
