/**
 * PGA Roster Scoring Service
 *
 * Populates golfer_scores for all rosters in a contest.
 * Matches entry_rosters to golfer_event_scores and inserts/updates golfer_scores.
 *
 * Entry point: scoreContestRosters(contestInstanceId, dbClient)
 */

'use strict';

/**
 * Score all rosters in a contest.
 *
 * For each entry_roster in the contest:
 * - Get all players (golfer_ids) in the roster
 * - For each player, fetch their golfer_event_scores
 * - Insert/upsert golfer_scores records
 *
 * @param {string} contestInstanceId - Contest UUID
 * @param {PgClient} dbClient - Database client with transaction support
 * @returns {Promise<void>}
 */
async function scoreContestRosters(contestInstanceId, dbClient) {
  if (!contestInstanceId || !dbClient) {
    throw new Error('scoreContestRosters requires contestInstanceId and dbClient');
  }

  // Fetch all rosters for this contest
  const rosters = await dbClient.query(
    `SELECT id, user_id, player_ids FROM entry_rosters
     WHERE contest_instance_id = $1`,
    [contestInstanceId]
  );

  if (!rosters.rows || rosters.rows.length === 0) {
    // No rosters yet, nothing to score
    return;
  }

  // For each roster, score each golfer
  for (const roster of rosters.rows) {
    const userId = roster.user_id;
    const golferIds = roster.player_ids || [];

    // For each golfer in the roster
    for (const golferId of golferIds) {
      // Get all rounds for this golfer in this contest
      const golfScores = await dbClient.query(
        `SELECT round_number, hole_points, bonus_points, finish_bonus, total_points
         FROM golfer_event_scores
         WHERE contest_instance_id = $1 AND golfer_id = $2
         ORDER BY round_number ASC`,
        [contestInstanceId, golferId]
      );

      // Insert/update golfer_scores for each round
      for (const score of golfScores.rows) {
        await dbClient.query(
          `INSERT INTO golfer_scores (
            contest_instance_id, user_id, golfer_id, round_number,
            hole_points, bonus_points, finish_bonus, total_points
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (contest_instance_id, user_id, golfer_id, round_number)
          DO UPDATE SET
            hole_points = EXCLUDED.hole_points,
            bonus_points = EXCLUDED.bonus_points,
            finish_bonus = EXCLUDED.finish_bonus,
            total_points = EXCLUDED.total_points,
            updated_at = NOW()`,
          [
            contestInstanceId,
            userId,
            golferId,
            score.round_number,
            score.hole_points || 0,
            score.bonus_points || 0,
            score.finish_bonus || 0,
            score.total_points || 0
          ]
        );
      }
    }
  }
}

module.exports = {
  scoreContestRosters
};
