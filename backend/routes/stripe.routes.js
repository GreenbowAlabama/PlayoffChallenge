/**
 * Stripe Connect Routes
 *
 * Handles Stripe Connect Express onboarding and account status for wallet withdrawals.
 * All endpoints require authentication via extractUserId middleware.
 *
 * Routes:
 * - POST /api/stripe/connect/onboard - Start/resume onboarding, get onboarding link
 * - GET /api/stripe/connect/status - Get current Stripe account status
 */

const express = require('express');
const router = express.Router();
const StripeWithdrawalAdapter = require('../services/StripeWithdrawalAdapter');
// Use the adapter's Stripe instance (single source of truth)
const getStripe = () => StripeWithdrawalAdapter.getStripeInstance();

/**
 * Validate UUID format
 */
function isValidUUID(str) {
  if (!str || typeof str !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Middleware to extract user ID from request.
 * Supports both:
 * - Authorization: Bearer <jwt> (extracts sub or user_id from payload)
 * - X-User-Id: <uuid> (direct UUID)
 * Validates UUID format.
 */
function extractUserId(req, res, next) {
  let userId = null;

  // Try Authorization Bearer token first
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      userId = payload.sub || payload.user_id;
    } catch (err) {
      // JWT decode failed, fall through to X-User-Id check
    }
  }

  // Fall back to X-User-Id header if JWT didn't work
  if (!userId) {
    userId = req.headers['x-user-id'];
  }

  // No user ID found
  if (!userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Validate UUID format
  if (!isValidUUID(userId)) {
    return res.status(400).json({ error: 'Invalid user ID format' });
  }

  if (process.env.LOG_AUTH_DEBUG === 'true') {
    console.log('[Auth]', req.method, req.originalUrl, 'user_id_suffix:', userId.slice(-6));
  }
  req.userId = userId;
  next();
}

/**
 * POST /api/stripe/connect/onboard
 *
 * Start or resume Stripe Connect Express onboarding for the user.
 * Creates a new Stripe Express account if none exists (idempotent).
 * Returns onboarding link for user to complete KYC and bank account setup.
 *
 * Request:
 * - Headers:
 *   - Authorization (required): Bearer {userId}
 *   - X-User-Id (alternative): {userId}
 *
 * Response (200):
 * {
 *   url: string (Stripe onboarding link, expires after 24h)
 * }
 *
 * Error responses:
 * - 401: Authentication required
 * - 500: Stripe API error or database error
 */
router.post('/connect/onboard', extractUserId, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.userId;

    // 1. Fetch user's existing Stripe account
    const userResult = await pool.query(
      'SELECT id, stripe_connected_account_id, email FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    let stripeConnectedAccountId = user.stripe_connected_account_id;

    // 2. Create Stripe Express account if none exists (idempotent)
    if (!stripeConnectedAccountId) {
      const stripeInstance = getStripe();
      const account = await stripeInstance.accounts.create({
        type: 'express',
        country: 'US',
        email: user.email
      });

      stripeConnectedAccountId = account.id;

      // Save account ID to database
      await pool.query(
        'UPDATE users SET stripe_connected_account_id = $1, updated_at = NOW() WHERE id = $2',
        [stripeConnectedAccountId, userId]
      );
    }

    // 3. Create onboarding link
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8081';
    const stripeInstance = getStripe();
    const accountLink = await stripeInstance.accountLinks.create({
      account: stripeConnectedAccountId,
      type: 'account_onboarding',
      refresh_url: `${frontendUrl}/stripe/reauth`,
      return_url: `${frontendUrl}/wallet`
    });

    if (process.env.LOG_AUTH_DEBUG === 'true') {
      console.log('[StripeConnect] Onboarding link generated for user:', userId.slice(-6));
    }

    return res.status(200).json({
      url: accountLink.url
    });
  } catch (err) {
    console.error('[StripeConnect] Error in onboard endpoint', {
      userId: req.userId,
      error: err.message
    });

    return res.status(500).json({
      error: 'Failed to generate onboarding link',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

/**
 * GET /api/stripe/connect/status
 *
 * Get current Stripe Connect account status for the user.
 * Calls Stripe API live to retrieve the most current account state.
 *
 * Request:
 * - Headers:
 *   - Authorization (required): Bearer {userId}
 *   - X-User-Id (alternative): {userId}
 *
 * Response (200):
 * {
 *   connected: boolean,
 *   charges_enabled: boolean | null (if not connected, omitted),
 *   payouts_enabled: boolean | null (if not connected, omitted),
 *   details_submitted: boolean | null (if not connected, omitted)
 * }
 *
 * Error responses:
 * - 401: Authentication required
 * - 500: Stripe API error or database error
 */
router.get('/connect/status', extractUserId, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.userId;

    // 1. Fetch user's Stripe account ID
    const userResult = await pool.query(
      'SELECT id, stripe_connected_account_id FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // 2. Return not connected if no account
    if (!user.stripe_connected_account_id) {
      return res.status(200).json({
        connected: false
      });
    }

    // 3. Fetch live account status from Stripe
    const stripeInstance = getStripe();
    const account = await stripeInstance.accounts.retrieve(user.stripe_connected_account_id);

    if (process.env.LOG_AUTH_DEBUG === 'true') {
      console.log('[StripeConnect] Status check for user:', userId.slice(-6), {
        payouts_enabled: account.payouts_enabled,
        details_submitted: account.details_submitted,
        charges_enabled: account.charges_enabled
      });
    }

    return res.status(200).json({
      connected: true,
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      details_submitted: account.details_submitted
    });
  } catch (err) {
    console.error('[StripeConnect] Error in status endpoint', {
      userId: req.userId,
      error: err.message
    });

    return res.status(500).json({
      error: 'Failed to fetch account status',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

module.exports = router;
