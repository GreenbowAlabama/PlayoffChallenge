/**
 * PGA Leaderboard Debug Service
 *
 * Purpose: Read-only operational diagnostic for PGA scoring validation
 * Exposes current leaderboard snapshot with cumulative fantasy scores
 *
 * Constraints:
 * - No mutations
 * - No ledger interaction
 * - No lifecycle interaction
 * - Read-only diagnostic only
 *
 * Scoring Model:
 * Fantasy score is cumulative across all rounds per golfer.
 * Computed as: SUM(total_points) GROUP BY golfer_id
 * Matches settlement aggregation model.
 */

/**
 * ⚠️ ESPN PGA PAYLOAD CONTRACT
 *
 * Snapshots contain payload.competitors[]
 *
 * Stroke structure:
 *
 * competitor.linescores[]
 *   → round
 *     linescores[]
 *       → hole
 *         value = strokes
 *
 * DO NOT attempt to read competitor.holes[].
 *
 * Golfer IDs must be normalized:
 * espn_<athlete_id>
 *
 * Breaking either rule will cause leaderboard joins to fail.
 *
 * See: docs/architecture/providers/espn_pga_payload.md
 * See: docs/architecture/scoring/golfer_identity.md
 */

/**
 * Get PGA leaderboard with computed fantasy scores
 *
 * ALWAYS displays the PGA tournament leaderboard using golfer_event_scores,
 * and overlays fantasy scoring from golfer_scores when it exists.
 *
 * Works even when no contest entries exist (golfer_event_scores is independent of entries).
 *
 * Returns response matching OpenAPI PgaLeaderboardEntry schema exactly:
 * - golfer_id (string)
 * - player_name (string)
 * - position (integer)
 * - total_strokes (integer)
 * - fantasy_score (number)
 *
 * @param {Object} pool - Database connection pool
 * @returns {Promise<Array>} Array of leaderboard entries with fantasy scores
 */
async function getPgaLeaderboardWithScores(pool) {
  // Step 1: Locate the active PGA/GOLF contest (by tournament_start_time, most recent)
  // Uses explicit sport whitelist to support multiple storage variants without implicit normalization.
  // Supported values: 'PGA', 'pga', 'GOLF', 'golf' (all golf variants in system).
  const contestResult = await pool.query(
    `SELECT ci.id as contest_id
     FROM contest_instances ci
     JOIN contest_templates ct ON ct.id = ci.template_id
     WHERE ct.sport IN ('PGA', 'pga', 'GOLF', 'golf')
       AND ci.status IN ('LIVE', 'COMPLETE')
     ORDER BY ci.tournament_start_time DESC
     LIMIT 1`
  );

  if (contestResult.rows.length === 0) {
    return [];
  }

  const contestId = contestResult.rows[0].contest_id;

  // Step 2: Get the latest leaderboard snapshot for this contest (raw tournament data)
  // Snapshot domain: tournament leaderboard with stroke data (JSON structure)
  const snapshotResult = await pool.query(
    `SELECT payload
     FROM event_data_snapshots
     WHERE contest_instance_id = $1
     ORDER BY ingested_at DESC
     LIMIT 1`,
    [contestId]
  );

  if (snapshotResult.rows.length === 0) {
    return [];
  }

  const leaderboardPayload = snapshotResult.rows[0].payload;

  // Step 3: Extract golfers from payload.competitors (ESPN leaderboard format)
  // Normalize IDs to espn_<athlete_id> format to match golfer_event_scores.golfer_id
  if (!leaderboardPayload || !leaderboardPayload.competitors || !Array.isArray(leaderboardPayload.competitors)) {
    return [];
  }

  const golferIds = leaderboardPayload.competitors
    .map(c => {
      const id = c.athlete?.id || c.id;
      return id ? `espn_${id}` : null;
    })
    .filter(Boolean);

  if (golferIds.length === 0) {
    return [];
  }

  // Step 4: Query golfer_event_scores with player names, score, and finish bonus
  const scoresResult = await pool.query(
    `SELECT
       ges.golfer_id,
       COALESCE(p.full_name, 'Unknown') as player_name,
       -SUM(COALESCE(ges.hole_points, 0)) as score_to_par,
       SUM(COALESCE(ges.finish_bonus, 0)) as finish_bonus,
       SUM(
         COALESCE(ges.hole_points, 0) +
         COALESCE(ges.bonus_points, 0) +
         COALESCE(ges.finish_bonus, 0)
       ) as fantasy_score
     FROM golfer_event_scores ges
     LEFT JOIN players p
       ON p.espn_id::text = REPLACE(ges.golfer_id, 'espn_', '')
     WHERE ges.contest_instance_id = $1
       AND ges.golfer_id = ANY($2)
     GROUP BY ges.golfer_id, p.full_name`,
    [contestId, golferIds]
  );

  // Build lookup map from scores query result
  const scoresMap = {};

  scoresResult.rows.forEach(row => {
    if (row.golfer_id) {
      scoresMap[row.golfer_id] = {
        player_name: row.player_name || 'Unknown',
        score_to_par: row.score_to_par || 0,
        finish_bonus: row.finish_bonus || 0,
        fantasy_score: row.fantasy_score || 0
      };
    }
  });

  // Step 6: Build result from scores query (player names and scores from normalized tables)
  const result = [];

  for (const competitor of leaderboardPayload.competitors) {
    const competitorId = competitor.athlete?.id || competitor.id;
    if (!competitorId) {
      continue;
    }

    const normalizedGolferId = `espn_${competitorId}`;

    // Get scores and player name from database query
    const scoreData = scoresMap[normalizedGolferId] || { player_name: 'Unknown', score_to_par: 0, fantasy_score: 0 };

    // Step 7: Build response object with score, finish bonus, and fantasy score
    // Position will be calculated after sorting by score_to_par
    result.push({
      golfer_id: normalizedGolferId,
      player_name: scoreData.player_name,
      position: 0,  // Computed below after sorting
      score: scoreData.score_to_par,
      finish_bonus: scoreData.finish_bonus,
      fantasy_score: scoreData.fantasy_score
    });
  }

  // Step 8: Compute leaderboard position from score relative to par
  // Golf leaderboards rank by lowest score (best = lowest/most negative)
  // Golfers with 0 score (not started) sort to bottom
  result.sort((a, b) => {
    if (a.score === 0) return 1;
    if (b.score === 0) return -1;
    return a.score - b.score;
  });

  // Assign rank numbers after sorting
  let rank = 1;
  for (const row of result) {
    row.position = rank++;
  }

  return result;
}

module.exports = {
  getPgaLeaderboardWithScores
};
