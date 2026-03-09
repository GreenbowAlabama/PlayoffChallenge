/**
 * Ingestion Strategy Resolver
 *
 * Derives ingestion strategy from provider_tournament_id.
 * No longer relies on sport column.
 *
 * IMPORTANT: provider_tournament_id contains the full provider EVENT identifier
 * (e.g., "espn_pga_401811935"), not a tournament series ID.
 * The field name is semantically confusing but functionally correct.
 * The sport prefix (pga_, nfl_) is required for strategy resolution.
 *
 * Mapping:
 * - espn_pga_* → pga_espn
 * - espn_nfl_* → nfl_espn
 */

'use strict';

/**
 * Extract ESPN event ID from provider_tournament_id
 *
 * Format: espn_{sport}_{eventId}
 * Example: espn_pga_401811937 → 401811937
 *
 * @param {string} providerTournamentId - Full provider tournament ID
 * @returns {string|null} Numeric ESPN event ID or null if format is invalid
 */
function extractEspnEventId(providerTournamentId) {
  if (!providerTournamentId || typeof providerTournamentId !== 'string') {
    return null;
  }

  // Match espn_{sport}_{eventId}
  const match = providerTournamentId.match(/^espn_(?:pga|nfl)_(\d+)$/);
  return match ? match[1] : null;
}

/**
 * Resolve ingestion strategy key from provider_tournament_id
 *
 * @param {string} providerTournamentId - Full provider tournament ID
 * @returns {string|null} Strategy key ('pga_espn' or 'nfl_espn') or null if format is invalid
 * @throws {Error} If provider_tournament_id is missing or format is unrecognized
 */
function resolveStrategyKey(providerTournamentId) {
  if (!providerTournamentId || typeof providerTournamentId !== 'string') {
    throw new Error('provider_tournament_id is required to resolve ingestion strategy');
  }

  if (providerTournamentId.startsWith('espn_pga_')) {
    return 'pga_espn';
  }

  if (providerTournamentId.startsWith('espn_nfl_')) {
    return 'nfl_espn';
  }

  throw new Error(
    `Unrecognized provider_tournament_id format: '${providerTournamentId}'. ` +
    `Expected 'espn_pga_*' or 'espn_nfl_*'`
  );
}

module.exports = {
  extractEspnEventId,
  resolveStrategyKey
};
