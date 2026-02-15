/**
 * Contest Rules Validator
 *
 * Validates contest-specific roster and player constraints.
 * Pure validation service with no side effects.
 *
 * Iteration 01 scope: roster_size, duplicates, player existence only.
 */

/**
 * Validate a player roster against tournament constraints.
 *
 * @param {Array} roster - Array of player_ids submitted by user
 * @param {Object} config - Tournament configuration
 * @param {Array} validatedField - Array of validated field participants
 * @returns {{ valid: boolean, errors: string[] }} Validation result
 */
function validateRoster(roster, config, validatedField) {
  const errors = [];

  if (!Array.isArray(roster)) {
    errors.push('Roster must be an array');
    return { valid: false, errors };
  }

  if (!config) {
    errors.push('Config is required');
    return { valid: false, errors };
  }

  if (!Array.isArray(validatedField)) {
    errors.push('ValidatedField must be an array');
    return { valid: false, errors };
  }

  // Constraint 1: Roster size must match config
  if (config.roster_size === undefined || config.roster_size === null) {
    errors.push('Config.roster_size is required');
  } else if (typeof config.roster_size !== 'number' || config.roster_size <= 0) {
    errors.push('Config.roster_size must be a positive number');
  } else if (roster.length !== config.roster_size) {
    errors.push(
      `Roster size mismatch: expected ${config.roster_size}, got ${roster.length}`
    );
  }

  // Constraint 2: No duplicates
  const seen = new Set();
  const duplicates = [];
  for (const player_id of roster) {
    if (seen.has(player_id)) {
      duplicates.push(player_id);
    }
    seen.add(player_id);
  }
  if (duplicates.length > 0) {
    errors.push(
      `Duplicate player_ids in roster: ${[...new Set(duplicates)].join(', ')}`
    );
  }

  // Constraint 3: Each player must exist in validated field
  const validatedFieldIds = new Set(validatedField.map(p => p.player_id));
  const unknownPlayers = [];
  for (const player_id of roster) {
    if (!validatedFieldIds.has(player_id)) {
      unknownPlayers.push(player_id);
    }
  }
  if (unknownPlayers.length > 0) {
    errors.push(
      `Players not in validated field: ${unknownPlayers.join(', ')}`
    );
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = {
  validateRoster
};
