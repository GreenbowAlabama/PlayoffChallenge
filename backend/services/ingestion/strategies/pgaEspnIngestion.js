/**
 * PGA ESPN Ingestion Adapter (Stub)
 *
 * Stub implementation for PGA Tour (Masters) ingestion via ESPN.
 * Not yet implemented — present to allow registry registration
 * and future implementation without touching server.js or the registry.
 *
 * All methods throw NotImplemented until this adapter is built.
 */

function validateConfig() {
  throw new Error("Ingestion adapter 'pga_espn' is not yet implemented");
}

async function getWorkUnits(_ctx) {
  throw new Error("Ingestion adapter 'pga_espn' is not yet implemented");
}

function computeIngestionKey(_contestInstanceId, _unit) {
  throw new Error("Ingestion adapter 'pga_espn' is not yet implemented");
}

async function ingestWorkUnit(_ctx, _unit) {
  throw new Error("Ingestion adapter 'pga_espn' is not yet implemented");
}

async function upsertScores(_ctx, _normalizedScores) {
  throw new Error("Ingestion adapter 'pga_espn' is not yet implemented");
}

module.exports = {
  validateConfig,
  getWorkUnits,
  computeIngestionKey,
  ingestWorkUnit,
  upsertScores
};
