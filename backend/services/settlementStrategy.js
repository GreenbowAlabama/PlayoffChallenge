/**
 * Settlement Strategy Execution Placeholder (Scaffold)
 *
 * Purpose:
 * Computes final standings and payout allocations for a contest.
 * Settlement strategies are READ-ONLY computations - they produce
 * a payout plan but do NOT execute payments.
 *
 * Mental Model:
 * - Template specifies a settlement_strategy_key (registered in settlementRegistry)
 * - Settlement computation takes scores and produces rankings + payout allocations
 * - NO wallet or payment logic here - payouts are executed by a separate module
 * - Pure computation: given scores + payout structure, returns deterministic results
 *
 * Separation of Concerns:
 * - SettlementStrategy: "Who won? How much do they get?"
 * - PayoutExecution (future): "How do we transfer the money?"
 *
 * Supported Strategies:
 * 1. final_standings — Rank by total score, distribute per payout_structure (see settlementRegistry)
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

// Strategy validity is enforced by the registry — see settlementRegistry.js

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
 * and split equally among the tied users using canonical safe tie allocation.
 *
 * Example: ranks [1, 1, 3] with structure {"1": 70, "2": 20, "3": 10}
 * - Rank 1 (2 users) occupy positions 1-2 → combine 70 + 20 = 90%, split equally
 * - Rank 3 (1 user) occupies position 3 → 10%
 *
 * PGA v1 Section 3.3: Remainder cents (from floor division) are retained by platform.
 *
 * @param {Array} rankings - Ranked participants from computeRankings, sorted by rank
 * @param {Object} payoutStructure - Payout structure { "1": percentage, "2": percentage, ... }
 * @param {number} totalPoolCents - Total pool in cents
 * @returns {Object} { payouts: Array, platformRemainderCents: number }
 *   - payouts: Array of { user_id, rank, amount_cents }
 *   - platformRemainderCents: Integer cents retained by platform from rounding
 */
function allocatePayouts(rankings, payoutStructure, totalPoolCents) {
  let totalPlatformRemainderCents = 0;

  if (!payoutStructure || Object.keys(payoutStructure).length === 0) {
    // No payout structure defined
    return {
      payouts: rankings.map(r => ({ user_id: r.user_id, rank: r.rank, amount_cents: 0 })),
      platformRemainderCents: 0
    };
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

    // Step 1: Calculate total payout for this tie group (round half-up once at block level)
    // PGA v1 Section 3.3: round at tier level, never over-allocate
    const blockPayoutCents = Math.round((totalPoolCents * combinedPercentage) / 100);

    // Step 2: Split safely using floor to guarantee no over-allocation
    // This is the canonical tie allocation algorithm that never exceeds pool
    const baseShare = Math.floor(blockPayoutCents / tieSize);
    const blockPlatformRemainderCents = blockPayoutCents - (baseShare * tieSize);

    // Step 3: Assign base share to each user in the group
    // Remainder is retained by platform (67 Enterprises per PGA v1 Section 3.3)
    group.forEach(entry => {
      payouts.push({
        user_id: entry.user_id,
        rank: entry.rank,
        amount_cents: baseShare
      });
    });

    // Accumulate platform remainder across all tie groups
    totalPlatformRemainderCents += blockPlatformRemainderCents;

    // Move position counter forward by tie size
    currentPosition += tieSize;
  });

  return {
    payouts,
    platformRemainderCents: totalPlatformRemainderCents
  };
}

/**
 * Compute full settlement plan for a contest
 *
 * This is the main entry point for settlement computation.
 * Wires together pure functions: rankings → payouts → settlement record.
 *
 * PGA v1 Requirements (pga-rules-and-payment-v1.md Section 4.1):
 * - Refuse to settle without snapshot_id (determinism requirement)
 * - Calculate prize pool frozen at lock_time
 * - Apply 10% rake, 90% distributable per Section 3.1
 *
 * @param {string} strategyKey - Settlement strategy key from template
 * @param {Object} contestInstance - Contest instance with payout_structure, lock_time
 * @param {Array} scores - Array of participant scores { user_id, total_score }
 * @param {string} snapshotId - Immutable snapshot_id for scoring binding (REQUIRED)
 * @param {string} snapshotHash - Hash of snapshot data (REQUIRED)
 * @returns {Object} SettlementPlan with snapshot binding (scoringRunId set by caller after record insert)
 * @throws {Error} If strategyKey unknown, snapshotId or snapshotHash missing
 */
