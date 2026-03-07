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

/**
 * GET /api/admin/users/:userId/wallet-ledger
 *
 * Returns wallet transaction history for a specific user.
 * Ordered by most recent first, limited to 100 transactions.
 *
 * Response:
 * {
 *   "user_id": "uuid",
 *   "current_balance_cents": 55000,
 *   "transactions": [
 *     {
 *       "id": "uuid",
 *       "entry_type": "WALLET_DEPOSIT|ENTRY_FEE|PRIZE_PAYOUT|...",
 *       "direction": "CREDIT|DEBIT",
 *       "amount_cents": 6000,
 *       "created_at": "2026-03-07T14:15:00Z",
 *       "reference_id": "uuid",
 *       "metadata_json": {}
 *     }
 *   ]
 * }
 */
router.get('/:userId/wallet-ledger', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { userId } = req.params;

    // Verify user exists
    const userResult = await pool.query(
      `SELECT id FROM users WHERE id = $1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get transaction history
    const transactionsResult = await pool.query(
      `SELECT
        id,
        entry_type,
        direction,
        amount_cents,
        created_at,
        reference_id,
        metadata_json
      FROM ledger
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 100`,
      [userId]
    );

    // Compute current wallet balance
    const balanceResult = await pool.query(
      `SELECT
        COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents ELSE -amount_cents END), 0) as balance_cents
      FROM ledger
      WHERE user_id = $1`,
      [userId]
    );

    const currentBalance = balanceResult.rows[0]?.balance_cents || 0;

    res.json({
      user_id: userId,
      current_balance_cents: parseInt(currentBalance, 10),
      transactions: transactionsResult.rows.map(row => ({
        id: row.id,
        entry_type: row.entry_type,
        direction: row.direction,
        amount_cents: parseInt(row.amount_cents, 10),
        created_at: row.created_at,
        reference_id: row.reference_id,
        metadata_json: row.metadata_json
      }))
    });
  } catch (err) {
    console.error('[Admin Users] Error fetching wallet ledger:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/admin/users/:userId/wallet/credit
 *
 * Issue a wallet credit to a user for payouts, refunds, or adjustments.
 *
 * Request body:
 * - amount_cents: number (positive integer, in cents)
 * - reason: string enum (PAYOUT_ADJUSTMENT | REFUND | GOODWILL | OTHER)
 * - reference_contest_id: string uuid (optional, for audit trail)
 * - notes: string (max 1000 chars, admin explanation)
 *
 * Response:
 * - success: boolean
 * - new_balance_cents: number (user's balance after credit)
 * - ledger_entry_id: string uuid
 * - idempotency_key: string
 * - timestamp: ISO 8601 timestamp
 * - error: string (if applicable)
 *
 * Idempotency:
 * - Same idempotency_key (userId:reason:reference_contest_id) = single ledger entry
 * - Calling twice with same params returns success with same result
 */
router.post('/:userId/wallet/credit', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { userId } = req.params;
    const { amount_cents, reason, reference_contest_id, notes } = req.body;

    // Validate inputs
    if (!Number.isInteger(amount_cents) || amount_cents <= 0) {
      return res.status(400).json({ error_code: 'INVALID_AMOUNT', reason: 'amount_cents must be a positive integer' });
    }

    if (!['PAYOUT_ADJUSTMENT', 'REFUND', 'GOODWILL', 'OTHER'].includes(reason)) {
      return res.status(400).json({ error_code: 'INVALID_REASON', reason: 'reason must be one of: PAYOUT_ADJUSTMENT, REFUND, GOODWILL, OTHER' });
    }

    if (!notes || notes.trim().length === 0) {
      return res.status(400).json({ error_code: 'INVALID_NOTES', reason: 'notes is required' });
    }

    // Reject any attempt to create ENTRY_FEE entries via admin endpoint
    // ENTRY_FEE entries can ONLY be created by contest join logic
    if (reason === 'ENTRY_FEE') {
      return res.status(400).json({
        error: 'INVALID_ENTRY_TYPE',
        message: 'ENTRY_FEE entries can only be created by contest join logic (joinContest, publishContestInstance), not admin endpoints'
      });
    }

    // Generate deterministic idempotency key
    const idempotencyKey = `wallet_credit:${userId}:${reason}:${reference_contest_id || 'none'}`;

    // Insert credit atomically
    const ledgerId = require('crypto').randomUUID();
    const now = new Date();

    try {
      // Try to insert the ledger entry
      // Columns based on actual schema (no reason_code or created_by_admin_id)
      const insertResult = await pool.query(
        `INSERT INTO ledger
         (id, reference_id, entry_type, direction, amount_cents, reference_type,
          idempotency_key, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [ledgerId, userId, 'WALLET_DEPOSIT', 'CREDIT', amount_cents, 'WALLET', idempotencyKey, now]
      );

      // Check if insert was successful (didn't violate unique constraint)
      if (insertResult.rows.length === 0) {
        // Idempotency key already exists - verify it matches our request
        const existingResult = await pool.query(
          `SELECT id, amount_cents FROM ledger WHERE idempotency_key = $1`,
          [idempotencyKey]
        );

        if (existingResult.rows.length === 0) {
          return res.status(500).json({ error: 'Ledger entry disappeared after conflict check' });
        }

        const existingEntry = existingResult.rows[0];
        if (existingEntry.amount_cents !== amount_cents) {
          return res.status(409).json({ error_code: 'IDEMPOTENCY_CONFLICT', reason: 'Conflict - idempotency key already exists with different amount' });
        }

        // Return success with existing ledger entry
        const walletBalance = await require('../repositories/LedgerRepository').computeWalletBalance(pool, userId);
        return res.json({
          success: true,
          new_balance_cents: walletBalance,
          ledger_entry_id: existingEntry.id,
          idempotency_key: idempotencyKey,
          timestamp: now.toISOString()
        });
      }

      // Insert succeeded - compute new balance
      const { computeWalletBalance } = require('../repositories/LedgerRepository');
      const newBalance = await computeWalletBalance(pool, userId);

      res.json({
        success: true,
        new_balance_cents: newBalance,
        ledger_entry_id: insertResult.rows[0].id,
        idempotency_key: idempotencyKey,
        timestamp: now.toISOString()
      });
    } catch (dbErr) {
      if (dbErr.code === '23505') {
        // Unique violation on idempotency_key
        const existingResult = await pool.query(
          `SELECT id, amount_cents FROM ledger WHERE idempotency_key = $1`,
          [idempotencyKey]
        );

        if (existingResult.rows.length > 0) {
          const existingEntry = existingResult.rows[0];
          if (existingEntry.amount_cents !== amount_cents) {
            return res.status(409).json({ error_code: 'IDEMPOTENCY_CONFLICT', reason: 'Conflict - idempotency key already exists with different amount' });
          }

          const walletBalance = await require('../repositories/LedgerRepository').computeWalletBalance(pool, userId);
          return res.json({
            success: true,
            new_balance_cents: walletBalance,
            ledger_entry_id: existingEntry.id,
            idempotency_key: idempotencyKey,
            timestamp: now.toISOString()
          });
        }
      }
      throw dbErr;
    }
  } catch (err) {
    if (err.code === '23503') {
      // Foreign key violation - user doesn't exist
      return res.status(404).json({ error: 'User not found' });
    }
    console.error('[Admin Users] Error crediting wallet:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
