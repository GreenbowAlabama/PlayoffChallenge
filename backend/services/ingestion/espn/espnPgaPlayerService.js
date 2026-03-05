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

    logger.info(`[espnPgaPlayerService] Fetched ${competitors.length} golfers`);

    const normalized = competitors
      .map(competitor => normalizeGolfer(competitor.athlete))
      .filter(golfer => golfer !== null);

    return normalized;
  } catch (err) {
    logger.error('[espnPgaPlayerService] Error fetching golfers:', err.message);
    throw err;
  }
}

/**
 * Fetch tournament field from ESPN PGA endpoints with smart fallback.
 *
 * Strategy:
 * 1. Try leaderboard endpoint (has tee times, starting positions)
 * 2. If leaderboard is empty or fails → fallback to scoreboard (always has field)
 * 3. Both endpoints return competitors in same structure (athlete object)
 *
 * This handles pre-tournament scenarios where leaderboard is empty.
 *
 * @param {string} eventId - ESPN event ID (e.g., '401811937')
 * @returns {Promise<Array>} Array of normalized golfer objects
 * @throws {Error} If eventId is missing or both endpoints fail
 */
async function fetchTournamentField(eventId) {
  if (!eventId) {
    throw new Error('fetchTournamentField: eventId is required');
  }

  logger.info(`[espnPgaPlayerService] Fetching tournament field for event ${eventId}...`);

  let leaderboardCompetitors = [];
  let leaderboardAvailable = false;

  // Step 1: Try leaderboard first (returns field for a specific tournament)
  try {
    const leaderboardResponse = await axios.get(
      `https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard?event=${eventId}`,
      {
        timeout: 10000,
        headers: {
          'User-Agent': 'playoff-challenge/2.0'
        }
      }
    );

    leaderboardCompetitors = leaderboardResponse.data.events?.[0]?.competitions?.[0]?.competitors || [];
    leaderboardAvailable = true;

    // Step 2: Use leaderboard if it has competitors
    if (leaderboardCompetitors.length > 0) {
      // DEBUG: Log raw leaderboard structure
      console.log('[DEBUG-LEADERBOARD] Total competitors fetched:', leaderboardCompetitors.length);
      if (leaderboardCompetitors.length > 0) {
        console.log('[DEBUG-LEADERBOARD] First competitor keys:', Object.keys(leaderboardCompetitors[0]));
        console.log('[DEBUG-LEADERBOARD] First athlete keys:', Object.keys(leaderboardCompetitors[0].athlete || {}));
        console.log('[DEBUG-LEADERBOARD] First athlete:', JSON.stringify(leaderboardCompetitors[0].athlete, null, 2).slice(0, 800));
      }

      const normalized = leaderboardCompetitors
        .map((competitor, idx) => {
          const result = normalizeGolfer(competitor.athlete);
          if (!result) {
            console.log(`[DEBUG-FILTERED] Leaderboard golfer ${idx} rejected. Athlete:`, JSON.stringify(competitor.athlete, null, 2).slice(0, 500));
          }
          return result;
        })
        .filter(golfer => golfer !== null);
      logger.info(`[espnPgaPlayerService] Using leaderboard endpoint: ${normalized.length} valid golfers for event ${eventId}`);
      return normalized;
    }
  } catch (err) {
    logger.warn(`[espnPgaPlayerService] Leaderboard fetch failed for event ${eventId}, will try scoreboard: ${err.message}`);
  }

  // Step 3: Fallback to scoreboard if leaderboard is empty or failed (pre-tournament)
  logger.info(`[espnPgaPlayerService] Leaderboard empty or unavailable, falling back to scoreboard for event ${eventId}`);

  try {
    const scoreboardResponse = await axios.get(
      'https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard',
      {
        timeout: 10000,
        headers: {
          'User-Agent': 'playoff-challenge/2.0'
        }
      }
    );

    // Find the specific event matching eventId in scoreboard
    const scoreboardEvents = scoreboardResponse.data.events || [];
    const targetEvent = scoreboardEvents.find(e => e.id === eventId);

    if (!targetEvent) {
      logger.warn(`[espnPgaPlayerService] Event ${eventId} not found in scoreboard`);
      return [];
    }

    // Extract competitors from the specific requested event only
    const competitors = [];
    const competitions = targetEvent.competitions || [];
    for (const competition of competitions) {
      const competitorList = competition.competitors || [];
      competitors.push(...competitorList);
    }

    // DEBUG: Log raw scoreboard structure
    console.log('[DEBUG-SCOREBOARD] Total competitors fetched:', competitors.length);
    if (competitors.length > 0) {
      console.log('[DEBUG-SCOREBOARD] First competitor keys:', Object.keys(competitors[0]));
      console.log('[DEBUG-SCOREBOARD] First competitor structure:', JSON.stringify(competitors[0], null, 2).slice(0, 800));
      if (competitors[0].athlete) {
        console.log('[DEBUG-SCOREBOARD] First athlete keys:', Object.keys(competitors[0].athlete));
        console.log('[DEBUG-SCOREBOARD] First athlete:', JSON.stringify(competitors[0].athlete, null, 2).slice(0, 800));
      } else {
        console.log('[DEBUG-SCOREBOARD] WARNING: competitor.athlete is missing!');
        console.log('[DEBUG-SCOREBOARD] Competitor object:', JSON.stringify(competitors[0], null, 2).slice(0, 800));
      }
    }

    const normalized = competitors
      .map((competitor, idx) => {
        const result = normalizeGolfer(competitor.athlete);
        if (!result) {
          console.log(`[DEBUG-FILTERED] Golfer ${idx} rejected. Athlete:`, JSON.stringify(competitor.athlete, null, 2).slice(0, 500));
        }
        return result;
      })
      .filter(golfer => golfer !== null);
    logger.info(`[espnPgaPlayerService] Using scoreboard fallback: ${normalized.length} valid golfers for event ${eventId}`);

    return normalized;
  } catch (err) {
    logger.error(`[espnPgaPlayerService] Error fetching tournament field (both leaderboard and scoreboard failed) for event ${eventId}:`, err.message);
    throw err;
  }
}

