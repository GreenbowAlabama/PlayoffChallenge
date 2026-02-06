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
 * PATCH /api/admin/contests/:id/status
 * Force status change with admin override rules
 * Body: { status, reason }
 */
router.patch('/:id/status', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { status, reason } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'status is required' });
    }
    if (!reason) {
      return res.status(400).json({ error: 'reason is required' });
    }

    const contest = await adminContestService.overrideStatus(
      pool,
      req.params.id,
      status,
      req.adminUser.id,
      reason
    );

    res.json({ contest });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    if (err.message.includes('cannot') || err.message.includes('Cannot')) {
      return res.status(409).json({ error: err.message });
    }
    console.error('[Admin Contests] Error overriding status:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/admin/contests/:id
 * Update lock_time
 * Body: { lock_time, reason }
 */
router.patch('/:id', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { lock_time, reason } = req.body;

    if (!reason) {
      return res.status(400).json({ error: 'reason is required' });
    }

    const contest = await adminContestService.updateLockTime(
      pool,
      req.params.id,
      lock_time || null,
      req.adminUser.id,
      reason
    );

    res.json({ contest });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    console.error('[Admin Contests] Error updating lock_time:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/admin/contests/:id
 * Hard delete contest with cascading cleanup
 * Body: { reason, confirm_refund }
 */
router.delete('/:id', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { reason, confirm_refund } = req.body;

    if (!reason) {
      return res.status(400).json({ error: 'reason is required' });
    }

    const refundManifest = await adminContestService.deleteContest(
      pool,
      req.params.id,
      req.adminUser.id,
      reason,
      confirm_refund
    );

    res.json({ deleted: true, refund_manifest: refundManifest });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    if (err.message.includes('settled') || err.message.includes('confirm_refund')) {
      return res.status(409).json({ error: err.message });
    }
    console.error('[Admin Contests] Error deleting contest:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
