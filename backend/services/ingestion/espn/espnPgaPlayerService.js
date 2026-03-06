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

    logger.info(`[espnPgaPlayerService] Fetched ${competitors.length} golfers from scoreboard`);

    // EMERGENCY DEBUG: Show first competitor structure from scoreboard
    if (competitors.length > 0) {
      const firstCompetitor = competitors[0];
      console.log('[EMERGENCY-SCOREBOARD] First competitor from scoreboard:', JSON.stringify(firstCompetitor, null, 2).substring(0, 2000));
      console.log('[EMERGENCY-SCOREBOARD-IDS] ID fields in first competitor:', {
        'competitor.id': firstCompetitor.id,
        'competitor.athleteId': firstCompetitor.athleteId,
        'competitor.athlete?.id': firstCompetitor.athlete?.id,
        'competitor.athlete?.person?.id': firstCompetitor.athlete?.person?.id,
        'all_competitor_keys': Object.keys(firstCompetitor).sort()
      });
    }

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
      // EMERGENCY DEBUG: Show raw ESPN athlete structure
      console.log('[EMERGENCY-DEBUG] Leaderboard first athlete keys:', Object.keys(leaderboardCompetitors[0].athlete || {}));
      console.log('[EMERGENCY-DEBUG] Leaderboard first athlete:', JSON.stringify(leaderboardCompetitors[0].athlete, null, 2).substring(0, 500));

      const normalized = leaderboardCompetitors
        .map(competitor => normalizeGolfer(competitor))
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

    // Extract competitors from scoreboard
    const scoreboardEvents = scoreboardResponse.data.events || [];
    console.log('[EMERGENCY-DEBUG] Scoreboard has', scoreboardEvents.length, 'events');

    let competitors = [];

    // Strategy 1: Try to find exact event match by ID
    const targetEvent = scoreboardEvents.find(e => e.id === eventId);
    if (targetEvent) {
      console.log('[EMERGENCY-DEBUG] Found exact event match for', eventId);
      const competitions = targetEvent.competitions || [];
      for (const competition of competitions) {
        const competitorList = competition.competitors || [];
        competitors.push(...competitorList);
      }
    }

    // Strategy 2: If no exact match, extract from ALL events (fallback for edge cases)
    if (competitors.length === 0) {
      console.log('[EMERGENCY-DEBUG] No competitors found for', eventId, '- trying all events');
      for (const event of scoreboardEvents) {
        const competitions = event.competitions || [];
        for (const competition of competitions) {
          const competitorList = competition.competitors || [];
          competitors.push(...competitorList);
        }
      }
      if (competitors.length > 0) {
        console.log('[EMERGENCY-DEBUG] Extracted', competitors.length, 'competitors from all events');
      }
    }

    // EMERGENCY DEBUG: Show full ESPN competitor structure including ID fields
    if (competitors.length > 0) {
      const competitor = competitors[0];
      console.log('[EMERGENCY-DEBUG-FULL] First competitor COMPLETE structure:', JSON.stringify(competitor, null, 2).substring(0, 2000));
      console.log('[EMERGENCY-DEBUG-IDS] Competitor ID extraction:',{
        'competitor.id': competitor.id,
        'competitor.athleteId': competitor.athleteId,
        'competitor.athlete?.id': competitor.athlete?.id,
        'competitor.athlete?.athleteId': competitor.athlete?.athleteId,
        'competitor.athlete?.person?.id': competitor.athlete?.person?.id,
        'competitor.status?.id': competitor.status?.id,
        'all_competitor_keys': Object.keys(competitor).sort(),
        'all_athlete_keys': competitor.athlete ? Object.keys(competitor.athlete).sort() : 'no athlete object'
      });
    } else {
      console.log('[EMERGENCY-DEBUG] NO COMPETITORS FOUND - returning empty array');
    }

    const normalized = competitors
      .map(competitor => normalizeGolfer(competitor))
      .filter(golfer => golfer !== null);
    logger.info(`[espnPgaPlayerService] Using scoreboard fallback: ${normalized.length} valid golfers for event ${eventId}`);

    return normalized;
  } catch (err) {
    logger.error(`[espnPgaPlayerService] Error fetching tournament field (both leaderboard and scoreboard failed) for event ${eventId}:`, err.message);
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

  // EMERGENCY DEBUG: Log extraction details
  const athleteName = competitor.athlete?.displayName || competitor.athlete?.fullName || 'UNKNOWN';
  if (!athleteId) {
    console.log('[EMERGENCY-NORMALIZE] Failed to extract ID for athlete:', {
      name: athleteName,
      competitor_keys: Object.keys(competitor).sort(),
      athlete_keys: competitor.athlete ? Object.keys(competitor.athlete).sort() : 'N/A',
      attempted_paths: {
        'competitor.id': competitor.id,
        'competitor.athleteId': competitor.athleteId,
        'competitor.athlete?.id': competitor.athlete?.id,
        'competitor.athlete?.athleteId': competitor.athlete?.athleteId,
        'competitor.athlete?.person?.id': competitor.athlete?.person?.id
      }
    });
    return null;
  }

  // Guard: require an ID from somewhere
  if (!athleteId) {
    return null;
  }

  console.log('[EMERGENCY-NORMALIZE] Successfully extracted ID:', {
    athleteName,
    athleteId,
    from: athleteId === competitor.id ? 'competitor.id' :
          athleteId === competitor.athleteId ? 'competitor.athleteId' :
          athleteId === competitor.athlete?.id ? 'competitor.athlete.id' :
          athleteId === competitor.athlete?.athleteId ? 'competitor.athlete.athleteId' :
          athleteId === competitor.athlete?.person?.id ? 'competitor.athlete.person.id' : 'UNKNOWN'
  });

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
