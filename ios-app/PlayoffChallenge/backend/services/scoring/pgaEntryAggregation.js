/**
 * PGA Entry Aggregation
 *
 * Aggregates individual golfer scores into a single entry score.
 * Rules:
 * - Accepts up to 7 golfers
 * - Drops the lowest total_points score
 * - Sums the best 6
 * - Returns deterministic results across multiple runs
 * - Does not mutate input array
 */

/**
 * Aggregate golfer scores by dropping the lowest and summing the best 6.
 *
 * Assumes golfer_scores is a pre-computed array of per-golfer round scores.
 * Each score object must have a total_points property (number).
 *
 * @param {Array<{golfer_id: string, total_points: number, ...}>} golferScores
 * @returns {{best_6_sum: number, dropped_golfer_id: string|null, entry_total: number}}
 */
function aggregateEntryScore(golferScores) {
  // Defensive: non-mutating copy
  const scores = golferScores.map((s) => ({ ...s }));

  if (scores.length === 0) {
    return {
      best_6_sum: 0,
      dropped_golfer_id: null,
      entry_total: 0
    };
  }

  if (scores.length <= 6) {
    // Fewer than 7 golfers: no drop, just sum all
    const sum = scores.reduce((acc, s) => acc + (s.total_points || 0), 0);
    return {
      best_6_sum: sum,
      dropped_golfer_id: null,
      entry_total: sum
    };
  }

  // Find the index of the lowest total_points
  let lowestIndex = 0;
  let lowestScore = scores[0].total_points || 0;

  for (let i = 1; i < scores.length; i++) {
    const current = scores[i].total_points || 0;
    if (current < lowestScore) {
      lowestScore = current;
      lowestIndex = i;
    }
  }

  // Drop the lowest
  const dropped = scores.splice(lowestIndex, 1)[0];
  const droppedGolferId = dropped.golfer_id || null;

  // Sum the remaining (best 6)
  const best6Sum = scores.reduce((acc, s) => acc + (s.total_points || 0), 0);

  return {
    best_6_sum: best6Sum,
    dropped_golfer_id: droppedGolferId,
    entry_total: best6Sum
  };
}

module.exports = {
  aggregateEntryScore
};
