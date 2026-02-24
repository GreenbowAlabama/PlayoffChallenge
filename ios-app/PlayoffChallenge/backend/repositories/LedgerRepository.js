/**
 * Ledger Repository
 *
 * SQL-only operations for ledger table.
 * Append-only: INSERT only. No mutations.
 *
 * Constraints:
 * - Append-only: INSERT only, no UPDATE or DELETE
 * - UNIQUE constraint on idempotency_key (partial: WHERE NOT NULL)
 * - Must use provided transaction client (never commits/rollbacks)
 * - Caller manages transaction lifecycle
 */

/**
 * Insert a ledger entry.
 *
 * All ledger entries are immutable after creation.
 * This method does NOT commit the transaction - caller is responsible.
 *
 * @param {Object} client - Database transaction client (from pool.connect())
 * @param {Object} data - Ledger entry data
 * @param {string} [data.contest_instance_id] - UUID of contest
 * @param {string} [data.user_id] - UUID of user
 * @param {string} data.entry_type - Type of entry (e.g., 'ENTRY_FEE')
 * @param {string} data.direction - 'CREDIT' or 'DEBIT'
 * @param {number} data.amount_cents - Amount in cents
 * @param {string} [data.currency] - Currency code (default: 'USD')
 * @param {string} [data.reference_type] - Type of related entity (optional)
 * @param {string} [data.reference_id] - ID of related entity (optional)
 * @param {string} [data.idempotency_key] - Unique key for idempotency (optional, can be NULL)
 * @param {Object} [data.metadata_json] - Additional metadata (optional)
 * @returns {Promise<Object>} { id, entry_type, direction, amount_cents }
 * @throws {Error} PG error 23505 if duplicate non-NULL idempotency_key
 */
async function insertLedgerEntry(client, {
  contest_instance_id,
  user_id,
  entry_type,
  direction,
  amount_cents,
  currency = 'USD',
  reference_type = null,
  reference_id = null,
  idempotency_key = null,
  stripe_event_id = null,
  metadata_json = null
}) {
  const result = await client.query(
    `INSERT INTO ledger (
       contest_instance_id,
       user_id,
       entry_type,
       direction,
       amount_cents,
       currency,
       reference_type,
       reference_id,
       idempotency_key,
       stripe_event_id,
       metadata_json,
       created_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
     RETURNING id, entry_type, direction, amount_cents`,
    [
      contest_instance_id,
      user_id,
      entry_type,
      direction,
      amount_cents,
      currency,
      reference_type,
      reference_id,
      idempotency_key,
      stripe_event_id,
      metadata_json ? JSON.stringify(metadata_json) : null
    ]
  );

  return result.rows[0];
}

/**
 * Find ledger entries by idempotency key.
 *
 * Used for idempotency checks - if entry with this key already exists,
 * the insert operation can be safely skipped.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} idempotency_key - Idempotency key to search for
 * @returns {Promise<Object|null>} ledger row or null if not found
 */
async function findByIdempotencyKey(pool, idempotency_key) {
  if (!idempotency_key) return null;

  const result = await pool.query(
    `SELECT id, entry_type, direction, amount_cents, contest_instance_id, user_id, created_at
     FROM ledger
     WHERE idempotency_key = $1`,
    [idempotency_key]
  );

  return result.rows[0] || null;
}

module.exports = {
  insertLedgerEntry,
  findByIdempotencyKey
};
