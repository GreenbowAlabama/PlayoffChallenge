/**
 * Payout Job Service
 *
 * Manages payout job lifecycle: pending → processing → complete.
 *
 * Responsibilities:
 * - Process pending/retryable transfers in a job
 * - Use FOR UPDATE SKIP LOCKED for concurrent safety
 * - Update job status and counts
 * - Mark job complete when all transfers are terminal

 * Does NOT:
 * - Execute transfers (PayoutExecutionService does that)
 * - Compute amounts
 * - Mutate contest state
 */

const PayoutJobsRepository = require('../repositories/PayoutJobsRepository');
const PayoutTransfersRepository = require('../repositories/PayoutTransfersRepository');
const PayoutExecutionService = require('./PayoutExecutionService');

/**
 * Process a specific payout job.
 *
 * Processes all pending and retryable transfers in the job.
 * Updates job status to 'processing' and then 'complete' when all transfers are terminal.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} payoutJobId - UUID of payout job
 * @param {Object} options - Processing options
 * @param {number} options.transferBatchSize - Number of transfers to process per job execution (default: 50)
 *
 * @returns {Promise<Object>} {
 *   job_id: UUID,
 *   status: 'pending' | 'processing' | 'complete',
 *   transfers_processed: number,
 *   transfers_completed: number,
 *   transfers_failed: number,
 *   transfers_retryable: number,
 *   errors: Array of error messages
 * }
 */
async function processJob(pool, payoutJobId, options = {}) {
  const { transferBatchSize = 50 } = options;

  // Fetch job
  const job = await PayoutJobsRepository.findById(pool, payoutJobId);
  if (!job) {
    throw new Error(`Payout job not found: ${payoutJobId}`);
  }

  // If job already complete, no-op
  if (job.status === 'complete') {
    return {
      job_id: payoutJobId,
      status: 'complete',
      transfers_processed: 0,
      transfers_completed: 0,
      transfers_failed: 0,
      transfers_retryable: 0,
      errors: []
    };
  }

  // Mark job as processing (idempotent)
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (job.status === 'pending') {
      await PayoutJobsRepository.updateStatus(client, payoutJobId, 'processing', true);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  // Process pending/retryable transfers
  const transfers = await PayoutTransfersRepository.findPendingByJobId(
    pool,
    payoutJobId,
    transferBatchSize
  );

  const errors = [];
  let transfersProcessed = 0;
  let transfersCompleted = 0;
  let transfersFailed = 0;
  let transfersRetryable = 0;

  for (const transfer of transfers) {
    try {
      const result = await PayoutExecutionService.executeTransfer(pool, transfer.id);

      transfersProcessed += 1;

      if (result.status === 'completed') {
        transfersCompleted += 1;
      } else if (result.status === 'retryable') {
        transfersRetryable += 1;
      } else if (result.status === 'failed_terminal') {
        transfersFailed += 1;
      }
    } catch (error) {
      errors.push({
        transfer_id: transfer.id,
        error: error.message
      });
      transfersProcessed += 1;
      transfersFailed += 1;
    }
  }

  // Check if job should transition to complete
  // Job is complete when all transfers are in terminal state (completed or failed_terminal)
  const terminalCounts = await PayoutTransfersRepository.countTerminalByJobId(pool, payoutJobId);

  let jobCompleted = false;
  if (terminalCounts.completed + terminalCounts.failed === terminalCounts.total && terminalCounts.total > 0) {
    // All transfers are terminal - mark job as complete
    const updateClient = await pool.connect();
    try {
      await updateClient.query('BEGIN');

      await PayoutJobsRepository.updateCounts(
        updateClient,
        payoutJobId,
        terminalCounts.completed,
        terminalCounts.failed
      );

      await updateClient.query('COMMIT');
      jobCompleted = true;
    } catch (error) {
      await updateClient.query('ROLLBACK');
      errors.push({
        error: `Failed to mark job complete: ${error.message}`
      });
    } finally {
      updateClient.release();
    }
  }

  return {
    job_id: payoutJobId,
    status: jobCompleted ? 'complete' : job.status,
    transfers_processed: transfersProcessed,
    transfers_completed: transfersCompleted,
    transfers_failed: transfersFailed,
    transfers_retryable: transfersRetryable,
    errors
  };
}

/**
 * Process all pending and processing payout jobs.
 *
 * Called by scheduler. Finds all non-complete jobs and processes them.
 * Uses SKIP LOCKED for concurrent safety (multiple scheduler instances).
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} options - Processing options
 * @param {number} options.jobBatchSize - Number of jobs to process per scheduler run (default: 10)
 * @param {number} options.transferBatchSize - Number of transfers per job (default: 50)
 *
 * @returns {Promise<Object>} {
 *   jobs_processed: number,
 *   jobs_completed: number,
 *   total_transfers_processed: number,
 *   errors: Array of error messages
 * }
 */
async function processPendingJobs(pool, options = {}) {
  const { jobBatchSize = 10, transferBatchSize = 50 } = options;

  // Fetch pending/processing jobs
  const jobs = await PayoutJobsRepository.findPendingOrProcessing(pool, jobBatchSize);

  let jobsProcessed = 0;
  let jobsCompleted = 0;
  let totalTransfersProcessed = 0;
  const errors = [];

  for (const job of jobs) {
    try {
      const result = await processJob(pool, job.id, { transferBatchSize });

      jobsProcessed += 1;
      if (result.status === 'complete') {
        jobsCompleted += 1;
      }
      totalTransfersProcessed += result.transfers_processed;

      if (result.errors && result.errors.length > 0) {
        errors.push({
          job_id: job.id,
          errors: result.errors
        });
      }
    } catch (error) {
      errors.push({
        job_id: job.id,
        error: error.message
      });
      jobsProcessed += 1;
    }
  }

  return {
    jobs_processed: jobsProcessed,
    jobs_completed: jobsCompleted,
    total_transfers_processed: totalTransfersProcessed,
    errors
  };
}

module.exports = {
  processJob,
  processPendingJobs
};
