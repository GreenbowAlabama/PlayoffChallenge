/**
 * Scoring Strategy Registry
 *
 * Maps scoring_strategy_key values to contest-level strategy modules.
 * Each strategy module exports:
 * - liveStandings(pool, contestInstanceId) — fetch and rank LIVE standings
 * - rosterConfig() — return roster size and validation rules
 * - rules(contestRow) — return hole scoring values, bonuses, etc.
 *
 * This registry centralizes all sport-specific dispatch logic.
 * Services use this to avoid string literal conditionals.
 */

const pgaStandardV1 = require('./strategies/pgaStandardV1');
const nflStandardV1 = require('./strategies/nflStandardV1');

const strategies = Object.freeze({
  'pga_standard_v1': pgaStandardV1,
  'nfl_standard_v1': nflStandardV1
});

/**
 * Get a strategy module by key.
 * Falls back to nflStandardV1 for unknown or absent keys (logs a warning).
 *
 * @param {string} strategyKey - Strategy identifier (e.g. 'pga_standard_v1')
 * @returns {Object} Strategy module with { liveStandings, rosterConfig, rules }
 */
function getStrategy(strategyKey) {
  const strategy = strategies[strategyKey];
  if (!strategy) {
    console.warn(
      `[scoringStrategyRegistry] Unknown scoring strategy: '${strategyKey}'. Falling back to nfl_standard_v1. Registered: ${Object.keys(strategies).join(', ')}`
    );
    return nflStandardV1;
  }
  return strategy;
}

/**
 * List all registered strategy keys.
 *
 * @returns {Array<string>} Array of strategy keys
 */
function listStrategies() {
  return Object.keys(strategies);
}

module.exports = {
  getStrategy,
  listStrategies
};
