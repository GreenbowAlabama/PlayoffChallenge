/**
 * Payout Jobs Repository
 *
 * SQL-only operations for payout_jobs table.
 * Manages job lifecycle transitions and queries.
 *
 * Constraints:
 * - UNIQUE settlement_id (settlement maps to exactly one job)
 * - Must use provided transaction client (never commits/rollbacks)
 * - Caller manages transaction lifecycle
 */

/**
 * Insert a payout job.
 *
 * @param {Object} client - Database transaction client (from pool.connect())
 * @param {Object} data - Job data
 * @param {string} data.settlement_id - UUID of settlement
 * @param {string} data.contest_id - UUID of contest
 * @param {number} data.total_payouts - Total number of transfers in this job
 * @returns {Promise<Object>} { id, settlement_id, contest_id, status }
 * @throws {Error} PG 23505 if settlement_id already exists
 */
async function insertPayoutJob(client, { settlement_id, contest_id, total_payouts }) {
  const result = await client.query(
    `INSERT INTO payout_jobs (settlement_id, contest_id, status, total_payouts)
     VALUES ($1, $2, 'pending', $3)
     RETURNING id, settlement_id, contest_id, status, created_at`,
    [settlement_id, contest_id, total_payouts]
  );

  return result.rows[0];
}

/**
 * Find a payout job by settlement_id.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} settlement_id - UUID of settlement
 * @returns {Promise<Object|null>} payout_job row or null if not found
 */
async function findBySettlementId(pool, settlement_id) {
  const result = await pool.query(
    `SELECT id, settlement_id, contest_id, status, total_payouts, completed_count, failed_count, started_at, completed_at, created_at
     FROM payout_jobs
     WHERE settlement_id = $1`,
    [settlement_id]
  );

  return result.rows[0] || null;
}

/**
 * Find a payout job by ID.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} job_id - UUID of job
 * @returns {Promise<Object|null>} payout_job row or null if not found
 */
async function findById(pool, job_id) {
  const result = await pool.query(
    `SELECT id, settlement_id, contest_id, status, total_payouts, completed_count, failed_count, started_at, completed_at, created_at
     FROM payout_jobs
     WHERE id = $1`,
    [job_id]
  );

  return result.rows[0] || null;
}

/**
 * Find all pending or processing payout jobs.
 *
 * Used by scheduler to find jobs to process.
 *
 * @param {Object} pool - Database connection pool
 * @param {number} limit - Maximum number of jobs to return
 * @returns {Promise<Array>} Array of payout_job rows
 */
async function findPendingOrProcessing(pool, limit = 50) {
  const result = await pool.query(
    `SELECT id, settlement_id, contest_id, status, total_payouts, completed_count, failed_count, started_at, completed_at, created_at
     FROM payout_jobs
     WHERE status IN ('pending', 'processing')
     ORDER BY created_at ASC
     LIMIT $1`,
    [limit]
  );

  return result.rows;
}

/**
 * Update job status and started_at timestamp.
 *
 * Used to transition job from 'pending' to 'processing'.
 *
 * @param {Object} client - Database transaction client
 * @param {string} job_id - UUID of job
 * @param {string} newStatus - New status ('pending' | 'processing' | 'complete')
 * @param {boolean} setStartedAt - Whether to set started_at to now()
 * @returns {Promise<Object>} { id, status }
 */
async function updateStatus(client, job_id, newStatus, setStartedAt = false) {
  let query, params;

  if (setStartedAt) {
    query = `UPDATE payout_jobs
             SET status = $1, started_at = now()
             WHERE id = $2
             RETURNING id, status`;
    params = [newStatus, job_id];
  } else {
    query = `UPDATE payout_jobs
             SET status = $1
             WHERE id = $2
             RETURNING id, status`;
    params = [newStatus, job_id];
  }

  const result = await client.query(query, params);
  return result.rows[0];
}

/**
 * Update job counts and completion timestamp.
 *
 * Called when job reaches terminal state (all transfers completed or failed).
 *
 * @param {Object} client - Database transaction client
 * @param {string} job_id - UUID of job
 * @param {number} completed_count - Number of successfully completed transfers
 * @param {number} failed_count - Number of failed transfers
 * @returns {Promise<Object>} { id, completed_count, failed_count, status }
 */
async function updateCounts(client, job_id, completed_count, failed_count) {
  const result = await client.query(
    `UPDATE payout_jobs
     SET completed_count = $1, failed_count = $2, status = 'complete', completed_at = now()
     WHERE id = $3
     RETURNING id, completed_count, failed_count, status`,
    [completed_count, failed_count, job_id]
  );

  return result.rows[0];
}

module.exports = {
  insertPayoutJob,
  findBySettlementId,
  findById,
  findPendingOrProcessing,
  updateStatus,
  updateCounts
};
