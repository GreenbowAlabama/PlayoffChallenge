/**
 * Join Token Rate Limiting Middleware
 *
 * Provides lightweight protection against token brute forcing.
 * Uses IP + token based limiting to prevent:
 * - Rapid token enumeration from a single IP
 * - Excessive requests for a specific token
 *
 * Configuration via centralized config module.
 */

const rateLimit = require('express-rate-limit');
const config = require('../config');
const { logJoinRateLimited } = require('../services/joinAuditService');

/**
 * Create the join token rate limiter
 * Limits requests based on IP address
 *
 * Uses default keyGenerator which properly handles IPv6 addresses.
 */
function createJoinRateLimiter() {
  const rateLimitConfig = config.getJoinRateLimitConfig();

  return rateLimit({
    windowMs: rateLimitConfig.windowMs,
    max: rateLimitConfig.maxAttempts,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      valid: false,
      error_code: 'RATE_LIMITED',
      reason: 'Too many join attempts, please try again later'
    },
    // Use default keyGenerator (handles IPv6 properly)
    // Handler when rate limit is exceeded
    handler: (req, res, next, options) => {
      const token = req.params.token;
      const ipAddress = req.ip;

      // Log the rate-limited attempt
      logJoinRateLimited({
        token: token || null,
        ipAddress,
        limitType: 'ip'
      });

      res.status(429).json(options.message);
    },
  });
}

/**
 * In-memory store for per-token rate limiting
 * This is a lightweight implementation for additional token-based protection
 */
const tokenAttemptStore = new Map();

/**
 * Cleanup expired entries periodically
 */
function cleanupTokenStore() {
  const now = Date.now();
  const rateLimitConfig = config.getJoinRateLimitConfig();

  for (const [key, data] of tokenAttemptStore.entries()) {
    if (now - data.firstAttempt > rateLimitConfig.windowMs) {
      tokenAttemptStore.delete(key);
    }
  }
}

// Run cleanup every 5 minutes.
// unref() so this timer does not keep the Node process alive (e.g. after tests).
const cleanupInterval = setInterval(cleanupTokenStore, 5 * 60 * 1000);
cleanupInterval.unref();

/**
 * Per-token rate limiting middleware
 * Tracks attempts per token to prevent focused attacks on specific tokens
 */
function perTokenRateLimiter(req, res, next) {
  const token = req.params.token;
  if (!token) {
    return next();
  }

  const rateLimitConfig = config.getJoinRateLimitConfig();
  const now = Date.now();
  const ipAddress = req.ip;

  // Get or create entry for this token
  let tokenData = tokenAttemptStore.get(token);
  if (!tokenData || (now - tokenData.firstAttempt > rateLimitConfig.windowMs)) {
    // Reset or create new window
    tokenData = {
      count: 0,
      firstAttempt: now
    };
    tokenAttemptStore.set(token, tokenData);
  }

  // Increment counter
  tokenData.count++;

  // Check if limit exceeded
  if (tokenData.count > rateLimitConfig.maxAttemptsPerToken) {
    logJoinRateLimited({
      token,
      ipAddress,
      limitType: 'token'
    });

    return res.status(429).json({
      valid: false,
      error_code: 'RATE_LIMITED',
      reason: 'Too many attempts for this token, please try again later'
    });
  }

  next();
}

/**
 * Combined rate limiter for join endpoints
 * Applies both IP-based and token-based limiting
 */
function createCombinedJoinRateLimiter() {
  const ipLimiter = createJoinRateLimiter();

  return [ipLimiter, perTokenRateLimiter];
}

module.exports = {
  createJoinRateLimiter,
  perTokenRateLimiter,
  createCombinedJoinRateLimiter,
};
