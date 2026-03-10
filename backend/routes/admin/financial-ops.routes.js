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
const financialResetService = require('../../services/financialResetService');

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

/**
 * POST /api/admin/financial-ops/reset-financial-state
 *
 * Reset staging financial state by inserting compensating ledger entries.
 * Neutralizes wallet liability and contest pool balances.
 *
 * Ledger governance:
 * - Append-only: inserts only, no deletions
 * - Uses ADJUSTMENT entry type with DEBIT direction
 * - Idempotent: running twice produces no additional entries
 *
 * Response:
 * {
 *   "success": true,
 *   "wallet_reset_cents": number,
 *   "contest_pool_reset_cents": number
 * }
 */
router.post('/reset-financial-state', async (req, res) => {
  try {
    const pool = req.app.locals.pool;

    const result = await financialResetService.resetFinancialState(pool);

    res.json(result);
  } catch (err) {
    console.error('[Financial Ops] Reset error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to reset financial state'
    });
  }
});

/**
 * POST /api/admin/financial-ops/seed-test-wallets
 *
 * Seed test wallets with $100 each.
 * Identifies test users (email LIKE '%test%') and inserts WALLET_DEPOSIT entries.
 *
 * Ledger governance:
 * - Append-only: inserts only, no mutations
 * - Entry type: WALLET_DEPOSIT
 * - Direction: CREDIT (increases user balance)
 * - Idempotent: running twice does not double-seed
 *
 * Response:
 * {
 *   "users_seeded": number,
 *   "total_seeded_cents": number
 * }
 */
router.post('/seed-test-wallets', async (req, res) => {
  try {
    const pool = req.app.locals.pool;

    const result = await financialResetService.seedTestWallets(pool);

    res.json(result);
  } catch (err) {
    console.error('[Financial Ops] Seed error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to seed test wallets'
    });
  }
});

module.exports = router;
