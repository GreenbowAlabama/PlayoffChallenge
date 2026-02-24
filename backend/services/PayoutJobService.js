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
 * ALWAYS checks and finalizes job state, even if no transfers need processing.
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

  // Mark job as processing (transition from pending → processing, idempotent)
  let jobStatus = job.status;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (jobStatus === 'pending') {
      await PayoutJobsRepository.updateStatus(client, payoutJobId, 'processing', true);
      jobStatus = 'processing';
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

  // CRITICAL: Always check and finalize job state, even if no transfers processed in this execution.
  // This handles the case where all transfers are already terminal from a previous scheduler run.
  // Must be idempotent: calling multiple times with same job state is safe.
  let finalJobStatus = jobStatus;
  let jobCompleted = false;

  const terminalCounts = await PayoutTransfersRepository.countTerminalByJobId(pool, payoutJobId);

  // INSTRUMENTATION: Log terminal state
  console.log('[PayoutJobService.processJob] Terminal counts', {
    job_id: payoutJobId,
    completed: terminalCounts.completed,
    failed: terminalCounts.failed,
    total: terminalCounts.total
  });

  // Explicit validation: ensure counts are numbers (not null/undefined)
  if (typeof terminalCounts.total !== 'number' || terminalCounts.total < 0) {
    throw new Error(`Invalid terminal count for job ${payoutJobId}: total=${terminalCounts.total}`);
  }

  // All transfers must be in terminal state (completed or failed_terminal)
  const allTerminal = terminalCounts.completed + terminalCounts.failed === terminalCounts.total;
  const hasTransfers = terminalCounts.total > 0;

  // INSTRUMENTATION: Log finalization decision
  console.log('[PayoutJobService.processJob] Finalization check', {
    job_id: payoutJobId,
    all_terminal: allTerminal,
    has_transfers: hasTransfers,
    will_finalize: allTerminal && hasTransfers
  });

  if (allTerminal && hasTransfers) {
    // All transfers are terminal - finalize job immediately
    console.log('[PayoutJobService.processJob] Finalization starting', {
      job_id: payoutJobId,
      completed_count: terminalCounts.completed,
      failed_count: terminalCounts.failed
    });

    const finalizeClient = await pool.connect();
    try {
      await finalizeClient.query('BEGIN');

      // Update counts AND transition to 'complete' atomically
      const updateResult = await PayoutJobsRepository.updateCounts(
        finalizeClient,
        payoutJobId,
        terminalCounts.completed,
        terminalCounts.failed
      );

      if (!updateResult) {
        throw new Error(`Failed to update job counts: no row returned`);
      }

      await finalizeClient.query('COMMIT');
      finalJobStatus = 'complete';
      jobCompleted = true;

      // INSTRUMENTATION: Log successful finalization
      console.log('[PayoutJobService.processJob] Finalization succeeded', {
        job_id: payoutJobId,
        new_status: 'complete'
      });
    } catch (error) {
      await finalizeClient.query('ROLLBACK');

      // INSTRUMENTATION: Log finalization failure
      console.error('[PayoutJobService.processJob] Finalization FAILED', {
        job_id: payoutJobId,
        error: error.message
      });

      // Do NOT swallow finalization errors - they indicate data consistency issues
      errors.push({
        error: `CRITICAL: Failed to finalize job ${payoutJobId}: ${error.message}`
      });
      // Preserve original job status in return (finalization failed)
      finalJobStatus = jobStatus;
      jobCompleted = false;
    } finally {
      finalizeClient.release();
    }
  }

  return {
    job_id: payoutJobId,
    status: finalJobStatus,
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
 * Ensures job finalization completes even if job is stuck in 'processing' state.
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
 * @throws {Error} If job selection fails (with full context in error message)
 */
async function processPendingJobs(pool, options = {}) {
  const { jobBatchSize = 10, transferBatchSize = 50 } = options;

  let jobs = [];

  // Fetch pending/processing jobs with explicit error handling
  try {
    jobs = await PayoutJobsRepository.findPendingOrProcessing(pool, jobBatchSize);
  } catch (error) {
    // Throw with full context if job selection fails
    const errorMessage = error && error.message ? error.message : String(error);
    throw new Error(
      `CRITICAL: Failed to select pending/processing jobs: ${errorMessage}. ` +
      `This blocks all payout processing. Check database connection and payout_jobs table.`
    );
  }

  // INSTRUMENTATION: Log job selection results
  const jobIds = jobs.map(j => j.id);
  console.log('[PayoutJobService.processPendingJobs] Job selection complete', {
    jobs_selected: jobs.length,
    job_ids: jobIds,
    batch_size: jobBatchSize
  });

  let jobsProcessed = 0;
  let jobsCompleted = 0;
  let totalTransfersProcessed = 0;
  const errors = [];

  for (const job of jobs) {
    try {
      // INSTRUMENTATION: Log per-job entry
      console.log('[PayoutJobService.processPendingJobs] Processing job', {
        job_id: job.id,
        initial_status: job.status
      });

      const result = await processJob(pool, job.id, { transferBatchSize });

      // INSTRUMENTATION: Log per-job result
      console.log('[PayoutJobService.processPendingJobs] Job processing result', {
        job_id: job.id,
        final_status: result.status,
        transfers_processed: result.transfers_processed,
        transfers_completed: result.transfers_completed,
        transfers_failed: result.transfers_failed,
        transfers_retryable: result.transfers_retryable,
        errors_count: result.errors.length
      });

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
      // Capture full error context, not just error.message
      const errorMessage = error && error.message ? error.message : String(error);

      // INSTRUMENTATION: Log job processing exception
      console.error('[PayoutJobService.processPendingJobs] Job processing FAILED', {
        job_id: job.id,
        error: errorMessage
      });

      errors.push({
        job_id: job.id,
        error: `processJob failed: ${errorMessage}`
      });
      jobsProcessed += 1;
    }
  }

  // INSTRUMENTATION: Log final scheduler results
  console.log('[PayoutJobService.processPendingJobs] Scheduler cycle complete', {
    jobs_processed: jobsProcessed,
    jobs_completed: jobsCompleted,
    total_transfers_processed: totalTransfersProcessed,
    total_errors: errors.length
  });

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
