/**
 * User Operations Admin Routes
 *
 * Aggregated endpoints for User Ops Dashboard
 * Exposes user growth, engagement, and wallet health metrics.
 */

const express = require('express');
const router = express.Router();
const userOpsService = require('../../services/userOpsService');

/**
 * GET /api/admin/users/ops
 *
 * Get complete operational snapshot for user growth and engagement.
 * Aggregates signals from user counts, wallet health, and contest participation.
 *
 * Response:
 * {
 *   "server_time": "ISO-8601 timestamp",
 *   "users": {
 *     "users_total": number,
 *     "users_created_today": number,
 *     "users_created_last_7_days": number
 *   },
 *   "wallets": {
 *     "users_with_wallet_balance": number,
 *     "users_with_zero_balance": number,
 *     "wallet_balance_total": number,
 *     "wallet_balance_avg": number
 *   },
 *   "participation": {
 *     "users_joined_contests_today": number,
 *     "users_joined_contests_last_7_days": number,
 *     "avg_contests_per_user": number,
 *     "users_with_no_entries": number
 *   }
 * }
 */
router.get('/ops', async (req, res) => {
  try {
    const pool = req.app.locals.pool;

    const snapshot = await userOpsService.getUserOpsSnapshot(pool);

    res.json(snapshot);
  } catch (err) {
    console.error('[User Ops - Ops Snapshot] Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
