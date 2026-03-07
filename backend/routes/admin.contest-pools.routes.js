/**
 * Admin Contest Pool Diagnostics Routes
 *
 * All endpoints under /api/admin/contest-pools/*
 * Protected by existing admin middleware (requireAdmin).
 */

const express = require('express');
const router = express.Router();
const contestPoolDiagnosticsService = require('../services/contestPoolDiagnosticsService');

/**
 * GET /api/admin/contest-pools/negative
 * Get all contests with negative pool balances
 * Returns summary with root cause classification and ordering
 */
router.get('/negative', async (req, res) => {
  try {
    const pool = req.app.locals.pool;

    const contests = await contestPoolDiagnosticsService.getNegativePoolContests(pool);

    // Calculate summary stats
    const totalNegativeCents = contests.reduce(
      (sum, c) => sum + c.pool_balance_cents,
      0
    );

    // Count by root cause
    const rootCauseCounts = {
      PAYOUTS_EXCEED_ENTRIES: contests.filter(c => c.root_cause === 'PAYOUTS_EXCEED_ENTRIES').length,
      NO_ENTRIES_WITH_PAYOUTS: contests.filter(c => c.root_cause === 'NO_ENTRIES_WITH_PAYOUTS').length,
      REFUNDED_ENTRIES_WITH_PAYOUTS: contests.filter(c => c.root_cause === 'REFUNDED_ENTRIES_WITH_PAYOUTS').length,
      MIXED: contests.filter(c => c.root_cause === 'MIXED').length
    };

    res.json({
      contests,
      total_count: contests.length,
      total_negative_cents: totalNegativeCents,
      root_cause_breakdown: rootCauseCounts,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('[Contest Pool Diagnostics] Error getting negative pools:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/contest-pools/:contestId/details
 * Get detailed ledger breakdown for a specific contest
 */
router.get('/:contestId/details', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { contestId } = req.params;

    const details = await contestPoolDiagnosticsService.getContestPoolDetails(pool, contestId);

    res.json(details);
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    console.error('[Contest Pool Diagnostics] Error getting contest details:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
