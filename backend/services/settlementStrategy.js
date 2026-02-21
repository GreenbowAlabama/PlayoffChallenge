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

const crypto = require('crypto');

const VALID_STRATEGIES = ['final_standings', 'weekly_winner'];

/**
 * Compute rankings from scores using competition ranking
 *
 * Competition ranking: equal scores get same rank, next rank skips positions for ties.
 * Example: [100, 100, 90] → ranks [1, 1, 3]
 *
 * @param {Array} scores - Array of { user_id, total_score }
 * @returns {Array} Ranked scores { user_id, rank, score }
 */
function computeRankings(scores) {
  // Sort by total_score descending, then by user_id ascending for determinism
  const sorted = [...scores].sort((a, b) => {
    if (b.total_score !== a.total_score) return b.total_score - a.total_score;
    return a.user_id.localeCompare(b.user_id);
  });

  let currentRank = 1;
  const rankings = sorted.map((entry, index) => {
    if (index > 0 && entry.total_score !== sorted[index - 1].total_score) {
      // Score changed, next rank is current position + 1 (competition ranking)
      currentRank = index + 1;
    }
    return { user_id: entry.user_id, rank: currentRank, score: entry.total_score };
  });

  return rankings;
}

/**
 * Allocate payouts based on competition rankings and payout structure
 *
 * Algorithm: Group rankings by rank, then linearly process each group.
 * For each rank group (tie), combine the payouts for all positions it occupies
 * and split equally among the tied users.
 *
 * Example: ranks [1, 1, 3] with structure {"1": 70, "2": 20, "3": 10}
 * - Rank 1 (2 users) occupy positions 1-2 → combine 70 + 20 = 90%, split equally
 * - Rank 3 (1 user) occupies position 3 → 10%
 *
 * @param {Array} rankings - Ranked participants from computeRankings, sorted by rank
 * @param {Object} payoutStructure - Payout structure { "1": percentage, "2": percentage, ... }
 * @param {number} totalPoolCents - Total pool in cents
 * @returns {Array} Payout allocations { user_id, rank, amount_cents }
 */
