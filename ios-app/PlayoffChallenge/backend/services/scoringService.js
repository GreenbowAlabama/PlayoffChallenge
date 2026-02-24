/**
 * Scoring Service
 *
 * Dispatches scoring calculation to a registered strategy.
 * Strategy key must always come from the contest template.
 */

const { getScoringStrategy } = require('./scoringRegistry');

/**
 * Calculate fantasy points for a player based on their stats.
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} stats - Player statistics object
 * @param {string} strategyKey - Scoring strategy key from contest template
 * @returns {Promise<number>} - Calculated fantasy points (rounded to 2 decimal places)
 */
async function calculateFantasyPoints(pool, stats, strategyKey) {
  // Strategy key must always come from template
  const scoreFn = getScoringStrategy(strategyKey);
  return scoreFn(pool, stats);
}

module.exports = {
  calculateFantasyPoints
};
