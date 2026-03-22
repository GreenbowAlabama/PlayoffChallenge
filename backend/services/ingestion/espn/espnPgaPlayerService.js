/**
 * ESPN PGA Player Service
 *
 * Responsibilities:
 * - Fetch PGA golfers from ESPN API
 * - Normalize golfer data into platform format
 * - Return structured player objects
 *
 * Non-responsibilities:
 * - No database access
 * - No persistence
 * - No filtering or business logic
 */

'use strict';

const axios = require('axios');

// Cache debug logging is OFF by default (prod mode)
// ONLY enable with explicit ESPN_CACHE_DEBUG=true env var
const DEBUG = process.env.ESPN_CACHE_DEBUG === 'true' && process.env.NODE_ENV !== 'production';

const logger = {
  debug: (msg) => {
    if (DEBUG) console.debug(msg);
  },
  error: (msg) => console.error(msg),
  info: (msg) => console.info(msg),
  warn: (msg) => console.warn(msg)
};

const httpsAgent = require('../../../utils/httpAgent');

// ===== PER-CYCLE FIELD CACHE (Promise-based for concurrency safety) =====
// Stores Promises so concurrent calls for the same key deduplicate to a single HTTP request.
// Cache keys: `field_${eventId}` (fetchTournamentField) or '__all__' (fetchGolfers)
// Cleared at cycle start via clearFieldCache()
const fieldCache = new Map();

/**
 * Clear the per-cycle field cache.
 * Called at the start of each ingestion cycle via ingestionService.resetCycleCache().
 */
function clearFieldCache() {
  fieldCache.clear();
}

/**
 * Fetch golfers from ESPN PGA scoreboard endpoint.
 *
 * The scoreboard endpoint is preferred because it returns all tournaments and
 * their competitors, which is reliable even before a tournament begins.
 * The legacy athletes endpoint returns 404 in pre-tournament states.
 *
 * @returns {Promise<Array>} Array of normalized golfer objects
 * @throws {Error} If ESPN API call fails
 */
async function fetchGolfers() {
  const cacheKey = '__all__';

  if (fieldCache.has(cacheKey)) {
    logger.debug(`[CACHE HIT] key=${cacheKey}`);
    return fieldCache.get(cacheKey);
  }

  logger.debug(`[CACHE MISS] key=${cacheKey}`);

  const promise = (async () => {
    const response = await axios.get(
      'https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard',
      {
        timeout: 10000,
        httpsAgent,
        headers: {
          'User-Agent': 'playoff-challenge/2.0'
        }
      }
    );

    const competitors = [];
    const events = response.data.events || [];

    for (const event of events) {
      const competitions = event.competitions || [];
      for (const competition of competitions) {
        const competitorList = competition.competitors || [];
        competitors.push(...competitorList);
      }
    }

    const normalized = competitors
      .map(competitor => normalizeGolfer(competitor))
      .filter(golfer => golfer !== null);

    logger.debug(`[espnPgaPlayerService] Fetched ${normalized.length} golfers`);

    // Replace in-flight promise with resolved value
    fieldCache.set(cacheKey, Promise.resolve(normalized));
    logger.debug(`[CACHE STORE] key=${cacheKey}`);
    return normalized;
  })();

  fieldCache.set(cacheKey, promise);

  try {
    return await promise;
  } catch (err) {
    fieldCache.delete(cacheKey);
    logger.error('[espnPgaPlayerService] Error fetching golfers:', err.message);
    throw err;
  }
}

/**
 * Fetch tournament field from ESPN PGA scoreboard endpoint.
 *
 * Strategy:
 * 1. Fetch scoreboard (always contains live tournament data and competitors)
 * 2. Locate the exact event by ID
 * 3. Extract competitors from that event
 * 4. Throw if event not found (strict matching required)
 *
 * Note: The leaderboard endpoint returns empty competitors even during
 * live tournaments. Scoreboard is the reliable source for PGA field data.
 *
 * @param {string} eventId - ESPN event ID (e.g., '401811937')
 * @returns {Promise<Array>} Array of normalized golfer objects
 * @throws {Error} If eventId is missing, event not found, or fetch fails
 */
