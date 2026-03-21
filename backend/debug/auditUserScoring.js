/**
 * AUDIT USER SCORING — Cross-User Duplication Detection
 *
 * Purpose: Identify scoring duplication and aggregation bugs
 *
 * Usage (run on staging with DATABASE_URL set):
 *   node backend/debug/auditUserScoring.js
 *
 * Output: CSV and console logs detailing per-golfer score contributions
 */

const { Pool } = require('pg');

async function auditUserScoring() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    // Hardcoded user_id from task description
    const USER_ID = 'a940693d-350c-4b72-8232-4186fdba06bb';

    console.log(`\n========== AUDIT USER SCORING ==========`);
    console.log(`User ID: ${USER_ID}`);
    console.log(`Timestamp: ${new Date().toISOString()}\n`);

    // ========== STEP 1: Find active contest for this user
    console.log(`--- STEP 1: Find Active Contest ---`);
    const contestResult = await pool.query(
      `SELECT
        cp.contest_instance_id,
        ci.contest_name,
        ci.status,
        cct.template_type,
        cct.scoring_strategy_key
      FROM contest_participants cp
      JOIN contest_instances ci ON ci.id = cp.contest_instance_id
      LEFT JOIN contest_templates cct ON cct.id = ci.template_id
      WHERE cp.user_id = $1
        AND ci.status IN ('LIVE', 'COMPLETE')
      ORDER BY ci.updated_at DESC
      LIMIT 1`,
      [USER_ID]
    );

    if (contestResult.rows.length === 0) {
      console.log(`❌ No active (LIVE/COMPLETE) contest found for user ${USER_ID}`);
      process.exit(0);
    }

    const contest = contestResult.rows[0];
    const contestId = contest.contest_instance_id;
    console.log(`✅ Found contest: ${contest.contest_name}`);
    console.log(`   ID: ${contestId}`);
    console.log(`   Status: ${contest.status}`);
    console.log(`   Strategy: ${contest.scoring_strategy_key}\n`);

    // ========== STEP 2: Fetch user's roster (player_ids)
    console.log(`--- STEP 2: User Roster (Player IDs) ---`);
    const rosterResult = await pool.query(
      `SELECT
        player_ids
      FROM entry_rosters
      WHERE user_id = $1
        AND contest_instance_id = $2
      LIMIT 1`,
      [USER_ID, contestId]
    );

    if (rosterResult.rows.length === 0) {
      console.log(`❌ No roster found for user in this contest`);
      process.exit(0);
    }

    const playerIds = rosterResult.rows[0].player_ids;
    console.log(`✅ Roster: ${playerIds.join(', ')}`);
    console.log(`   Total players: ${playerIds.length}\n`);

    // ========== STEP 3: Fetch golfer scores for this user from golfer_scores table
    console.log(`--- STEP 3: Raw Golfer Scores (golfer_scores table) ---`);
    console.log(`Columns: golfer_id, round_number, hole_points, bonus_points, finish_bonus, total_points`);

    const userScoresResult = await pool.query(
      `SELECT
        golfer_id,
        round_number,
        hole_points,
        bonus_points,
        finish_bonus,
        total_points,
        (hole_points + bonus_points + finish_bonus) AS computed_total
      FROM golfer_scores
      WHERE contest_instance_id = $1
        AND user_id = $2
      ORDER BY golfer_id, round_number`,
      [contestId, USER_ID]
    );

    console.log(`Found ${userScoresResult.rows.length} score records for this user\n`);
    userScoresResult.rows.forEach(row => {
      console.log(
        `  ${row.golfer_id.padEnd(6)} | ` +
        `Round ${row.round_number} | ` +
        `Hole: ${String(row.hole_points).padStart(3)}, ` +
        `Bonus: ${String(row.bonus_points).padStart(3)}, ` +
        `Finish: ${String(row.finish_bonus).padStart(3)} | ` +
        `Total: ${row.total_points}`
      );
    });

    // ========== STEP 4: Per-player aggregation (as it should be done)
    console.log(`\n--- STEP 4: Per-Player Aggregation (User-Scoped) ---`);
    const perPlayerAggResult = await pool.query(
      `SELECT
        golfer_id,
        COUNT(*) AS record_count,
        SUM(hole_points) AS total_hole_points,
        SUM(bonus_points) AS total_bonus_points,
        SUM(finish_bonus) AS total_finish_bonus,
        SUM(hole_points + bonus_points + finish_bonus) AS user_final_score
      FROM golfer_scores
      WHERE contest_instance_id = $1
        AND user_id = $2
      GROUP BY golfer_id
      ORDER BY user_final_score DESC`,
      [contestId, USER_ID]
    );

    console.log(`Per-player contribution (user-scoped):\n`);
    let userTotal = 0;
    perPlayerAggResult.rows.forEach(row => {
      userTotal += parseFloat(row.user_final_score) || 0;
      console.log(
        `  ${row.golfer_id.padEnd(6)} | ` +
        `Records: ${String(row.record_count).padStart(2)} | ` +
        `Score: ${String(row.user_final_score).padStart(6)} ` +
        `(hole: ${String(row.total_hole_points).padStart(3)}, ` +
        `bonus: ${String(row.total_bonus_points).padStart(3)}, ` +
        `finish: ${String(row.total_finish_bonus).padStart(3)})`
      );
    });
    console.log(`\nUser total (all players): ${userTotal}\n`);

    // ========== STEP 5: Check for duplication (same golfer, multiple records)
    console.log(`--- STEP 5: Duplication Check ---`);
    const dupCheckResult = await pool.query(
      `SELECT
        golfer_id,
        COUNT(*) AS record_count,
        MAX(round_number) AS max_round,
        MIN(round_number) AS min_round
      FROM golfer_scores
      WHERE contest_instance_id = $1
        AND user_id = $2
      GROUP BY golfer_id
      HAVING COUNT(*) > 1
      ORDER BY record_count DESC`,
      [contestId, USER_ID]
    );

    if (dupCheckResult.rows.length === 0) {
      console.log(`✅ No duplicate golfers (each golfer appears exactly once per round)\n`);
    } else {
      console.log(`⚠️  Potential duplication found:\n`);
      dupCheckResult.rows.forEach(row => {
        console.log(`  ${row.golfer_id}: ${row.record_count} records (rounds ${row.min_round}-${row.max_round})`);
      });
      console.log();
    }

    // ========== STEP 6: Compare with leaderboard calculation
    console.log(`--- STEP 6: Leaderboard Calculation (Current Query Logic) ---`);

    const leaderboardResult = await pool.query(
      `WITH roster_golfers AS (
         SELECT
           er.user_id,
           UNNEST(er.player_ids) AS golfer_id
         FROM entry_rosters er
         WHERE er.contest_instance_id = $1
       ),
       golfer_totals AS (
         SELECT
           rg.user_id,
           rg.golfer_id,
           COALESCE(gs_agg.total, 0) AS total_points
         FROM roster_golfers rg
         LEFT JOIN (
           SELECT
             contest_instance_id,
             golfer_id,
             SUM(hole_points + bonus_points + finish_bonus) AS total
           FROM golfer_scores
           WHERE contest_instance_id = $1
           GROUP BY contest_instance_id, golfer_id
         ) gs_agg
           ON gs_agg.golfer_id = rg.golfer_id
          AND gs_agg.contest_instance_id = $1
         GROUP BY rg.user_id, rg.golfer_id, gs_agg.total
       ),
       ranked AS (
         SELECT
           *,
           ROW_NUMBER() OVER (
             PARTITION BY user_id
             ORDER BY total_points DESC
           ) AS rnk,
           COUNT(*) OVER (PARTITION BY user_id) AS roster_size
         FROM golfer_totals
       )
       SELECT
         r.user_id,
         r.golfer_id,
         r.total_points,
         r.rnk,
         r.roster_size
       FROM ranked r
       WHERE r.user_id = $2
       ORDER BY r.rnk`,
      [contestId, USER_ID]
    );

    console.log(`Leaderboard calculation result for user:\n`);
    let leaderboardTotal = 0;
    const selectedPlayers = [];
    leaderboardResult.rows.forEach(row => {
      if (row.rnk <= 6) {
        leaderboardTotal += parseFloat(row.total_points) || 0;
        selectedPlayers.push(`${row.golfer_id}(${row.total_points})`);
      }
      console.log(
        `  Rank ${String(row.rnk).padStart(2)}: ${row.golfer_id.padEnd(6)} | ` +
        `Score: ${String(row.total_points).padStart(6)} | ` +
        `(of ${row.roster_size} in roster)`
      );
    });
    console.log(`\nSelected (top 6): ${selectedPlayers.join(', ')}`);
    console.log(`Leaderboard total (best 6 of 7): ${leaderboardTotal}\n`);

    // ========== STEP 7: Cross-user score detection
    console.log(`--- STEP 7: Cross-User Score Detection ---`);

    const crossUserResult = await pool.query(
      `WITH roster_golfers AS (
         SELECT DISTINCT UNNEST(player_ids) AS golfer_id FROM entry_rosters
         WHERE contest_instance_id = $1 AND user_id = $2
       ),
       other_users_with_golfer AS (
         SELECT DISTINCT
           cp.user_id,
           COUNT(DISTINCT gs.golfer_id) AS golfer_score_count
         FROM contest_participants cp
         JOIN golfer_scores gs ON gs.contest_instance_id = cp.contest_instance_id
           AND gs.user_id = cp.user_id
         WHERE cp.contest_instance_id = $1
           AND cp.user_id != $2
           AND EXISTS (
             SELECT 1 FROM roster_golfers rg
             WHERE rg.golfer_id = gs.golfer_id
           )
         GROUP BY cp.user_id
       )
       SELECT COUNT(*) AS other_users_with_same_golfers
       FROM other_users_with_golfer`,
      [contestId, USER_ID]
    );

    const otherUsersCount = crossUserResult.rows[0].other_users_with_same_golfers;
    console.log(`Other users with SAME golfers in their rosters: ${otherUsersCount}`);

    if (otherUsersCount > 0) {
      console.log(`⚠️  CROSS-USER RISK: If these golfers' scores are aggregated without\n   filtering by user_id, all users will receive the combined total!\n`);
    } else {
      console.log(`✅ No cross-user overlap in golfers (duplication risk is lower)\n`);
    }

    // ========== SUMMARY
    console.log(`========== SUMMARY ==========`);
    console.log(`User-Scoped Total:        ${userTotal.toFixed(2)}`);
    console.log(`Leaderboard Query Total:  ${leaderboardTotal.toFixed(2)}`);
    const diff = Math.abs(userTotal - leaderboardTotal);
    if (diff > 0.01) {
      console.log(`❌ MISMATCH: ${diff.toFixed(2)} point difference\n`);
      console.log(`   → Likely cause: golfer_scores aggregation missing user_id filter`);
      console.log(`   → Multiple users with same golfer are summing scores together\n`);
    } else {
      console.log(`✅ Scores match (no duplication detected)\n`);
    }

  } catch (err) {
    console.error('❌ Error during audit:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

auditUserScoring();
