/**
 * Settlement Strategy Execution Placeholder (Scaffold)
 *
 * Purpose:
 * Computes final standings and payout allocations for a contest.
 * Settlement strategies are READ-ONLY computations - they produce
 * a payout plan but do NOT execute payments.
 *
 * Mental Model:
 * - Template specifies a settlement_strategy_key (e.g., 'final_standings', 'weekly_winner')
 * - Settlement computation takes scores and produces rankings + payout allocations
 * - NO wallet or payment logic here - payouts are executed by a separate module
 * - Pure computation: given scores + payout structure, returns deterministic results
 *
 * Separation of Concerns:
 * - SettlementStrategy: "Who won? How much do they get?"
 * - PayoutExecution (future): "How do we transfer the money?"
 *
 * Supported Strategies:
 * 1. final_standings - Rank by total score, distribute per payout_structure
 * 2. weekly_winner - Rank by weekly score (for multi-week contests)
 *
 * Output Format (SettlementPlan):
 * {
 *   contest_id: UUID,
 *   computed_at: Date,
 *   rankings: [
 *     { user_id: UUID, rank: 1, score: number },
 *     { user_id: UUID, rank: 2, score: number },
 *     ...
 *   ],
 *   payouts: [
 *     { user_id: UUID, rank: 1, amount_cents: number },
 *     { user_id: UUID, rank: 2, amount_cents: number },
 *     ...
 *   ],
 *   total_pool_cents: number,
 *   status: 'computed' | 'finalized'
 * }
 *
 * TODO: Implementation steps:
 * 1. Implement computeRankings(scores) - sort and rank participants
 * 2. Implement allocatePayouts(rankings, payoutStructure, totalPool)
 * 3. Implement computeSettlement(strategyKey, contestInstance, scores)
 * 4. Integrate with contest lifecycle (locked -> settled transition)
 */

const VALID_STRATEGIES = ['final_standings', 'weekly_winner'];

/**
 * Compute rankings from scores
 *
 * Handles ties by assigning same rank to equal scores.
 *
 * TODO: Implement
 *
 * @param {Array} scores - Array of { user_id, total_score }
 * @returns {Array} Ranked scores { user_id, rank, score }
 */
function computeRankings(scores) {
  // TODO: Implement
  // - Sort by total_score descending
  // - Assign ranks (handle ties)
  // - Return ranked array

  throw new Error('Not implemented: computeRankings');
}

/**
 * Allocate payouts based on rankings and payout structure
 *
 * TODO: Implement
 *
 * @param {Array} rankings - Ranked participants from computeRankings
 * @param {Object} payoutStructure - Payout structure (e.g., { first: 70, second: 20, third: 10 })
 * @param {number} totalPoolCents - Total pool in cents
 * @returns {Array} Payout allocations { user_id, rank, amount_cents }
 */
function allocatePayouts(rankings, payoutStructure, totalPoolCents) {
  // TODO: Implement
  // - Map payout structure percentages to actual amounts
  // - Handle ties (split payout for tied positions)
  // - Return payout allocations

  throw new Error('Not implemented: allocatePayouts');
}

/**
 * Compute full settlement plan for a contest
 *
 * This is the main entry point for settlement computation.
 * READ-ONLY: produces a plan but does not persist or execute.
 *
 * TODO: Implement
 *
 * @param {string} strategyKey - Settlement strategy key from template
 * @param {Object} contestInstance - Contest instance with payout_structure
 * @param {Array} scores - Array of participant scores
 * @returns {Object} SettlementPlan (see format above)
 */
function computeSettlement(strategyKey, contestInstance, scores) {
  if (!VALID_STRATEGIES.includes(strategyKey)) {
    throw new Error(`Unknown settlement strategy: ${strategyKey}`);
  }

  // TODO: Implement strategy-specific logic
  // const rankings = computeRankings(scores);
  // const totalPoolCents = calculateTotalPool(contestInstance);
  // const payouts = allocatePayouts(rankings, contestInstance.payout_structure, totalPoolCents);
  //
  // return {
  //   contest_id: contestInstance.id,
  //   computed_at: new Date(),
  //   rankings,
  //   payouts,
  //   total_pool_cents: totalPoolCents,
  //   status: 'computed'
  // };

  throw new Error('Not implemented: computeSettlement');
}

/**
 * Calculate total pool from contest instance
 *
 * TODO: Implement - requires knowledge of participant count
 *
 * @param {Object} contestInstance - Contest instance
 * @param {number} participantCount - Number of paid participants
 * @returns {number} Total pool in cents
 */
function calculateTotalPool(contestInstance, participantCount) {
  // TODO: Implement
  // return contestInstance.entry_fee_cents * participantCount;

  throw new Error('Not implemented: calculateTotalPool');
}

/**
 * Validate a settlement strategy key
 *
 * @param {string} strategyKey - Strategy key to validate
 * @returns {boolean} True if valid
 */
function isValidStrategy(strategyKey) {
  return VALID_STRATEGIES.includes(strategyKey);
}

/**
 * Check if a contest is ready for settlement
 *
 * Conditions:
 * - Status is 'locked'
 * - All games/events have completed
 * - Scores are final
 *
 * TODO: Implement
 *
 * @param {Object} contestInstance - Contest instance to check
 * @param {Object} gameState - Current game state
 * @returns {boolean} True if ready for settlement
 */
function isReadyForSettlement(contestInstance, gameState) {
  // TODO: Implement
  // - Check status is 'locked'
  // - Check all relevant games are final
  // - Check scores are computed and final

  throw new Error('Not implemented: isReadyForSettlement');
}

module.exports = {
  // Core computation (READ-ONLY)
  computeSettlement,
  computeRankings,
  allocatePayouts,
  calculateTotalPool,

  // Status checks
  isReadyForSettlement,

  // Validation
  isValidStrategy,

  // Constants
  VALID_STRATEGIES
};