function allocatePayouts(rankings, payoutStructure, totalPoolCents) {
  if (!payoutStructure || Object.keys(payoutStructure).length === 0) {
    // No payout structure defined
    return rankings.map(r => ({ user_id: r.user_id, rank: r.rank, amount_cents: 0 }));
  }

  // Group rankings by rank (preserves order of appearance within each rank)
  const rankGroups = {};
  rankings.forEach(entry => {
    if (!rankGroups[entry.rank]) {
      rankGroups[entry.rank] = [];
    }
    rankGroups[entry.rank].push(entry);
  });

  // Sort rank groups by rank ascending
  const sortedRanks = Object.keys(rankGroups)
    .map(Number)
    .sort((a, b) => a - b);

  const payouts = [];
  let currentPosition = 1;

  // Process each rank group in order
  sortedRanks.forEach(rank => {
    const group = rankGroups[rank];
    const tieSize = group.length;

    // Calculate combined percentage for all positions occupied by this tie
    let combinedPercentage = 0;
    for (let p = currentPosition; p < currentPosition + tieSize; p++) {
      combinedPercentage += (payoutStructure[p] || 0);
    }

    // Calculate total payout for this tie group
    const payoutCents = Math.floor((totalPoolCents * combinedPercentage) / 100);

    // Split equally among tied users (using Math.floor for cents)
    const perUserCents = Math.floor(payoutCents / tieSize);

    // Assign to each user in the group
    group.forEach(entry => {
      payouts.push({
        user_id: entry.user_id,
        rank: entry.rank,
        amount_cents: perUserCents
      });
    });

    // Move position counter forward by tie size
    currentPosition += tieSize;
  });

  return payouts;
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
 * Calculate total pool from contest instance and participant count
 *
 * @param {Object} contestInstance - Contest instance
 * @param {number} participantCount - Number of paid participants
 * @returns {number} Total pool in cents
 */
function calculateTotalPool(contestInstance, participantCount) {
  return contestInstance.entry_fee_cents * participantCount;
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
 * Verifies that all contest participants have scores for all required playoff weeks.
 * Uses a single SQL query with COUNT(DISTINCT week_number) to detect missing scores.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} contestInstanceId - Contest instance UUID
 * @returns {Promise<boolean>} True if all participants have complete scores
 * @throws {Error} If any participant is missing scores (with user_id details)
 */
async function isReadyForSettlement(pool, contestInstanceId) {
  // Fetch playoff start week from game settings
  const settingsResult = await pool.query('SELECT playoff_start_week FROM game_settings LIMIT 1');
  const startWeek = settingsResult.rows[0]?.playoff_start_week || 19;
  const endWeek = startWeek + 3; // 4 playoff weeks

  // Query: Find any participants missing scores for any of the 4 weeks
  const result = await pool.query(`
    SELECT
      cp.user_id,
      COUNT(DISTINCT s.week_number) as weeks_with_scores
    FROM contest_participants cp
    LEFT JOIN scores s ON s.user_id = cp.user_id
      AND s.week_number BETWEEN $2 AND $3
    WHERE cp.contest_instance_id = $1
    GROUP BY cp.user_id
    HAVING COUNT(DISTINCT s.week_number) < 4
  `, [contestInstanceId, startWeek, endWeek]);

  if (result.rows.length > 0) {
    // At least one participant is missing scores
    const missingUsers = result.rows.map(r => `${r.user_id} (${r.weeks_with_scores}/4 weeks)`).join(', ');
    throw new Error(`Settlement readiness check failed: ${result.rows.length} participant(s) missing scores: ${missingUsers}`);
  }

  // All participants have scores for all 4 weeks
  return true;
}

/**
 * Canonicalize a JSON object for deterministic hashing
 *
 * Recursively sorts all object keys alphabetically, preserves array order.
 * This ensures the same data structure always produces the same JSON string.
 *
 * @param {*} obj - Object to canonicalize
 * @returns {*} Canonicalized object (same type as input)
 */
function canonicalizeJson(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Primitives: return as-is
  if (typeof obj !== 'object') {
    return obj;
  }

  // Arrays: recursively canonicalize, preserve order
  if (Array.isArray(obj)) {
    return obj.map(item => canonicalizeJson(item));
  }

  // Objects: sort keys, recursively canonicalize values
  const keys = Object.keys(obj).sort();
  const canonical = {};
  keys.forEach(key => {
    canonical[key] = canonicalizeJson(obj[key]);
  });

  return canonical;
}

/**
 * Execute settlement for a contest
 *
 * Full transactional settlement with:
 * - Row-level lock (SELECT FOR UPDATE)
 * - Idempotency check (settlement_records already exists?)
 * - Consistency validation (settle_time without records?)
 * - Score fetching and computation
 * - Rankings and payout calculation
 * - Atomic insert into settlement_records
 * - Atomic update to settle_time
 * - SYSTEM audit record
 *
 * On any error: ROLLBACK and re-throw (error recovery handles LIVE→ERROR)
 *
 * @param {Object} contestInstance - Contest instance object (minimal: id, entry_fee_cents, payout_structure)
 * @param {Object} pool - Database connection pool
 * @returns {Promise<Object>} Settlement record from database
 * @throws {Error} On any failure (transaction rolled back)
 */
async function executeSettlement(contestInstance, pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. LOCK: SELECT FOR UPDATE to prevent concurrent settlement attempts
    const lockResult = await client.query(
      'SELECT id, status, entry_fee_cents, payout_structure, settle_time FROM contest_instances WHERE id = $1 FOR UPDATE',
      [contestInstance.id]
    );

    if (lockResult.rows.length === 0) {
      throw new Error(`Contest instance ${contestInstance.id} not found`);
    }

    const lockedContest = lockResult.rows[0];

    // 2. IDEMPOTENCY CHECK (after lock): settlement already exists?
    const existingSettlement = await client.query(
      'SELECT * FROM settlement_records WHERE contest_instance_id = $1',
      [contestInstance.id]
    );

    if (existingSettlement.rows.length > 0) {
      // Settlement already executed, return existing record (no-op)
      await client.query('COMMIT');
      return existingSettlement.rows[0];
    }

    // 3. CONSISTENCY VALIDATION: settle_time set but no record?
    if (lockedContest.settle_time && existingSettlement.rows.length === 0) {
      throw new Error('INCONSISTENT_STATE: settle_time is set but no settlement_records entry exists');
    }

    // 4. COMPUTE SETTLEMENT - dispatch to registered strategy
    const { getSettlementStrategy } = require('./settlementRegistry');
    const settleFn = getSettlementStrategy('final_standings');
    const scoreRows = await settleFn(contestInstance.id, client);

    const participantCount = scoreRows.length;

    // Compute rankings and payouts
    const rankings = computeRankings(scoreRows);
    const totalPoolCents = calculateTotalPool(lockedContest, participantCount);
    const payouts = allocatePayouts(rankings, lockedContest.payout_structure, totalPoolCents);

    // Compute SHA-256 hash for immutability verification
    const results = { rankings, payouts };
    const resultsHash = crypto.createHash('sha256')
      .update(JSON.stringify(canonicalizeJson(results)))
      .digest('hex');

    // 5. INSERT SETTLEMENT RECORD (exactly once)
    const insertResult = await client.query(`
      INSERT INTO settlement_records (
        contest_instance_id,
        settled_at,
        results,
        results_sha256,
        settlement_version,
        participant_count,
        total_pool_cents
      ) VALUES ($1, NOW(), $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      contestInstance.id,
      JSON.stringify(results),
      resultsHash,
      'v1',
      participantCount,
      totalPoolCents
    ]);

    // 6. WRITE settle_time (exactly once)
    await client.query(
      'UPDATE contest_instances SET settle_time = NOW() WHERE id = $1',
      [contestInstance.id]
    );

    // 7. WRITE SYSTEM AUDIT RECORD
    const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';
    await client.query(`
      INSERT INTO admin_contest_audit (contest_instance_id, admin_user_id, action, reason, payload)
      VALUES ($1, $2, $3, $4, $5)
    `, [
      contestInstance.id,
      SYSTEM_USER_ID,
      'system_settlement_complete',
      'Settlement executed successfully',
      JSON.stringify({
        participant_count: participantCount,
        total_pool_cents: totalPoolCents,
        results_sha256: resultsHash,
        settlement_version: 'v1'
      })
    ]);

    await client.query('COMMIT');
    return insertResult.rows[0];

  } catch (err) {
    await client.query('ROLLBACK');
    // Re-throw: error recovery (GAP-08) will catch this and transition LIVE→ERROR
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  // Settlement readiness and execution
  isReadyForSettlement,
  executeSettlement,

  // Ranking and payout computation
  computeRankings,
  allocatePayouts,
  calculateTotalPool,

  // Deterministic hashing
  canonicalizeJson,

  // Validation
  isValidStrategy,

  // Constants
  VALID_STRATEGIES
};
