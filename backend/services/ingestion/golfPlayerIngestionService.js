/**
 * Golf Player Ingestion Service
 *
 * Orchestrates fetching golfers from ESPN and persisting them to the database.
 */

const espnPgaPlayerService = require('./espn/espnPgaPlayerService');
const golfPlayerRepository = require('../../repositories/golfPlayerRepository');

/**
 * Ingest golf players from ESPN
 *
 * Fetches the latest golfer data from ESPN PGA API and upserts them into the database.
 *
 * @param {Pool} pool - Database connection pool
 * @returns {Promise<Object>} Ingestion result with success status and counts
 */
async function ingestGolfPlayers(pool) {
  let golfers = [];

  try {
    // Fetch golfers from ESPN
    golfers = await espnPgaPlayerService.fetchGolfers();

    // Upsert them into the database
    const result = await golfPlayerRepository.upsertGolfPlayers(pool, golfers);

    console.log(`[GolfPlayerIngestion] Ingestion complete: ${JSON.stringify({
      fetched: golfers.length,
      inserted: result.inserted,
      updated: result.updated
    })}`);

    return {
      success: true,
      players_fetched: golfers.length,
      players_inserted: result.inserted,
      players_updated: result.updated
    };
  } catch (error) {
    console.error('[GolfPlayerIngestion] Ingestion failed:', error.message);

    return {
      success: false,
      error: error.message,
      players_fetched: golfers.length
    };
  }
}

module.exports = {
  ingestGolfPlayers
};
