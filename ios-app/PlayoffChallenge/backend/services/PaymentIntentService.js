/**
 * Payment Intent Service
 *
 * Creates Stripe payment intents with full idempotency and atomic transactions.
 *
 * Idempotency strategy:
 * - Client provides Idempotency-Key header (required)
 * - Same Idempotency-Key + same request parameters = same payment_intent_id
 * - Database UNIQUE constraint enforces idempotency at DB level
 * - If duplicate key: fetch existing intent and return it (no new Stripe call)
 * - Stripe API also gets Idempotency-Key for its own deduplication
 *
 * Transaction atomicity:
 * - All DB operations (INSERT, UPDATE) in single transaction
 * - Stripe API call inside transaction boundary
 * - Any failure (Stripe or DB) rolls back entire transaction
 * - No partial rows survive on Stripe API failure
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const PaymentIntentsRepository = require('../repositories/PaymentIntentsRepository');
const { PAYMENT_ERROR_CODES } = require('./paymentErrorCodes');

/**
 * Create a payment intent for a user to join a paid contest.
 *
 * Fully idempotent and atomic: same inputs always produce same payment_intent_id.
 * All database operations wrapped in single transaction.
 * Stripe API call inside transaction boundary.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} contestInstanceId - UUID of contest instance
 * @param {string} userId - UUID of user
 * @param {number} amountCents - Entry fee in cents
 * @param {string} idempotencyKey - Unique key for idempotency (required)
 * @returns {Promise<Object>} {
 *   payment_intent_id: string,
 *   client_secret: string,
 *   status: string
 * }
 * @throws {Error} Error with code property set to PAYMENT_ERROR_CODES key
 */
async function createPaymentIntent(pool, contestInstanceId, userId, amountCents, idempotencyKey) {
  // Validate idempotency key is provided
  if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
    const error = new Error('Idempotency-Key is required');
    error.code = PAYMENT_ERROR_CODES.IDEMPOTENCY_KEY_REQUIRED;
    throw error;
  }

  // Pre-check: Look for existing payment intent (read-only, outside transaction)
  const existingIntent = await PaymentIntentsRepository.findByIdempotencyKey(pool, idempotencyKey);
  if (existingIntent) {
    // Return cached result - idempotent success
    // Note: client_secret is only available on first creation from Stripe response
    return {
      payment_intent_id: existingIntent.id,
      status: existingIntent.status
    };
  }

  // Acquire transaction client for atomic INSERT + Stripe call + UPDATE
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Step 1: INSERT payment_intents with initial status
    let paymentIntentRow;
    try {
      paymentIntentRow = await PaymentIntentsRepository.insertPaymentIntent(
        client,
        {
          idempotency_key: idempotencyKey,
          contest_instance_id: contestInstanceId,
          user_id: userId,
          amount_cents: amountCents,
          currency: 'USD',
          status: 'REQUIRES_CONFIRMATION'
        }
      );
    } catch (err) {
      // If duplicate idempotency_key race condition (another thread inserted)
      if (err.code === '23505') {
        // Let outer catch handle rollback
        throw err;
      }
      // Other DB error - let outer catch handle rollback and rethrow
      throw err;
    }

    // Step 2: Create payment intent with Stripe (inside transaction)
    let stripePI;
    try {
      stripePI = await stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency: 'usd',
          metadata: {
            contest_instance_id: contestInstanceId,
            user_id: userId
          }
        },
        {
          idempotencyKey: idempotencyKey
        }
      );
    } catch (err) {
      // Stripe API error - let outer catch handle rollback and rethrow with mapped error
      const error = new Error(`Stripe API error: ${err.message}`);
      error.code = PAYMENT_ERROR_CODES.STRIPE_API_ERROR;
      error.originalError = err;
      throw error;
    }

    // Step 3: Update payment_intents with Stripe response (same transaction)
    await PaymentIntentsRepository.updateStripeDetails(client, paymentIntentRow.id, {
      stripe_payment_intent_id: stripePI.id,
      stripe_customer_id: stripePI.customer || null,
      status: stripePI.status.toUpperCase()
    });

    // Step 4: Commit transaction
    await client.query('COMMIT');

    // Return payment intent to client
    return {
      payment_intent_id: paymentIntentRow.id,
      client_secret: stripePI.client_secret,
      status: stripePI.status.toUpperCase()
    };
  } catch (err) {
    // Single rollback point for all errors
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      // Silently handle rollback error; original error will be thrown
    }

    // Handle duplicate key race condition
    if (err.code === '23505') {
      const raceWinner = await PaymentIntentsRepository.findByIdempotencyKey(pool, idempotencyKey);
      if (raceWinner) {
        // Another thread won the race - return their result
        // Note: client_secret is only available on first creation from Stripe response
        return {
          payment_intent_id: raceWinner.id,
          status: raceWinner.status
        };
      }
    }

    // Re-throw mapped errors
    if (err.code === PAYMENT_ERROR_CODES.STRIPE_API_ERROR) {
      throw err;
    }

    // Re-throw other errors with code set if needed
    if (err.code === PAYMENT_ERROR_CODES.IDEMPOTENCY_KEY_REQUIRED) {
      throw err;
    }

    // Unexpected errors
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  createPaymentIntent
};
