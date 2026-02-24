/**
 * Admin Rate Limit Service
 *
 * Read-only service for rate limit and auth visibility.
 *
 * IMPORTANT: This service is strictly read-only. No overrides or bypass logic.
 * Returns "not tracked" for data that is not currently persisted.
 */

// Default rate limit configuration values
// These match the values in server.js for visibility
const RATE_LIMIT_CONFIG = {
  api: {
    name: 'API Rate Limit',
    windowMs: 60 * 1000,        // 1 minute
    maxRequests: 1000,          // 1000 requests per window
    description: 'General API rate limit applied to all /api/* routes'
  },
  auth: {
    name: 'Auth Rate Limit',
    windowMs: 15 * 60 * 1000,   // 15 minutes
    maxRequests: 10,            // 10 attempts per window
    description: 'Authentication rate limit for login/auth endpoints'
  }
};

/**
 * Returns the current rate limit configuration.
 * These are static values matching the server configuration.
 *
 * @returns {Object} Rate limit configuration
 */
function getRateLimitConfig() {
  return {
    timestamp: new Date().toISOString(),
    limits: {
      api: {
        ...RATE_LIMIT_CONFIG.api,
        window_seconds: RATE_LIMIT_CONFIG.api.windowMs / 1000,
        requests_per_window: RATE_LIMIT_CONFIG.api.maxRequests
      },
      auth: {
        ...RATE_LIMIT_CONFIG.auth,
        window_seconds: RATE_LIMIT_CONFIG.auth.windowMs / 1000,
        requests_per_window: RATE_LIMIT_CONFIG.auth.maxRequests
      }
    }
  };
}

/**
 * Returns information about recent rate limit blocks.
 * Currently not tracked - express-rate-limit does not persist block history.
 *
 * @returns {Object} Rate limit block information
 */
function getRecentBlocks() {
  return {
    timestamp: new Date().toISOString(),
    status: 'not_tracked',
    message: 'Rate limit block history is not currently persisted. ' +
             'Express-rate-limit handles limiting in-memory without logging blocked requests.',
    recommendation: 'To enable block tracking, configure a custom handler or external logging.'
  };
}

/**
 * Returns information about auth failures.
 * Currently not tracked in a persistent counter.
 *
 * @returns {Object} Auth failure information
 */
function getAuthFailures() {
  return {
    timestamp: new Date().toISOString(),
    status: 'not_tracked',
    message: 'Auth failure counts are not currently aggregated. ' +
             'Individual failures are logged to console but not persisted.',
    recommendation: 'Auth failures are logged with [Admin Auth] prefix. ' +
                   'Check server logs for individual failure events.',
    log_format: {
      prefix: '[Admin Auth]',
      includes: ['timestamp', 'path', 'ip', 'error']
    }
  };
}

/**
 * Returns complete rate limit and auth visibility report.
 *
 * @returns {Object} Full visibility report
 */
function getFullVisibilityReport() {
  return {
    timestamp: new Date().toISOString(),
    rate_limits: getRateLimitConfig().limits,
    recent_blocks: getRecentBlocks(),
    auth_failures: getAuthFailures()
  };
}

module.exports = {
  getRateLimitConfig,
  getRecentBlocks,
  getAuthFailures,
  getFullVisibilityReport,
  RATE_LIMIT_CONFIG
};
