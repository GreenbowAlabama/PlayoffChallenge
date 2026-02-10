/**
 * Admin Contest Service
 *
 * Handles admin-only contest operations:
 * - Status overrides with restricted transition rules
 * - Hard deletion with cascade and refund manifest
 * - Audit logging for all mutations
 */

const { validateContestTimeInvariants } = require('./helpers/timeInvariantValidator');

const ADMIN_TRANSITIONS = {
  draft: [],
  open: ['draft', 'cancelled'],
  locked: ['cancelled'],
  settled: [],
  cancelled: []
};


/**
 * Write an audit record for an admin action.
 *
 * @param {Object} client - DB client (inside transaction) or pool
 * @param {Object} opts
 * @param {string} opts.contest_id
 * @param {string} opts.admin_user_id
 * @param {string} opts.action
 * @param {string} opts.reason
 * @param {Object} opts.payload
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

module.exports = {
  listContests,
  getContest,
  overrideStatus,
  updateLockTime,
  deleteContest,
  writeAudit,
  ADMIN_TRANSITIONS
};
