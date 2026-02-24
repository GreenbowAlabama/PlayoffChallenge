/**
 * PGA Settlement Strategy
 *
 * Aggregates golfer scores across all rounds for each participant entry.
 *
 * Algorithm:
 * 1. Query golfer round scores for all rounds
 * 2. Group by participant and golfer
 * 3. Accumulate each golfer's total_points across all rounds
 * 4. For each participant:
 *    - Apply entry aggregation: drop lowest golfer, sum best 6
 * 5. Return { user_id, total_score } for each participant
 *
 * @param {string} contestInstanceId - The contest instance UUID
 * @param {Object} client - Database client (within transaction)
 * @returns {Promise<Array<{user_id: string, total_score: number}>>}
 */
async function pgaSettlementFn(contestInstanceId, client) {
  // Query all golfer round scores for this contest
  // Expected schema: golfer_scores with columns:
  // user_id, golfer_id, round_number, total_points (or hole_points, bonus_points, finish_bonus)
  const scoresResult = await client.query(`
    SELECT
      cp.user_id,
      gs.golfer_id,
      SUM(COALESCE(gs.total_points, 0)) as golfer_total
    FROM contest_participants cp
    LEFT JOIN golfer_scores gs ON gs.user_id = cp.user_id
      AND gs.contest_instance_id = $1
    WHERE cp.contest_instance_id = $1
    GROUP BY cp.user_id, gs.golfer_id
    ORDER BY cp.user_id, golfer_total DESC
  `, [contestInstanceId]);

  // Aggregate golfer scores by participant
  // Structure: { user_id: { golfer_id: total_points, ... }, ... }
  const participantGolfers = {};

  scoresResult.rows.forEach(row => {
    if (!participantGolfers[row.user_id]) {
      participantGolfers[row.user_id] = {};
    }

    // Only include golfers with scores (not null)
    // Coerce golfer_total to number (database may return as string)
    if (row.golfer_id !== null && row.golfer_total !== null) {
      participantGolfers[row.user_id][row.golfer_id] = Number(row.golfer_total);
    }
  });

  // Apply entry aggregation (drop lowest golfer, sum best 6) for each participant
  const { aggregateEntryScore } = require('../scoring/pgaEntryAggregation');

  const participantScores = [];

  for (const [userId, golfersMap] of Object.entries(participantGolfers)) {
    // Convert golfer map to array of score objects
    const golferScores = Object.entries(golfersMap).map(([golferId, totalPoints]) => ({
      golfer_id: golferId,
      total_points: totalPoints
    }));

    // Aggregate entry: drop lowest, sum best 6
    const aggregation = aggregateEntryScore(golferScores);

    participantScores.push({
      user_id: userId,
      total_score: aggregation.entry_total
    });
  }

  return participantScores;
}

module.exports = { pgaSettlementFn };
