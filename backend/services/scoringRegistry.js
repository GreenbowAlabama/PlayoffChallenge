/**
 * Scoring Strategy Registry
 *
 * Maps template scoring_strategy_key values to scoring functions.
 * Each scoring function has signature: async (pool, stats) => number
 */

const { nflScoringFn } = require('./strategies/nflScoring');
const { scoreRound: pgaStandardScoring } = require('./scoring/strategies/pgaStandardScoring');

const scoringStrategies = Object.freeze({
  'ppr': nflScoringFn,
  'half_ppr': nflScoringFn,
  'standard': nflScoringFn,
  'pga_standard_v1': pgaStandardScoring
});

function getScoringStrategy(key) {
  const strategy = scoringStrategies[key];
  if (!strategy) {
    throw new Error(`Unknown scoring strategy: '${key}'. Registered: ${Object.keys(scoringStrategies).join(', ')}`);
  }
  return strategy;
}

function listScoringStrategies() {
  return Object.keys(scoringStrategies);
}

module.exports = { getScoringStrategy, listScoringStrategies };
