/**
 * CONTEST LIFECYCLE ENGINE — FROZEN (v1)
 *
 * Guarantees:
 * - Deterministic time-driven state transitions
 * - Atomic state mutations with audit trail
 * - Idempotent reconciliation (safe repeated execution, zero duplicate writes)
 * - Settlement-bound LIVE → COMPLETE
 * - Error escalation LIVE → ERROR via attemptSystemTransitionWithErrorRecovery
 *
 * Do not modify without governance review.
 *
 * ---
 *
 * Pure lifecycle transition functions for contest instances.
 * All transitions are deterministic, idempotent, and atomic.
 *
 * This service is responsible for:
 * - Atomic state updates with transition record insertion
 * - Deterministic execution (injected now, no implicit database clock)
 * - Returning changed IDs for observability
 *
 * This service is NOT responsible for:
 * - Contract validation (DB schema enforces via CHECK constraints)
 * - Execution orchestration (when/how to call transitions)
 * - Admin endpoints, background scheduling, or polling loops
 *
 * Execution wiring belongs in a separate orchestration layer.
 */

/**
 * Transition all eligible SCHEDULED contests to LOCKED based on lock_time.
 *
 * Mechanics:
 * - Finds all SCHEDULED contests where lock_time IS NOT NULL
 * - Checks if injected `now` >= lock_time
 * - Updates status to LOCKED (atomic)
 * - Inserts contest_state_transitions records (same transaction)
 * - Idempotent: re-calls do nothing
 *
 * @param {Object} pool - Database connection pool
 * @param {Date} now - Injected current time (for determinism and testability)
 * @returns {Promise<{ changedIds: string[], count: number }>}
 *   changedIds: Array of contest_instance IDs that transitioned
 *   count: Number of contests transitioned
 * @throws {Error} On database errors
 */
async function transitionScheduledToLocked(pool, now) {
  // Atomic CTE: UPDATE + INSERT transitions in single transaction
  const result = await pool.query(
    `WITH transitioned AS (
       UPDATE contest_instances
       SET status = $1,
           updated_at = $2
       WHERE status = $3
         AND lock_time IS NOT NULL
         AND $2 >= lock_time
       RETURNING id
     )
     INSERT INTO contest_state_transitions (
       contest_instance_id,
       from_state,
       to_state,
       triggered_by,
       reason,
       created_at
     )
     SELECT
       id,
       $3,
       $1,
       'LOCK_TIME_REACHED',
       'Automatic transition at lock time',
       $2
     FROM transitioned
     RETURNING contest_instance_id`,
    ['LOCKED', now, 'SCHEDULED']
  );

  const changedIds = result.rows.map(row => row.contest_instance_id);

  return {
    changedIds,
    count: changedIds.length
  };
}

/**
 * Transition all eligible LOCKED contests to LIVE based on tournament_start_time.
 *
 * Mechanics:
 * - Finds all LOCKED contests where tournament_start_time IS NOT NULL
 * - Checks if injected `now` >= tournament_start_time
 * - Updates status to LIVE (atomic)
 * - Inserts contest_state_transitions records (same transaction)
 * - Idempotent: re-calls do nothing
 *
 * @param {Object} pool - Database connection pool
 * @param {Date} now - Injected current time (for determinism and testability)
 * @returns {Promise<{ changedIds: string[], count: number }>}
 *   changedIds: Array of contest_instance IDs that transitioned
 *   count: Number of contests transitioned
 * @throws {Error} On database errors
 */
async function transitionLockedToLive(pool, now) {
  // Atomic CTE: UPDATE + INSERT transitions in single transaction
  const result = await pool.query(
    `WITH transitioned AS (
       UPDATE contest_instances
       SET status = $1,
           updated_at = $2
       WHERE status = $3
         AND tournament_start_time IS NOT NULL
         AND $2 >= tournament_start_time
       RETURNING id
     )
     INSERT INTO contest_state_transitions (
       contest_instance_id,
       from_state,
       to_state,
       triggered_by,
       reason,
       created_at
     )
     SELECT
       id,
       $3,
       $1,
       'TOURNAMENT_START_TIME_REACHED',
       'Automatic transition at tournament start time',
       $2
     FROM transitioned
     RETURNING contest_instance_id`,
    ['LIVE', now, 'LOCKED']
  );

  const changedIds = result.rows.map(row => row.contest_instance_id);

  return {
    changedIds,
    count: changedIds.length
  };
}

