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

    return competitors.map(competitor => normalizeGolfer(competitor.athlete));
  } catch (err) {
    logger.error('[espnPgaPlayerService] Error fetching golfers:', err.message);
    throw err;
  }
}

/**
 * Normalize a single ESPN athlete into platform player format.
 *
 * @param {Object} athlete - ESPN athlete object
 * @returns {Object} Normalized player object
 */
function normalizeGolfer(athlete) {
  return {
    external_id: athlete.id,
    name: athlete.displayName,
    image_url: athlete.headshot?.href || null,
    sport: 'GOLF',
    position: 'G'
  };
}

module.exports = {
  fetchGolfers,
  normalizeGolfer
};
