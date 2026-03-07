/**
 * Admin Ledger Verification Routes
 *
 * All endpoints under /api/admin/ledger/*
 * Protected by existing admin middleware (requireAdmin).
 */

const express = require('express');
const router = express.Router();
const ledgerVerificationService = require('../services/ledgerVerificationService');

/**
 * GET /api/admin/ledger/verification
 * Get ledger verification summary - aggregated by entry type and direction
 * Returns balanced status and breakdown by entry type
 */
router.get('/verification', async (req, res) => {
  try {
    const pool = req.app.locals.pool;

    const verification = await ledgerVerificationService.getLedgerVerification(pool);

    res.json({
      ...verification,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('[Ledger Verification] Error getting verification:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
