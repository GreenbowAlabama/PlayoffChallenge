/**
 * Webhook Routes
 *
 * Handles webhook endpoints from external services.
 * Currently supports Stripe webhooks.
 *
 * Routes:
 * - POST /api/webhooks/stripe - Stripe event webhook
 */

const express = require('express');
const router = express.Router();
const StripeWebhookService = require('../services/StripeWebhookService');
const { PAYMENT_ERROR_CODES } = require('../services/paymentErrorCodes');

/**
 * POST /api/webhooks/stripe
 *
 * Receive and process Stripe webhook event.
 *
 * Request:
 * - Body: raw JSON body from Stripe (NOT parsed by express.json())
 * - Headers: stripe-signature (for HMAC validation)
 *
 * Response:
 * - 200: Event processed or duplicate (idempotent success)
 * - 400: Signature validation failed
 * - 409: Referenced payment_intent not found
 * - 500: Unexpected error
 *
 * Idempotency:
 * - Duplicate stripe_event_id returns 200 with duplicate: true
 * - Same webhook content replayed produces identical ledger state
 */
router.post(
  '/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const pool = req.app.locals.pool;
    const signature = req.headers['stripe-signature'];

    // Signature is required
    if (!signature) {
      return res.status(400).json({
        error: 'Missing stripe-signature header'
      });
    }

    try {
      const result = await StripeWebhookService.handleStripeEvent(req.body, signature, pool);

      // Duplicate events return 200 with received flag
      if (result.status === 'duplicate') {
        return res.status(200).json({
          received: true,
          duplicate: true,
          stripe_event_id: result.stripe_event_id
        });
      }

      // Normal processing returns 200
      return res.status(200).json({
        received: true,
        stripe_event_id: result.stripe_event_id
      });
    } catch (err) {
      // Map error codes to HTTP status
      if (err.code === PAYMENT_ERROR_CODES.STRIPE_SIGNATURE_INVALID) {
        return res.status(400).json({
          error: 'Invalid Stripe signature'
        });
      }

      if (err.code === PAYMENT_ERROR_CODES.PAYMENT_INTENT_NOT_FOUND) {
        return res.status(409).json({
          error: 'Payment intent not found'
        });
      }

      // Unexpected errors
      return res.status(500).json({
        error: 'Webhook processing failed'
      });
    }
  }
);

module.exports = router;
