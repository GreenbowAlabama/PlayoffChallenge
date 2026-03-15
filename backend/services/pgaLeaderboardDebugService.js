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

  // Step 4: Query golfer_event_scores for fantasy scores
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // IMPORTANT: golfer_event_scores ID format and join safety
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //
  // golfer_event_scores.golfer_id uses ESPN normalized format:
  //     espn_<athleteId>
  //
  // Example values:
  //     espn_1030
  //     espn_10372
  //     espn_11253
  //
  // Do NOT attempt to join against players.id (UUID)!
  // This will fail silently and return no matches:
  //     ❌ LEFT JOIN players p ON p.id = ges.golfer_id
  //        (UUID type vs text "espn_<id>" type mismatch)
  //
  // Player names MUST come from ESPN snapshot payload:
  //     ✅ competitor.athlete.displayName (from leaderboard payload)
  //     ✅ competitor.displayName (fallback)
  //
  // This is enforced by architecture at multiple levels:
  // 1. pgaEspnIngestion.js — writes golfer_id as espn_<athleteId>
  // 2. pgaLeaderboardDebugService.js — reads golfer_id same format
  // 3. Snapshot data — provides player names
  //
  // Violating this contract will cause:
  // - fantasy_score = 0 for all golfers
  // - Silent query failure (no error, just no matches)
  // - Leaderboard diagnostics showing empty scoring data
  //
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const scoresResult = await pool.query(
    `SELECT
       ges.golfer_id,
       COALESCE(SUM(ges.total_points), 0) as fantasy_score
     FROM golfer_event_scores ges
     WHERE ges.contest_instance_id = $1
       AND ges.golfer_id = ANY($2)
     GROUP BY ges.golfer_id`,
    [contestId, golferIds]
  );

  // Build lookup map from scores query result
  const scoresMap = {};

  scoresResult.rows.forEach(row => {
    if (row.golfer_id) {
      scoresMap[row.golfer_id] = {
        event_points: row.fantasy_score || 0,
        fantasy_score: row.fantasy_score || 0
      };
    }
  });

  // Step 6: Merge snapshot leaderboard (with strokes) + scores overlay
  const result = [];

  for (const competitor of leaderboardPayload.competitors) {
    const competitorId = competitor.athlete?.id || competitor.id;
    if (!competitorId) {
      continue;
    }

    const normalizedGolferId = `espn_${competitorId}`;

    // Calculate total strokes from ESPN linescores structure
    let totalStrokes = 0;

    // Check if ESPN provides total directly (optimization)
    if (typeof competitor.total === 'number') {
      totalStrokes = competitor.total;
    } else {
      // Compute from linescores: competitor.linescores[].linescores[].value
      // where period = round, linescores = holes, value = strokes
      if (Array.isArray(competitor.linescores)) {
        for (const round of competitor.linescores) {
          if (!Array.isArray(round.linescores)) continue;

          for (const hole of round.linescores) {
            if (typeof hole.value === 'number') {
              totalStrokes += hole.value;
            }
          }
        }
      }
    }

    // Get overlay scores (fantasy points from per-roster scoring)
    const scoreData = scoresMap[normalizedGolferId] || { event_points: 0, fantasy_score: 0 };

    // Get player name from snapshot data
    // Competitor data comes from ESPN payload, not from players database
    const playerName = competitor.athlete?.displayName || competitor.displayName || 'Unknown';

    // Step 7: Build response object matching OpenAPI schema exactly
    // Position will be calculated after sorting by strokes
    result.push({
      golfer_id: normalizedGolferId,
      player_name: playerName,
      position: 0,  // Computed below after sorting
      total_strokes: totalStrokes,
      fantasy_score: scoreData.fantasy_score
    });
  }

  // Step 8: Compute leaderboard position from stroke totals
  // Golf leaderboards rank by lowest strokes (best = lowest)
  // Golfers with 0 strokes (not started) sort to bottom
  result.sort((a, b) => {
    if (a.total_strokes === 0) return 1;
    if (b.total_strokes === 0) return -1;
    return a.total_strokes - b.total_strokes;
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
