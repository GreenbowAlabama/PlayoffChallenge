/**
 * Application Base URL Configuration
 *
 * Single source of truth for all user-facing URLs (join links, etc.)
 * Loads from APP_BASE_URL environment variable.
 *
 * Required in all environments (dev, test, staging, production)
 */

/**
 * Get the cleaned APP_BASE_URL
 * Validates and normalizes the environment variable
 */
const getAppBaseUrl = () => {
  const url = process.env.APP_BASE_URL;
  if (!url) {
    throw new Error('APP_BASE_URL is required but not set. Set it to the public-facing app URL (e.g., https://app.67enterprises.com)');
  }
  // Remove trailing slash and any surrounding quotes (in case of misconfiguration)
  return url.replace(/^["']|["']$/g, '').replace(/\/$/, '');
};

/**
 * Lazy singleton: computed once, cached thereafter
 * Provides deterministic config snapshot while supporting test environments
 */
let cachedAppBaseUrl = null;

function getAppBaseUrlCached() {
  if (cachedAppBaseUrl === null) {
    cachedAppBaseUrl = getAppBaseUrl();
  }
  return cachedAppBaseUrl;
}

/**
 * Reset cache (test-only utility)
 * Allows tests to change APP_BASE_URL mid-suite
 */
function resetCache() {
  cachedAppBaseUrl = null;
}

/**
 * Exported constant getter: provides stable value for introspection
 * Computed lazily on first access, then cached
 */
Object.defineProperty(module.exports, 'APP_BASE_URL', {
  get: getAppBaseUrlCached,
  enumerable: true
});

/**
 * Generate a canonical join URL for a contest token
 *
 * @param {string} token - The join token
 * @returns {string} Full join URL (e.g., https://app.67enterprises.com/join/dev_abc123...)
 * @throws {Error} If token is missing or invalid
 */
function buildJoinUrl(token) {
  if (!token) {
    throw new Error('token is required to build join URL');
  }
  return `${getAppBaseUrlCached()}/join/${token}`;
}

module.exports.getAppBaseUrl = getAppBaseUrl;
module.exports.buildJoinUrl = buildJoinUrl;
module.exports.resetCache = resetCache;