function computeSettlement(strategyKey, contestInstance, scores, snapshotId, snapshotHash) {
  const { getSettlementStrategy } = require('./settlementRegistry');

  // GUARD: Validate strategy key first (before snapshot checks)
  // This ensures unknown strategy errors are not masked by snapshot guards
  getSettlementStrategy(strategyKey);

  // GUARD: Snapshot binding is mandatory per PGA v1 Section 4.1
  if (!snapshotId) {
    throw new Error('SETTLEMENT_REQUIRES_SNAPSHOT_ID: Settlement refuses to execute without snapshot_id binding (PGA v1 Section 4.1)');
  }
  if (!snapshotHash) {
    throw new Error('SETTLEMENT_REQUIRES_SNAPSHOT_HASH: Settlement refuses to execute without snapshot_hash binding (PGA v1 Section 4.1)');
  }

  // Compute rankings: sort by score descending, deterministically by user_id ascending
  const rankings = computeRankings(scores);

  // Calculate prize pool and rake per PGA v1 Section 3.1
  const participantCount = scores.length;
  const totalPoolCents = calculateTotalPool(contestInstance, participantCount);

  // Apply rake: 10% retained, 90% distributable
  const rakeCents = Math.round(totalPoolCents * 0.10);
  const distributableCents = totalPoolCents - rakeCents;

  // Allocate payouts from distributable pool (returns payouts + remainder)
  const allocationResult = allocatePayouts(rankings, contestInstance.payout_structure, distributableCents);
  const payouts = allocationResult.payouts;
  const platformRemainderCents = allocationResult.platformRemainderCents;

  // Build settlement plan with snapshot binding and platform remainder tracking
  const settlementPlan = {
    contest_instance_id: contestInstance.id,
    snapshot_id: snapshotId,
    snapshot_hash: snapshotHash,
    computed_at: new Date(),
    rankings,
    payouts,
    total_pool_cents: totalPoolCents,
    rake_cents: rakeCents,
    distributable_cents: distributableCents,
    platform_remainder_cents: platformRemainderCents,
    participant_count: participantCount,
    status: 'computed'
  };

  return settlementPlan;
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
  const { listSettlementStrategies } = require('./settlementRegistry');
  return listSettlementStrategies().includes(strategyKey);
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
 * - Atomic insert into settlement_records with snapshot binding
 * - Atomic update to settle_time
 * - SYSTEM audit record
 *
 * Snapshot binding (PGA v1 Section 4.1):
 * - snapshotId, snapshotHash are REQUIRED
 * - Settlement refuses to complete without them
 * - scoringRunId is set to settlement_records.id after INSERT (deterministic, immutable)
 * - All values stored in settlement_records for replay safety and dispute resolution
 *
 * On any error: ROLLBACK and re-throw (error recovery handles LIVE→ERROR)
 *
 * @param {Object} contestInstance - Contest instance object (minimal: id, entry_fee_cents, payout_structure)
 * @param {Object} pool - Database connection pool
 * @param {string} snapshotId - Event data snapshot UUID (REQUIRED for PGA v1 compliance)
 * @param {string} snapshotHash - Hash of snapshot (REQUIRED for PGA v1 compliance)
 * @param {Date} [now=new Date()] - Injected current time for determinism (used for settle_time and transition timestamp)
 * @returns {Promise<Object>} Settlement record from database (includes id for use as scoring_run_id), or { noop: true, reason: string } if status not LIVE
 * @throws {Error} On any failure (transaction rolled back) or missing snapshot binding
 */
/**
 * Transaction-safe settlement core.
 * Accepts client, does NOT manage transaction boundaries.
 * Caller is responsible for BEGIN/COMMIT/ROLLBACK.
 */
async function executeSettlementTx({
  client,
  contestInstanceId,
  snapshotId,
  snapshotHash,
  now = new Date(),
}) {
  // 1. LOCK: SELECT FOR UPDATE to prevent concurrent settlement attempts
  const lockResult = await client.query(
    'SELECT id, status, entry_fee_cents, payout_structure, settle_time FROM contest_instances WHERE id = $1 FOR UPDATE',
    [contestInstanceId]
  );

  if (lockResult.rows.length === 0) {
    throw new Error(`Contest instance ${contestInstanceId} not found`);
  }

  const lockedContest = lockResult.rows[0];

  // 2. IDEMPOTENCY CHECK (after lock): settlement already exists?
  const existingSettlement = await client.query(
    'SELECT * FROM settlement_records WHERE contest_instance_id = $1',
    [contestInstanceId]
  );

  if (existingSettlement.rows.length > 0) {
    // Settlement already executed, return existing record (no-op)
    return existingSettlement.rows[0];
  }

  // 3. CONSISTENCY VALIDATION: settle_time set but no record?
  if (lockedContest.settle_time && existingSettlement.rows.length === 0) {
    throw new Error('INCONSISTENT_STATE: settle_time is set but no settlement_records entry exists');
  }

  // 3b. STATUS GUARD: Only settle LIVE contests (idempotent, no-throw)
  if (lockedContest.status !== 'LIVE') {
    return {
      noop: true,
      reason: `STATUS_NOT_LIVE: Contest status is ${lockedContest.status}, expected LIVE`
    };
  }

  // 4. LOAD TEMPLATE - read settlement_strategy_key from contest template
  // Strategy key must always come from template
  const templateResult = await client.query(
    `SELECT ct.settlement_strategy_key
     FROM contest_instances ci
     JOIN contest_templates ct ON ct.id = ci.template_id
     WHERE ci.id = $1`,
    [contestInstanceId]
  );

  if (templateResult.rows.length === 0) {
    throw new Error(`No template found for contest instance ${contestInstanceId}`);
  }

  const settlementStrategyKey = templateResult.rows[0].settlement_strategy_key;

  // 5. VALIDATE STRATEGY KEY BEFORE SNAPSHOT BINDING (ensures clear error ordering)
  const { getSettlementStrategy } = require('./settlementRegistry');
  const settleFn = getSettlementStrategy(settlementStrategyKey);

  // 6. SNAPSHOT BINDING VALIDATION (PGA v1 Section 4.1)
  // Must occur after strategy validation so unknown strategy errors are not masked
  if (!snapshotId) {
    throw new Error('SETTLEMENT_REQUIRES_SNAPSHOT_ID: Settlement refuses to execute without snapshot_id binding (PGA v1 Section 4.1)');
  }
  if (!snapshotHash) {
    throw new Error('SETTLEMENT_REQUIRES_SNAPSHOT_HASH: Settlement refuses to execute without snapshot_hash binding (PGA v1 Section 4.1)');
  }

  // 7. COMPUTE SETTLEMENT - dispatch to validated strategy
  const scoreRows = await settleFn(contestInstanceId, client);

  // 8. CALL COMPUTE SETTLEMENT with snapshot binding (required)
  // scoringRunId will be set to settlement_records.id after INSERT
  const settlementPlan = computeSettlement(
    settlementStrategyKey,
    lockedContest,
    scoreRows,
    snapshotId,
    snapshotHash
  );

  const participantCount = settlementPlan.participant_count;
  const totalPoolCents = settlementPlan.total_pool_cents;
  const platformRemainderCents = settlementPlan.platform_remainder_cents;

  // Compute SHA-256 hash for immutability verification
  // Include platform remainder for audit trail and conservation verification
  const results = {
    rankings: settlementPlan.rankings,
    payouts: settlementPlan.payouts,
    platform_remainder_cents: platformRemainderCents,
    rake_cents: settlementPlan.rake_cents,
    distributable_cents: settlementPlan.distributable_cents
  };
  const resultsHash = crypto.createHash('sha256')
    .update(JSON.stringify(canonicalizeJson(results)))
    .digest('hex');

  // 9. INSERT SETTLEMENT RECORD with snapshot binding (exactly once)
  const insertResult = await client.query(`
    INSERT INTO settlement_records (
      contest_instance_id,
      snapshot_id,
      snapshot_hash,
      settled_at,
      results,
      results_sha256,
      settlement_version,
      participant_count,
      total_pool_cents
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `, [
    contestInstanceId,
    snapshotId,
    snapshotHash,
    now,
    JSON.stringify(results),
    resultsHash,
    'v1',
    participantCount,
    totalPoolCents
  ]);

  const settlementRecord = insertResult.rows[0];
  const scoringRunId = settlementRecord.id; // scoring_run_id IS settlement_records.id (PGA v1 Section 4.1)

  // 9b. UPDATE settlement_records to set scoring_run_id now that we have the id (for explicit binding in record)
  await client.query(
    'UPDATE settlement_records SET scoring_run_id = $1 WHERE id = $2',
    [scoringRunId, settlementRecord.id]
  );

  // 10. WRITE settle_time and status to COMPLETE (only if currently LIVE)
  const previousStatus = lockedContest.status;
  const newStatus = 'COMPLETE';

  const statusUpdateResult = await client.query(
    'UPDATE contest_instances SET settle_time = $1, status = $2 WHERE id = $3 AND status = $4 RETURNING id',
    [now, newStatus, contestInstanceId, 'LIVE']
  );

  // If UPDATE affected 0 rows, status was already changed (e.g., to CANCELLED)
  // This is idempotent - settlement already happened, so return existing record
  if (statusUpdateResult.rows.length === 0) {
    return settlementRecord;
  }

  // 10b. INSERT LIFECYCLE TRANSITION RECORD (LIVE → COMPLETE)
  // Idempotent via NOT EXISTS to prevent duplicate rows if function is re-called
  await client.query(`
    INSERT INTO contest_state_transitions (
      contest_instance_id,
      from_state,
      to_state,
      triggered_by,
      reason,
      created_at
    )
    SELECT $1, $2, $3, $4, $5, $6
    WHERE NOT EXISTS (
      SELECT 1 FROM contest_state_transitions
      WHERE contest_instance_id = $1
        AND from_state = $2
        AND to_state = $3
        AND triggered_by = $4
    )
  `, [
    contestInstanceId,
    'LIVE',
    'COMPLETE',
    'TOURNAMENT_END_TIME_REACHED',
    'Automatic settlement at tournament end time',
    now
  ]);

  // 11. WRITE SYSTEM AUDIT RECORD with snapshot context
  const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';
  await client.query(`
    INSERT INTO admin_contest_audit
    (contest_instance_id, admin_user_id, action, reason, from_status, to_status, payload)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [
    contestInstanceId,
    SYSTEM_USER_ID,
    'system_settlement_complete',
    'Settlement executed successfully with snapshot binding (PGA v1)',
    previousStatus,
    newStatus,
    JSON.stringify({
      snapshot_id: snapshotId,
      snapshot_hash: snapshotHash,
      scoring_run_id: scoringRunId,
      participant_count: participantCount,
      total_pool_cents: totalPoolCents,
      results_sha256: resultsHash,
      settlement_version: 'v1'
    })
  ]);

  return settlementRecord;
}

/**
 * Wrapper: Transaction-managed settlement execution.
 * Accepts pool and contestInstance object.
 * Manages BEGIN/COMMIT/ROLLBACK.
 */
async function executeSettlement(contestInstance, pool, snapshotId, snapshotHash, now = new Date()) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await executeSettlementTx({
      client,
      contestInstanceId: contestInstance.id,
      snapshotId,
      snapshotHash,
      now,
    });

    await client.query('COMMIT');
    return result;

  } catch (err) {
    await client.query('ROLLBACK');
    // Re-throw: error recovery (GAP-08) will catch this and transition LIVE→ERROR
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  // Settlement execution
  executeSettlement,
  executeSettlementTx,

  // Settlement computation (pure function)
  computeSettlement,

  // Ranking and payout computation
  computeRankings,
  allocatePayouts,
  calculateTotalPool,

  // Deterministic hashing
  canonicalizeJson,

  // Validation
  isValidStrategy
};
