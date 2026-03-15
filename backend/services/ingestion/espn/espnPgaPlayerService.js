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

const logger = console; // TODO: Replace with structured logger

const httpsAgent = require('../../utils/httpAgent');

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
  logger.info('[espnPgaPlayerService] Fetching golfers from ESPN...');

  try {
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

    // Extract all competitors from all events and competitions
    const competitors = [];
    const events = response.data.events || [];

    for (const event of events) {
      const competitions = event.competitions || [];
      for (const competition of competitions) {
        const competitorList = competition.competitors || [];
        competitors.push(...competitorList);
      }
    }

    logger.info(`[espnPgaPlayerService] Fetched ${competitors.length} golfers from scoreboard`);

    const normalized = competitors
      .map(competitor => normalizeGolfer(competitor))
      .filter(golfer => golfer !== null);

    logger.info(`[espnPgaPlayerService] Normalized ${normalized.length} of ${competitors.length} fetched golfers (${competitors.length - normalized.length} skipped due to missing IDs)`);

    return normalized;
  } catch (err) {
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

  logger.info(`[espnPgaPlayerService] Fetching tournament field for event ${eventId} from scoreboard...`);

  try {
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

    // Extract competitors from scoreboard
    const scoreboardEvents = scoreboardResponse.data.events || [];

    // Find exact event match by ID (no fallback to other events)
    const targetEvent = scoreboardEvents.find(e => e.id === eventId);
    if (!targetEvent) {
      throw new Error(`Event ${eventId} not found in scoreboard`);
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

    logger.info(`[espnPgaPlayerService] Fetched ${normalized.length} valid golfers for event ${eventId} from scoreboard`);

    return normalized;
  } catch (err) {
    // If event not found in scoreboard (expected for SCHEDULED tournaments), log at debug level
    if (err.message.includes('not found in scoreboard')) {
      logger.debug(`[espnPgaPlayerService] Event ${eventId} not yet available in ESPN scoreboard`);
      return [];
    }

    // For actual network/API errors, log at error level
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

  // Derive display name from available fields
  // ESPN API may provide: displayName, fullName, or firstName+lastName
  let name = athlete.displayName || athlete.fullName;
  if (!name && athlete.firstName && athlete.lastName) {
    name = `${athlete.firstName} ${athlete.lastName}`;
  }
  if (!name && athlete.firstName) {
    name = athlete.firstName;
  }

  // Guard: require a name
  if (!name) {
    return null;
  }

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
  normalizeGolfer
};
