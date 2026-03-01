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
 * @param {string} [data.snapshot_id] - Immutable snapshot ID for scoring binding (PGA v1 Section 4.1)
 * @param {string} [data.snapshot_hash] - Hash of snapshot data for integrity verification
 * @param {string} [data.scoring_run_id] - Reference to scoring computation (settlement_records.id)
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
  metadata_json = null,
  snapshot_id = null,
  snapshot_hash = null,
  scoring_run_id = null
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
       snapshot_id,
       snapshot_hash,
       scoring_run_id,
       created_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
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
      metadata_json ? JSON.stringify(metadata_json) : null,
      snapshot_id,
      snapshot_hash,
      scoring_run_id
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

/**
 * Get wallet balance for a user.
 *
 * Sums all CREDIT and DEBIT entries where reference_type = 'WALLET' and reference_id = user_id.
 * Read-only query. Safe under concurrent inserts (uses SUM aggregate).
 * Returns 0 if no wallet entries exist.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} userId - UUID of user
 * @returns {Promise<number>} Balance in cents (can be 0 or negative)
 */
async function getWalletBalance(pool, userId) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const result = await pool.query(
    `SELECT COALESCE(
       SUM(CASE
         WHEN direction = 'CREDIT' THEN amount_cents
         WHEN direction = 'DEBIT' THEN -amount_cents
       END),
       0
     ) as balance_cents
     FROM ledger
     WHERE reference_type = 'WALLET'
     AND reference_id = $1::UUID`,
    [userId]
  );

  // Enforce numeric return: prevent silent type drift in financial code
  // SUM may return string in some pg configs; explicit cast required
  // Fail loud on corruption: do not silently zero corrupted balances
  const raw = result.rows[0]?.balance_cents;

  if (raw == null) {
    return 0;
  }

  const parsed = parseInt(raw, 10);

  if (Number.isNaN(parsed)) {
    throw new Error('Invalid balance_cents value from database');
  }

  return parsed;
}

/**
 * Compute wallet balance for a user within a locked transaction.
 *
 * Call this AFTER locking the user row (SELECT...FOR UPDATE users WHERE id=$1).
 * The user row lock ensures no concurrent wallet modifications.
 *
 * This is NOT a locking function itself — the caller must manage the lock.
 * Used in atomic wallet debit flows where user row is already locked.
 *
 * @param {Object} client - Database transaction client (from pool.connect())
 * @param {string} userId - UUID of user (must be locked by caller)
 * @returns {Promise<number>} Balance in cents (can be 0 or negative)
 * @throws {Error} If userId is invalid or query fails
 */
async function computeWalletBalance(client, userId) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const result = await client.query(
    `SELECT COALESCE(
       SUM(CASE
         WHEN direction = 'CREDIT' THEN amount_cents
         WHEN direction = 'DEBIT' THEN -amount_cents
       END),
       0
     ) as balance_cents
     FROM ledger
     WHERE reference_type = 'WALLET'
     AND reference_id = $1::UUID`,
    [userId]
  );

  const raw = result.rows[0]?.balance_cents;

  if (raw == null) {
    return 0;
  }

  const parsed = parseInt(raw, 10);

  if (Number.isNaN(parsed)) {
    throw new Error('Invalid balance_cents value from database');
  }

  return parsed;
}

module.exports = {
  insertLedgerEntry,
  findByIdempotencyKey,
  getWalletBalance,
  computeWalletBalance
};
