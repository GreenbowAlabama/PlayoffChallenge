/**
 * Wallet Routes
 *
 * Handles wallet-related endpoints for managing user wallet balance.
 * Relies on centralized authentication middleware (req.user).
 *
 * Routes:
 * - GET /api/wallet - Get user wallet balance (authenticated)
 */

const express = require('express');
const router = express.Router();
const LedgerRepository = require('../repositories/LedgerRepository');

/**
 * GET /api/wallet
 *
 * Get user wallet balance.
 *
 * Request:
 * - Headers:
 *   - Authorization (required): Bearer {userId} or equivalent auth context
 *
 * Response (200):
 * {
 *   balance_cents: number (can be 0 or positive)
 * }
 *
 * Error responses:
 * - 401: Authentication required (req.user missing)
 * - 500: Database error
 *
 * Authentication:
 * - Requires req.user (populated by upstream auth middleware)
 * - userId derived from req.user.id
 */
router.get('/', async (req, res) => {
  try {
    // Require authenticated user from centralized auth middleware
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const pool = req.app.locals.pool;
    const userId = req.user.id;

    const balanceCents = await LedgerRepository.getWalletBalance(pool, userId);

    return res.status(200).json({
      balance_cents: balanceCents
    });
  } catch (err) {
    console.error('[Wallet] Error fetching balance', {
      userId: req.user?.id,
      error: err.message
    });

    return res.status(500).json({
      error: 'Failed to fetch wallet balance'
    });
  }
});

module.exports = router;
