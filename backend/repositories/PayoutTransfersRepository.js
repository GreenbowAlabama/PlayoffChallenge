/**
 * Payout Transfers Repository
 *
 * SQL-only operations for payout_transfers table.
 * Manages transfer lifecycle, claims, and updates.
 *
 * Constraints:
 * - UNIQUE idempotency_key (per transfer attempt)
 * - UNIQUE(contest_id, user_id) - one transfer per winner per contest
 * - Must use provided transaction client (never commits/rollbacks)
 * - Caller manages transaction lifecycle
 */

/**
 * Batch insert payout transfers from settlement payouts.
 *
 * Idempotent: UNIQUE constraint on (contest_id, user_id) prevents duplicates.
 * Uses ON CONFLICT to safely re-run on duplicate settlement.
 *
 * @param {Object} client - Database transaction client
 * @param {string} job_id - UUID of payout job
 * @param {string} contest_id - UUID of contest
 * @param {Array} payouts - Array of { user_id, amount_cents }
 * @returns {Promise<Array>} Array of inserted/ignored payout_transfer rows
 */
async function insertTransfers(client, job_id, contest_id, payouts) {
  if (!payouts || payouts.length === 0) {
    return [];
  }

  const values = [];
  const params = [];
  let paramIndex = 1;

  payouts.forEach((payout) => {
    const idempotencyKey = `payout:${payout.user_id}:${contest_id}`;
    values.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
    params.push(job_id, contest_id, payout.user_id, payout.amount_cents, idempotencyKey, 'pending');
  });

  const result = await client.query(
    `INSERT INTO payout_transfers (payout_job_id, contest_id, user_id, amount_cents, idempotency_key, status)
     VALUES ${values.join(',')}
     ON CONFLICT (contest_id, user_id) DO NOTHING
     RETURNING id, payout_job_id, user_id, amount_cents, status, idempotency_key`,
    params
  );

  return result.rows;
}

/**
 * Find all transfers for a payout job.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} job_id - UUID of job
 * @returns {Promise<Array>} Array of payout_transfer rows
 */
async function findByJobId(pool, job_id) {
  const result = await pool.query(
    `SELECT id, payout_job_id, contest_id, user_id, amount_cents, status, attempt_count, max_attempts, stripe_transfer_id, idempotency_key, failure_reason, created_at
     FROM payout_transfers
     WHERE payout_job_id = $1
     ORDER BY created_at ASC`,
    [job_id]
  );

  return result.rows;
}

/**
 * Find transfer by ID.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} transfer_id - UUID of transfer
 * @returns {Promise<Object|null>} payout_transfer row or null
 */
async function findById(pool, transfer_id) {
  const result = await pool.query(
    `SELECT id, payout_job_id, contest_id, user_id, amount_cents, status, attempt_count, max_attempts, stripe_transfer_id, idempotency_key, failure_reason, created_at
     FROM payout_transfers
     WHERE id = $1`,
    [transfer_id]
  );

  return result.rows[0] || null;
}

/**
 * Find pending transfers for a job (non-terminal state).
 *
 * Used by job service to find transfers to process.
 * Returns transfers with status IN ('pending', 'retryable').
 *
 * @param {Object} pool - Database connection pool
 * @param {string} job_id - UUID of job
 * @param {number} limit - Maximum number of transfers to return
 * @returns {Promise<Array>} Array of payout_transfer rows
 */
async function findPendingByJobId(pool, job_id, limit = 100) {
  const result = await pool.query(
    `SELECT id, payout_job_id, contest_id, user_id, amount_cents, status, attempt_count, max_attempts, stripe_transfer_id, idempotency_key, failure_reason
     FROM payout_transfers
     WHERE payout_job_id = $1 AND status IN ('pending', 'retryable')
     LIMIT $2`,
    [job_id, limit]
  );

  return result.rows;
}

/**
 * Claim a transfer for processing using SELECT ... FOR UPDATE.
 *
 * Acquires row-level lock to prevent concurrent processing.
 * Must be called within a transaction.
 * Returns transfer only if:
 * - status IN ('pending', 'retryable')
 * - stripe_transfer_id IS NULL (not yet claimed)
 * - attempt_count < max_attempts (retries available)
 *
 * @param {Object} client - Database transaction client
 * @param {string} transfer_id - UUID of transfer
 * @returns {Promise<Object|null>} Claimed transfer or null if not claimable
 */
