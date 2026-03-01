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

/**
 * Internal helper: Atomic single-contest state transition with optional field updates.
 *
 * Unified pattern for all admin-triggered single-contest state mutations.
 * Ensures consistent atomicity, idempotency, and audit trail across all admin operations.
 *
 * Mechanics:
 * - Locks row FOR UPDATE
 * - Validates current state is in allowed set
 * - Executes optional callback (e.g., settlement)
 * - Updates status + any extra fields (if callback returns non-null) — SINGLE atomic UPDATE
 * - Inserts transition record (idempotent)
 * - Commits atomically
 *
 * @param {Object} pool - Database connection pool
 * @param {Date} now - Injected current time
 * @param {string} contestInstanceId - Contest instance UUID
 * @param {string[]} allowedFromStates - Array of valid source states
 * @param {string} toState - Target state
 * @param {string} triggeredBy - Trigger reason (e.g., 'ADMIN_FORCE_LOCK')
 * @param {string} reason - Human-readable reason
 * @param {Function} callback - Optional: (pool, contestId, targetState) => result; if null, no state change
 * @param {Object} extraUpdates - Optional: { fieldName: 'sqlExpression' } for additional atomic field updates
 *                               Example: { lock_time: 'COALESCE(lock_time, $X)' }
 * @returns {Promise<{ success: boolean, changed: boolean }>}
 * @throws {Error} If contest not found or state validation fails
 */
