/**
 * Payment Routes
 *
 * Handles payment-related endpoints for collecting entry fees.
 *
 * Routes:
 * - POST /api/payments/intents - Create a payment intent
 */

const express = require('express');
const router = express.Router();
const PaymentIntentService = require('../services/PaymentIntentService');
const { PAYMENT_ERROR_CODES } = require('../services/paymentErrorCodes');

/**
 * Extract user ID from request headers.
 *
 * Reuses pattern from existing auth middleware.
 * Expects X-User-Id header (for testing) or authorization context.
 */
function extractUserId(req, res, next) {
  const xUserId = req.headers['x-user-id'];

  if (!xUserId) {
    return res.status(401).json({
      error: 'Missing X-User-Id header'
    });
  }

  // Basic UUID validation
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(xUserId)) {
    return res.status(400).json({
      error: 'Invalid X-User-Id format'
    });
  }

  req.userId = xUserId;
  next();
}

/**
 * POST /api/payments/intents
 *
 * Create a payment intent for contest entry fee.
 *
 * Request:
 * - Headers:
 *   - Idempotency-Key (required): UUID or string to ensure idempotency
 *   - X-User-Id (required): UUID of requesting user
 * - Body (JSON):
 *   - contest_instance_id: UUID
 *   - amount_cents: integer (entry fee)
 *
 * Response (200):
 * {
 *   payment_intent_id: string (UUID),
 *   status: string (Stripe status),
 *   client_secret: string (for Stripe.js)
 * }
 *
 * Error responses:
 * - 400: Missing required fields or invalid format
 * - 500: Stripe API or database error
 *
 * Idempotency:
 * - Same Idempotency-Key returns same payment_intent_id
 * - No new Stripe payment intent is created on retry
 */
router.post('/intents', extractUserId, async (req, res) => {
  const pool = req.app.locals.pool;
  const { contest_instance_id, amount_cents } = req.body;
  const idempotencyKey = req.headers['idempotency-key'];
  const userId = req.userId;

  // Validate idempotency key
  if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
    return res.status(400).json({
      error: 'Idempotency-Key header is required'
    });
  }

  // Validate contest instance ID
  if (!contest_instance_id || typeof contest_instance_id !== 'string') {
    return res.status(400).json({
      error: 'contest_instance_id is required'
    });
  }

  // Validate amount
  if (!Number.isInteger(amount_cents) || amount_cents <= 0) {
    return res.status(400).json({
      error: 'amount_cents must be a positive integer'
    });
  }

  try {
    const result = await PaymentIntentService.createPaymentIntent(
      pool,
      contest_instance_id,
      userId,
      amount_cents,
      idempotencyKey
    );

    return res.status(200).json(result);
  } catch (err) {
    // Map error codes to HTTP responses
    if (err.code === PAYMENT_ERROR_CODES.IDEMPOTENCY_KEY_REQUIRED) {
      return res.status(400).json({
        error: 'Idempotency-Key header is required'
      });
    }

    if (err.code === PAYMENT_ERROR_CODES.STRIPE_API_ERROR) {
      console.error('[Payment Intent Route] Stripe error:', err.message);
      return res.status(500).json({
        error: 'Stripe API error'
      });
    }

    // Unexpected errors
    console.error('[Payment Intent Route] Error:', err);
    return res.status(500).json({
      error: 'Payment intent creation failed'
    });
  }
});

module.exports = router;
