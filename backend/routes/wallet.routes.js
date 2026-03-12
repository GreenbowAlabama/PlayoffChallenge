/**
 * Wallet Routes
 *
 * Handles wallet-related endpoints for managing user wallet balance.
 * All endpoints require authentication via extractUserId middleware.
 *
 * Routes:
 * - GET /api/wallet - Get user wallet balance (authenticated)
 */

const express = require('express');
const router = express.Router();
const LedgerRepository = require('../repositories/LedgerRepository');
const withdrawalService = require('../services/withdrawalService');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');
const crypto = require('crypto');

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
 * GET /api/wallet
 *
 * Get user wallet balance (balance-only endpoint).
 *
 * Request:
 * - Headers:
 *   - Authorization (required): Bearer {userId}
 *   - X-User-Id (alternative): {userId}
 *
 * Response (200):
 * {
 *   balance_cents: number (can be 0 or positive)
 * }
 *
 * Error responses:
 * - 400: Invalid user ID format
 * - 401: Authentication required (no Authorization or X-User-Id header)
 * - 500: Database error
 *
 * Authentication:
 * - Requires extractUserId middleware to set req.userId
 * - userId extracted from Authorization Bearer token or X-User-Id header
 *
 * Note: Ledger history is available via separate endpoint if needed.
 */
router.get('/', extractUserId, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.userId;

    const balanceCents = await LedgerRepository.getWalletBalance(pool, userId);

    if (process.env.LOG_AUTH_DEBUG === 'true') {
      console.log('[Wallet] Fetched balance for user:', userId.slice(-6), 'balance:', balanceCents);
    }

    return res.status(200).json({
      balance_cents: balanceCents
    });
  } catch (err) {
    console.error('[Wallet] Error fetching balance', {
      userId: req.userId,
      error: err.message
    });

    return res.status(500).json({
      error: 'Failed to fetch wallet balance'
    });
  }
});

/**
 * GET /api/wallet/transactions
 *
 * Get user's recent wallet transactions (ledger entries).
 * Returns all ledger entries for the user, sorted by date (newest first).
 *
 * Request:
 * - Headers:
 *   - Authorization (required): Bearer {userId}
 *   - X-User-Id (alternative): {userId}
 * - Query params (optional):
 *   - limit: number (default: 50, max: 100)
 *   - offset: number (default: 0)
 *
 * Response (200):
 * {
 *   transactions: [
 *     {
 *       id: string (UUID),
 *       entry_type: 'ENTRY_FEE' | 'WALLET_DEPOSIT' | 'WALLET_WITHDRAWAL' | 'PAYOUT_COMPLETED',
 *       direction: 'DEBIT' | 'CREDIT',
 *       amount_cents: number,
 *       reference_type: 'CONTEST' | 'WALLET' | 'PAYOUT_TRANSFER',
 *       reference_id: string (UUID),
 *       description: string,
 *       created_at: ISO string
 *     }
 *   ],
 *   total_count: number
 * }
 *
 * Error responses:
 * - 400: Invalid parameters
 * - 401: Authentication required
 * - 500: Database error
 */
