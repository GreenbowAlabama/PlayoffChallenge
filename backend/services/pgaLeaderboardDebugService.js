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
 * Fetches the most recent PGA contest and returns current leaderboard
 * with cumulative fantasy scores across all rounds.
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
  // Step 1: Locate the active PGA contest (by tournament_start_time, most recent)
  const contestResult = await pool.query(
    `SELECT ci.id as contest_id
     FROM contest_instances ci
     JOIN contest_templates ct ON ct.id = ci.template_id
     WHERE ct.sport = 'PGA'
       AND ci.status IN ('LIVE', 'COMPLETE')
     ORDER BY ci.tournament_start_time DESC
     LIMIT 1`
  );

  if (contestResult.rows.length === 0) {
    return [];
  }

  const contestId = contestResult.rows[0].contest_id;

  // Step 2: Get the latest leaderboard snapshot for this contest
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

  // Step 4: Fetch player names for only those golfers (constrained query)
  // Note: players.id is the golfer_id, players.full_name is the player name
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

  // Step 5: Aggregate fantasy scores (cumulative across all rounds)
  const scoresResult = await pool.query(
    `SELECT
       golfer_id,
       SUM(total_points) as fantasy_score
     FROM golfer_scores
     WHERE contest_instance_id = $1
       AND golfer_id = ANY($2)
     GROUP BY golfer_id`,
    [contestId, golferIds]
  );

  const scoresMap = {};
  scoresResult.rows.forEach(row => {
    scoresMap[row.golfer_id] = row.fantasy_score || 0;
  });

  // Step 6: Merge snapshot leaderboard + scores
  const result = [];

  for (const golfer of leaderboardPayload.golfers) {
    if (!golfer.golfer_id) {
      continue;
    }

    // Calculate total strokes from holes in snapshot
    let totalStrokes = 0;
    let totalPar = 0;

    if (golfer.holes && Array.isArray(golfer.holes)) {
      for (const hole of golfer.holes) {
        if (typeof hole.strokes === 'number' && typeof hole.par === 'number') {
          totalStrokes += hole.strokes;
          totalPar += hole.par;
        }
      }
    }

    // Step 7: Build response object matching OpenAPI schema exactly
    // No additional fields allowed
    result.push({
      golfer_id: golfer.golfer_id,
      player_name: playerNameMap[golfer.golfer_id] || 'Unknown',
      position: golfer.position || 0,
      total_strokes: totalStrokes,
      fantasy_score: scoresMap[golfer.golfer_id] || 0
    });
  }

  return result;
}

module.exports = {
  getPgaLeaderboardWithScores
};
