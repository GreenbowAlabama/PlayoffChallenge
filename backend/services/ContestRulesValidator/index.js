/**
 * Contest Rules Validator Service
 *
 * Validates roster entries against contest configuration and available players.
 * Enforces:
 * - Exact roster size matching
 * - No duplicate players
 * - All players exist in validated field
 */

/**
 * Validate a roster against contest rules.
 *
 * @param {Array<string>} roster - Array of player IDs
 * @param {Object} config - Contest configuration with roster_size
 * @param {Array<Object>} validField - Array of valid players with player_id property
 * @returns {Object} { valid: boolean, errors: [string] }
 */
function validateRoster(roster, config, validField) {
  const errors = [];

  // Input validation: roster must be an array
  if (!Array.isArray(roster)) {
    errors.push('Roster must be an array');
  }

  // Input validation: config must exist
  if (!config) {
    errors.push('Config is required');
    return { valid: false, errors };
  }

  // Input validation: validField must be an array
  if (!Array.isArray(validField)) {
    errors.push('validField must be an array');
  }

  // Config validation: roster_size must exist
  if (!config.hasOwnProperty('roster_size')) {
    errors.push('Config must have roster_size property');
  }

  // Config validation: roster_size must be a positive number
  if (typeof config.roster_size !== 'number' || config.roster_size <= 0) {
    errors.push('roster_size must be a positive number');
  }

  // If we have config validation errors, return early
  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Roster size validation: must be within range [0, roster_size]
  // Allow partial roster submission for incremental lineup building
  if (roster.length > config.roster_size) {
    errors.push(`Roster size must be between 0 and ${config.roster_size}, got ${roster.length}`);
  }

  // Duplicate detection
  const playerCounts = {};
  const duplicates = [];
  for (const playerId of roster) {
    playerCounts[playerId] = (playerCounts[playerId] || 0) + 1;
  }
  for (const [playerId, count] of Object.entries(playerCounts)) {
    if (count > 1) {
      duplicates.push(playerId);
    }
  }
  if (duplicates.length > 0) {
    errors.push(`Duplicate players: ${duplicates.join(', ')}`);
  }

  // Player existence validation: all players must be in validField
  const validPlayerIds = new Set(validField.map(p => p.player_id));
  const notFound = [];
  for (const playerId of roster) {
    if (!validPlayerIds.has(playerId)) {
      notFound.push(playerId);
    }
  }
  if (notFound.length > 0) {
    errors.push(`Players not in validated field: ${notFound.join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = {
  validateRoster
};