/**
 * Normalize a single ESPN athlete into platform player format.
 *
 * @param {Object} athlete - ESPN athlete object
 * @returns {Object|null} Normalized player object, or null if required fields missing
 */
function normalizeGolfer(athlete) {
  if (!athlete) {
    console.log('[DEBUG-NORMALIZE] athlete is null/undefined');
    return null;
  }

  // Guard: require athlete ID
  const athleteId = athlete.id || athlete.athleteId;
  if (!athleteId) {
    console.log('[DEBUG-NORMALIZE] No ID found. id=', athlete.id, 'athleteId=', athlete.athleteId);
    return null;
  }

  // Derive display name from available fields
  // ESPN API may provide: displayName, or firstName+lastName
  let name = athlete.displayName;
  if (!name && athlete.firstName && athlete.lastName) {
    name = `${athlete.firstName} ${athlete.lastName}`;
  }
  if (!name && athlete.firstName) {
    name = athlete.firstName;
  }

  // Guard: require a name
  if (!name) {
    console.log('[DEBUG-NORMALIZE] No name found. displayName=', athlete.displayName, 'firstName=', athlete.firstName, 'lastName=', athlete.lastName);
    return null;
  }

  console.log('[DEBUG-NORMALIZE] SUCCESS: athleteId=', athleteId, 'name=', name);

  return {
    external_id: athleteId,
    name: name,
    image_url: athlete.headshot?.href || null,
    sport: 'GOLF',
    position: 'G'
  };
}

module.exports = {
  fetchGolfers,
  fetchTournamentField,
  normalizeGolfer
};
