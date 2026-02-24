/**
 * Stripe Payout Adapter
 *
 * Wraps Stripe transfer API with idempotency, error classification, and retry logic.
 *
 * Responsibilities:
 * - Call stripe.transfers.create() with idempotency key
 * - Classify errors as retryable or permanent
 * - Return structured result for service layer
 *
 * Does NOT:
 * - Access database
 * - Manage job state
 * - Decide retry strategy
 */

let stripe = null;

/**
 * Transient (retryable) error classifications.
 * These errors indicate temporary failures that may succeed on retry.
 */
const TRANSIENT_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH'
]);

const TRANSIENT_HTTP_CODES = new Set([
  408, // Request Timeout
  429, // Too Many Requests
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504  // Gateway Timeout
]);

/**
 * Initialize stripe instance (lazy load).
 * Can be overridden with a mock in tests.
 * @private
 */
function getStripeInstance() {
  if (!stripe) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  }
  return stripe;
}

/**
 * Create a payout transfer via Stripe.
 *
 * Calls stripe.transfers.create() with idempotency key to ensure deterministic,
 * deduplicated transfers. Same idempotency key always returns same transfer_id.
 *
 * @param {Object} params - Transfer parameters
 * @param {number} params.amountCents - Amount in cents (must be > 0)
 * @param {string} params.destination - Destination Stripe account ID
 * @param {string} params.idempotencyKey - Idempotency key (deterministic, never random)
 * @param {Object} [params.metadata] - Optional metadata to store with transfer
 * @param {number} [params.timeoutMs] - Request timeout in milliseconds (default: 30000)
 * @param {Object} [params.stripeOverride] - Optional stripe instance override (for testing)
 *
 * @returns {Promise<Object>} Result object:
 *   On success: { success: true, transferId: 'tr_xxx' }
 *   On error: { success: false, classification: 'retryable'|'permanent', reason: 'error_reason' }
 */
async function createTransfer({ amountCents, destination, idempotencyKey, metadata, timeoutMs = 30000, stripeOverride }) {
  // Validate inputs
  if (!amountCents || amountCents <= 0) {
    return {
      success: false,
      classification: 'permanent',
      reason: 'invalid_amount'
    };
  }

  if (!destination || typeof destination !== 'string') {
    return {
      success: false,
      classification: 'permanent',
      reason: 'invalid_destination'
    };
  }

  if (!idempotencyKey || typeof idempotencyKey !== 'string') {
    return {
      success: false,
      classification: 'permanent',
      reason: 'invalid_idempotency_key'
    };
  }

  try {
    // Get stripe instance (use override for testing, or lazy-load production instance)
    const stripeInstance = stripeOverride || getStripeInstance();

    // Call Stripe with idempotency key in header
    const transfer = await stripeInstance.transfers.create(
      {
        amount: amountCents,
        currency: 'usd',
        destination,
        metadata: metadata || {}
      },
      {
        idempotencyKey,
        timeout: timeoutMs
      }
    );

    return {
      success: true,
      transferId: transfer.id
    };
  } catch (error) {
    // Classify error
    const classification = classifyError(error);

    return {
      success: false,
      classification,
      reason: extractErrorReason(error)
    };
  }
}

/**
 * Classify error as retryable or permanent.
 *
 * Transient errors (network, timeout, rate limit, 5xx):
 *   classification = 'retryable'
 *
 * Permanent errors (validation, 4xx, invalid parameters):
 *   classification = 'permanent'
 *
 * @private
 * @param {Error} error - Error from Stripe SDK or network layer
 * @returns {string} 'retryable' or 'permanent'
 */
function classifyError(error) {
  // Network timeouts and connection errors
  if (error.code && TRANSIENT_ERROR_CODES.has(error.code)) {
    return 'retryable';
  }

  // Rate limit errors FIRST (before generic 4xx check, since 429 is retryable)
  if (error.status === 429 || error.type === 'StripeRateLimitError') {
    return 'retryable';
  }

  // Stripe API error with HTTP status
  if (error.status) {
    // 5xx server errors are retryable
    if (error.status >= 500) {
      return 'retryable';
    }
    // 4xx validation errors are permanent (but NOT 429, already handled above)
    if (error.status >= 400 && error.status < 500) {
      return 'permanent';
    }
  }

  // HTTP status codes from raw response
  if (error.statusCode && TRANSIENT_HTTP_CODES.has(error.statusCode)) {
    return 'retryable';
  }

  // API connection errors
  if (error.type === 'StripeConnectionError') {
    return 'retryable';
  }

  // API errors (validation, missing fields, etc.)
  if (error.type === 'StripeAPIError' || error.type === 'StripeInvalidRequestError') {
    return 'permanent';
  }

  // Authentication/authorization errors
  if (error.type === 'StripeAuthenticationError' || error.type === 'StripePermissionError') {
    return 'permanent';
  }

  // Default to retryable for unknown errors (safer to retry than to permanently fail)
  return 'retryable';
}

/**
 * Extract structured reason from error for logging and auditing.
 *
 * @private
 * @param {Error} error - Error object
 * @returns {string} Reason code (e.g., 'stripe_timeout', 'stripe_invalid_account')
 */
function extractErrorReason(error) {
  // Network errors by code
  if (error.code === 'ETIMEDOUT') {
    return 'stripe_timeout';
  }

  if (error.code === 'ECONNRESET' || (error.code && TRANSIENT_ERROR_CODES.has(error.code))) {
    return 'stripe_connection_error';
  }

  // Rate limit (by type or status)
  if (error.type === 'StripeRateLimitError' || error.status === 429) {
    return 'stripe_rate_limit';
  }

  // Connection errors
  if (error.type === 'StripeConnectionError') {
    return 'stripe_connection_error';
  }

  // Server errors (5xx)
  if (error.status >= 500) {
    return 'stripe_server_error';
  }

  // Validation errors (4xx)
  if (error.type === 'StripeInvalidRequestError' || (error.status >= 400 && error.status < 500)) {
    // Check error message for common cases
    const message = error.message || '';
    if (message.includes('destination') || message.includes('account')) {
      return 'stripe_invalid_account';
    }
    return 'stripe_invalid_request';
  }

  // Permission errors
  if (error.type === 'StripePermissionError') {
    return 'stripe_permission_error';
  }

  // API errors
  if (error.type === 'StripeAPIError') {
    return 'stripe_api_error';
  }

  // Fallback
  return 'stripe_unknown_error';
}

module.exports = {
  createTransfer
};
