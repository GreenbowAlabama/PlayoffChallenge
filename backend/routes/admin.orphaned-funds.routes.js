/**
 * Admin Orphaned Funds Routes
 *
 * All endpoints under /api/admin/orphaned-funds/*
 * Protected by existing admin middleware (requireAdmin).
 */

const express = require('express');
const router = express.Router();
const orphanedFundsService = require('../services/orphanedFundsService');

/**
 * GET /api/admin/orphaned-funds/summary
 * Get summary of all contests with stranded funds
 */
router.get('/summary', async (req, res) => {
  try {
    const pool = req.app.locals.pool;

    const contests = await orphanedFundsService.getOrphanedFundsSummary(pool);

    const totalAffectedUsers = contests.reduce(
      (sum, c) => sum + c.affected_user_count,
      0
    );
    const totalStrandedCents = contests.reduce(
      (sum, c) => sum + c.total_stranded_cents,
      0
    );

    res.json({
      contests_with_stranded_funds: contests,
      total_affected_users: totalAffectedUsers,
      total_stranded_cents: totalStrandedCents,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('[Orphaned Funds] Error getting summary:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/orphaned-funds/:contestId
 * Get affected users for a specific contest
 */
router.get('/:contestId', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { contestId } = req.params;

    const result = await orphanedFundsService.getContestAffectedUsers(
      pool,
      contestId
    );

    res.json(result);
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    console.error('[Orphaned Funds] Error getting affected users:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/admin/orphaned-funds/:contestId/refund-all
 * Refund all affected users in a contest
 * Body: { reason: string }
 */
router.post('/:contestId/refund-all', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { contestId } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ error: 'reason is required' });
    }

    const result = await orphanedFundsService.refundContest(
      pool,
      contestId,
      req.adminUser.id,
      reason
    );

    res.json(result);
  } catch (err) {
    console.error('[Orphaned Funds] Error refunding contest:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
