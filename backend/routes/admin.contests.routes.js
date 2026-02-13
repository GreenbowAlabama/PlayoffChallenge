/**
 * Admin Contest Control Routes
 *
 * All endpoints under /api/admin/contests/*
 * Protected by existing admin middleware (requireAdmin).
 */

const express = require('express');
const router = express.Router();
const adminContestService = require('../services/adminContestService');

/**
 * GET /api/admin/contests
 * List contests with optional filters: status, organizer_id, limit, offset
 */
router.get('/', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { status, organizer_id, limit, offset } = req.query;

    const contests = await adminContestService.listContests(pool, {
      status,
      organizer_id,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined
    });

    res.json({ contests });
  } catch (err) {
    console.error('[Admin Contests] Error listing contests:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/contests/:id
 * Get a single contest with participant count
 */
router.get('/:id', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const contest = await adminContestService.getContest(pool, req.params.id);

    if (!contest) {
      return res.status(404).json({ error: 'Contest not found' });
    }

    res.json({ contest });
  } catch (err) {
    console.error('[Admin Contests] Error getting contest:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/admin/contests/:id/cancel
 * Cancel contest from SCHEDULED, LOCKED, LIVE, or ERROR
 * Body: { reason }
 */
router.post('/:id/cancel', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ error: 'reason is required' });
    }

    const result = await adminContestService.cancelContestInstance(
      pool,
      req.params.id,
      req.adminUser.id,
      reason
    );

    res.json({ success: result.success, contest: result.contest, noop: result.noop });
  } catch (err) {
    if (err.code === 'CONTEST_NOT_FOUND') {
      return res.status(404).json({ error: err.message });
    }
    if (err.code === 'TERMINAL_STATE' || err.code === 'INVALID_STATUS') {
      return res.status(409).json({ error: err.message });
    }
    console.error('[Admin Contests] Error cancelling contest:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/admin/contests/:id/force-lock
 * Force SCHEDULED → LOCKED transition
 * Body: { reason }
 */
router.post('/:id/force-lock', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ error: 'reason is required' });
    }

    const result = await adminContestService.forceLockContestInstance(
      pool,
      req.params.id,
      req.adminUser.id,
      reason
    );

    res.json({ success: result.success, contest: result.contest, noop: result.noop });
  } catch (err) {
    if (err.code === 'CONTEST_NOT_FOUND') {
      return res.status(404).json({ error: err.message });
    }
    if (err.code === 'INVALID_STATUS') {
      return res.status(409).json({ error: err.message });
    }
    console.error('[Admin Contests] Error force locking contest:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/admin/contests/:id/mark-error
 * Mark LIVE contest as ERROR (failure declaration)
 * Body: { reason }
 */
router.post('/:id/mark-error', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ error: 'reason is required' });
    }

    const result = await adminContestService.markContestError(
      pool,
      req.params.id,
      req.adminUser.id,
      reason
    );

    res.json({ success: result.success, contest: result.contest, noop: result.noop });
  } catch (err) {
    if (err.code === 'CONTEST_NOT_FOUND') {
      return res.status(404).json({ error: err.message });
    }
    if (err.code === 'INVALID_STATUS') {
      return res.status(409).json({ error: err.message });
    }
    console.error('[Admin Contests] Error marking error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/admin/contests/:id/update-times
 * Update lock_time, start_time, end_time on SCHEDULED contests
 * Note: settle_time is system-written and immutable
 * Body: { reason, lock_time?, start_time?, end_time? }
 */
router.post('/:id/update-times', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { lock_time, start_time, end_time, reason } = req.body;

    if (!reason) {
      return res.status(400).json({ error: 'reason is required' });
    }

    const result = await adminContestService.updateContestTimeFields(
      pool,
      req.params.id,
      { lock_time, start_time, end_time, settle_time },
      req.adminUser.id,
      reason
    );

    res.json({ success: result.success, contest: result.contest, noop: result.noop });
  } catch (err) {
    if (err.code === 'CONTEST_NOT_FOUND') {
      return res.status(404).json({ error: err.message });
    }
    if (err.code === 'INVALID_STATUS' || err.message.includes('invariant')) {
      return res.status(409).json({ error: err.message });
    }
    console.error('[Admin Contests] Error updating times:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/admin/contests/:id/settle
 * Trigger settlement (LIVE → COMPLETE)
 * Body: { reason }
 */
router.post('/:id/settle', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ error: 'reason is required' });
    }

    const result = await adminContestService.triggerSettlement(
      pool,
      req.params.id,
      req.adminUser.id,
      reason
    );

    res.json({ success: result.success, contest: result.contest });
  } catch (err) {
    if (err.code === 'CONTEST_NOT_FOUND') {
      return res.status(404).json({ error: err.message });
    }
    if (err.code === 'INVALID_STATUS') {
      return res.status(409).json({ error: err.message });
    }
    console.error('[Admin Contests] Error settling contest:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/admin/contests/:id/resolve-error
 * Resolve ERROR status to COMPLETE or CANCELLED
 * Body: { to_status, reason }
 */
router.post('/:id/resolve-error', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { to_status, reason } = req.body;

    if (!to_status) {
      return res.status(400).json({ error: 'to_status is required' });
    }
    if (!reason) {
      return res.status(400).json({ error: 'reason is required' });
    }

    const result = await adminContestService.resolveError(
      pool,
      req.params.id,
      to_status,
      req.adminUser.id,
      reason
    );

    res.json({ success: result.success, contest: result.contest });
  } catch (err) {
    if (err.code === 'CONTEST_NOT_FOUND') {
      return res.status(404).json({ error: err.message });
    }
    if (err.code === 'INVALID_STATUS' || err.message.includes('toStatus')) {
      return res.status(409).json({ error: err.message });
    }
    console.error('[Admin Contests] Error resolving error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/contests/:id/audit
 * Get audit log for contest
 */
router.get('/:id/audit', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      `SELECT id, created_at, action, from_status, to_status, reason, admin_user_id, payload
       FROM admin_contest_audit
       WHERE contest_instance_id = $1
       ORDER BY created_at DESC`,
      [req.params.id]
    );

    res.json({ audit: result.rows });
  } catch (err) {
    console.error('[Admin Contests] Error fetching audit:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
