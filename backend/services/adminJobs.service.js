/**
 * Admin Jobs Service
 *
 * Read-only service for background job status visibility.
 *
 * IMPORTANT: This service is strictly read-only.
 * No pause, no retry, no trigger - visibility only.
 *
 * Jobs register their status with this service, which exposes it
 * through the diagnostics API.
 */

// In-memory job status registry
// Jobs update their status here; this service only reads it
const jobRegistry = new Map();

/**
 * Registers a job in the registry.
 * Called by server.js when starting a background job.
 *
 * @param {string} jobName - Unique identifier for the job
 * @param {Object} initialStatus - Initial status object
 */
function registerJob(jobName, initialStatus = {}) {
  jobRegistry.set(jobName, {
    name: jobName,
    registered_at: new Date().toISOString(),
    last_run_at: null,
    last_success_at: null,
    last_error_at: null,
    last_error_message: null,
    run_count: 0,
    success_count: 0,
    failure_count: 0,
    status: 'registered',
    interval_ms: initialStatus.interval_ms || null,
    ...initialStatus
  });
}

/**
 * Updates job status after a run.
 * Called by server.js after each job execution.
 *
 * @param {string} jobName - Unique identifier for the job
 * @param {Object} runResult - Result of the job run
 * @param {boolean} runResult.success - Whether the run succeeded
 * @param {string} [runResult.error] - Error message if failed
 */
function updateJobStatus(jobName, runResult) {
  const job = jobRegistry.get(jobName);
  if (!job) {
    // Auto-register if not found
    registerJob(jobName);
    return updateJobStatus(jobName, runResult);
  }

  const now = new Date().toISOString();
  job.last_run_at = now;
  job.run_count += 1;

  if (runResult.success) {
    job.last_success_at = now;
    job.success_count += 1;
    job.status = 'healthy';
    job.last_error_message = null; // Clear previous error on success
  } else {
    job.last_error_at = now;
    job.failure_count += 1;
    job.status = 'error';
    job.last_error_message = runResult.error || 'Unknown error';
  }

  jobRegistry.set(jobName, job);
}

/**
 * Marks a job as running (started but not yet completed).
 *
 * @param {string} jobName - Unique identifier for the job
 */
function markJobRunning(jobName) {
  const job = jobRegistry.get(jobName);
  if (job) {
    job.status = 'running';
    jobRegistry.set(jobName, job);
  }
}

/**
 * Gets the status of a specific job.
 *
 * @param {string} jobName - Unique identifier for the job
 * @returns {Object|null} Job status or null if not found
 */
function getJobStatus(jobName) {
  return jobRegistry.get(jobName) || null;
}

/**
 * Gets the status of all registered jobs.
 *
 * @returns {Array} Array of job status objects
 */
function getAllJobStatuses() {
  return Array.from(jobRegistry.values());
}

/**
 * Gets a summary of job health for the health check endpoint.
 *
 * @returns {Object} Job health summary
 */
function getJobHealthSummary() {
  const jobs = getAllJobStatuses();

  if (jobs.length === 0) {
    return {
      status: 'unknown',
      message: 'No background jobs registered',
      job_count: 0
    };
  }

  const healthyJobs = jobs.filter(j => j.status === 'healthy').length;
  const errorJobs = jobs.filter(j => j.status === 'error').length;
  const runningJobs = jobs.filter(j => j.status === 'running').length;

  let overallStatus = 'healthy';
  if (errorJobs > 0) {
    overallStatus = 'degraded';
  }
  if (errorJobs === jobs.length) {
    overallStatus = 'unhealthy';
  }

  return {
    status: overallStatus,
    job_count: jobs.length,
    healthy: healthyJobs,
    error: errorJobs,
    running: runningJobs,
    jobs: jobs.map(j => ({
      name: j.name,
      status: j.status,
      last_run_at: j.last_run_at,
      last_error_message: j.last_error_message
    }))
  };
}

/**
 * Clears the job registry. Used for testing only.
 */
function clearRegistry() {
  jobRegistry.clear();
}

/**
 * Run payout scheduler.
 *
 * Called by background job runner to process pending payout jobs.
 * Not a recurring job itself - the caller manages scheduling.
 *
 * @param {Object} pool - Database connection pool
 * @returns {Promise<Object>} Scheduler execution result
 */
async function runPayoutScheduler(pool) {
  const PayoutJobService = require('./PayoutJobService');

  try {
    const result = await PayoutJobService.processPendingJobs(pool, {
      jobBatchSize: 10,
      transferBatchSize: 50
    });

    // INSTRUMENTATION: Log result before returning
    console.log('[adminJobs.runPayoutScheduler] Execution complete', {
      success: true,
      jobs_processed: result.jobs_processed,
      jobs_completed: result.jobs_completed,
      total_transfers_processed: result.total_transfers_processed,
      errors_count: result.errors.length
    });

    return {
      success: true,
      ...result
    };
  } catch (error) {
    // INSTRUMENTATION: Capture full error context - never return empty error
    const errorMessage = error && error.message ? error.message : String(error);
    const fullError = errorMessage || 'Unknown scheduler error (no error message)';

    console.error('[adminJobs.runPayoutScheduler] FAILED', {
      error: fullError,
      error_type: error?.constructor?.name || 'Unknown',
      has_stack: !!(error && error.stack)
    });

    return {
      success: false,
      error: fullError
    };
  }
}

module.exports = {
  registerJob,
  updateJobStatus,
  markJobRunning,
  getJobStatus,
  getAllJobStatuses,
  getJobHealthSummary,
  clearRegistry,
  runPayoutScheduler
};
