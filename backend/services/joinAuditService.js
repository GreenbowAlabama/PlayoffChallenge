/**
 * Join Audit Logging Service
 *
 * Provides structured logging for join token operations.
 * Logging only - no database writes.
 *
 * Log entries include:
 * - contest_id: The resolved contest ID (if available)
 * - token_id: The token used (redacted for security)
 * - user_id: The user attempting to join (if authenticated)
 * - join_source: How the join was initiated (e.g., 'universal_link', 'qr_code', 'direct')
 * - ip_address: Client IP address
 * - result: Success or error code
 * - timestamp: ISO timestamp
 */

const LOG_PREFIX = '[Join Audit]';

/**
 * Redact a token for logging (show prefix and last 4 chars only)
 * @param {string} token - The full token
 * @returns {string} Redacted token for logging
 */
function redactToken(token) {
  if (!token || token.length < 8) {
    return '[invalid]';
  }
  const parts = token.split('_');
  if (parts.length < 2) {
    return '[malformed]';
  }
  const prefix = parts[0];
  const randomPart = parts.slice(1).join('_');
  const lastFour = randomPart.slice(-4);
  return `${prefix}_...${lastFour}`;
}

/**
 * Log a join token resolution attempt
 *
 * @param {Object} params - Logging parameters
 * @param {string} params.token - The join token (will be redacted)
 * @param {string} [params.contestId] - Resolved contest ID (if successful)
 * @param {string} [params.userId] - User ID (if authenticated)
 * @param {string} [params.joinSource] - Source of join attempt (default: 'universal_link')
 * @param {string} [params.ipAddress] - Client IP address
 * @param {string} params.result - Result code (e.g., 'success', error code)
 * @param {string} [params.errorCode] - Structured error code if failed
 * @param {Object} [params.extra] - Additional context for debugging
 */
function logJoinAttempt(params) {
  const {
    token,
    contestId,
    userId,
    joinSource = 'universal_link',
    ipAddress,
    result,
    errorCode,
    extra
  } = params;

  const logEntry = {
    event: 'join_attempt',
    timestamp: new Date().toISOString(),
    token_id: redactToken(token),
    contest_id: contestId || null,
    user_id: userId || null,
    join_source: joinSource,
    ip_address: ipAddress || null,
    result: result,
    error_code: errorCode || null,
  };

  // Add extra context if provided (for debugging)
  if (extra && Object.keys(extra).length > 0) {
    logEntry.extra = extra;
  }

  // Use structured JSON logging
  console.log(LOG_PREFIX, JSON.stringify(logEntry));
}

/**
 * Log a successful join token resolution
 *
 * @param {Object} params - Logging parameters
 * @param {string} params.token - The join token
 * @param {string} params.contestId - The resolved contest ID
 * @param {string} [params.userId] - User ID if authenticated
 * @param {string} [params.joinSource] - Source of join
 * @param {string} [params.ipAddress] - Client IP
 */
function logJoinSuccess(params) {
  logJoinAttempt({
    ...params,
    result: 'success'
  });
}

/**
 * Log a failed join token resolution
 *
 * @param {Object} params - Logging parameters
 * @param {string} params.token - The join token
 * @param {string} params.errorCode - Structured error code (from JOIN_ERROR_CODES)
 * @param {string} [params.contestId] - Contest ID if resolved before failure
 * @param {string} [params.userId] - User ID if authenticated
 * @param {string} [params.joinSource] - Source of join
 * @param {string} [params.ipAddress] - Client IP
 * @param {Object} [params.extra] - Additional error context
 */
function logJoinFailure(params) {
  const { errorCode, ...rest } = params;
  logJoinAttempt({
    ...rest,
    result: 'failure',
    errorCode
  });
}

/**
 * Log a rate-limited join attempt
 *
 * @param {Object} params - Logging parameters
 * @param {string} params.token - The join token (may be null for IP-only limits)
 * @param {string} [params.ipAddress] - Client IP
 * @param {string} params.limitType - Type of limit hit ('ip', 'token', 'combined')
 */
function logJoinRateLimited(params) {
  const { token, ipAddress, limitType } = params;

  const logEntry = {
    event: 'join_rate_limited',
    timestamp: new Date().toISOString(),
    token_id: token ? redactToken(token) : null,
    ip_address: ipAddress || null,
    limit_type: limitType,
    result: 'rate_limited'
  };

  console.log(LOG_PREFIX, JSON.stringify(logEntry));
}

/**
 * Log a contest creation event
 *
 * @param {Object} params - Logging parameters
 * @param {string} params.contestId - The created contest ID
 * @param {string} params.organizerId - The user who created the contest
 * @param {string} params.templateId - The template used
 * @param {string} [params.token] - The join token (will be redacted)
 */
function logContestCreated(params) {
  const { contestId, organizerId, templateId, token } = params;

  const logEntry = {
    event: 'contest_created',
    timestamp: new Date().toISOString(),
    contest_id: contestId,
    organizer_id: organizerId,
    template_id: templateId,
    token_id: token ? redactToken(token) : null
  };

  console.log(LOG_PREFIX, JSON.stringify(logEntry));
}

/**
 * Log a contest publish event
 *
 * @param {Object} params - Logging parameters
 * @param {string} params.contestId - The published contest ID
 * @param {string} params.organizerId - The user who published the contest
 * @param {string} params.token - The join token (will be redacted)
 */
function logContestPublished(params) {
  const { contestId, organizerId, token } = params;

  const logEntry = {
    event: 'contest_published',
    timestamp: new Date().toISOString(),
    contest_id: contestId,
    organizer_id: organizerId,
    token_id: redactToken(token)
  };

  console.log(LOG_PREFIX, JSON.stringify(logEntry));
}

module.exports = {
  logJoinAttempt,
  logJoinSuccess,
  logJoinFailure,
  logJoinRateLimited,
  logContestCreated,
  logContestPublished,
  redactToken,
};
