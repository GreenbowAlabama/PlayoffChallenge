/**
 * Centralized Configuration Module
 *
 * All environment variables should be accessed through this module.
 * Services, controllers, and routes should not read process.env directly.
 *
 * This ensures:
 * - Single source of truth for configuration
 * - Consistent defaults
 * - Easy testing with config overrides
 */

const VALID_APP_ENVS = ['dev', 'test', 'stg', 'prd'];

/**
 * Application environment (dev, test, stg, prd)
 * Used for environment-scoped tokens and feature flags
 *
 * Behavior:
 * - Missing APP_ENV: defaults to 'dev', warns in non-test environments
 * - Invalid APP_ENV: throws (no silent fallback)
 */
function getAppEnv() {
  const env = process.env.APP_ENV;

  if (!env) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(
        '[CONFIG WARNING] APP_ENV is not set. Defaulting to "dev". ' +
        'Set APP_ENV explicitly in all environments.'
      );
    }
    return 'dev';
  }

  if (!VALID_APP_ENVS.includes(env)) {
    throw new Error(
      `Invalid APP_ENV: "${env}". Must be one of: ${VALID_APP_ENVS.join(', ')}. ` +
      'Fix the APP_ENV environment variable.'
    );
  }

  return env;
}

/**
 * Validate environment configuration at startup.
 * Call during server initialization to fail fast on misconfiguration.
 *
 * Throws if:
 * - APP_ENV is set to an invalid value
 * - APP_ENV is missing in production (NODE_ENV=production)
 *
 * Warns if:
 * - APP_ENV is missing in non-production, non-test environments
 */
function validateEnvironment() {
  const appEnv = process.env.APP_ENV;
  const nodeEnv = process.env.NODE_ENV;

  if (appEnv && !VALID_APP_ENVS.includes(appEnv)) {
    throw new Error(
      `[STARTUP FATAL] Invalid APP_ENV: "${appEnv}". ` +
      `Must be one of: ${VALID_APP_ENVS.join(', ')}`
    );
  }

  if (!appEnv) {
    if (nodeEnv === 'production') {
      throw new Error(
        '[STARTUP FATAL] APP_ENV is required in production. ' +
        `Set APP_ENV to one of: ${VALID_APP_ENVS.join(', ')}`
      );
    }
    if (nodeEnv !== 'test') {
      console.warn(
        '[CONFIG WARNING] APP_ENV is not set. Defaulting to "dev". ' +
        'Set APP_ENV explicitly to avoid environment mismatch issues.'
      );
    }
  }
}

/**
 * Join Base URL for generating shareable join links
 * This should be the public-facing URL where users access the app
 *
 * Format: https://app.67enterprises.com (no trailing slash)
 * REQUIRED: Must be set in all environments (dev, staging, prod)
 */
function getJoinBaseUrl() {
  const url = process.env.JOIN_BASE_URL;
  if (!url) {
    throw new Error(
      'JOIN_BASE_URL environment variable is required but not set. ' +
      'Set it to the public-facing app URL (e.g., https://app.67enterprises.com)'
    );
  }
  // Remove trailing slash and any surrounding quotes (in case of misconfiguration)
  const cleanUrl = url.replace(/^["']|["']$/g, '').replace(/\/$/, '');
  return cleanUrl;
}

/**
 * Generate a canonical join URL for a contest token
 * @param {string} token - The join token
 * @returns {string} Full join URL
 */
function buildJoinUrl(token) {
  if (!token) {
    throw new Error('Token is required to build join URL');
  }
  return `${getJoinBaseUrl()}/join/${token}`;
}

/**
 * Server port
 */
function getPort() {
  return parseInt(process.env.PORT, 10) || 8080;
}

/**
 * Node environment (development, production, test)
 */
function getNodeEnv() {
  return process.env.NODE_ENV || 'development';
}

/**
 * Database connection URL
 */
function getDatabaseUrl() {
  return process.env.DATABASE_URL;
}

/**
 * Check if running in production
 */
function isProduction() {
  return getNodeEnv() === 'production';
}

/**
 * Admin JWT secret
 */
function getAdminJwtSecret() {
  return process.env.ADMIN_JWT_SECRET;
}

/**
 * App Store URL for iOS app
 * Used for fallback redirect when universal links don't work
 */
function getAppStoreUrl() {
  return process.env.APP_STORE_URL || 'https://apps.apple.com/us/app/fantasy-playoffs/id6754228835';
}

/**
 * Rate limiting configuration for join token endpoint
 */
function getJoinRateLimitConfig() {
  return {
    // Window in milliseconds (default: 15 minutes)
    windowMs: parseInt(process.env.JOIN_RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    // Maximum attempts per IP per window (default: 50)
    maxAttempts: parseInt(process.env.JOIN_RATE_LIMIT_MAX, 10) || 50,
    // Maximum attempts per token per window (default: 20)
    maxAttemptsPerToken: parseInt(process.env.JOIN_RATE_LIMIT_MAX_PER_TOKEN, 10) || 20,
  };
}

module.exports = {
  // Environment
  getAppEnv,
  validateEnvironment,
  getNodeEnv,
  isProduction,
  getPort,

  // Database
  getDatabaseUrl,

  // Authentication
  getAdminJwtSecret,

  // Join URLs
  getJoinBaseUrl,
  buildJoinUrl,

  // Rate limiting
  getJoinRateLimitConfig,

  // App Store
  getAppStoreUrl,
};
