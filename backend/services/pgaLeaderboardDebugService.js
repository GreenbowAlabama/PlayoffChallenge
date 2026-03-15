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

  // Step 3: Extract golfers from payload
  if (!leaderboardPayload || !leaderboardPayload.golfers || !Array.isArray(leaderboardPayload.golfers)) {
    return [];
  }

  const golferIds = leaderboardPayload.golfers
    .map(g => g.golfer_id)
    .filter(id => id);

  if (golferIds.length === 0) {
    return [];
  }

  // Step 4: Fetch player names for only those golfers
  const playersResult = await pool.query(
    `SELECT id as golfer_id, full_name as player_name
     FROM players
     WHERE id = ANY($1)`,
    [golferIds]
  );

  const playerNameMap = {};
  playersResult.rows.forEach(row => {
    playerNameMap[row.golfer_id] = row.player_name;
  });

  // Step 5: Query golfer_event_scores with LEFT JOIN to golfer_scores overlay
  // This ensures we always have the tournament leaderboard, overlaying fantasy points when available
  const scoresResult = await pool.query(
    `SELECT
       ges.golfer_id,
       SUM(ges.total_points) as event_total_points,
       COALESCE(SUM(gs.total_points), 0) as fantasy_score
     FROM golfer_event_scores ges
     LEFT JOIN golfer_scores gs ON gs.golfer_id = ges.golfer_id
       AND gs.contest_instance_id = ges.contest_instance_id
     WHERE ges.contest_instance_id = $1
       AND ges.golfer_id = ANY($2)
     GROUP BY ges.golfer_id`,
    [contestId, golferIds]
  );

  const scoresMap = {};
  scoresResult.rows.forEach(row => {
    scoresMap[row.golfer_id] = {
      event_points: row.event_total_points || 0,
      fantasy_score: row.fantasy_score || 0
    };
  });

  // Step 6: Merge snapshot leaderboard (with strokes) + scores overlay
  const result = [];

  for (const golfer of leaderboardPayload.golfers) {
    if (!golfer.golfer_id) {
      continue;
    }

    // Calculate total strokes from holes in snapshot
    let totalStrokes = 0;

    if (golfer.holes && Array.isArray(golfer.holes)) {
      for (const hole of golfer.holes) {
        if (typeof hole.strokes === 'number') {
          totalStrokes += hole.strokes;
        }
      }
    }

    // Get overlay scores (fantasy points from per-roster scoring)
    const scoreData = scoresMap[golfer.golfer_id] || { event_points: 0, fantasy_score: 0 };

    // Step 7: Build response object matching OpenAPI schema exactly
    result.push({
      golfer_id: golfer.golfer_id,
      player_name: playerNameMap[golfer.golfer_id] || 'Unknown',
      position: golfer.position || 0,
      total_strokes: totalStrokes,
      fantasy_score: scoreData.fantasy_score
    });
  }

  return result;
}

module.exports = {
  getPgaLeaderboardWithScores
};