async function fetchTournamentField(eventId) {
  if (!eventId) {
    throw new Error('fetchTournamentField: eventId is required');
  }

  const cacheKey = `field_${eventId}`;

  if (fieldCache.has(cacheKey)) {
    logger.debug(`[CACHE HIT] key=${cacheKey}`);
    return fieldCache.get(cacheKey);
  }

  logger.debug(`[CACHE MISS] key=${cacheKey}`);

  const promise = (async () => {
    const scoreboardResponse = await axios.get(
      'https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard',
      {
        timeout: 10000,
        httpsAgent,
        headers: {
          'User-Agent': 'playoff-challenge/2.0'
        }
      }
    );

    const scoreboardEvents = scoreboardResponse.data.events || [];
    const targetEvent = scoreboardEvents.find(e => e.id === eventId);

    if (!targetEvent) {
      // Event not found — return empty array but do NOT cache (allow retry)
      logger.debug(`[espnPgaPlayerService] Event ${eventId} not yet available in ESPN scoreboard`);
      fieldCache.delete(cacheKey);
      return [];
    }

    let competitors = [];
    const competitions = targetEvent.competitions || [];
    for (const competition of competitions) {
      const competitorList = competition.competitors || [];
      competitors.push(...competitorList);
    }

    const normalized = competitors
      .map(competitor => normalizeGolfer(competitor))
      .filter(golfer => golfer !== null);

    logger.debug(`[espnPgaPlayerService] Fetched ${normalized.length} golfers for event ${eventId}`);

    // Replace in-flight promise with resolved value
    fieldCache.set(cacheKey, Promise.resolve(normalized));
    logger.debug(`[CACHE STORE] key=${cacheKey}`);
    return normalized;
  })();

  fieldCache.set(cacheKey, promise);

  try {
    return await promise;
  } catch (err) {
    // Never cache failures
    fieldCache.delete(cacheKey);

    if (err.message.includes('not found in scoreboard')) {
      logger.debug(`[espnPgaPlayerService] Event ${eventId} not yet available in ESPN scoreboard`);
      return [];
    }

    logger.error(`[espnPgaPlayerService] Error fetching tournament field for event ${eventId}:`, err.message);
    throw err;
  }
}

/**
 * Normalize a single ESPN competitor (with athlete data) into platform player format.
 *
 * ESPN scoreboard structure:
 * {
 *   id: '12345',           // ← Player ID is here (not on athlete)
 *   athlete: {
 *     displayName: 'Name',
 *     fullName: 'Full Name',
 *     headshot: { href: '...' }
 *   }
 * }
 *
 * @param {Object} competitor - ESPN competitor object (has id + nested athlete)
 * @returns {Object|null} Normalized player object, or null if required fields missing
 */
function normalizeGolfer(competitor) {
  if (!competitor) {
    return null;
  }

  // STRATEGY 1: Try to extract ID from competitor wrapper level (ESPN scoreboard structure)
  let athleteId = competitor.id || competitor.athleteId;

  // STRATEGY 2: Fallback - try athlete.id (backward compat if some responses have it there)
  if (!athleteId && competitor.athlete) {
    athleteId = competitor.athlete.id || competitor.athlete.athleteId;
  }

  // STRATEGY 3: Fallback - try athlete.person.id (if athlete has nested person object)
  if (!athleteId && competitor.athlete?.person) {
    athleteId = competitor.athlete.person.id;
  }

  // Guard: require an ID from somewhere
  if (!athleteId) {
    return null;
  }

  // Extract athlete object (either from competitor or passed directly)
  const athlete = competitor.athlete || competitor;
  if (!athlete) {
    return null;
  }

  // Derive display name from available fields with correct fallback order
  // ESPN API may provide: displayName, fullName, shortName, or firstName+lastName
  const name =
    athlete.displayName ||
    athlete.fullName ||
    athlete.shortName ||
    (athlete.firstName && athlete.lastName
      ? `${athlete.firstName} ${athlete.lastName}`
      : null) ||
    athlete.firstName ||
    'Unknown';

  // Deterministic image URL construction (no ESPN response dependency)
  const imageUrl = `https://a.espncdn.com/i/headshots/golf/players/full/${athleteId}.png`;

  return {
    external_id: athleteId,
    name: name,
    image_url: imageUrl,
    sport: 'GOLF',
    position: 'G'
  };
}

module.exports = {
  fetchGolfers,
  fetchTournamentField,
  normalizeGolfer,
  clearFieldCache
};