async function claimForProcessing(client, transfer_id) {
  const result = await client.query(
    `SELECT id, payout_job_id, contest_id, user_id, amount_cents, status, attempt_count, max_attempts, stripe_transfer_id, idempotency_key, failure_reason
     FROM payout_transfers
     WHERE id = $1
       AND status IN ('pending', 'retryable')
       AND stripe_transfer_id IS NULL
       AND attempt_count < max_attempts
     FOR UPDATE`,
    [transfer_id]
  );

  return result.rows[0] || null;
}

/**
 * Transition transfer to processing state and increment attempt_count.
 *
 * Called after claiming transfer, before calling Stripe.
 * Must be in same transaction as claim.
 *
 * @param {Object} client - Database transaction client
 * @param {string} transfer_id - UUID of transfer
 * @returns {Promise<Object>} { id, status, attempt_count }
 */
async function markProcessing(client, transfer_id) {
  const result = await client.query(
    `UPDATE payout_transfers
     SET status = 'processing', attempt_count = attempt_count + 1
     WHERE id = $1
     RETURNING id, status, attempt_count`,
    [transfer_id]
  );

  return result.rows[0];
}

/**
 * Mark transfer as completed with stripe_transfer_id.
 *
 * Final terminal state. Called after successful Stripe transfer.
 *
 * @param {Object} client - Database transaction client
 * @param {string} transfer_id - UUID of transfer
 * @param {string} stripe_transfer_id - Stripe transfer ID
 * @returns {Promise<Object>} { id, status, stripe_transfer_id }
 */
async function markCompleted(client, transfer_id, stripe_transfer_id) {
  const result = await client.query(
    `UPDATE payout_transfers
     SET status = 'completed', stripe_transfer_id = $1
     WHERE id = $2
     RETURNING id, status, stripe_transfer_id`,
    [stripe_transfer_id, transfer_id]
  );

  return result.rows[0];
}

/**
 * Mark transfer as retryable with error reason.
 *
 * Non-terminal state. Transfer will be re-queued for processing.
 * attempt_count was already incremented during processing.
 *
 * @param {Object} client - Database transaction client
 * @param {string} transfer_id - UUID of transfer
 * @param {string} failure_reason - Reason for failure (e.g., 'stripe_timeout')
 * @returns {Promise<Object>} { id, status, attempt_count }
 */
async function markRetryable(client, transfer_id, failure_reason) {
  const result = await client.query(
    `UPDATE payout_transfers
     SET status = 'retryable', failure_reason = $1
     WHERE id = $2
     RETURNING id, status, attempt_count`,
    [failure_reason, transfer_id]
  );

  return result.rows[0];
}

/**
 * Mark transfer as failed_terminal (no more retries).
 *
 * Final terminal state. Called after max_attempts exhausted or permanent error.
 *
 * @param {Object} client - Database transaction client
 * @param {string} transfer_id - UUID of transfer
 * @param {string} failure_reason - Reason for failure (e.g., 'stripe_invalid_account')
 * @returns {Promise<Object>} { id, status, attempt_count, failure_reason }
 */
async function markFailedTerminal(client, transfer_id, failure_reason) {
  const result = await client.query(
    `UPDATE payout_transfers
     SET status = 'failed_terminal', failure_reason = $1
     WHERE id = $2
     RETURNING id, status, attempt_count, failure_reason`,
    [failure_reason, transfer_id]
  );

  return result.rows[0];
}

/**
 * Count terminal transfers for a job.
 *
 * Used to determine if job is complete.
 * Terminal states: 'completed', 'failed_terminal'
 *
 * @param {Object} pool - Database connection pool
 * @param {string} job_id - UUID of job
 * @returns {Promise<Object>} { completed: number, failed: number }
 */
async function countTerminalByJobId(pool, job_id) {
  const result = await pool.query(
    `SELECT
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
       SUM(CASE WHEN status = 'failed_terminal' THEN 1 ELSE 0 END) as failed,
       COUNT(*) as total
     FROM payout_transfers
     WHERE payout_job_id = $1`,
    [job_id]
  );

  const row = result.rows[0];
  return {
    completed: row.completed || 0,
    failed: row.failed || 0,
    total: row.total || 0
  };
}

module.exports = {
  insertTransfers,
  findByJobId,
  findById,
  findPendingByJobId,
  claimForProcessing,
  markProcessing,
  markCompleted,
  markRetryable,
  markFailedTerminal,
  countTerminalByJobId
};
