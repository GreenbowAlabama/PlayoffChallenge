/**
 * ESPN PGA API Layer — Pure I/O Module
 *
 * Responsibilities:
 * - Fetch ESPN PGA calendar (external API call)
 * - Fetch ESPN event leaderboard (external API call)
 * - Handle timeouts, retries, rate limits with proper 429 backoff
 * - Return raw ESPN responses (no transformation)
 *
 * Non-responsibilities (delegated):
 * - No database access
 * - No adapter calls
 * - No contest logic
 * - No event selection (returns raw data to caller)
 * - No payload validation (caller validates before use)
 */

'use strict';

const axios = require('axios');

const logger = console; // TODO: Replace with structured logger

/**
 * Sleep for specified milliseconds.
 *
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parse Retry-After header value to milliseconds.
 * Can be either seconds (number) or HTTP-date (string).
 *
 * @param {string|number} retryAfter - Retry-After header value
 * @returns {number} Milliseconds, clamped to [1000, 30000]
 */
function parseRetryAfter(retryAfter) {
  if (!retryAfter) {
    // No Retry-After header, use safe default: 1000ms
    return 1000;
  }

  // If it's a number, treat as seconds, clamp to [1000ms, 30000ms]
  if (!isNaN(retryAfter)) {
    const seconds = parseInt(retryAfter, 10);
    const ms = seconds * 1000;
    return Math.max(1000, Math.min(ms, 30000));
  }

  // If it's a date string, parse and calculate delay
  try {
    const date = new Date(retryAfter);
    const now = new Date();
    const delayMs = date.getTime() - now.getTime();

    // If date parsing failed or delay is invalid, fallback to safe default
    if (!Number.isFinite(delayMs) || delayMs <= 0) {
      return 1000;
    }

    // Clamp to [1000ms, 30000ms]
    return Math.max(1000, Math.min(delayMs, 30000));
  } catch (err) {
    // Parse error, fallback to safe default
    return 1000;
  }
}

/**
 * Retry logic for transient errors with proper 429 rate limit handling.
 *
 * Retry Strategy:
 * - 429 (Rate Limited): Parse Retry-After, sleep (capped 30s), count as attempt, WARN log
 * - Timeout/Connection Error: Exponential backoff (500ms, 1s, 2s)
 * - 5xx: Exponential backoff
 * - 4xx (except 429): No retry, fail fast
 *
 * @param {Function} fn - Async function to retry
 * @param {number} maxRetries - Max attempts (default 3)
 * @returns {Promise<*>} Result from fn
 * @throws {Error} If all retries exhausted or non-transient error
 */
async function withRetry(fn, maxRetries = 3) {
  let lastErr;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;

      // Extract HTTP status code from axios error
      const statusCode = err.response?.status;

      // 429 Rate Limited: Respect Retry-After
      if (statusCode === 429) {
        const retryAfter = err.response?.headers['retry-after'];
        const delayMs = parseRetryAfter(retryAfter);

        logger.warn(
          `[espnPgaApi] Rate limited (429): Retry-After=${retryAfter || 'not specified'}, ` +
          `waiting ${delayMs}ms (attempt ${attempt}/${maxRetries})`
        );

        if (attempt === maxRetries) {
          // Last attempt exhausted, throw the original error
          throw err;
        }

        await sleep(delayMs);
        continue; // Count as attempt, continue loop
      }

      // Non-429 4xx errors: no retry, fail fast
      if (statusCode && statusCode >= 400 && statusCode < 500) {
        throw err;
      }

      // Timeout or connection error or 5xx: Exponential backoff
      const msg = String(err.message || '');
      const isTimeoutOrConnection = err.code === 'ECONNABORTED' ||
        err.code === 'ECONNREFUSED' ||
        msg.includes('timeout');

      if (isTimeoutOrConnection || (statusCode && statusCode >= 500)) {
        if (attempt === maxRetries) {
          throw err;
        }

        const baseDelayMs = 500;
        const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
        logger.warn(
          `[espnPgaApi] Transient error (timeout/connection/5xx), retrying in ${delayMs}ms ` +
          `(attempt ${attempt}/${maxRetries}): ${err.message}`
        );
        await sleep(delayMs);
        continue;
      }

      // Unknown error, throw
      throw err;
    }
  }

  throw lastErr;
}

/**
 * Fetch ESPN PGA calendar for a league and season.
 *
 * @param {Object} options
 *   {
 *     leagueId: number (e.g., 1106 for PGA Tour)
 *     seasonYear: number (e.g., 2026)
 *     timeout: number (ms, default 5000)
 *   }
 * @returns {Promise<Object>} ESPN calendar response { events: [...] }
 * @throws {Error} If fetch fails (after retries or non-transient error)
 */
async function fetchCalendar({ leagueId, seasonYear, timeout = 5000 }) {
  if (!leagueId || !seasonYear) {
    throw new Error(
      'fetchCalendar: leagueId and seasonYear are required'
    );
  }

  logger.info(
    `[espnPgaApi] Fetching calendar: league=${leagueId}, year=${seasonYear}`
  );

  return withRetry(async () => {
    // TODO: Replace with actual ESPN API endpoint
    // Placeholder: should be something like:
    // https://site.api.espn.com/sports/golf/pga/leagues/{leagueId}/seasons/{seasonYear}/events

    const url = `https://site.api.espn.com/sports/golf/pga/leagues/${leagueId}/seasons/${seasonYear}/events`;

    const response = await axios.get(url, {
      timeout,
      headers: {
        'User-Agent': 'playoff-challenge/2.0'
      }
    });

    logger.info(
      `[espnPgaApi] Calendar fetched: ${response.data.events?.length || 0} events`
    );
    return response.data;
  }, 3);
}

/**
 * Fetch ESPN event leaderboard (including competitor scores).
 *
 * @param {Object} options
 *   {
 *     eventId: string (ESPN event ID, e.g., "401811941")
 *     timeout: number (ms, default 5000)
 *   }
 * @returns {Promise<Object>} ESPN event detail response { events: [{competitions:[...]}] }
 * @throws {Error} If fetch fails (after retries or non-transient error)
 */
async function fetchLeaderboard({ eventId, timeout = 5000 }) {
  if (!eventId) {
    throw new Error('fetchLeaderboard: eventId is required');
  }

  logger.info(`[espnPgaApi] Fetching leaderboard: eventId=${eventId}`);

  return withRetry(async () => {
    // TODO: Replace with actual ESPN API endpoint
    // Placeholder: should be something like:
    // https://site.api.espn.com/sports/golf/pga/events/{eventId}

    const url = `https://site.api.espn.com/sports/golf/pga/events/${eventId}`;

    const response = await axios.get(url, {
      timeout,
      headers: {
        'User-Agent': 'playoff-challenge/2.0'
      }
    });

    logger.info(
      `[espnPgaApi] Leaderboard fetched: eventId=${eventId}`
    );
    return response.data;
  }, 3);
}

module.exports = {
  fetchCalendar,
  fetchLeaderboard,
  withRetry, // Export for testing
  parseRetryAfter // Export for testing
};
