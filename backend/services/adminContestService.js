/**
 * Admin Contest Service — Contest Operation Only
 *
 * Handles admin-only contest operations:
 * - Cancel contest
 * - Force lock contest
 * - Update contest time fields
 * - Trigger settlement
 * - Resolve error status
 * - Audit logging for all mutations
 *
 * This service is operation-focused, not override-focused.
 * All operations respect actor-based transition rules.
 */

const { validateContestTimeInvariants } = require('./helpers/timeInvariantValidator');
const { assertAllowedDbStatusTransition, ACTORS, TransitionNotAllowedError } = require('./helpers/contestTransitionValidator');
const {
  transitionSingleLiveToComplete,
  lockScheduledContestForAdmin,
  markContestAsErrorForAdmin,
  resolveContestErrorForAdmin,
  cancelContestForAdmin
} = require('./contestLifecycleService');

/**
 * Write a contest state transition record.
 * Used to audit all status transitions in adminContestService.
 * Append-only; immutable via DB trigger.
 *
 * @param {Object} client - DB client (inside transaction)
 * @param {string} contestInstanceId - FK to contest_instances
 * @param {string} fromState - Status before transition
 * @param {string} toState - Status after transition
 * @param {string|null} reason - Human-readable reason (nullable)
 */
async function _writeStateTransition(client, contestInstanceId, fromState, toState, reason) {
  await client.query(
    `INSERT INTO contest_state_transitions
     (contest_instance_id, from_state, to_state, triggered_by, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [contestInstanceId, fromState, toState, 'ADMIN', reason || null]
  );
}

/**
 * Write an audit record for an admin action.
 * All required fields must be provided per schema.
 *
 * @param {Object} client - DB client (inside transaction)
 * @param {Object} opts
 * @param {string} opts.contest_instance_id - FK to contest_instances (required)
 * @param {string} opts.admin_user_id - FK to users (required)
 * @param {string} opts.action - Action type (required)
 * @param {string} opts.reason - Human-readable reason (required)
 * @param {string} opts.from_status - Status before operation (required)
 * @param {string} opts.to_status - Status after operation (required)
 * @param {Object} opts.payload - Additional context (optional)
 */
async function _writeAdminAudit(client, {
  contest_instance_id,
  admin_user_id,
  action,
  reason,
  from_status,
  to_status,
  payload = {}
}) {
  await client.query(
    `INSERT INTO admin_contest_audit (
      contest_instance_id, admin_user_id, action, reason,
      from_status, to_status, payload
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      contest_instance_id,
      admin_user_id,
      action,
      reason,
      from_status,
      to_status,
      JSON.stringify(payload)
    ]
  );
}

/**
 * List contests with optional filters.
 *
 * @param {Object} pool - Database pool
 * @param {Object} filters
 * @param {string} [filters.status] - Filter by status
 * @param {string} [filters.organizer_id] - Filter by organizer
 * @param {number} [filters.limit=50] - Max results
 * @param {number} [filters.offset=0] - Offset for pagination
 * @returns {Promise<Array>} Contest instances with participant counts
 */
