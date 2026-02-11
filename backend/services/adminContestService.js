/**
 * Admin Contest Service
 *
 * Handles admin-only contest operations:
 * - Status overrides with restricted transition rules
 * - Hard deletion with cascade and refund manifest
 * - Audit logging for all mutations
 */

const { validateContestTimeInvariants } = require('./helpers/timeInvariantValidator');
const { assertAllowedDbStatusTransition, ACTORS, TransitionNotAllowedError } = require('./helpers/contestTransitionValidator');

const ADMIN_TRANSITIONS = {
  draft: [],
  open: ['draft', 'cancelled'],
  locked: ['cancelled'],
  settled: [],
  cancelled: []
};


/**
 * Write an audit record for an admin action (GAP-13 compliant).
 * Uses correct schema column names and required fields.
 *
 * @param {Object} client - DB client (inside transaction)
 * @param {Object} opts
 * @param {string} opts.contest_instance_id - FK to contest_instances
 * @param {string} opts.admin_user_id - FK to users
 * @param {string} opts.action - Action type (e.g., 'cancel_contest')
 * @param {string} opts.reason - Human-readable reason (required by schema)
 * @param {string} opts.from_status - Previous status (required by schema)
 * @param {string} opts.to_status - New status (required by schema)
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
 * Write an audit record for an admin action (DEPRECATED).
 * Use _writeAdminAudit instead. This exists only for backward compatibility.
 *
 * @param {Object} client - DB client (inside transaction) or pool
 * @param {Object} opts
 * @param {string} opts.contest_id
 * @param {string} opts.admin_user_id
 * @param {string} opts.action
 * @param {string} opts.reason
 * @param {Object} opts.payload
 * @deprecated Use _writeAdminAudit instead
 */
