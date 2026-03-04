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
 * Fetch golfers from ESPN PGA athletes endpoint.
 *
 * @returns {Promise<Array>} Array of normalized golfer objects
 * @throws {Error} If ESPN API call fails
 */
async function fetchGolfers() {
  logger.info('[espnPgaPlayerService] Fetching golfers from ESPN...');

  try {
    const response = await axios.get(
      'https://site.web.api.espn.com/apis/v2/sports/golf/pga/athletes',
      {
        timeout: 10000,
        headers: {
          'User-Agent': 'playoff-challenge/2.0'
        }
      }
    );

    const athletes = response.data.athletes || [];
    logger.info(`[espnPgaPlayerService] Fetched ${athletes.length} golfers`);

    return athletes.map(normalizeGolfer);
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
    short_name: athlete.shortName,
    image_url: athlete.headshot?.href || null,
    sport: 'GOLF',
    position: 'G'
  };
}

module.exports = {
  fetchGolfers,
  normalizeGolfer
};