router.get('/transactions', extractUserId, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.userId;

    // Parse and validate pagination params
    let limit = parseInt(req.query.limit) || 50;
    let offset = parseInt(req.query.offset) || 0;

    limit = Math.min(Math.max(limit, 1), 100); // Clamp to 1-100
    offset = Math.max(offset, 0);

    // Fetch total count
    const countResult = await pool.query(
      'SELECT COUNT(*) as count FROM ledger WHERE user_id = $1',
      [userId]
    );
    const totalCount = parseInt(countResult.rows[0].count, 10);

    // Fetch transactions
    const txResult = await pool.query(
      `SELECT
        id,
        entry_type,
        direction,
        amount_cents,
        reference_type,
        reference_id,
        idempotency_key,
        created_at
      FROM ledger
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    // Map to response format with human-readable descriptions
    const transactions = txResult.rows.map(row => {
      let description = '';
      switch (row.entry_type) {
        case 'ENTRY_FEE':
          description = 'Contest Entry Fee';
          break;
        case 'WALLET_DEPOSIT':
          description = 'Wallet Top-Up';
          break;
        case 'WALLET_WITHDRAWAL':
          description = 'Wallet Withdrawal';
          break;
        case 'PAYOUT_COMPLETED':
          description = 'Contest Payout';
          break;
        default:
          description = row.entry_type;
      }

      return {
        id: row.id,
        entry_type: row.entry_type,
        direction: row.direction,
        amount_cents: row.amount_cents,
        reference_type: row.reference_type,
        reference_id: row.reference_id,
        description,
        created_at: row.created_at
      };
    });

    return res.status(200).json({
      transactions,
      total_count: totalCount
    });
  } catch (err) {
    console.error('[Wallet] Error fetching transactions', {
      userId: req.userId,
      error: err.message
    });

    return res.status(500).json({
      error: 'Failed to fetch transactions'
    });
  }
});

/**
 * POST /api/wallet/fund
 *
 * Create Stripe PaymentIntent for wallet top-up (QA/testing).
 * Idempotent: same Idempotency-Key returns cached client_secret.
 *
 * Request:
 * - Headers:
 *   - Authorization (required): Bearer {userId}
 *   - Idempotency-Key (required): Unique request identifier
 * - Body: { amount_cents: number }
 *
 * Response (200):
 * {
 *   client_secret: string (for Stripe payment sheet),
 *   amount_cents: number
 * }
 *
 * Error responses:
 * - 400: Invalid amount, missing Idempotency-Key, or invalid request
 * - 401: Authentication required
 * - 500: Stripe error or database error
 */
router.post('/fund', extractUserId, async (req, res) => {
  try {
    console.log('[WalletFund] ========== REQUEST RECEIVED ==========');
    console.log('[WalletFund] Method:', req.method);
    console.log('[WalletFund] Path:', req.path);
    console.log('[WalletFund] URL:', req.originalUrl);
    console.log('[WalletFund] Headers:', JSON.stringify(req.headers, null, 2));

    const pool = req.app.locals.pool;
    const userId = req.userId;
    const { amount_cents } = req.body;
    const idempotencyKey = req.headers['idempotency-key'];

    console.log('[WalletFund] userId:', userId);
    console.log('[WalletFund] amount_cents:', amount_cents);
    console.log('[WalletFund] idempotencyKey:', idempotencyKey);

    // 1. Validate Idempotency-Key header
    if (!idempotencyKey || typeof idempotencyKey !== 'string') {
      console.log('[WalletFund] ERROR: Missing or invalid Idempotency-Key');
      return res.status(400).json({
        error: 'Invalid request',
        reason: 'Idempotency-Key header is required'
      });
    }

    // 2. Validate amount_cents
    console.log('[WalletFund] Validating amount_cents:', amount_cents);
    if (!Number.isInteger(amount_cents) || amount_cents <= 0) {
      console.log('[WalletFund] ERROR: Invalid amount_cents (not positive integer)');
      return res.status(400).json({
        error: 'Invalid request',
        reason: 'amount_cents must be a positive integer'
      });
    }

    // 3. Check staging max (default: 100000 cents = $1000)
    const maxDepositCents = parseInt(process.env.WALLET_MAX_DEPOSIT_CENTS || '100000', 10);
    console.log('[WalletFund] Max deposit cents:', maxDepositCents);
    if (amount_cents > maxDepositCents) {
      console.log('[WalletFund] ERROR: Amount exceeds maximum');
      return res.status(400).json({
        error: 'Invalid request',
        reason: `Maximum deposit is ${maxDepositCents} cents`,
        max_deposit_cents: maxDepositCents
      });
    }

    // 4. Check if wallet_deposit_intent with this idempotency_key already exists
    console.log('[WalletFund] Checking for existing wallet_deposit_intent...');
    const existingResult = await pool.query(
      `SELECT stripe_payment_intent_id, amount_cents, status, created_at
       FROM wallet_deposit_intents
       WHERE idempotency_key = $1`,
      [idempotencyKey]
    );

    if (existingResult.rows.length > 0) {
      const existing = existingResult.rows[0];
      console.log('[WalletFund] Found cached result:', existing);
      // Return cached result
      return res.status(200).json({
        client_secret: existing.stripe_payment_intent_id, // Note: This is a mock; real Stripe call would return actual client_secret
        amount_cents: existing.amount_cents,
        cached: true
      });
    }

    console.log('[WalletFund] No cached result found, creating new PaymentIntent...');

    // 5. Create Stripe PaymentIntent with WALLET_TOPUP purpose
    console.log('[WalletFund] Creating Stripe PaymentIntent...');
    console.log('[WalletFund] Stripe config: SECRET_KEY present =', !!process.env.STRIPE_SECRET_KEY);

    let paymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.create(
        {
          amount: amount_cents,
          currency: 'usd',
          payment_method_types: ['card'],
          metadata: {
            purpose: 'WALLET_TOPUP',
            user_id: userId
          }
        },
        {
          idempotencyKey: idempotencyKey
        }
      );
      console.log('[WalletFund] Stripe PaymentIntent created:', paymentIntent.id);
    } catch (stripeError) {
      console.log('[WalletFund] ERROR: Stripe API call failed:', stripeError.message);
      throw stripeError;
    }

    // 6. Insert wallet_deposit_intent record
    console.log('[WalletFund] Inserting wallet_deposit_intent record...');
    const insertResult = await pool.query(
      `INSERT INTO wallet_deposit_intents (
         user_id, stripe_payment_intent_id, amount_cents, currency, status, idempotency_key
       ) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, stripe_payment_intent_id, amount_cents, status`,
      [userId, paymentIntent.id, amount_cents, 'USD', 'REQUIRES_CONFIRMATION', idempotencyKey]
    );

    const intent = insertResult.rows[0];
    console.log('[WalletFund] wallet_deposit_intent record created:', intent.id);

    console.log('[WalletFund] ========== SUCCESS ==========');
    console.log('[WalletFund] Returning response: client_secret, amount_cents');

    return res.status(200).json({
      client_secret: paymentIntent.client_secret,
      amount_cents: amount_cents
    });
  } catch (err) {
    console.error('[WalletFund] ========== ERROR ==========');
    console.error('[WalletFund] Error creating PaymentIntent');
    console.error('[WalletFund] Error message:', err.message);
    console.error('[WalletFund] Error code:', err.code);
    console.error('[WalletFund] Error type:', err.type);
    console.error('[WalletFund] Error stack:', err.stack);

    // Stripe errors
    if (err.type === 'StripeInvalidRequestError') {
      console.error('[WalletFund] Returning 400: Stripe invalid request');
      return res.status(400).json({
        error: 'Invalid request',
        reason: err.message
      });
    }

    if (err.code === '23505') {
      // Duplicate idempotency_key
      console.error('[WalletFund] Returning 400: Duplicate idempotency key');
      return res.status(400).json({
        error: 'Invalid request',
        reason: 'Duplicate idempotency key'
      });
    }

    console.error('[WalletFund] Returning 500: Generic error');
    return res.status(500).json({
      error: 'Failed to create payment intent',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

/**
 * POST /api/wallet/withdraw
 *
 * Create withdrawal request and process it.
 * Debits wallet and creates Stripe payout.
 *
 * Request:
 * - Headers:
 *   - Authorization (required): Bearer {userId}
 *   - Idempotency-Key (required): Unique request identifier
 * - Body: { amount_cents: number, method: 'standard'|'instant' }
 *
 * Response (200):
 * {
 *   withdrawal_id: string (UUID),
 *   status: string,
 *   amount_cents: number
 * }
 *
 * Error responses:
 * - 400: Invalid amount or missing Idempotency-Key
 * - 401: Authentication required
 * - 422: Insufficient wallet funds
 * - 500: Service error
 */
router.post('/withdraw', extractUserId, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.userId;
    const { amount_cents, method = 'standard' } = req.body;
    const idempotencyKey = req.headers['idempotency-key'];
    const environment = process.env.ENVIRONMENT || 'sandbox';

    // 1. Validate Idempotency-Key header
    if (!idempotencyKey || typeof idempotencyKey !== 'string') {
      return res.status(400).json({
        error: 'Invalid request',
        reason: 'Idempotency-Key header is required'
      });
    }

    // 2. Validate amount_cents
    if (!Number.isInteger(amount_cents) || amount_cents <= 0) {
      return res.status(400).json({
        error: 'Invalid request',
        reason: 'amount_cents must be a positive integer'
      });
    }

    // 3. Validate method
    if (!['standard', 'instant'].includes(method)) {
      return res.status(400).json({
        error: 'Invalid request',
        reason: "method must be 'standard' or 'instant'"
      });
    }

    // 4. Create withdrawal request
    const createResult = await withdrawalService.createWithdrawalRequest(
      pool,
      userId,
      { amount_cents, method, idempotency_key: idempotencyKey },
      environment
    );

    if (!createResult.success) {
      // Handle specific error codes
      if (createResult.error_code === 'INSUFFICIENT_BALANCE') {
        return res.status(422).json({
          error: 'Insufficient wallet funds',
          reason: createResult.reason,
          available_balance_cents: createResult.available_balance_cents
        });
      }

      // Other errors (validation, config, etc.)
      return res.status(400).json({
        error: 'Invalid request',
        reason: createResult.reason,
        error_code: createResult.error_code
      });
    }

    const withdrawal = createResult.withdrawal;

    // 5. Process withdrawal (insert ledger debit, transition to PROCESSING)
    const processResult = await withdrawalService.processWithdrawal(
      pool,
      withdrawal.id,
      { bankAccountId: process.env.STAGING_BANK_ACCOUNT_TOKEN || null }
    );

    if (!processResult.success) {
      return res.status(500).json({
        error: 'Failed to process withdrawal',
        reason: processResult.reason
      });
    }

    if (process.env.LOG_AUTH_DEBUG === 'true') {
      console.log('[WalletWithdraw] Created withdrawal for user:', userId.slice(-6), 'amount:', amount_cents);
    }

    return res.status(200).json({
      withdrawal_id: withdrawal.id,
      status: processResult.withdrawal.status,
      amount_cents: amount_cents
    });
  } catch (err) {
    console.error('[WalletWithdraw] Error creating withdrawal', {
      userId: req.userId,
      error: err.message
    });

    return res.status(500).json({
      error: 'Failed to create withdrawal'
    });
  }
});

module.exports = router;