async function listContests(pool, filters = {}) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (filters.status) {
    conditions.push(`ci.status = $${idx++}`);
    params.push(filters.status);
  }
  if (filters.organizer_id) {
    conditions.push(`ci.organizer_id = $${idx++}`);
    params.push(filters.organizer_id);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  params.push(limit, offset);

  const result = await pool.query(
    `SELECT ci.*,
            ct.name as template_name,
            ct.sport as template_sport,
            (SELECT COUNT(*) FROM contest_participants cp WHERE cp.contest_instance_id = ci.id) as participant_count
     FROM contest_instances ci
     JOIN contest_templates ct ON ci.template_id = ct.id
     ${where}
     ORDER BY ci.created_at DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    params
  );

  return result.rows;
}

/**
 * Get a single contest with participant count.
 *
 * @param {Object} pool - Database pool
 * @param {string} contestId - Contest instance UUID
 * @returns {Promise<Object|null>}
 */
async function getContest(pool, contestId) {
  const result = await pool.query(
    `SELECT ci.*,
            ct.name as template_name,
            ct.sport as template_sport,
            (SELECT COUNT(*) FROM contest_participants cp WHERE cp.contest_instance_id = ci.id) as participant_count
     FROM contest_instances ci
     JOIN contest_templates ct ON ci.template_id = ct.id
     WHERE ci.id = $1`,
    [contestId]
  );
  return result.rows[0] || null;
}


/**
 * Force SCHEDULED → LOCKED transition by updating lock_time and performing SYSTEM transition.
 *
 * This operation respects the actor model:
 *   - ADMIN updates lock_time to NOW (if null)
 *   - SYSTEM validates and performs the status transition
 *
 * Transaction steps:
 *   1. SELECT * FOR UPDATE to lock the row
 *   2. Check status AFTER lock (not via conditional UPDATE)
 *   3. If LOCKED: idempotent return with noop=true
 *   4. If not SCHEDULED: rejection with audit (let catch handle rollback)
 *   5. Validate SYSTEM transition (SCHEDULED → LOCKED)
 *   6. UPDATE lock_time to NOW (ADMIN action)
 *   7. UPDATE status to LOCKED (SYSTEM transition)
 *   8. Write audit with all required fields
 *   9. COMMIT
 *
 * @param {Object} pool - Database pool
 * @param {string} contestId - Contest instance UUID
 * @param {string} adminUserId - Admin user UUID
 * @param {string} reason - Human-readable reason for force lock
 * @returns {Promise<Object>} { success: boolean, contest: Object, noop: boolean }
 * @throws {Error} If contest not found, status invalid, or transition not allowed
 */
async function forceLockContestInstance(pool, contestId, adminUserId, reason) {
  // Validate inputs
  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    throw new Error('reason is required for force lock');
  }

  // Verify contest exists and fetch current status
  const checkClient = await pool.connect();
  let contest;
  try {
    const checkResult = await checkClient.query(
      'SELECT * FROM contest_instances WHERE id = $1',
      [contestId]
    );
    if (!checkResult.rows.length) {
      const err = new Error('Contest not found');
      err.code = 'CONTEST_NOT_FOUND';
      throw err;
    }
    contest = checkResult.rows[0];
  } finally {
    checkClient.release();
  }

  const fromStatus = contest.status;

  // Idempotency: already locked
  if (fromStatus === 'LOCKED') {
    const auditClient = await pool.connect();
    try {
      await auditClient.query('BEGIN');
      await _writeAdminAudit(auditClient, {
        contest_instance_id: contestId,
        admin_user_id: adminUserId,
        action: 'force_lock',
        reason,
        from_status: fromStatus,
        to_status: fromStatus,
        payload: { noop: true }
      });
      await auditClient.query('COMMIT');
    } finally {
      auditClient.release();
    }
    return { success: true, contest, noop: true };
  }

  // Rejection: only SCHEDULED allowed
  if (fromStatus !== 'SCHEDULED') {
    const auditClient = await pool.connect();
    try {
      await auditClient.query('BEGIN');
      await _writeAdminAudit(auditClient, {
        contest_instance_id: contestId,
        admin_user_id: adminUserId,
        action: 'force_lock',
        reason,
        from_status: fromStatus,
        to_status: fromStatus,
        payload: { noop: true, rejected: true, error_code: 'INVALID_STATUS' }
      });
      await auditClient.query('COMMIT');
    } finally {
      auditClient.release();
    }
    const err = new Error(`Cannot force lock from status '${fromStatus}'. Only SCHEDULED contests can be force-locked.`);
    err.code = 'INVALID_STATUS';
    throw err;
  }

  // Validate SYSTEM transition via actor model
  assertAllowedDbStatusTransition({
    fromStatus,
    toStatus: 'LOCKED',
    actor: ACTORS.SYSTEM
  });

  // Call frozen lifecycle primitive
  // This atomically updates status + lock_time + inserts transition record
  const now = new Date();
  let transitionResult;
  try {
    transitionResult = await lockScheduledContestForAdmin(pool, now, contestId);
  } catch (err) {
    const auditClient = await pool.connect();
    try {
      await auditClient.query('BEGIN');
      await _writeAdminAudit(auditClient, {
        contest_instance_id: contestId,
        admin_user_id: adminUserId,
        action: 'force_lock',
        reason,
        from_status: fromStatus,
        to_status: fromStatus,
        payload: { rejected: true, error_code: 'LIFECYCLE_ERROR', error: err.message }
      });
      await auditClient.query('COMMIT');
    } finally {
      auditClient.release();
    }
    throw err;
  }

  // Fetch final updated contest
  const fetchClient = await pool.connect();
  let updatedContest;
  try {
    const fetchResult = await fetchClient.query(
      'SELECT * FROM contest_instances WHERE id = $1',
      [contestId]
    );
    updatedContest = fetchResult.rows[0];
  } finally {
    fetchClient.release();
  }

  // Write admin audit record
  const auditClient = await pool.connect();
  try {
    await auditClient.query('BEGIN');
    await _writeAdminAudit(auditClient, {
      contest_instance_id: contestId,
      admin_user_id: adminUserId,
      action: 'force_lock',
      reason,
      from_status: fromStatus,
      to_status: 'LOCKED',
      payload: {
        noop: !transitionResult.changed,
        lock_time_set: !contest.lock_time,
        lock_time: updatedContest.lock_time
      }
    });
    await auditClient.query('COMMIT');
  } finally {
    auditClient.release();
  }

  return {
    success: true,
    contest: updatedContest,
    noop: !transitionResult.changed
  };
}

/**
 * Update contest time fields (lock_time, start_time, end_time only).
 * settle_time is system-written and immutable per contract.
 *
 * Constraints:
 *   - SCHEDULED status only
 *   - No lifecycle transitions
 *   - Dynamic UPDATE of only changed fields
 *   - Time invariant validation on merged state
 *   - Idempotency via explicit field comparison
 *   - Audit on all paths (success, noop, rejection)
 *
 * @param {Object} pool - Database pool
 * @param {string} contestId - Contest instance UUID
 * @param {Object} timeFields - { lock_time?, start_time?, end_time? } (ISO 8601)
 * @param {string} adminUserId - Admin user UUID
 * @param {string} reason - Human-readable reason (optional, defaults to 'admin_time_update')
 * @returns {Promise<Object>} { success: boolean, contest: Object, noop: boolean }
 * @throws {Error} If contest not found, status invalid, or time invariants violated
 */
async function updateContestTimeFields(pool, contestId, timeFields, adminUserId, reason) {
  // Default reason if empty
  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    reason = 'admin_time_update';
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Step 1: Lock row
    const lockResult = await client.query(
      'SELECT * FROM contest_instances WHERE id = $1 FOR UPDATE',
      [contestId]
    );

    if (lockResult.rows.length === 0) {
      await client.query('ROLLBACK');
      const err = new Error('Contest not found');
      err.code = 'CONTEST_NOT_FOUND';
      throw err;
    }

    const contest = lockResult.rows[0];
    const fromStatus = contest.status;

    // Step 2: Check status - SCHEDULED only
    if (fromStatus !== 'SCHEDULED') {
      await _writeAdminAudit(client, {
        contest_instance_id: contestId,
        admin_user_id: adminUserId,
        action: 'update_time_fields',
        reason,
        from_status: fromStatus,
        to_status: fromStatus,
        payload: { noop: true, rejected: true, error_code: 'INVALID_STATUS' }
      });
      await client.query('COMMIT');
      const err = new Error(`Cannot update time fields in status '${fromStatus}'. Only SCHEDULED contests allow time updates.`);
      err.code = 'INVALID_STATUS';
      throw err;
    }

    // Step 3: Determine what's actually changing
    const oldValues = {};
    const newValues = {};
    let hasChanges = false;

    if (timeFields.lock_time !== undefined && timeFields.lock_time !== contest.lock_time) {
      oldValues.lock_time = contest.lock_time;
      newValues.lock_time = timeFields.lock_time;
      hasChanges = true;
    }

    if (timeFields.start_time !== undefined && timeFields.start_time !== contest.start_time) {
      oldValues.start_time = contest.start_time;
      newValues.start_time = timeFields.start_time;
      hasChanges = true;
    }

    if (timeFields.end_time !== undefined && timeFields.end_time !== contest.end_time) {
      oldValues.end_time = contest.end_time;
      newValues.end_time = timeFields.end_time;
      hasChanges = true;
    }

    // Step 4: Idempotency check
    if (!hasChanges) {
      await _writeAdminAudit(client, {
        contest_instance_id: contestId,
        admin_user_id: adminUserId,
        action: 'update_time_fields',
        reason,
        from_status: fromStatus,
        to_status: fromStatus,
        payload: { noop: true }
      });
      await client.query('COMMIT');
      return {
        success: true,
        contest,
        noop: true
      };
    }

    // Step 5: Validate time invariants on merged state
    try {
      validateContestTimeInvariants({
        existing: contest,
        updates: timeFields
      });
    } catch (err) {
      await _writeAdminAudit(client, {
        contest_instance_id: contestId,
        admin_user_id: adminUserId,
        action: 'update_time_fields',
        reason,
        from_status: fromStatus,
        to_status: fromStatus,
        payload: { noop: true, rejected: true, error_code: 'TIME_INVARIANT_VIOLATION' }
      });
      throw err;
    }

    // Step 6: Build dynamic UPDATE
    const setClauses = [];
    const params = [];
    let paramIndex = 1;

    if (timeFields.lock_time !== undefined && timeFields.lock_time !== contest.lock_time) {
      setClauses.push(`lock_time = $${paramIndex++}`);
      params.push(timeFields.lock_time);
    }

    if (timeFields.start_time !== undefined && timeFields.start_time !== contest.start_time) {
      setClauses.push(`start_time = $${paramIndex++}`);
      params.push(timeFields.start_time);
    }

    if (timeFields.end_time !== undefined && timeFields.end_time !== contest.end_time) {
      setClauses.push(`end_time = $${paramIndex++}`);
      params.push(timeFields.end_time);
    }

    setClauses.push('updated_at = NOW()');
    params.push(contestId);

    const updateQuery = `
      UPDATE contest_instances
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const updateResult = await client.query(updateQuery, params);

    // Step 7: Write audit
    await _writeAdminAudit(client, {
      contest_instance_id: contestId,
      admin_user_id: adminUserId,
      action: 'update_time_fields',
      reason,
      from_status: fromStatus,
      to_status: fromStatus,
      payload: {
        noop: false,
        old_values: oldValues,
        new_values: newValues
      }
    });

    // Step 8: Commit
    await client.query('COMMIT');

    return {
      success: true,
      contest: updateResult.rows[0],
      noop: false
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Cancel a contest from SCHEDULED, LOCKED, LIVE, or ERROR status.
 * COMPLETE is terminal and cannot be cancelled.
 *
 * Transaction steps:
 *   1. SELECT * FOR UPDATE to lock the row
 *   2. Check status AFTER lock (not via conditional UPDATE)
 *   3. Reject COMPLETE with error (terminal state)
 *   4. Handle CANCELLED as idempotent (return noop)
 *   5. Validate ADMIN transition via validator
 *   6. UPDATE status to CANCELLED
 *   7. Write audit with all required fields
 *   8. COMMIT
 *
 * @param {Object} pool - Database pool
 * @param {string} contestId - Contest instance UUID
 * @param {string} adminUserId - Admin user UUID
 * @param {string} reason - Human-readable reason for cancellation
 * @returns {Promise<Object>} { success: boolean, contest: Object, noop: boolean }
 * @throws {Error} If contest not found or transition invalid
 */
async function cancelContestInstance(pool, contestId, adminUserId, reason) {
  // Validate inputs
  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    throw new Error('reason is required for contest cancellation');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock and fetch contest
    const lockResult = await client.query(
      'SELECT * FROM contest_instances WHERE id = $1 FOR UPDATE',
      [contestId]
    );

    if (!lockResult.rows.length) {
      await client.query('ROLLBACK');
      const err = new Error('Contest not found');
      err.code = 'CONTEST_NOT_FOUND';
      throw err;
    }

    const contest = lockResult.rows[0];
    const fromStatus = contest.status;

    // 2. Idempotency: already cancelled
    if (fromStatus === 'CANCELLED') {
      await _writeAdminAudit(client, {
        contest_instance_id: contestId,
        admin_user_id: adminUserId,
        action: 'cancel_contest',
        reason,
        from_status: fromStatus,
        to_status: fromStatus,
        payload: { noop: true }
      });
      await client.query('COMMIT');
      return { success: true, contest, noop: true };
    }

    // 3. Fail-closed: only SCHEDULED, LOCKED, ERROR allowed
    if (!['SCHEDULED', 'LOCKED', 'ERROR'].includes(fromStatus)) {
      await _writeAdminAudit(client, {
        contest_instance_id: contestId,
        admin_user_id: adminUserId,
        action: 'cancel_contest',
        reason,
        from_status: fromStatus,
        to_status: fromStatus,
        payload: { rejected: true, error_code: 'INVALID_STATUS' }
      });
      await client.query('COMMIT');
      const err = new Error(`Cannot cancel contest in status '${fromStatus}'. Only SCHEDULED, LOCKED, and ERROR contests can be cancelled.`);
      err.code = 'INVALID_STATUS';
      throw err;
    }

    // 4. Validate transition via actor model
    assertAllowedDbStatusTransition({
      fromStatus,
      toStatus: 'CANCELLED',
      actor: ACTORS.ADMIN
    });

    // 5. Call frozen lifecycle primitive (using same client to keep transaction atomic)
    const now = new Date();
    await cancelContestForAdmin(pool, now, contestId, client);

    // 6. Fetch updated contest (now that it's CANCELLED)
    const fetchResult = await client.query(
      'SELECT * FROM contest_instances WHERE id = $1',
      [contestId]
    );
    const updatedContest = fetchResult.rows[0];

    // 7. Refund all participants (deterministic, idempotent via idempotency_key)
    if (contest.entry_fee_cents > 0) {
      // Get all participants at time of cancellation
      const participantsResult = await client.query(
        `SELECT DISTINCT user_id FROM contest_participants WHERE contest_instance_id = $1`,
        [contestId]
      );

      // Create refund entry for each participant
      for (const participant of participantsResult.rows) {
        const userId = participant.user_id;
        const refundIdempotencyKey = `cancel_contest_refund:${contestId}:${userId}`;

        await client.query(
          `INSERT INTO ledger (
             user_id,
             entry_type,
             direction,
             amount_cents,
             currency,
             reference_type,
             reference_id,
             contest_instance_id,
             idempotency_key,
             created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [
            userId,
            'ENTRY_FEE_REFUND',
            'CREDIT',
            contest.entry_fee_cents,
            'USD',
            'CONTEST',
            contestId,
            contestId,
            refundIdempotencyKey
          ]
        );
      }
    }

    // 8. Write admin audit
    await _writeAdminAudit(client, {
      contest_instance_id: contestId,
      admin_user_id: adminUserId,
      action: 'cancel_contest',
      reason,
      from_status: fromStatus,
      to_status: 'CANCELLED',
      payload: { noop: false }
    });

    // 9. Commit all changes atomically
    await client.query('COMMIT');

    return {
      success: true,
      contest: updatedContest,
      noop: false
    };

  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      // Swallow rollback errors
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Mark contest as ERROR (LIVE → ERROR only).
 * Explicit failure declaration by admin.
 *
 * Transaction steps:
 *   1. SELECT * FOR UPDATE
 *   2. If ERROR: audit noop, COMMIT, return success with noop=true (idempotent)
 *   3. If status !== LIVE: audit rejected, COMMIT, throw INVALID_STATUS
 *   4. UPDATE status to ERROR
 *   5. Write audit
 *   6. COMMIT
 *
 * @param {Object} pool - Database pool
 * @param {string} contestId - Contest instance UUID
 * @param {string} adminUserId - Admin user UUID
 * @param {string} reason - Human-readable reason for failure declaration
 * @returns {Promise<Object>} { success: boolean, contest: Object, noop?: boolean }
 * @throws {Error} If contest not found or status invalid
 */
async function markContestError(pool, contestId, adminUserId, reason) {
  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    throw new Error('reason is required for error marking');
  }

  // Delegate to frozen primitive (handles validation, UPDATE, transition record)
  return await markContestAsErrorForAdmin(pool, new Date(), contestId);
}

/**
 * Trigger settlement transition (LIVE → COMPLETE).
 *
 * Transaction steps:
 *   1. SELECT * FOR UPDATE
 *   2. If COMPLETE: audit noop, COMMIT, return success with noop=true
 *   3. If status !== LIVE: audit rejected, COMMIT, throw INVALID_STATUS
 *   4. UPDATE status to COMPLETE
 *   5. Write audit
 *   6. COMMIT
 *
 * @param {Object} pool - Database pool
 * @param {string} contestId - Contest instance UUID
 * @param {string} adminUserId - Admin user UUID
 * @param {string} reason - Human-readable reason
 * @returns {Promise<Object>} { success: boolean, contest: Object, noop?: boolean }
 * @throws {Error} If contest not found or status invalid
 */
async function triggerSettlement(pool, contestId, adminUserId, reason) {
  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    throw new Error('reason is required for settlement trigger');
  }

  // Verify contest exists and fetch current status for audit
  const checkClient = await pool.connect();
  let fromStatus;
  try {
    const checkResult = await checkClient.query(
      'SELECT status FROM contest_instances WHERE id = $1',
      [contestId]
    );
    if (checkResult.rows.length === 0) {
      const err = new Error('Contest not found');
      err.code = 'CONTEST_NOT_FOUND';
      throw err;
    }
    fromStatus = checkResult.rows[0].status;
  } finally {
    checkClient.release();
  }

  // Idempotent if already COMPLETE
  if (fromStatus === 'COMPLETE') {
    const auditClient = await pool.connect();
    try {
      await auditClient.query('BEGIN');
      await _writeAdminAudit(auditClient, {
        contest_instance_id: contestId,
        admin_user_id: adminUserId,
        action: 'trigger_settlement',
        reason,
        from_status: fromStatus,
        to_status: fromStatus,
        payload: { noop: true }
      });
      await auditClient.query('COMMIT');
    } finally {
      auditClient.release();
    }
    return {
      success: true,
      noop: true
    };
  }

  // Reject if not LIVE
  if (fromStatus !== 'LIVE') {
    const auditClient = await pool.connect();
    try {
      await auditClient.query('BEGIN');
      await _writeAdminAudit(auditClient, {
        contest_instance_id: contestId,
        admin_user_id: adminUserId,
        action: 'trigger_settlement',
        reason,
        from_status: fromStatus,
        to_status: fromStatus,
        payload: { noop: true, rejected: true, error_code: 'INVALID_STATUS' }
      });
      await auditClient.query('COMMIT');
    } finally {
      auditClient.release();
    }
    const err = new Error(`Cannot settle contest in status '${fromStatus}'. Only LIVE contests can be settled.`);
    err.code = 'INVALID_STATUS';
    throw err;
  }

  // Call frozen lifecycle primitive with injected now
  const now = new Date();
  let result;
  try {
    result = await transitionSingleLiveToComplete(pool, now, contestId);
  } catch (err) {
    // Settlement error - write audit and rethrow
    const auditClient = await pool.connect();
    try {
      await auditClient.query('BEGIN');
      await _writeAdminAudit(auditClient, {
        contest_instance_id: contestId,
        admin_user_id: adminUserId,
        action: 'trigger_settlement',
        reason,
        from_status: fromStatus,
        to_status: fromStatus,
        payload: { rejected: true, error_code: 'SETTLEMENT_ERROR', error: err.message }
      });
      await auditClient.query('COMMIT');
    } finally {
      auditClient.release();
    }
    throw err;
  }

  // Fetch updated contest for response and audit
  const fetchClient = await pool.connect();
  let updatedContest;
  let toStatus = fromStatus;
  try {
    const fetchResult = await fetchClient.query(
      'SELECT * FROM contest_instances WHERE id = $1',
      [contestId]
    );
    updatedContest = fetchResult.rows[0];
    toStatus = updatedContest?.status || fromStatus;
  } finally {
    fetchClient.release();
  }

  // Write audit record
  const auditClient = await pool.connect();
  try {
    await auditClient.query('BEGIN');
    await _writeAdminAudit(auditClient, {
      contest_instance_id: contestId,
      admin_user_id: adminUserId,
      action: 'trigger_settlement',
      reason,
      from_status: fromStatus,
      to_status: toStatus,
      payload: { noop: !result.changedId }
    });
    await auditClient.query('COMMIT');
  } finally {
    auditClient.release();
  }

  return {
    success: true,
    contest: updatedContest,
    noop: !result.changedId
  };
}

/**
 * Resolve ERROR status to COMPLETE or CANCELLED.
 *
 * Transaction steps:
 *   1. SELECT * FOR UPDATE
 *   2. If status !== ERROR: audit rejected, COMMIT, throw INVALID_STATUS
 *   3. If toStatus not in COMPLETE|CANCELLED: throw immediately
 *   4. UPDATE status to toStatus
 *   5. Write audit
 *   6. COMMIT
 *
 * @param {Object} pool - Database pool
 * @param {string} contestId - Contest instance UUID
 * @param {string} toStatus - Target status: COMPLETE or CANCELLED
 * @param {string} adminUserId - Admin user UUID
 * @param {string} reason - Human-readable reason
 * @returns {Promise<Object>} { success: boolean, contest: Object }
 * @throws {Error} If contest not found, status invalid, or toStatus invalid
 */
async function resolveError(pool, contestId, toStatus, adminUserId, reason) {
  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    throw new Error('reason is required for error resolution');
  }

  if (!['COMPLETE', 'CANCELLED'].includes(toStatus)) {
    throw new Error(`toStatus must be COMPLETE or CANCELLED, got '${toStatus}'`);
  }

  // Delegate to frozen primitive (handles validation, UPDATE, transition record)
  return await resolveContestErrorForAdmin(pool, new Date(), contestId, toStatus);
}

/**
 * Compatibility wrapper: overrideStatus (legacy)
 * Maps legacy transitions to v1 equivalents.
 * Only supports transitions that are semantically equivalent.
 *
 * @param {Object} pool - Database pool
 * @param {string} contestId - Contest instance UUID
 * @param {string} toStatus - Target legacy status (e.g., 'cancelled', 'locked')
 * @param {string} adminId - Admin user UUID
 * @param {string} reason - Human-readable reason
 * @returns {Promise<Object>} Result from underlying operation
 * @throws {Error} If transition not supported
 */
async function overrideStatus(pool, contestId, toStatus, adminId, reason) {
  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    throw new Error('reason is required');
  }

  switch (toStatus) {
    case 'cancelled':
      return cancelContestInstance(pool, contestId, adminId, reason);

    case 'locked':
      return forceLockContestInstance(pool, contestId, adminId, reason);

    default:
      throw new Error(`Unsupported legacy overrideStatus transition to '${toStatus}'`);
  }
}

/**
 * Compatibility wrapper: updateLockTime (legacy)
 * Maps to updateContestTimeFields for v1 contract.
 *
 * @param {Object} pool - Database pool
 * @param {string} contestId - Contest instance UUID
 * @param {string|null} newLockTime - New lock time (ISO 8601 or null)
 * @param {string} adminId - Admin user UUID
 * @param {string} reason - Human-readable reason
 * @returns {Promise<Object>} Result from updateContestTimeFields
 * @throws {Error} If contest not found or status invalid
 */
async function updateLockTime(pool, contestId, newLockTime, adminId, reason) {
  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    throw new Error('reason is required');
  }

  return updateContestTimeFields(
    pool,
    contestId,
    { lock_time: newLockTime },
    adminId,
    reason
  );
}

/**
 * Compatibility wrapper: deleteContest (legacy)
 * Routes to cancelContestInstance because deletion is not part of v1 lifecycle.
 * Cancellation is the correct semantic operation for contest removal from active contests.
 *
 * @param {Object} pool - Database pool
 * @param {string} contestId - Contest instance UUID
 * @param {string} adminId - Admin user UUID
 * @param {string} reason - Human-readable reason
 * @param {boolean} hard - Unused (ignored for compatibility)
 * @returns {Promise<Object>} Result from cancelContestInstance
 * @throws {Error} If contest not found or status invalid
 */
async function deleteContest(pool, contestId, adminId, reason, hard) {
  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    throw new Error('reason is required');
  }

  // Route to cancel - correct semantic operation
  return cancelContestInstance(pool, contestId, adminId, reason);
}

/**
 * Admin Remove User From Contest
 *
 * Removes a participant from a contest and refunds entry fee (if applicable).
 * Only allowed for SCHEDULED and LOCKED contests.
 *
 * Atomic operation:
 * - Removes contest_participants row
 * - Creates refund ledger entry (idempotent via idempotency_key)
 * - Writes admin audit entry
 *
 * Idempotent: If user is not in contest, returns success with noop=true.
 *
 * @param {Object} pool - Database pool
 * @param {string} contestId - Contest instance UUID
 * @param {string} userId - User to remove UUID
 * @param {string} adminUserId - Admin performing the action UUID
 * @param {string} reason - Human-readable reason
 * @returns {Promise<Object>} { success: true, noop: boolean, refunded: boolean }
 * @throws {Error} If contest not found, invalid status, or database error
 */
async function adminRemoveUserFromContest(pool, contestId, userId, adminUserId, reason) {
  // Validate inputs
  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    throw new Error('reason is required');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock and fetch contest
    const lockResult = await client.query(
      'SELECT * FROM contest_instances WHERE id = $1 FOR UPDATE',
      [contestId]
    );

    if (!lockResult.rows.length) {
      await client.query('ROLLBACK');
      const err = new Error('Contest not found');
      err.code = 'CONTEST_NOT_FOUND';
      throw err;
    }

    const contest = lockResult.rows[0];

    // 2. Only allowed for SCHEDULED or LOCKED contests
    if (!['SCHEDULED', 'LOCKED'].includes(contest.status)) {
      await client.query('ROLLBACK');
      const err = new Error(`Cannot remove user from contest in ${contest.status} status. Only SCHEDULED and LOCKED contests allow user removal.`);
      err.code = 'INVALID_STATUS';
      throw err;
    }

    // 3. Check if participant exists (SELECT FOR UPDATE to lock row)
    const participantResult = await client.query(
      `SELECT contest_instance_id, user_id
       FROM contest_participants
       WHERE contest_instance_id = $1 AND user_id = $2
       FOR UPDATE`,
      [contestId, userId]
    );

    // 4. If participant doesn't exist, idempotent noop
    if (participantResult.rows.length === 0) {
      await _writeAdminAudit(client, {
        contest_instance_id: contestId,
        admin_user_id: adminUserId,
        action: 'remove_user_from_contest',
        reason,
        from_status: contest.status,
        to_status: contest.status,
        payload: { user_id: userId, refunded: false, noop: true }
      });
      await client.query('COMMIT');
      return { success: true, noop: true, refunded: false };
    }

    // 5. Delete the participant
    await client.query(
      'DELETE FROM contest_participants WHERE contest_instance_id = $1 AND user_id = $2',
      [contestId, userId]
    );

    // 6. Create refund entry if entry_fee_cents > 0
    let refunded = false;
    if (contest.entry_fee_cents > 0) {
      const refundIdempotencyKey = `remove_user_refund:${contestId}:${userId}`;

      await client.query(
        `INSERT INTO ledger (
           user_id,
           entry_type,
           direction,
           amount_cents,
           currency,
           reference_type,
           reference_id,
           contest_instance_id,
           idempotency_key,
           created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [
          userId,
          'ENTRY_FEE_REFUND',
          'CREDIT',
          contest.entry_fee_cents,
          'USD',
          'CONTEST',
          contestId,
          contestId,
          refundIdempotencyKey
        ]
      );

      refunded = true;
    }

    // 7. Write admin audit
    await _writeAdminAudit(client, {
      contest_instance_id: contestId,
      admin_user_id: adminUserId,
      action: 'remove_user_from_contest',
      reason,
      from_status: contest.status,
      to_status: contest.status,
      payload: { user_id: userId, refunded, amount_cents: contest.entry_fee_cents }
    });

    // 8. Commit all changes atomically
    await client.query('COMMIT');

    return { success: true, noop: false, refunded };

  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      // Swallow rollback errors
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Compatibility constant: ADMIN_TRANSITIONS
 * Maps legacy transition expectations for test compatibility.
 * Does not affect actual lifecycle logic.
 */
const ADMIN_TRANSITIONS = {
  draft: [],
  open: ['draft', 'cancelled'],
  locked: ['cancelled'],
  cancelled: [],
  settled: []
};

module.exports = {
  listContests,
  getContest,
  cancelContestInstance,
  adminRemoveUserFromContest,
  forceLockContestInstance,
  updateContestTimeFields,
  triggerSettlement,
  resolveError,
  markContestError,
  overrideStatus,
  deleteContest,
  updateLockTime,
  ADMIN_TRANSITIONS,
  _writeAdminAudit,
  _writeStateTransition
};
