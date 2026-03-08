/**
 * Admin Platform Health Service
 *
 * Aggregates raw diagnostics signals into operator-facing platform health status.
 *
 * This is the anti-corruption layer between:
 * - Diagnostics (raw data: health checks, jobs, lifecycle, invariants)
 * - UI (operator signal: single platform health status)
 *
 * Prevents UI coupling to multiple internal endpoints.
 */

const healthService = require('./adminHealth.service');
const jobsService = require('./adminJobs.service');
const lifecycleHealthService = require('./lifecycleHealthService');
const systemInvariantService = require('./systemInvariantService');

/**
 * Aggregates all platform signals into a single operator status.
 *
 * Returns:
 * {
 *   "status": "healthy" | "degraded" | "critical",
 *   "timestamp": "2026-03-08T19:24:00Z",
 *   "services": {
 *     "database": "healthy",
 *     "externalApis": "healthy",
 *     "workers": "healthy",
 *     "contestLifecycle": "healthy",
 *     "invariants": "healthy"
 *   }
 * }
 *
 * @param {Pool} pool - PostgreSQL connection pool
 * @returns {Promise<Object>} Aggregated platform health
 */
async function getPlatformHealth(pool) {
  try {
    // Gather all signals in parallel
    const [health, jobs, lifecycle, invariants] = await Promise.all([
      healthService.getFullHealthCheck(pool, null),
      getJobsSignal(),
      getLifecycleSignal(pool),
      getInvariantsSignal(pool)
    ]);

    // Compute services status
    const services = {
      database: health.checks.database.status,
      externalApis: aggregateExternalApis(health),
      workers: aggregateWorkerStatus(jobs),
      contestLifecycle: lifecycle.status,
      invariants: invariants.status
    };

    // Compute overall status
    const overallStatus = computeOverallStatus(services);

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      services
    };
  } catch (err) {
    // Fail gracefully if aggregation fails
    console.error('[Platform Health] Aggregation failed:', err);
    return {
      status: 'critical',
      timestamp: new Date().toISOString(),
      services: {
        database: 'unknown',
        externalApis: 'unknown',
        workers: 'unknown',
        contestLifecycle: 'unknown',
        invariants: 'unknown'
      },
      error: err.message
    };
  }
}

/**
 * Gets worker job status signal.
 * Returns "healthy" if all critical jobs are running.
 */
function getJobsSignal() {
  try {
    const jobs = jobsService.getAllJobStatuses();
    const summary = jobsService.getJobHealthSummary();

    // If we can't get job status, consider it unknown (not critical)
    if (!summary) {
      return Promise.resolve({
        status: 'unknown'
      });
    }

    // If all jobs are healthy, signal is healthy
    // If any job has errors, signal is degraded
    const hasErrors = jobs.some(j => j.failure_count > 0);

    return Promise.resolve({
      status: hasErrors ? 'degraded' : 'healthy',
      jobs: jobs.length
    });
  } catch (err) {
    return Promise.resolve({
      status: 'unknown',
      error: err.message
    });
  }
}

/**
 * Gets lifecycle health signal.
 * Calls the existing lifecycle health service.
 */
async function getLifecycleSignal(pool) {
  try {
    const lifecycle = await lifecycleHealthService.getLifecycleHealth(pool, new Date());

    // Determine signal based on anomalies
    const hasAnomalies =
      (lifecycle.scheduled_past_lock_time || 0) > 0 ||
      (lifecycle.locked_past_start_time || 0) > 0 ||
      (lifecycle.live_past_end_time || 0) > 0;

    return {
      status: hasAnomalies ? 'degraded' : 'healthy'
    };
  } catch (err) {
    console.error('[Platform Health] Lifecycle signal failed:', err);
    return {
      status: 'unknown',
      error: err.message
    };
  }
}

/**
 * Gets system invariants signal.
 * Calls the existing invariant check service.
 */
async function getInvariantsSignal(pool) {
  try {
    const invariants = await systemInvariantService.runFullInvariantCheck(pool);

    // Map invariant status to signal
    const status = mapInvariantStatus(invariants.overall_status);

    return {
      status
    };
  } catch (err) {
    console.error('[Platform Health] Invariants signal failed:', err);
    return {
      status: 'unknown',
      error: err.message
    };
  }
}

/**
 * Aggregates external API statuses into single signal.
 */
function aggregateExternalApis(health) {
  const espnStatus = health.checks.espn_api?.status || 'unknown';
  const sleeperStatus = health.checks.sleeper_api?.status || 'unknown';

  // If either is unhealthy, aggregated is unhealthy
  if (espnStatus === 'unhealthy' || sleeperStatus === 'unhealthy') {
    return 'unhealthy';
  }

  // If either is degraded, aggregated is degraded
  if (espnStatus === 'degraded' || sleeperStatus === 'degraded') {
    return 'degraded';
  }

  return 'healthy';
}

/**
 * Aggregates worker job statuses into single signal.
 */
function aggregateWorkerStatus(jobsSignal) {
  return jobsSignal.status;
}

/**
 * Maps system invariant status to operator signal.
 */
function mapInvariantStatus(invariantStatus) {
  if (invariantStatus === 'HEALTHY') return 'healthy';
  if (invariantStatus === 'WARNING') return 'degraded';
  if (invariantStatus === 'CRITICAL') return 'critical';
  return 'unknown';
}

/**
 * Computes overall platform status from service statuses.
 *
 * healthy:   all services healthy
 * degraded:  any service degraded, none critical
 * critical:  any service critical
 */
function computeOverallStatus(services) {
  const statuses = Object.values(services);

  if (statuses.includes('critical')) {
    return 'critical';
  }

  if (statuses.includes('degraded')) {
    return 'degraded';
  }

  if (statuses.every(s => s === 'healthy')) {
    return 'healthy';
  }

  return 'unknown';
}

module.exports = {
  getPlatformHealth
};
