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
/**
 * GET /api/admin/financial-ops
 *
 * Get complete operational snapshot for platform finances.
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

/**
 * POST /api/admin/financial-ops/repair-contest-pools
 *
 * Repair all contests with negative pool balances.
 *
 * Scans for contests flagged with negative pools (using same logic as
 * Financial Ops dashboard) and inserts compensating ADJUSTMENT ledger
 * entries to restore pool accounting.
 *
 * Repairs are idempotent: running twice produces no additional entries.
 *
 * Response:
 * {
 *   "contests_scanned": number,
 *   "contests_repaired": number,
 *   "total_adjusted_cents": number
 * }
 */
router.post('/repair-contest-pools', async (req, res) => {
  try {
    const pool = req.app.locals.pool;

    const result = await financialOpsService.repairContestPools(pool);

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    console.error('[Financial Ops] Repair error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to repair contest pools'
    });
  }
});

module.exports = router;
