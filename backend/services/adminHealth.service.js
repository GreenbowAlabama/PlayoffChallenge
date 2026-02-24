/**
 * Admin Health Service
 *
 * Read-only service for environment health diagnostics.
 * Performs non-blocking health checks with fast-fail behavior.
 *
 * IMPORTANT: This service is strictly read-only. No mutations.
 * No retries, no blocking calls, fast-fail only.
 */

const axios = require('axios');

// Timeout for external service checks (ms)
const EXTERNAL_CHECK_TIMEOUT = 3000;

/**
 * Checks if the database is reachable.
 * Fast-fail: returns immediately on connection error.
 *
 * @param {Pool} pool - PostgreSQL connection pool
 * @returns {Promise<Object>} Health check result
 */
async function checkDatabase(pool) {
  const startTime = Date.now();
  try {
    await pool.query('SELECT 1');
    return {
      status: 'healthy',
      latency_ms: Date.now() - startTime
    };
  } catch (err) {
    return {
      status: 'unhealthy',
      error: err.message,
      latency_ms: Date.now() - startTime
    };
  }
}

/**
 * Checks if the ESPN API is reachable (ping only).
 * Fast-fail: short timeout, no retries.
 *
 * @returns {Promise<Object>} Health check result
 */
async function checkESPNApi() {
  const startTime = Date.now();
  try {
    // Use HEAD request to minimize data transfer - just checking reachability
    const response = await axios.head(
      'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
      { timeout: EXTERNAL_CHECK_TIMEOUT }
    );
    return {
      status: response.status >= 200 && response.status < 400 ? 'healthy' : 'degraded',
      http_status: response.status,
      latency_ms: Date.now() - startTime
    };
  } catch (err) {
    // ESPN might not support HEAD, try a lightweight GET as fallback
    try {
      const response = await axios.get(
        'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
        { timeout: EXTERNAL_CHECK_TIMEOUT }
      );
      return {
        status: 'healthy',
        http_status: response.status,
        latency_ms: Date.now() - startTime
      };
    } catch (fallbackErr) {
      return {
        status: 'unhealthy',
        error: fallbackErr.code || fallbackErr.message,
        latency_ms: Date.now() - startTime
      };
    }
  }
}

/**
 * Checks if the Sleeper API is reachable (optional secondary stats provider).
 * Fast-fail: short timeout, no retries.
 *
 * @returns {Promise<Object>} Health check result
 */
async function checkSleeperApi() {
  const startTime = Date.now();
  try {
    const response = await axios.get(
      'https://api.sleeper.app/v1/state/nfl',
      { timeout: EXTERNAL_CHECK_TIMEOUT }
    );
    return {
      status: response.status >= 200 && response.status < 400 ? 'healthy' : 'degraded',
      http_status: response.status,
      latency_ms: Date.now() - startTime
    };
  } catch (err) {
    return {
      status: 'unhealthy',
      error: err.code || err.message,
      latency_ms: Date.now() - startTime
    };
  }
}

/**
 * Gets API process health status.
 * Trivially healthy since we're responding to the request.
 *
 * @returns {Object} API health status
 */
function checkApiProcess() {
  return {
    status: 'healthy',
    uptime_seconds: Math.floor(process.uptime()),
    memory_usage_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    node_version: process.version,
    environment: process.env.NODE_ENV || 'development'
  };
}

/**
 * Performs all health checks and returns aggregated results.
 * Checks run in parallel for efficiency.
 *
 * @param {Pool} pool - PostgreSQL connection pool
 * @param {Object} jobStatus - Optional job status from adminJobs service
 * @returns {Promise<Object>} Aggregated health check results
 */
async function getFullHealthCheck(pool, jobStatus = null) {
  const [dbHealth, espnHealth, sleeperHealth] = await Promise.all([
    checkDatabase(pool),
    checkESPNApi(),
    checkSleeperApi()
  ]);

  const apiHealth = checkApiProcess();

  // Determine overall status
  const allHealthy = dbHealth.status === 'healthy' &&
    espnHealth.status === 'healthy' &&
    apiHealth.status === 'healthy';

  const anyUnhealthy = dbHealth.status === 'unhealthy' ||
    espnHealth.status === 'unhealthy';

  let overallStatus = 'healthy';
  if (anyUnhealthy) {
    overallStatus = 'unhealthy';
  } else if (!allHealthy) {
    overallStatus = 'degraded';
  }

  return {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    checks: {
      api_process: apiHealth,
      database: dbHealth,
      espn_api: espnHealth,
      sleeper_api: sleeperHealth,
      background_jobs: jobStatus || { status: 'unknown', message: 'Job status not available' }
    }
  };
}

module.exports = {
  checkDatabase,
  checkESPNApi,
  checkSleeperApi,
  checkApiProcess,
  getFullHealthCheck
};
