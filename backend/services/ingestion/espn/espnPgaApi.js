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
const logger = require('../../../utils/logger');
const httpsAgent = require('../../../utils/httpAgent');

/**
 * In-cycle leaderboard cache (request-level, not persistent).
 * Prevents duplicate ESPN API calls for the same eventId within a single ingestion cycle.
 *
 * Cache key: eventId (e.g., "401811938")
 * Cache entry: { data, timestamp, isEmptyResponse }
 *   - data: Full ESPN leaderboard response or { events: [] } for not-yet-active events
 *   - timestamp: When cache entry was created (ms)
 *   - isEmptyResponse: Boolean flag indicating empty/not-found response
 *
 * TTL Rules:
 *   - Normal responses (event found): Cached for entire cycle (cleared at cycle start)
 *   - Empty responses (event not active): TTL = 60s (retry sooner for time-sensitive events)
 *
 * Usage:
 *   - Cleared at cycle start by calling clearLeaderboardCache()
 *   - Automatically hit when multiple contests reference same eventId
 *   - No setup needed; transparent to callers
 */
const leaderboardCache = new Map();
const EMPTY_RESPONSE_TTL_MS = 60 * 1000; // 60 second TTL for "event not found" responses

/**
 * Clear the leaderboard cache.
 * Called at the start of each ingestion cycle to prevent stale data.
 *
 * @returns {void}
 */
function clearLeaderboardCache() {
  leaderboardCache.clear();
}

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
      httpsAgent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.espn.com/',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
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
 * Deterministic event filtering: Fetches PGA scoreboard and filters to the exact
 * requested eventId. No fallback to other events (fail-safe for contest integrity).
 *
 * Timing-aware: Returns empty events array if event not yet active in ESPN scoreboard
 * (expected for SCHEDULED contests). Short TTL on empty responses allows retry.
 *
 * Checks in-cycle cache first to prevent duplicate ESPN API calls. Empty responses
 * have TTL of 60s (retry soon for time-sensitive events).
 *
 * @param {Object} options
 *   {
 *     eventId: string (ESPN event ID, e.g., "401811938")
 *     timeout: number (ms, default 15000)
 *   }
 * @returns {Promise<Object>} ESPN filtered response:
 *   - If event found: { events: [event] }
 *   - If event not active: { events: [] } (with 60s TTL)
 * @throws {Error} If ESPN API call fails (after retries)
 */
async function fetchLeaderboard({ eventId, timeout = 15000 }) {
  if (!eventId) {
    throw new Error('fetchLeaderboard: eventId is required');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Check cache first (with TTL for empty responses)
  // ─────────────────────────────────────────────────────────────────────────────
  if (leaderboardCache.has(eventId)) {
    const cacheEntry = leaderboardCache.get(eventId);
    const now = Date.now();
    const age = now - cacheEntry.timestamp;

    // Empty responses have short TTL (60s) to allow quick retry when event becomes active
    if (cacheEntry.isEmptyResponse && age > EMPTY_RESPONSE_TTL_MS) {
      logger.debug(
        `[espnPgaApi] Empty cache entry expired for eventId=${eventId} (age=${age}ms, TTL=${EMPTY_RESPONSE_TTL_MS}ms), refetching`
      );
      leaderboardCache.delete(eventId);
    } else {
      // Cache hit (either normal response or empty response within TTL)
      logger.debug(
        `[espnPgaApi] Cache HIT for leaderboard: eventId=${eventId}, isEmptyResponse=${cacheEntry.isEmptyResponse}`
      );
      return cacheEntry.data;
    }
  }

  logger.info(`[espnPgaApi] Fetching leaderboard: eventId=${eventId}`);

  return withRetry(async () => {
    const url = `https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard`;

    const response = await axios.get(url, {
      timeout,
      httpsAgent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.espn.com/',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });

    // ───────────────────────────────────────────────────────────────────────────
    // DETERMINISTIC EVENT FILTERING (no fallback, no events[0])
    // Pattern: Same as espnPgaPlayerService.fetchTournamentField()
    // ───────────────────────────────────────────────────────────────────────────
    const scoreboardEvents = response.data.events || [];
    const targetEvent = scoreboardEvents.find(e => String(e.id) === String(eventId));

    if (!targetEvent) {
      // Event not yet active in ESPN scoreboard (expected for SCHEDULED contests)
      // Return empty events array (not fallback to events[0], not throw)
      // Will retry with 60s TTL when next cycle runs
      const availableEventIds = scoreboardEvents.map(e => e.id).join(',') || 'none';

      logger.warn(
        '[espnPgaApi] Event not found in scoreboard',
        {
          event_id: eventId,
          available_event_ids: availableEventIds,
          scoreboard_events_count: scoreboardEvents.length,
          reason: 'Event likely not yet active in ESPN broadcast window'
        }
      );

      // Return empty response with short TTL (60s) to allow retry when event becomes active
      const emptyResponse = { events: [] };
      leaderboardCache.set(eventId, {
        data: emptyResponse,
        timestamp: Date.now(),
        isEmptyResponse: true
      });
      return emptyResponse;
    }

    logger.info(
      `[espnPgaApi] Leaderboard fetched and filtered: eventId=${eventId}, competitors=${targetEvent.competitions?.[0]?.competitors?.length || 0}`
    );

    // Success: Return ONLY the requested event (wrapped in events array for ingestion compatibility)
    const filteredResponse = { events: [targetEvent] };

    // Cache with normal scope (entire cycle, cleared at start of next cycle)
    leaderboardCache.set(eventId, {
      data: filteredResponse,
      timestamp: Date.now(),
      isEmptyResponse: false
    });

    return filteredResponse;
  }, 3);
}

/**
 * Fetch ESPN event metadata (completion status, tournament info).
 *
 * This endpoint provides the authoritative tournament completion signal via
 * status.type.completed. This is separate from the leaderboard endpoint and
 * is used to determine if a contest should move to COMPLETE state.
 *
 * @param {Object} options
 *   {
 *     eventId: string (ESPN event ID, e.g., "401811941")
 *     timeout: number (ms, default 5000)
 *   }
 * @returns {Promise<Object>} ESPN event metadata { status: {type: {completed, name}}, ... }
 * @throws {Error} If fetch fails (after retries or non-transient error)
 */
async function fetchEventMetadata({ eventId, timeout = 5000 }) {
  if (!eventId) {
    throw new Error('fetchEventMetadata: eventId is required');
  }

  logger.info(`[espnPgaApi] Fetching event metadata: eventId=${eventId}`);

  return withRetry(async () => {
    const url = `https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/${eventId}`;

    const response = await axios.get(url, {
      timeout,
      httpsAgent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.espn.com/',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });

    logger.info(
      `[espnPgaApi] Event metadata fetched: eventId=${eventId}, completed=${response.data.status?.type?.completed || false}`
    );

    return response.data;
  }, 3);
}

module.exports = {
  fetchCalendar,
  fetchLeaderboard,
  fetchEventMetadata,
  clearLeaderboardCache,
  withRetry, // Export for testing
  parseRetryAfter // Export for testing
};
