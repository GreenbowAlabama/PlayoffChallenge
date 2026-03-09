/**
 * Financial Operations Admin Routes
 *
 * Aggregated endpoint for Financial Ops Dashboard.
 * Exposes platform financial health, ledger integrity, wallet liability,
 * contest pools, settlement pipeline, and payout execution.
 */

const express = require('express');
const router = express.Router();
const financialOpsService = require('../../services/financialOpsService');

/**
 * GET /api/admin/financial-ops
 *
 * Get complete operational snapshot for platform finances.
 *
 * Response:
 * {
 *   "server_time": "ISO-8601 timestamp",
 *   "ledger": {
 *     "total_credits_cents": number,
 *     "total_debits_cents": number,
 *     "net_cents": number
 *   },
 *   "wallets": {
 *     "wallet_liability_cents": number,
 *     "users_with_positive_balance": number
 *   },
 *   "contest_pools": {
 *     "contest_pools_cents": number,
 *     "negative_pool_contests": number
 *   },
 *   "settlement": {
 *     "pending_settlement_contests": number,
 *     "settlement_failures": number
 *   },
 *   "payouts": {
 *     "pending_payout_jobs": number,
 *     "failed_payout_transfers": number
 *   },
 *   "reconciliation": {
 *     "deposits_cents": number,
 *     "withdrawals_cents": number,
 *     "expected_cents": number,
 *     "actual_cents": number,
 *     "difference_cents": number,
 *     "status": "balanced" | "drift"
 *   }
 * }
 */
router.get('/', async (req, res) => {
  try {
    const pool = req.app.locals.pool;

    const snapshot = await financialOpsService.getFinancialOpsSnapshot(pool);

    res.json({
      ...snapshot,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('[Financial Ops] Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