/**
 * Transition all eligible LIVE contests to COMPLETE via settlement.
 *
 * Mechanics:
 * - Finds all LIVE contests where tournament_end_time IS NOT NULL
 * - Checks if injected `now` >= tournament_end_time
 * - For each eligible contest:
 *   - Attempts settlement via error recovery boundary (attemptSystemTransitionWithErrorRecovery)
 *   - On success: contest reaches COMPLETE
 *   - On missing snapshot: skips (no escalation, contest remains LIVE)
 *   - On settlement logic error: automatically transitions LIVE → ERROR with audit trail
 * - Idempotent: re-calls do nothing if settlement_records already exists
 *
 * Error recovery (GAP-07):
 * - Reuses existing attemptSystemTransitionWithErrorRecovery infrastructure
 * - Settlement failures (payload errors, strategy failures) trigger LIVE → ERROR
 * - Audit trail marks failures with settlement_failure: true
 * - Missing snapshots are skipped (expected case, not an error)
 *
 * @param {Object} pool - Database connection pool
 * @param {Date} now - Injected current time (for determinism and testability)
 * @returns {Promise<{ changedIds: string[], count: number }>}
 *   changedIds: Array of contest_instance IDs that transitioned to COMPLETE
 *   count: Number of contests transitioned
 * @throws {Error} Only on database/pool failures (not on settlement errors, which escalate to ERROR)
 */
async function transitionLiveToComplete(pool, now) {
  const { executeSettlement } = require('./settlementStrategy');
  const { attemptSystemTransitionWithErrorRecovery } = require('./helpers/contestLifecycleAdvancer');

  // Find all LIVE contests eligible for completion
  const eligibleResult = await pool.query(
    `SELECT id, entry_fee_cents, payout_structure, template_id, status
     FROM contest_instances
     WHERE status = $1
       AND tournament_end_time IS NOT NULL
       AND $2 >= tournament_end_time
     ORDER BY created_at ASC`,
    ['LIVE', now]
  );

  const changedIds = [];

  // Process each eligible contest
  for (const contestRow of eligibleResult.rows) {
    try {
      // Settlement callback: handles both primary transition (LIVE→COMPLETE) and error recovery (LIVE→ERROR)
      // - If targetStatus is COMPLETE: find snapshot and call executeSettlement (complex operation)
      // - If targetStatus is ERROR: error recovery is handling the failure, just return the contest row
      // - If snapshot missing: return null (no state change, contest stays LIVE)
      // - If settlement fails: throw (error recovery catches and transitions to ERROR)
      const settlementCallback = async (pool, contestId, targetStatus) => {
        // If error recovery is calling us with ERROR, don't do settlement - just acknowledge
        // (the actual ERROR transition will be done by updateFn elsewhere)
        if (targetStatus === 'ERROR') {
          // Return the contest row to acknowledge the transition
          // The actual status update to ERROR is handled by error recovery
          const result = await pool.query(
            'SELECT * FROM contest_instances WHERE id = $1',
            [contestId]
          );
          return result.rows[0] || null;
        }

        // targetStatus is COMPLETE - perform settlement
        // Fetch FINAL snapshot for this contest (required for settlement)
        const snapshotResult = await pool.query(
          `SELECT id, snapshot_hash
           FROM event_data_snapshots
           WHERE contest_instance_id = $1
             AND provider_final_flag = true
           ORDER BY ingested_at DESC, id DESC
           LIMIT 1`,
          [contestId]
        );

        if (snapshotResult.rows.length === 0) {
          // Missing snapshot prerequisite - return null (no state change)
          // This is not a failure; the contest will be retried on next reconciliation tick
          return null;
        }

        const snapshotId = snapshotResult.rows[0].id;
        const snapshotHash = snapshotResult.rows[0].snapshot_hash;

        // Execute settlement with error recovery boundary
        // If this throws, error recovery will transition LIVE → ERROR
        const settlementResult = await executeSettlement(
          contestRow,
          pool,
          snapshotId,
          snapshotHash,
          now
        );

        return settlementResult;
      };

      // Attempt settlement with error recovery
      // On success: contest is COMPLETE
      // On settlement error: automatically transitions to ERROR (audit trail includes settlement_failure: true)
      // On missing snapshot: returns null (no state change, contest stays LIVE)
      const result = await attemptSystemTransitionWithErrorRecovery(
        pool,
        contestRow,
        'COMPLETE',
        settlementCallback
      );

      // Only count successful completions (not noop or missing-snapshot results)
      if (result && !result.noop) {
        changedIds.push(contestRow.id);
      }
    } catch (err) {
      // This should not happen if error recovery is working correctly.
      // Error recovery should have already transitioned to ERROR.
      // If we reach here, something failed in the error recovery path itself (e.g., audit write failed).
      // Log and continue to next contest.
      console.error(
        `Failed to process settlement for contest ${contestRow.id} (error recovery may have failed): ${err.message}`
      );
      continue;
    }
  }

  return {
    changedIds,
    count: changedIds.length
  };
}

module.exports = {
  transitionScheduledToLocked,
  transitionLockedToLive,
  transitionLiveToComplete
};
