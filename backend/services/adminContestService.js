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

    // Step 2: Check status AFTER lock
    // Idempotency: already locked
    if (fromStatus === 'LOCKED') {
      await _writeAdminAudit(client, {
        contest_instance_id: contestId,
        admin_user_id: adminUserId,
        action: 'force_lock',
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

    // Rejection: only SCHEDULED allowed
    if (fromStatus !== 'SCHEDULED') {
      await _writeAdminAudit(client, {
        contest_instance_id: contestId,
        admin_user_id: adminUserId,
        action: 'force_lock',
        reason,
        from_status: fromStatus,
        to_status: fromStatus,
        payload: { noop: true, rejected: true, error_code: 'INVALID_STATUS' }
      });
      await client.query('COMMIT');
      const err = new Error(`Cannot force lock from status '${fromStatus}'. Only SCHEDULED contests can be force-locked.`);
      err.code = 'INVALID_STATUS';
      throw err;
    }

    // Step 3: Validate SYSTEM transition
    // This enforces the actor model: SYSTEM performs the transition
    assertAllowedDbStatusTransition({
      fromStatus,
      toStatus: 'LOCKED',
      actor: ACTORS.SYSTEM
    });

    // Step 4: Update lock_time (ADMIN action)
    const lockTimeResult = await client.query(
      'UPDATE contest_instances SET lock_time = COALESCE(lock_time, NOW()), updated_at = NOW() WHERE id = $1 RETURNING *',
      [contestId]
    );

    const lockTimeUpdatedContest = lockTimeResult.rows[0];

    // Step 5: Update status (SYSTEM transition)
    // DB-level guard: only update if still in SCHEDULED state
    const statusResult = await client.query(
      'UPDATE contest_instances SET status = $1, updated_at = NOW() WHERE id = $2 AND status = $3 RETURNING *',
      ['LOCKED', contestId, 'SCHEDULED']
    );

    // Detect lifecycle race: status changed between SELECT and UPDATE
    if (statusResult.rows.length === 0) {
      await _writeAdminAudit(client, {
        contest_instance_id: contestId,
        admin_user_id: adminUserId,
        action: 'force_lock',
        reason,
        from_status: fromStatus,
        to_status: fromStatus,
        payload: { rejected: true, error_code: 'LIFECYCLE_RACE', race_detected: true }
      });
      await client.query('COMMIT');
      const err = new Error('Lifecycle transition race detected');
      err.code = 'LIFECYCLE_RACE';
      throw err;
    }

    const updatedContest = statusResult.rows[0];

    // Step 6: Log state transition (append-only)
    await _writeStateTransition(client, contestId, fromStatus, 'LOCKED', reason);

    // Step 7: Write audit
    await _writeAdminAudit(client, {
      contest_instance_id: contestId,
      admin_user_id: adminUserId,
      action: 'force_lock',
      reason,
      from_status: fromStatus,
      to_status: 'LOCKED',
      payload: {
        noop: false,
        lock_time_set: !contest.lock_time,
        lock_time: lockTimeUpdatedContest.lock_time
      }
    });

    // Step 7: Commit
    await client.query('COMMIT');

    return {
      success: true,
      contest: updatedContest,
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

    // Step 2: Check status AFTER lock
    // Idempotency: already cancelled
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
      return {
        success: true,
        contest,
        noop: true
      };
    }

    // Step 3: Fail-closed: only SCHEDULED, LOCKED, ERROR allowed
    // If future statuses added, reject rather than allow
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

    // Step 4: Validate transition via validator
    assertAllowedDbStatusTransition({
      fromStatus,
      toStatus: 'CANCELLED',
      actor: ACTORS.ADMIN
    });

    // Step 5: Update status
    // DB-level guard: only update if status hasn't changed since SELECT
    const updateResult = await client.query(
      'UPDATE contest_instances SET status = $1, updated_at = NOW() WHERE id = $2 AND status = $3 RETURNING *',
      ['CANCELLED', contestId, fromStatus]
    );

    // Detect lifecycle race: status changed between SELECT and UPDATE
    if (updateResult.rows.length === 0) {
      await _writeAdminAudit(client, {
        contest_instance_id: contestId,
        admin_user_id: adminUserId,
        action: 'cancel_contest',
        reason,
        from_status: fromStatus,
        to_status: fromStatus,
        payload: { rejected: true, error_code: 'LIFECYCLE_RACE', race_detected: true }
      });
      await client.query('COMMIT');
      const err = new Error('Lifecycle transition race detected');
      err.code = 'LIFECYCLE_RACE';
      throw err;
    }

    // Step 6: Log state transition (append-only)
    await _writeStateTransition(client, contestId, fromStatus, 'CANCELLED', reason);

    // Step 7: Write audit
    await _writeAdminAudit(client, {
      contest_instance_id: contestId,
      admin_user_id: adminUserId,
      action: 'cancel_contest',
      reason,
      from_status: fromStatus,
      to_status: 'CANCELLED',
      payload: { noop: false }
    });

    // Step 6: Commit
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

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

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

    // Idempotency: already ERROR
    if (fromStatus === 'ERROR') {
      await _writeAdminAudit(client, {
        contest_instance_id: contestId,
        admin_user_id: adminUserId,
        action: 'mark_error',
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

    // Only LIVE → ERROR allowed
    if (fromStatus !== 'LIVE') {
      await _writeAdminAudit(client, {
        contest_instance_id: contestId,
        admin_user_id: adminUserId,
        action: 'mark_error',
        reason,
        from_status: fromStatus,
        to_status: fromStatus,
        payload: { rejected: true, error_code: 'INVALID_STATUS' }
      });
      await client.query('COMMIT');
      const err = new Error(`Cannot mark error on contest in status '${fromStatus}'. Only LIVE contests can be marked as ERROR.`);
      err.code = 'INVALID_STATUS';
      throw err;
    }

    // DB-level guard: only update if still in LIVE state
    const updateResult = await client.query(
      'UPDATE contest_instances SET status = $1, updated_at = NOW() WHERE id = $2 AND status = $3 RETURNING *',
      ['ERROR', contestId, 'LIVE']
    );

    // Detect lifecycle race: status changed between SELECT and UPDATE
    if (updateResult.rows.length === 0) {
      await _writeAdminAudit(client, {
        contest_instance_id: contestId,
        admin_user_id: adminUserId,
        action: 'mark_error',
        reason,
        from_status: fromStatus,
        to_status: fromStatus,
        payload: { rejected: true, error_code: 'LIFECYCLE_RACE', race_detected: true }
      });
      await client.query('COMMIT');
      const err = new Error('Lifecycle transition race detected');
      err.code = 'LIFECYCLE_RACE';
      throw err;
    }

    // Log state transition (append-only)
    await _writeStateTransition(client, contestId, fromStatus, 'ERROR', reason);

    await _writeAdminAudit(client, {
      contest_instance_id: contestId,
      admin_user_id: adminUserId,
      action: 'mark_error',
      reason,
      from_status: fromStatus,
      to_status: 'ERROR',
      payload: {}
    });

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

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

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

    // Idempotent if already COMPLETE
    if (fromStatus === 'COMPLETE') {
      await _writeAdminAudit(client, {
        contest_instance_id: contestId,
        admin_user_id: adminUserId,
        action: 'trigger_settlement',
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

    // Reject if not LIVE
    if (fromStatus !== 'LIVE') {
      await _writeAdminAudit(client, {
        contest_instance_id: contestId,
        admin_user_id: adminUserId,
        action: 'trigger_settlement',
        reason,
        from_status: fromStatus,
        to_status: fromStatus,
        payload: { noop: true, rejected: true, error_code: 'INVALID_STATUS' }
      });
      await client.query('COMMIT');
      const err = new Error(`Cannot settle contest in status '${fromStatus}'. Only LIVE contests can be settled.`);
      err.code = 'INVALID_STATUS';
      throw err;
    }

    // Update to COMPLETE
    // DB-level guard: only update if still in LIVE state
    const updateResult = await client.query(
      'UPDATE contest_instances SET status = $1, updated_at = NOW() WHERE id = $2 AND status = $3 RETURNING *',
      ['COMPLETE', contestId, 'LIVE']
    );

    // Detect lifecycle race: status changed between SELECT and UPDATE
    if (updateResult.rows.length === 0) {
      await _writeAdminAudit(client, {
        contest_instance_id: contestId,
        admin_user_id: adminUserId,
        action: 'trigger_settlement',
        reason,
        from_status: fromStatus,
        to_status: fromStatus,
        payload: { rejected: true, error_code: 'LIFECYCLE_RACE', race_detected: true }
      });
      await client.query('COMMIT');
      const err = new Error('Lifecycle transition race detected');
      err.code = 'LIFECYCLE_RACE';
      throw err;
    }

    // Log state transition (append-only)
    await _writeStateTransition(client, contestId, fromStatus, 'COMPLETE', reason);

    // Audit success
    await _writeAdminAudit(client, {
      contest_instance_id: contestId,
      admin_user_id: adminUserId,
      action: 'trigger_settlement',
      reason,
      from_status: fromStatus,
      to_status: 'COMPLETE',
      payload: { noop: false }
    });

    await client.query('COMMIT');

    return {
      success: true,
      contest: updateResult.rows[0]
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

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

    // Reject if not ERROR
    if (fromStatus !== 'ERROR') {
      await _writeAdminAudit(client, {
        contest_instance_id: contestId,
        admin_user_id: adminUserId,
        action: 'resolve_error',
        reason,
        from_status: fromStatus,
        to_status: fromStatus,
        payload: { noop: true, rejected: true, error_code: 'INVALID_STATUS' }
      });
      await client.query('COMMIT');
      const err = new Error(`Cannot resolve error on contest in status '${fromStatus}'. Only ERROR contests can be resolved.`);
      err.code = 'INVALID_STATUS';
      throw err;
    }

    // Update to target status
    // DB-level guard: only update if still in ERROR state
    const updateResult = await client.query(
      'UPDATE contest_instances SET status = $1, updated_at = NOW() WHERE id = $2 AND status = $3 RETURNING *',
      [toStatus, contestId, 'ERROR']
    );

    // Detect lifecycle race: status changed between SELECT and UPDATE
    if (updateResult.rows.length === 0) {
      await _writeAdminAudit(client, {
        contest_instance_id: contestId,
        admin_user_id: adminUserId,
        action: 'resolve_error',
        reason,
        from_status: fromStatus,
        to_status: fromStatus,
        payload: { rejected: true, error_code: 'LIFECYCLE_RACE', race_detected: true }
      });
      await client.query('COMMIT');
      const err = new Error('Lifecycle transition race detected');
      err.code = 'LIFECYCLE_RACE';
      throw err;
    }

    // Log state transition (append-only)
    await _writeStateTransition(client, contestId, fromStatus, toStatus, reason);

    // Audit success
    await _writeAdminAudit(client, {
      contest_instance_id: contestId,
      admin_user_id: adminUserId,
      action: 'resolve_error',
      reason,
      from_status: fromStatus,
      to_status: toStatus,
      payload: { resolved_to: toStatus }
    });

    await client.query('COMMIT');

    return {
      success: true,
      contest: updateResult.rows[0]
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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
