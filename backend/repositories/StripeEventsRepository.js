/**
 * Stripe Events Repository
 *
 * SQL-only operations for stripe_events table.
 * No business logic; raw database access only.
 *
 * Constraints:
 * - Append-only: INSERT only, no UPDATE or DELETE
 * - UNIQUE constraint on stripe_event_id
 * - Must use provided transaction client (never commits/rollbacks)
 */

/**
 * Insert a new Stripe event into stripe_events table.
 *
 * @param {Object} client - Database transaction client (from pool.connect())
 * @param {Object} data - Event data
 * @param {string} data.stripe_event_id - Stripe's event ID (unique)
 * @param {string} data.event_type - Event type (e.g., 'payment_intent.succeeded')
 * @param {Object} data.raw_payload_json - Complete Stripe event object
 * @returns {Promise<Object>} { id, stripe_event_id, processing_status }
 * @throws {Error} PG error 23505 if duplicate stripe_event_id
 */
async function insertStripeEvent(client, { stripe_event_id, event_type, raw_payload_json }) {
  const result = await client.query(
    `INSERT INTO stripe_events (stripe_event_id, event_type, raw_payload_json, processing_status, received_at)
     VALUES ($1, $2, $3, 'RECEIVED', NOW())
     RETURNING id, stripe_event_id, processing_status`,
    [stripe_event_id, event_type, JSON.stringify(raw_payload_json)]
  );

  return result.rows[0];
}

/**
 * Find stripe event by stripe_event_id.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} stripe_event_id - Stripe's event ID
 * @returns {Promise<Object|null>} stripe_events row or null if not found
 */
async function findByStripeEventId(pool, stripe_event_id) {
  const result = await pool.query(
    'SELECT id, stripe_event_id, event_type, raw_payload_json, processing_status, processed_at FROM stripe_events WHERE stripe_event_id = $1',
    [stripe_event_id]
  );

  return result.rows[0] || null;
}

module.exports = {
  insertStripeEvent,
  findByStripeEventId
};
