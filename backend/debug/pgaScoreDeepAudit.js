#!/usr/bin/env node

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

async function auditScore(contestId, userId) {
  try {
    console.log('=== PGA SCORE DEEP AUDIT ===\n');

    // ========================================
    // 1. VERIFY PARTICIPANT
    // ========================================
    console.log('========================================');
    console.log('1. VERIFY PARTICIPANT');
    console.log('========================================\n');

    const participantResult = await pool.query(
      `SELECT id FROM contest_participants WHERE contest_instance_id = $1 AND user_id = $2`,
      [contestId, userId]
    );

    if (participantResult.rows.length === 0) {
      console.log('ERROR: User is not a participant in this contest\n');
      process.exit(1);
    }

    console.log(`- contest_id: ${contestId}`);
    console.log(`- user_id: ${userId}\n`);

    // ========================================
    // 2. ENTRY_ROSTERS DUP CHECK
    // ========================================
    console.log('========================================');
    console.log('2. ENTRY_ROSTERS DUP CHECK');
    console.log('========================================\n');

    const rostersResult = await pool.query(
      `SELECT id, player_ids, updated_at FROM entry_rosters WHERE contest_instance_id = $1 AND user_id = $2 ORDER BY updated_at DESC`,
      [contestId, userId]
    );

    console.log(`Total entry_rosters rows: ${rostersResult.rows.length}\n`);
    rostersResult.rows.forEach((row, idx) => {
      console.log(`Row ${idx + 1}:`);
      console.log(`  - id: ${row.id}`);
      console.log(`  - player_ids: ${JSON.stringify(row.player_ids)}`);
      console.log(`  - updated_at: ${row.updated_at}\n`);
    });

    const latestRoster = rostersResult.rows[0];
    if (!latestRoster) {
      console.log('ERROR: No roster found\n');
      process.exit(1);
    }

    const playerIds = latestRoster.player_ids || [];

    // ========================================
    // 3. ROSTER EXPANSION (UNNEST)
    // ========================================
    console.log('========================================');
    console.log('3. ROSTER EXPANSION (UNNEST)');
    console.log('========================================\n');

    // A) RAW UNNEST (all entry_rosters rows)
    console.log('A) RAW UNNEST (all entry_rosters rows):');
    const rawUnnestedResult = await pool.query(
      `SELECT user_id, UNNEST(player_ids) AS golfer_id
       FROM entry_rosters
       WHERE contest_instance_id = $1 AND user_id = $2
       ORDER BY golfer_id`,
      [contestId, userId]
    );
    console.log(`Count: ${rawUnnestedResult.rows.length}`);
    const rawCounts = {};
    rawUnnestedResult.rows.forEach(row => {
      rawCounts[row.golfer_id] = (rawCounts[row.golfer_id] || 0) + 1;
    });
    Object.entries(rawCounts).forEach(([gid, cnt]) => {
      console.log(`  - ${gid}: ${cnt}x`);
    });

    // B) DISTINCT UNNEST (latest roster only)
    console.log(`\nB) DISTINCT UNNEST (latest roster only):`);
    const distinctUnnestedResult = await pool.query(
      `SELECT user_id, UNNEST(player_ids) AS golfer_id
       FROM (
         SELECT DISTINCT ON (contest_instance_id, user_id) contest_instance_id, user_id, player_ids
         FROM entry_rosters
         WHERE contest_instance_id = $1 AND user_id = $2
         ORDER BY contest_instance_id, user_id, updated_at DESC
       ) t
       ORDER BY golfer_id`,
      [contestId, userId]
    );
    console.log(`Count: ${distinctUnnestedResult.rows.length}`);
    const distinctCounts = {};
    distinctUnnestedResult.rows.forEach(row => {
      distinctCounts[row.golfer_id] = (distinctCounts[row.golfer_id] || 0) + 1;
    });
    Object.entries(distinctCounts).forEach(([gid, cnt]) => {
      console.log(`  - ${gid}: ${cnt}x`);
    });

    // ========================================
    // 4. SCORING TABLE AUDIT (TOP-6 LOGIC)
    // ========================================
    console.log('\n========================================');
    console.log('4. SCORING TABLE AUDIT (TOP-6 LOGIC)');
    console.log('========================================\n');

    const scoringResult = await pool.query(
      `WITH latest_rosters AS (
         SELECT DISTINCT ON (contest_instance_id, user_id)
           id, contest_instance_id, user_id, player_ids
         FROM entry_rosters
         WHERE contest_instance_id = $1 AND user_id = $2
         ORDER BY contest_instance_id, user_id, updated_at DESC
       ),
       roster_golfers AS (
         SELECT
           lr.user_id,
           UNNEST(lr.player_ids) AS golfer_id
         FROM latest_rosters lr
       ),
       golfer_agg AS (
         SELECT
           golfer_id,
           SUM(hole_points + bonus_points + finish_bonus) AS total
         FROM golfer_event_scores
         WHERE contest_instance_id = $1
         GROUP BY golfer_id
       ),
       golfer_totals AS (
         SELECT
           rg.user_id,
           rg.golfer_id,
           COALESCE(ga.total, 0) AS total_points
         FROM roster_golfers rg
         LEFT JOIN golfer_agg ga ON ga.golfer_id = rg.golfer_id
       ),
       ranked AS (
         SELECT
           *,
           ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY total_points DESC) AS rnk,
           COUNT(*) OVER (PARTITION BY user_id) AS roster_size
         FROM golfer_totals
       )
       SELECT
         golfer_id,
         total_points,
         rnk,
         roster_size
       FROM ranked
       ORDER BY rnk`,
      [contestId, userId]
    );

    console.log('Per-golfer with ranking (all roster):');
    let groundTruthTotal = 0;
    let roster_size = 0;
    scoringResult.rows.forEach(row => {
      const isTopSix = row.rnk <= 6 ? '✓' : '✗';
      console.log(`  - ${row.golfer_id}: ${row.total_points} (rank ${row.rnk}) ${isTopSix}`);
      if (row.rnk <= 6) {
        groundTruthTotal += Number(row.total_points) || 0;
      }
      roster_size = row.roster_size;
    });
    console.log(`\nRoster size: ${roster_size}`);
    console.log(`Ground truth total (top 6 only): ${groundTruthTotal}\n`);

    // ========================================
    // 5. STRATEGY-STYLE AGGREGATION
    // ========================================
    console.log('========================================');
    console.log('5. STRATEGY-STYLE AGGREGATION');
    console.log('========================================\n');

    // Simulate pgaStandardV1 logic with latest_rosters + DISTINCT
    const strategyResult = await pool.query(
      `WITH latest_rosters AS (
         SELECT DISTINCT ON (contest_instance_id, user_id)
           id, contest_instance_id, user_id, player_ids
         FROM entry_rosters
         WHERE contest_instance_id = $1 AND user_id = $2
         ORDER BY contest_instance_id, user_id, updated_at DESC
       ),
       roster_golfers AS (
         SELECT DISTINCT
           lr.user_id,
           UNNEST(lr.player_ids) AS golfer_id
         FROM latest_rosters lr
       ),
       golfer_agg AS (
         SELECT
           golfer_id,
           SUM(hole_points + bonus_points + finish_bonus) AS total
         FROM golfer_event_scores
         WHERE contest_instance_id = $1
         GROUP BY golfer_id
       ),
       golfer_totals AS (
         SELECT
           rg.user_id,
           rg.golfer_id,
           COALESCE(ga.total, 0) AS total_points
         FROM roster_golfers rg
         LEFT JOIN golfer_agg ga ON ga.golfer_id = rg.golfer_id
       ),
       ranked AS (
         SELECT
           *,
           ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY total_points DESC) AS rnk,
           COUNT(*) OVER (PARTITION BY user_id) AS roster_size
         FROM golfer_totals
       ),
       user_totals AS (
         SELECT
           r.user_id,
           SUM(CASE WHEN r.rnk <= 6 THEN r.total_points ELSE 0 END) AS total_score
         FROM ranked r
         GROUP BY r.user_id
       )
       SELECT user_id, total_score FROM user_totals`,
      [contestId, userId]
    );

    const strategyTotal = strategyResult.rows.length > 0 ? strategyResult.rows[0].total_score : 0;
    console.log(`Strategy-style total: ${strategyTotal}\n`);

    // ========================================
    // 6. API-STYLE SIMULATION (POTENTIAL BUG PATH)
    // ========================================
    console.log('========================================');
    console.log('6. API-STYLE SIMULATION (POTENTIAL BUG PATH)');
    console.log('========================================\n');

    const apiSimResult = await pool.query(
      `SELECT
         golfer_id,
         total_points,
         row_num
       FROM (
         SELECT
           rg.golfer_id,
           COALESCE(ga.total, 0) AS total_points,
           ROW_NUMBER() OVER (ORDER BY COALESCE(ga.total, 0) DESC) AS row_num
         FROM (
           SELECT user_id, UNNEST(player_ids) AS golfer_id
           FROM entry_rosters
           WHERE contest_instance_id = $1 AND user_id = $2
         ) rg
         LEFT JOIN (
           SELECT golfer_id, SUM(hole_points + bonus_points + finish_bonus) AS total
           FROM golfer_event_scores
           WHERE contest_instance_id = $1
           GROUP BY golfer_id
         ) ga ON ga.golfer_id = rg.golfer_id
       ) t
       WHERE row_num <= 6
       ORDER BY golfer_id`,
      [contestId, userId]
    );

    console.log('Per-golfer before final aggregation:');
    let apiSimTotal = 0;
    apiSimResult.rows.forEach(row => {
      console.log(`  - ${row.golfer_id}: ${row.total_points}`);
      apiSimTotal += Number(row.total_points) || 0;
    });
    console.log(`\nAPI simulation total: ${apiSimTotal}\n`);

    // ========================================
    // 7. FINAL COMPARISON
    // ========================================
    console.log('========================================');
    console.log('7. FINAL COMPARISON');
    console.log('========================================\n');

    const ground = Number(groundTruthTotal) || 0;
    const strategy = Number(strategyTotal) || 0;
    const api = Number(apiSimTotal) || 0;

    console.log(`GROUND_TRUTH_TOTAL (top 6): ${ground}`);
    console.log(`STRATEGY_TOTAL: ${strategy}`);
    console.log(`API_SIM_TOTAL: ${api}`);

    console.log(`\nDIFF (expected 0):`);
    console.log(`  - Strategy vs Ground: ${strategy - ground}`);
    console.log(`  - API Sim vs Ground: ${api - ground}`);

    if (ground === strategy && ground === api) {
      console.log('\n✅ ALL QUERIES AGREE — no duplication detected');
    } else {
      if (ground !== strategy) {
        console.log('\n❌ STRATEGY QUERY MISMATCH');
      }
      if (ground !== api) {
        console.log('\n❌ API SIMULATION MISMATCH');
      }
    }

    await pool.end();
  } catch (error) {
    console.error('ERROR:', error.message);
    process.exit(1);
  }
}

const contestId = process.argv[2];
const userId = process.argv[3];

if (!contestId || !userId) {
  console.error('Usage: node backend/debug/pgaScoreDeepAudit.js <contest_id> <user_id>');
  process.exit(1);
}

auditScore(contestId, userId);
