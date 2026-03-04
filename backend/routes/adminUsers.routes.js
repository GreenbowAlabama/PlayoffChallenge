/**
 * Admin Users Routes
 *
 * Protected routes for admin user management and visibility.
 * All endpoints require admin authentication via requireAdmin middleware.
 */

const express = require('express');
const router = express.Router();
const adminUsersService = require('../services/adminUsers.service');

/**
 * GET /api/admin/users
 *
 * Returns all users with wallet and contest visibility data.
 *
 * Response includes:
 * - wallet_balance_cents: Current wallet balance (all credits minus all debits)
 * - lifetime_deposits_cents: Total wallet deposits
 * - lifetime_withdrawals_cents: Total wallet withdrawals
 * - active_contests_count: Count of contests in SCHEDULED/LOCKED/LIVE status
 * - last_wallet_activity_at: Timestamp of most recent ledger entry
 */
router.get('/', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const users = await adminUsersService.getAllUsersWithWalletVisibility(pool);
    res.json(users);
  } catch (err) {
    console.error('[Admin Users] Error fetching users:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/users/:userId
 *
 * Returns detailed user information including wallet visibility and recent activity.
 *
 * Response includes all wallet fields plus:
 * - recent_ledger_entries: Last 5 ledger entries with contest context
 * - contests: All contests user has participated in with status
 */
router.get('/:userId', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { userId } = req.params;

    const user = await adminUsersService.getUserDetailWithActivity(pool, userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (err) {
    console.error('[Admin Users] Error fetching user detail:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
