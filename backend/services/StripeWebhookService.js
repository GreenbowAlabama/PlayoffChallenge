/**
 * Stripe Webhook Service
 *
 * Handles Stripe webhook events with full idempotency and transactional correctness.
 *
 * Critical behavior:
 * - ALL operations happen in a single transaction
 * - stripe_events insert is INSIDE the transaction
 * - If processing fails, the ENTIRE transaction (including stripe_events) is rolled back
 * - This prevents "poisoned dedupe rows" - failed inserts don't leave records
 * - Stripe will retry the webhook after rollback, allowing success on retry
 *
 * Canonical event type: payment_intent.succeeded
 * All other event types are stored but not processed.
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const StripeEventsRepository = require('../repositories/StripeEventsRepository');
const PaymentIntentsRepository = require('../repositories/PaymentIntentsRepository');
const LedgerRepository = require('../repositories/LedgerRepository');
const { PAYMENT_ERROR_CODES } = require('./paymentErrorCodes');

/**
 * Handle a Stripe webhook event.
 *
 * Transaction strategy:
 * 1. Validate signature (before transaction)
 * 2. START TRANSACTION
 * 3. INSERT stripe_events (inside transaction)
 * 4. If duplicate stripe_event_id:
 *    - ROLLBACK (removes duplicate row)
 *    - Return { status: 'duplicate' }
 * 5. Route by event type:
 *    - payment_intent.succeeded: processPaymentIntentSucceeded()
 *    - Other: update status to PROCESSED and commit
 * 6. COMMIT transaction
 *
 * @param {Buffer} rawBody - Raw request body (required for signature verification)
 * @param {string} stripeSignature - Stripe-Signature header value
 * @param {Object} pool - Database connection pool
 * @returns {Promise<Object>} { status: 'processed' | 'duplicate' }
 * @throws {Error} Error with code property set to PAYMENT_ERROR_CODES key
 */
async function handleStripeEvent(rawBody, stripeSignature, pool) {
  // Step 1: Validate Stripe signature (outside transaction)
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      stripeSignature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    const error = new Error(`Stripe signature validation failed: ${err.message}`);
    error.code = PAYMENT_ERROR_CODES.STRIPE_SIGNATURE_INVALID;
    throw error;
  }

  // Step 2: Get database client and begin transaction
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Step 3: Insert stripe_events inside transaction
    let stripeEventsRow;
    try {
      stripeEventsRow = await StripeEventsRepository.insertStripeEvent(client, {
        stripe_event_id: event.id,
        event_type: event.type,
        raw_payload_json: event
      });
    } catch (err) {
      // Check if duplicate stripe_event_id (PG error code 23505)
      if (err.code === '23505') {
        await client.query('ROLLBACK');
        return { status: 'duplicate', stripe_event_id: event.id };
      }
      // Other database error - rollback and rethrow
      await client.query('ROLLBACK');
      throw err;
    }

    // Step 4: Route by event type
    if (event.type === 'payment_intent.succeeded') {
      // Process canonical event and update status inside transaction
      await processPaymentIntentSucceeded(client, event, stripeEventsRow.id);
    }

    // Step 5: Mark event as PROCESSED
    await StripeEventsRepository.updateProcessingStatus(
      client,
      stripeEventsRow.id,
      'PROCESSED',
      new Date()
    );

    // Step 6: Commit transaction
    await client.query('COMMIT');

    return { status: 'processed', stripe_event_id: event.id };
  } catch (err) {
    // Rollback on any error to prevent partial state
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[StripeWebhook] Rollback error:', rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Process payment_intent.succeeded event.
 *
 * Creates ledger entry for successful payment.
 * Handles idempotency: if payment already marked SUCCEEDED, skip ledger insert.
 * If ledger entry already exists (via idempotency_key), treat as idempotent success.
 *
 * @param {Object} client - Database transaction client
 * @param {Object} event - Stripe event object
 * @param {string} stripeEventsId - stripe_events.id (for idempotency_key)
 * @returns {Promise<void>}
 * @throws {Error} Error with code property
 */
async function processPaymentIntentSucceeded(client, event, stripeEventsId) {
  console.log("WEBHOOK_V3_ACTIVE", {
    event_id: event.id,
    stripe_pi: event.data.object.id
  });

  // Extract Stripe payment intent ID
  const stripePaymentIntentId = event.data.object.id;
  const amountCents = event.data.object.amount;

  // Load payment_intents by stripe_payment_intent_id
  const paymentIntent = await PaymentIntentsRepository.findByStripePaymentIntentId(
    client,
    stripePaymentIntentId
  );

  if (!paymentIntent) {
    const error = new Error(`Payment intent not found: ${stripePaymentIntentId}`);
    error.code = PAYMENT_ERROR_CODES.PAYMENT_INTENT_NOT_FOUND;
    throw error;
  }

  // If already SUCCEEDED, skip ledger insert (idempotent)
  if (paymentIntent.status === 'SUCCEEDED') {
    return;
  }

  // Update payment_intents status to SUCCEEDED
  await PaymentIntentsRepository.updateStripeDetails(client, paymentIntent.id, {
    status: 'SUCCEEDED'
  });

  // Insert ledger entry with idempotency key format: stripe_event:{event_id}:ENTRY_FEE
  const ledgerIdempotencyKey = `stripe_event:${event.id}:ENTRY_FEE`;

  if (!paymentIntent.id || paymentIntent.id.length !== 36) {
    throw new Error("Invalid internal paymentIntent.id (not UUID)");
  }

  try {
    await LedgerRepository.insertLedgerEntry(client, {
      contest_instance_id: paymentIntent.contest_instance_id,
      user_id: paymentIntent.user_id,
      entry_type: 'ENTRY_FEE',
      direction: 'CREDIT',
      amount_cents: amountCents,
      currency: paymentIntent.currency,
      reference_type: 'stripe_event',
      reference_id: paymentIntent.id,
      stripe_event_id: event.id,
      idempotency_key: ledgerIdempotencyKey
    });

    console.log("LEDGER_WRITE_SUCCESS", {
      stripe_event_id: event.id,
      internal_payment_intent_id: paymentIntent.id
    });
  } catch (err) {
    // If duplicate idempotency_key (PG error 23505), treat as idempotent success
    if (err.code === '23505') {
      return;
    }
    // Other database error - rethrow
    throw err;
  }
}

module.exports = {
  handleStripeEvent
};
