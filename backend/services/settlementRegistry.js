/**
 * Settlement Strategy Registry
 *
 * Maps template settlement_strategy_key values to score-aggregation functions.
 * Each function has signature: async (contestInstanceId, client) => Array<{user_id, total_score}>
 *
 * The platform (executeSettlement) handles: locking, idempotency, rankings,
 * payouts, hashing, persistence, and audit. The strategy function is
 * responsible ONLY for score aggregation.
 */

const { nflSettlementFn } = require('./strategies/nflSettlement');

const settlementStrategies = Object.freeze({
  'final_standings': nflSettlementFn,
  'weekly': () => { throw new Error("Settlement strategy 'weekly' is not yet implemented"); },
  'manual': () => { throw new Error("Settlement strategy 'manual' is not yet implemented"); }
});

function getSettlementStrategy(key) {
  const strategy = settlementStrategies[key];
  if (!strategy) {
    throw new Error(`Unknown settlement strategy: '${key}'. Registered: ${Object.keys(settlementStrategies).join(', ')}`);
  }
  return strategy;
}

function listSettlementStrategies() {
  return Object.keys(settlementStrategies);
}

module.exports = { getSettlementStrategy, listSettlementStrategies };