async function writeAudit(client, { contest_id, admin_user_id, action, reason, payload }) {
  await client.query(
    `INSERT INTO admin_contest_audit (contest_id, admin_user_id, action, reason, payload)
     VALUES ($1, $2, $3, $4, $5)`,
    [contest_id, admin_user_id, action, reason, JSON.stringify(payload || {})]
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
 * Admin status override with restricted transition rules.
 *
 * Allowed transitions:
 *   open → draft   (only if organizer is sole participant)
 *   open → cancelled
 *   locked → cancelled
 *
 * Settled and cancelled are terminal — no transitions out.
 *
 * @param {Object} pool - Database pool
 * @param {string} contestId
 * @param {string} newStatus
 * @param {string} adminUserId
 * @param {string} reason - Required reason for audit
 * @returns {Promise<Object>} Updated contest
 */
async function overrideStatus(pool, contestId, newStatus, adminUserId, reason) {
  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    throw new Error('reason is required for admin status override');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const lockResult = await client.query(
      'SELECT id, status, organizer_id FROM contest_instances WHERE id = $1 FOR UPDATE',
      [contestId]
    );

    if (lockResult.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new Error('Contest not found');
    }

    const contest = lockResult.rows[0];
    const allowed = ADMIN_TRANSITIONS[contest.status];

    if (!allowed || !allowed.includes(newStatus)) {
      await client.query('ROLLBACK');
      throw new Error(`Admin cannot transition from '${contest.status}' to '${newStatus}'`);
    }

    // open → draft requires organizer is sole participant
    if (contest.status === 'open' && newStatus === 'draft') {
      const countResult = await client.query(
        'SELECT COUNT(*) as cnt FROM contest_participants WHERE contest_instance_id = $1',
        [contestId]
      );
      const participantCount = parseInt(countResult.rows[0].cnt, 10);

      if (participantCount > 1) {
        await client.query('ROLLBACK');
        throw new Error('Cannot revert to draft: contest has participants beyond the organizer');
      }
    }

    const updateResult = await client.query(
      'UPDATE contest_instances SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [newStatus, contestId]
    );

    await writeAudit(client, {
      contest_id: contestId,
      admin_user_id: adminUserId,
      action: 'status_override',
      reason,
      payload: { from_status: contest.status, to_status: newStatus }
    });

    await client.query('COMMIT');
    return updateResult.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Update lock_time on a contest.
 *
 * @param {Object} pool - Database pool
 * @param {string} contestId
 * @param {string} lockTime - ISO 8601 timestamp or null
 * @param {string} adminUserId
 * @param {string} reason
 * @returns {Promise<Object>} Updated contest
 */
async function updateLockTime(pool, contestId, lockTime, adminUserId, reason) {
  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    throw new Error('reason is required for admin lock_time update');
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
      throw new Error('Contest not found');
    }

    const contest = lockResult.rows[0];

    // Validate time invariants before update
    validateContestTimeInvariants({
      existing: contest,
      updates: { lock_time: lockTime }
    });

    const updateResult = await client.query(
      'UPDATE contest_instances SET lock_time = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [lockTime, contestId]
    );

    await writeAudit(client, {
      contest_id: contestId,
      admin_user_id: adminUserId,
      action: 'update_lock_time',
      reason,
      payload: { old_lock_time: contest.lock_time, new_lock_time: lockTime }
    });

    await client.query('COMMIT');
    return updateResult.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Hard delete a contest with cascading cleanup.
 *
 * Transaction steps:
 *   1. SELECT ... FOR UPDATE on contest_instances
 *   2. Reject if status = settled
 *   3. Capture refund manifest (contest_id, entry_fee_cents, participants)
 *   4. Cascade delete: contest_participants, contest_instances
 *   5. Insert audit record
 *   6. COMMIT
 *   7. Return refund manifest
 *
 * Paid contest deletion requires confirmRefund = true.
 *
 * @param {Object} pool - Database pool
 * @param {string} contestId
 * @param {string} adminUserId
 * @param {string} reason
 * @param {boolean} confirmRefund - Must be true for paid contests
 * @returns {Promise<Object>} Refund manifest
 */
async function deleteContest(pool, contestId, adminUserId, reason, confirmRefund) {
  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    throw new Error('reason is required for admin contest deletion');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const lockResult = await client.query(
      'SELECT id, status, entry_fee_cents, organizer_id FROM contest_instances WHERE id = $1 FOR UPDATE',
      [contestId]
    );

    if (lockResult.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new Error('Contest not found');
    }

    const contest = lockResult.rows[0];

    if (contest.status === 'settled') {
      await client.query('ROLLBACK');
      throw new Error('Cannot delete a settled contest');
    }

    // Paid contest deletion requires explicit refund confirmation
    if (contest.entry_fee_cents > 0 && confirmRefund !== true) {
      await client.query('ROLLBACK');
      throw new Error('Paid contest deletion requires confirm_refund = true');
    }

    // Capture refund manifest
    const participantsResult = await client.query(
      'SELECT user_id FROM contest_participants WHERE contest_instance_id = $1',
      [contestId]
    );

    const refundManifest = {
      contest_id: contestId,
      entry_fee_cents: contest.entry_fee_cents,
      participants: participantsResult.rows.map(r => r.user_id)
    };

    // Cascade delete
    await client.query(
      'DELETE FROM contest_participants WHERE contest_instance_id = $1',
      [contestId]
    );
    await client.query(
      'DELETE FROM contest_instances WHERE id = $1',
      [contestId]
    );

    // Audit — contest_id is the deleted contest's ID (for forensics)
    await writeAudit(client, {
      contest_id: contestId,
      admin_user_id: adminUserId,
      action: 'delete_contest',
      reason,
      payload: refundManifest
    });

    await client.query('COMMIT');
    return refundManifest;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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
    const statusResult = await client.query(
      'UPDATE contest_instances SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      ['LOCKED', contestId]
    );

    const updatedContest = statusResult.rows[0];

    // Step 6: Write audit
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
 * Update contest time fields (lock_time, start_time, end_time).
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
    // Terminal state rejection
    if (fromStatus === 'COMPLETE') {
      await _writeAdminAudit(client, {
        contest_instance_id: contestId,
        admin_user_id: adminUserId,
        action: 'cancel_contest',
        reason,
        from_status: fromStatus,
        to_status: fromStatus,
        payload: { noop: true, rejected: true, error_code: 'TERMINAL_STATE' }
      });
      await client.query('ROLLBACK');
      const err = new Error(`Cannot cancel contest in terminal status '${fromStatus}'`);
      err.code = 'TERMINAL_STATE';
      throw err;
    }

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

    // Step 3: Validate transition via validator
    // Let TransitionNotAllowedError propagate if invalid
    assertAllowedDbStatusTransition({
      fromStatus,
      toStatus: 'CANCELLED',
      actor: ACTORS.ADMIN
    });

    // Step 4: Update status
    const updateResult = await client.query(
      'UPDATE contest_instances SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      ['CANCELLED', contestId]
    );

    // Step 5: Write audit
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

module.exports = {
  listContests,
  getContest,
  overrideStatus,
  updateLockTime,
  deleteContest,
  cancelContestInstance,
  forceLockContestInstance,
  updateContestTimeFields,
  writeAudit,
  _writeAdminAudit,
  ADMIN_TRANSITIONS
};
