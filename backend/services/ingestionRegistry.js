/**
 * Ingestion Strategy Registry
 *
 * Maps template ingestion_strategy_key values to ingestion adapters.
 * Each adapter implements the ingestion adapter interface:
 *   { validateConfig, getWorkUnits, computeIngestionKey, ingestWorkUnit, upsertScores }
 */

const nflEspnIngestion = require('./ingestion/strategies/nflEspnIngestion');
const pgaEspnIngestion = require('./ingestion/strategies/pgaEspnIngestion');

const ingestionStrategies = Object.freeze({
  'nfl_espn': nflEspnIngestion,
  'pga_espn': pgaEspnIngestion
});

function getIngestionStrategy(key) {
  const strategy = ingestionStrategies[key];
  if (!strategy) {
    throw new Error(`Unknown ingestion strategy: '${key}'. Registered: ${Object.keys(ingestionStrategies).join(', ')}`);
  }
  return strategy;
}

function listIngestionStrategies() {
  return Object.keys(ingestionStrategies);
}

module.exports = { getIngestionStrategy, listIngestionStrategies };
