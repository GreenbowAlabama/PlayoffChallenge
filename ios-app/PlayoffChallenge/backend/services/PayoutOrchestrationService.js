/**
 * Payout Orchestration Service
 *
 * Observes settlement completion and schedules payout jobs.
 * Called from orchestration layer AFTER settlement transaction commits.
 * Settlement logic itself is pure (no side effects).
 *
 * Responsibilities:
 * - Verify settlement is COMPLETE
 * - Create payout_job if not exists (idempotent)
 * - Expand settlement winners JSON → payout_transfers
 *
 * Does NOT:
 * - Compute settlement payouts (settlement strategy does that)
 * - Execute Stripe transfers (PayoutExecutionService does that)
 * - Mutate contest state
 */

const PayoutJobsRepository = require('../repositories/PayoutJobsRepository');
const PayoutTransfersRepository = require('../repositories/PayoutTransfersRepository');

/**
 * Schedule payout for a settled contest.
 *
 * Called after settlement completes. Creates payout_job and expands transfers.
 * Idempotent: duplicate calls return existing job (UNIQUE constraint on settlement_id).
 *
 * @param {Object} pool - Database connection pool
 * @param {string} settlementId - UUID of settlement
 * @param {string} contestId - UUID of contest
 * @param {Array} winners - Array of { user_id, amount_cents } from settlement
 *
 * @returns {Promise<Object>} {
 *   payout_job_id: UUID,
 *   settlement_id: UUID,
 *   status: 'pending',
 *   total_payouts: number,
 *   created_at: ISO8601
 * }
 *
 * @throws {Error} If settlement validation fails
 */
async function schedulePayoutForSettlement(pool, settlementId, contestId, winners) {
  // Validate inputs
  if (!settlementId || typeof settlementId !== 'string') {
    throw new Error('settlementId is required and must be a string');
  }

  if (!contestId || typeof contestId !== 'string') {
    throw new Error('contestId is required and must be a string');
  }

  if (!Array.isArray(winners)) {
    throw new Error('winners must be an array');
  }

  // Validate winners array is not empty
  if (winners.length === 0) {
    throw new Error('Winners array cannot be empty');
  }

  // Validate each winner
  winners.forEach((winner, index) => {
    if (!winner.user_id || !winner.amount_cents) {
      throw new Error(`Winner at index ${index} missing user_id or amount_cents`);
    }
    if (winner.amount_cents <= 0) {
      throw new Error(`Winner at index ${index} has invalid amount: ${winner.amount_cents}`);
    }
  });

  // Check if payout job already exists for this settlement (idempotency)
  const existingJob = await PayoutJobsRepository.findBySettlementId(pool, settlementId);
  if (existingJob) {
    // Return existing job - idempotent success
    return {
      payout_job_id: existingJob.id,
      settlement_id: existingJob.settlement_id,
      status: existingJob.status,
      total_payouts: existingJob.total_payouts,
      created_at: existingJob.created_at
    };
  }

  // Create job in transaction
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insert payout_job
    const job = await PayoutJobsRepository.insertPayoutJob(client, {
      settlement_id: settlementId,
      contest_id: contestId,
      total_payouts: winners.length
    });

    // Insert payout_transfers (expanded from winners)
    const transfers = await PayoutTransfersRepository.insertTransfers(
      client,
      job.id,
      contestId,
      winners
    );

    await client.query('COMMIT');

    return {
      payout_job_id: job.id,
      settlement_id: job.settlement_id,
      status: job.status,
      total_payouts: winners.length,
      created_at: job.created_at
    };
  } catch (error) {
    await client.query('ROLLBACK');

    // Handle unique constraint violation on settlement_id
    // (race condition: another request already created the job)
    if (error.code === '23505' && error.constraint === 'payout_jobs_settlement_id_key') {
      // Retry read to return existing job
      const existingJob = await PayoutJobsRepository.findBySettlementId(pool, settlementId);
      if (existingJob) {
        return {
          payout_job_id: existingJob.id,
          settlement_id: existingJob.settlement_id,
          status: existingJob.status,
          total_payouts: existingJob.total_payouts,
          created_at: existingJob.created_at
        };
      }
    }

    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  schedulePayoutForSettlement
};
