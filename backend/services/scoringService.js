/**
 * Scoring Service
 *
 * Dispatches scoring calculation to a registered strategy.
 * Strategy key is hardcoded to 'ppr' until template loading is wired.
 */

const { getScoringStrategy } = require('./scoringRegistry');

/**
 * Calculate fantasy points for a player based on their stats.
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} stats - Player statistics object
 * @returns {Promise<number>} - Calculated fantasy points (rounded to 2 decimal places)
 */
async function calculateFantasyPoints(pool, stats) {
  const scoreFn = getScoringStrategy('ppr');
  return scoreFn(pool, stats);
}

module.exports = {
  calculateFantasyPoints
};
