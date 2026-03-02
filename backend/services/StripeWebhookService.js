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
 *    - COMMIT transaction (duplicate row not inserted due to ON CONFLICT DO NOTHING)
 *    - Return { status: 'processed' } (idempotent success)
 * 5. Route by event type:
 *    - payment_intent.succeeded: processPaymentIntentSucceeded()
 *    - Other: update status to PROCESSED and commit
 * 6. COMMIT transaction
 *
 * @param {Buffer} rawBody - Raw request body (required for signature verification)
 * @param {string} stripeSignature - Stripe-Signature header value
 * @param {Object} pool - Database connection pool
 * @returns {Promise<Object>} { status: 'processed', stripe_event_id: string }
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

    // Step 3: Insert stripe_events inside transaction (idempotent via ON CONFLICT DO NOTHING)
    const stripeEventsRow = await StripeEventsRepository.insertStripeEvent(client, {
      stripe_event_id: event.id,
      event_type: event.type,
      raw_payload_json: event
    });

    // If insert returned null, this is a duplicate stripe_event_id (idempotent)
    if (!stripeEventsRow) {
      // Commit transaction and return idempotent success
      await client.query('COMMIT');
      return { status: 'processed', stripe_event_id: event.id };
    }

    // Step 4: Route by event type
    if (event.type === 'payment_intent.succeeded') {
      // Process canonical event inside transaction
      await processPaymentIntentSucceeded(client, event, stripeEventsRow.id);
    }

    // Step 5: Commit transaction
    await client.query('COMMIT');

    return { status: 'processed', stripe_event_id: event.id };
  } catch (err) {
    // Debug: log error details in test environment
    if (process.env.NODE_ENV === 'test') {
      console.error('handleStripeEvent error:', {
        message: err.message,
        code: err.code,
        constraint: err.constraint,
        detail: err.detail
      });
    }
    // Rollback on any error to prevent partial state
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      // Silently handle rollback error; original error will be thrown
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Process payment_intent.succeeded event.
 *
 * Routes to appropriate handler based on purpose metadata:
 * - WALLET_TOPUP: Wallet deposit flow
 * - (default): Entry fee contest join flow
 *
 * @param {Object} client - Database transaction client
 * @param {Object} event - Stripe event object
 * @param {string} stripeEventsId - stripe_events.id (for idempotency_key)
 * @returns {Promise<void>}
 * @throws {Error} Error with code property
 */
async function processPaymentIntentSucceeded(client, event, stripeEventsId) {
  const purpose = event.data.object.metadata?.purpose;

  if (purpose === 'WALLET_TOPUP') {
    await handleWalletTopupSuccess(client, event);
  } else {
    await handleEntryFeeSuccess(client, event);
  }
}

/**
 * Handle wallet top-up PaymentIntent success.
 *
 * Updates wallet_deposit_intents status and inserts ledger CREDIT.
 *
 * @param {Object} client - Database transaction client
 * @param {Object} event - Stripe event object
 * @returns {Promise<void>}
 * @throws {Error}
 */
async function handleWalletTopupSuccess(client, event) {
  const stripePaymentIntentId = event.data.object.id;
  const amountCents = event.data.object.amount;
  const userId = event.data.object.metadata?.user_id;

  if (!userId) {
    throw new Error('WALLET_TOPUP payment intent missing user_id in metadata');
  }

  // Find wallet_deposit_intent by stripe_payment_intent_id
  const walletIntentResult = await client.query(
    `SELECT id, user_id, amount_cents, status FROM wallet_deposit_intents
     WHERE stripe_payment_intent_id = $1`,
    [stripePaymentIntentId]
  );

  if (walletIntentResult.rows.length === 0) {
    throw new Error(`Wallet deposit intent not found: ${stripePaymentIntentId}`);
  }

  const walletIntent = walletIntentResult.rows[0];

  // If already SUCCEEDED, skip ledger insert (idempotent)
  if (walletIntent.status === 'SUCCEEDED') {
    return;
  }

  // Update wallet_deposit_intent status to SUCCEEDED
  await client.query(
    `UPDATE wallet_deposit_intents SET status = $1, updated_at = NOW() WHERE id = $2`,
    ['SUCCEEDED', walletIntent.id]
  );

  // Insert ledger CREDIT entry
  const ledgerIdempotencyKey = `wallet_deposit:${event.id}`;

  try {
    await LedgerRepository.insertLedgerEntry(client, {
      user_id: userId,
      entry_type: 'WALLET_DEPOSIT',
      direction: 'CREDIT',
      amount_cents: amountCents,
      currency: 'USD',
      reference_type: 'WALLET',
      reference_id: userId,
      stripe_event_id: event.id,
      idempotency_key: ledgerIdempotencyKey
    });
  } catch (err) {
    if (process.env.NODE_ENV === 'test') {
      console.error('Wallet ledger insert error:', {
        message: err.message,
        code: err.code,
        constraint: err.constraint,
        detail: err.detail
      });
    }
    // If duplicate idempotency_key (PG error 23505), treat as idempotent success
    if (err.code === '23505') {
      return;
    }
    throw err;
  }
}

/**
 * Handle entry fee PaymentIntent success.
 *
 * Original payment_intent.succeeded handler for contest entry fees.
 *
 * @param {Object} client - Database transaction client
 * @param {Object} event - Stripe event object
 * @returns {Promise<void>}
 * @throws {Error}
 */
async function handleEntryFeeSuccess(client, event) {
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
  } catch (err) {
    // Debug: log error details in test environment
    if (process.env.NODE_ENV === 'test') {
      console.error('Ledger insert error:', {
        message: err.message,
        code: err.code,
        constraint: err.constraint,
        detail: err.detail
      });
    }
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
