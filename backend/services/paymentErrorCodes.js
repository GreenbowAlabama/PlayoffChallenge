/**
 * Payment Error Codes Registry
 *
 * Enumerated error codes for payment operations.
 * All errors must be explicit; no generic 500 errors for expected paths.
 */

const PAYMENT_ERROR_CODES = {
  // Stripe webhook errors
  STRIPE_SIGNATURE_INVALID: 'STRIPE_SIGNATURE_INVALID',
  STRIPE_EVENT_DUPLICATE: 'STRIPE_EVENT_DUPLICATE',

  // Payment intent errors
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  PAYMENT_INTENT_NOT_FOUND: 'PAYMENT_INTENT_NOT_FOUND',
  PAYMENT_ALREADY_PROCESSED: 'PAYMENT_ALREADY_PROCESSED',

  // Ledger errors
  LEDGER_DUPLICATE_ENTRY: 'LEDGER_DUPLICATE_ENTRY',

  // Stripe API errors
  STRIPE_API_ERROR: 'STRIPE_API_ERROR'
};

/**
 * Get human-readable message for an error code
 * @param {string} code - Error code
 * @param {Object} context - Additional context
 * @returns {string} Human-readable error message
 */
function getErrorMessage(code, context = {}) {
  const messages = {
    STRIPE_SIGNATURE_INVALID: 'Stripe webhook signature validation failed',
    STRIPE_EVENT_DUPLICATE: 'Stripe event already processed',
    IDEMPOTENCY_KEY_REQUIRED: 'Idempotency-Key header is required',
    PAYMENT_INTENT_NOT_FOUND: 'Payment intent not found for this webhook event',
    PAYMENT_ALREADY_PROCESSED: 'Payment has already been processed',
    LEDGER_DUPLICATE_ENTRY: 'Ledger entry with this idempotency key already exists',
    STRIPE_API_ERROR: `Stripe API error: ${context.message || 'Unknown error'}`
  };

  return messages[code] || `Unknown error: ${code}`;
}

module.exports = {
  PAYMENT_ERROR_CODES,
  getErrorMessage
};
