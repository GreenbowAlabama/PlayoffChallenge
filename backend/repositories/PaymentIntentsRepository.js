/**
 * Payment Intents Repository
 *
 * SQL-only operations for payment_intents table.
 * No business logic; raw database access only.
 *
 * Constraints:
 * - UNIQUE constraint on idempotency_key
 * - UNIQUE constraint on stripe_payment_intent_id (WHERE NOT NULL)
 * - Must use provided transaction client (never commits/rollbacks)
 */

/**
 * Insert a new payment intent.
 *
 * @param {Object} client - Database transaction client
 * @param {Object} data - Payment intent data
 * @param {string} data.idempotency_key - Unique key for idempotency
 * @param {string} data.contest_instance_id - UUID of contest
 * @param {string} data.user_id - UUID of user
 * @param {number} data.amount_cents - Amount in cents
 * @param {string} [data.currency] - Currency code (default: 'USD')
 * @param {string} [data.status] - Initial status (default: 'REQUIRES_CONFIRMATION')
 * @returns {Promise<Object>} { id, idempotency_key, status }
 * @throws {Error} PG error 23505 if duplicate idempotency_key
 */
async function insertPaymentIntent(client, {
  idempotency_key,
  contest_instance_id,
  user_id,
  amount_cents,
  currency = 'USD',
  status = 'REQUIRES_CONFIRMATION'
}) {
  const result = await client.query(
    `INSERT INTO payment_intents (idempotency_key, contest_instance_id, user_id, amount_cents, currency, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     RETURNING id, idempotency_key, status, stripe_payment_intent_id`,
    [idempotency_key, contest_instance_id, user_id, amount_cents, currency, status]
  );

  return result.rows[0];
}

/**
 * Update payment intent with Stripe details and status.
 *
 * @param {Object} client - Database transaction client
 * @param {string} id - payment_intents.id (UUID)
 * @param {Object} data - Update data
 * @param {string} [data.stripe_payment_intent_id] - Stripe payment intent ID
 * @param {string} [data.stripe_customer_id] - Stripe customer ID
 * @param {string} [data.status] - Updated status
 * @returns {Promise<void>}
 */
async function updateStripeDetails(client, id, { stripe_payment_intent_id, stripe_customer_id, status }) {
  await client.query(
    `UPDATE payment_intents
     SET stripe_payment_intent_id = COALESCE($1, stripe_payment_intent_id),
         stripe_customer_id = COALESCE($2, stripe_customer_id),
         status = COALESCE($3, status),
         updated_at = NOW()
     WHERE id = $4`,
    [stripe_payment_intent_id, stripe_customer_id, status, id]
  );
}

/**
 * Find payment intent by idempotency key.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} idempotency_key - Idempotency key
 * @returns {Promise<Object|null>} payment_intents row or null
 */
async function findByIdempotencyKey(pool, idempotency_key) {
  const result = await pool.query(
    `SELECT id, idempotency_key, contest_instance_id, user_id, amount_cents, currency, status, stripe_payment_intent_id, stripe_customer_id, created_at, updated_at
     FROM payment_intents
     WHERE idempotency_key = $1`,
    [idempotency_key]
  );

  return result.rows[0] || null;
}

/**
 * Find payment intent by Stripe payment intent ID.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} stripe_payment_intent_id - Stripe PI ID
 * @returns {Promise<Object|null>} payment_intents row or null
 */
async function findByStripePaymentIntentId(pool, stripe_payment_intent_id) {
  const result = await pool.query(
    `SELECT id, idempotency_key, contest_instance_id, user_id, amount_cents, currency, status, stripe_payment_intent_id, stripe_customer_id, created_at, updated_at
     FROM payment_intents
     WHERE stripe_payment_intent_id = $1`,
    [stripe_payment_intent_id]
  );

  return result.rows[0] || null;
}

module.exports = {
  insertPaymentIntent,
  updateStripeDetails,
  findByIdempotencyKey,
  findByStripePaymentIntentId
};