async function performSingleStateTransition(
  pool,
  now,
  contestInstanceId,
  allowedFromStates,
  toState,
  triggeredBy,
  reason,
  callback = null,
  extraUpdates = null
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock and fetch contest
    const lockResult = await client.query(
      'SELECT id, status FROM contest_instances WHERE id = $1 FOR UPDATE',
      [contestInstanceId]
    );

    if (!lockResult.rows.length) {
      await client.query('ROLLBACK');
      throw new Error(`Contest ${contestInstanceId} not found`);
    }

    const contest = lockResult.rows[0];
    const fromState = contest.status;

    // Idempotency: if already in target state, return success noop
    if (fromState === toState) {
      await client.query('ROLLBACK');
      return { success: true, changed: false };
    }

    // Validate state is allowed
    if (!allowedFromStates.includes(fromState)) {
      await client.query('ROLLBACK');
      throw new Error(`Cannot transition ${contestInstanceId} from ${fromState} to ${toState}. Allowed from: ${allowedFromStates.join(', ')}`);
    }

    // Execute callback if provided (e.g., settlement logic)
    // Callback may return null (no state change) or proceed
    let callbackResult = null;
    if (callback) {
      callbackResult = await callback(client, contestInstanceId, toState);
      if (callbackResult === null) {
        // Callback determined no state change (e.g., missing snapshot)
        await client.query('ROLLBACK');
        return { success: true, changed: false };
      }
    }

    // Build atomic UPDATE with status + optional extra fields
    // All changes committed in single atomic operation
    let updateSql = 'UPDATE contest_instances SET status = $1, updated_at = $2';
    const updateParams = [toState, now];
    let paramIndex = 3;

    // Add extra field updates if provided
    if (extraUpdates && typeof extraUpdates === 'object') {
      for (const [fieldName, sqlExpr] of Object.entries(extraUpdates)) {
        updateSql += `, ${fieldName} = ${sqlExpr}`;
      }
    }

    updateSql += ` WHERE id = $${paramIndex} AND status = $${paramIndex + 1} RETURNING id`;
    updateParams.push(contestInstanceId, fromState);

    // Perform atomic state transition with all field updates
    const updateResult = await client.query(updateSql, updateParams);

    if (!updateResult.rows.length) {
      // Race condition: status changed between lock and update
      await client.query('ROLLBACK');
      throw new Error(`Lifecycle race: contest ${contestInstanceId} status changed during transition`);
    }

    // Insert transition record (idempotent via NOT EXISTS)
    await client.query(
      `INSERT INTO contest_state_transitions (
        contest_instance_id, from_state, to_state, triggered_by, reason, created_at
      )
      SELECT $1, $2, $3, $4, $5, $6
      WHERE NOT EXISTS (
        SELECT 1 FROM contest_state_transitions
        WHERE contest_instance_id = $1 AND from_state = $2 AND to_state = $3
      )`,
      [contestInstanceId, fromState, toState, triggeredBy, reason, now]
    );

    await client.query('COMMIT');
    return { success: true, changed: true };

  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      // Ignore rollback errors
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Transition a single LIVE contest to COMPLETE via settlement (admin-triggered).
 *
 * Frozen primitive for manual admin settlement (not time-driven).
 * Shares settlement logic with transitionLiveToComplete() but for one contest.
 *
 * @param {Object} pool - Database connection pool
 * @param {Date} now - Injected current time (for determinism and testability)
 * @param {string} contestInstanceId - Contest instance UUID
 * @returns {Promise<{ success: boolean, changedId: string | null }>}
 * @throws {Error} On database errors or settlement failures
 */
async function transitionSingleLiveToComplete(pool, now, contestInstanceId) {
  const { executeSettlement } = require('./settlementStrategy');
  const { attemptSystemTransitionWithErrorRecovery } = require('./helpers/contestLifecycleAdvancer');

  // Fetch the specific contest for settlement
  const contestResult = await pool.query(
    `SELECT id, entry_fee_cents, payout_structure, template_id, status
     FROM contest_instances
     WHERE id = $1`,
    [contestInstanceId]
  );

  if (!contestResult.rows.length) {
    throw new Error(`Contest ${contestInstanceId} not found`);
  }

  const contestRow = contestResult.rows[0];

  // Skip if not LIVE (idempotent)
  if (contestRow.status !== 'LIVE') {
    return {
      success: true,
      changedId: null
    };
  }

  // Callback: attempts settlement with error recovery
  const settlementCallback = async (pool, contestId, targetStatus) => {
    // If error recovery is calling us with ERROR, don't do settlement
    if (targetStatus === 'ERROR') {
      const result = await pool.query(
        'SELECT * FROM contest_instances WHERE id = $1',
        [contestId]
      );
      return result.rows[0] || null;
    }

    // targetStatus is COMPLETE - perform settlement
    // Fetch FINAL snapshot for this contest
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
      // Missing snapshot - return null (no state change)
      return null;
    }

    const snapshotId = snapshotResult.rows[0].id;
    const snapshotHash = snapshotResult.rows[0].snapshot_hash;

    // Execute settlement with error recovery boundary
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
  try {
    const result = await attemptSystemTransitionWithErrorRecovery(
      pool,
      contestRow,
      'COMPLETE',
      settlementCallback
    );

    // Return success if settlement was not a noop
    return {
      success: true,
      changedId: (result && !result.noop) ? contestInstanceId : null
    };
  } catch (err) {
    throw new Error(`Settlement for contest ${contestInstanceId} failed: ${err.message}`);
  }
}

/**
 * Lock a SCHEDULED contest for admin (manual force-lock, not time-based).
 *
 * Atomically:
 * - Updates status SCHEDULED → LOCKED
 * - Sets lock_time if not already set
 * - Inserts transition record
 *
 * @param {Object} pool - Database connection pool
 * @param {Date} now - Injected current time
 * @param {string} contestInstanceId - Contest instance UUID
 * @returns {Promise<{ success: boolean, changed: boolean }>}
 */
async function lockScheduledContestForAdmin(pool, now, contestInstanceId) {
  const result = await performSingleStateTransition(
    pool,
    now,
    contestInstanceId,
    ['SCHEDULED'],
    'LOCKED',
    'ADMIN_FORCE_LOCK',
    'Manual admin lock',
    null, // no callback
    { lock_time: 'COALESCE(lock_time, NOW())' } // atomic field update
  );
  return { success: result.success, changed: result.changed };
}

/**
 * Mark a contest as ERROR for admin (manual failure intervention).
 * @param {Object} pool - Database connection pool
 * @param {Date} now - Injected current time
 * @param {string} contestInstanceId - Contest instance UUID
 * @returns {Promise<{ success: boolean }>}
 */
async function markContestAsErrorForAdmin(pool, now, contestInstanceId) {
  // Allow from any state except ERROR and COMPLETE
  const result = await performSingleStateTransition(
    pool,
    now,
    contestInstanceId,
    ['SCHEDULED', 'LOCKED', 'LIVE'],
    'ERROR',
    'ADMIN_ERROR_MARK',
    'Manual error marking'
  );
  return { success: result.success };
}

/**
 * Resolve a contest in ERROR status to COMPLETE or CANCELLED (admin recovery).
 * @param {Object} pool - Database connection pool
 * @param {Date} now - Injected current time
 * @param {string} contestInstanceId - Contest instance UUID
 * @param {string} toStatus - Target: COMPLETE or CANCELLED
 * @returns {Promise<{ success: boolean }>}
 */
async function resolveContestErrorForAdmin(pool, now, contestInstanceId, toStatus) {
  if (!['COMPLETE', 'CANCELLED'].includes(toStatus)) {
    throw new Error(`toStatus must be COMPLETE or CANCELLED, got '${toStatus}'`);
  }

  const result = await performSingleStateTransition(
    pool,
    now,
    contestInstanceId,
    ['ERROR'],
    toStatus,
    'ADMIN_ERROR_RESOLVE',
    `Manual error resolution to ${toStatus}`
  );
  return { success: result.success };
}

/**
 * Cancel a contest (admin operation, any status except COMPLETE → CANCELLED).
 * @param {Object} pool - Database connection pool
 * @param {Date} now - Injected current time
 * @param {string} contestInstanceId - Contest instance UUID
 * @returns {Promise<{ success: boolean }>}
 */
async function cancelContestForAdmin(pool, now, contestInstanceId) {
  const result = await performSingleStateTransition(
    pool,
    now,
    contestInstanceId,
    ['SCHEDULED', 'LOCKED', 'LIVE', 'ERROR'],
    'CANCELLED',
    'ADMIN_CANCEL',
    'Manual cancellation'
  );
  return { success: result.success };
}

module.exports = {
  // Bulk (automatic) lifecycle transitions
  transitionScheduledToLocked,
  transitionLockedToLive,
  transitionLiveToComplete,
  // Single-instance (admin) frozen primitives
  transitionSingleLiveToComplete,
  lockScheduledContestForAdmin,
  markContestAsErrorForAdmin,
  resolveContestErrorForAdmin,
  cancelContestForAdmin
};
