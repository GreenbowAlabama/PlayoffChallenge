/**
 * Field Selection
 *
 * Deterministically selects primary field and alternates from participants.
 * Pure function that maintains deterministic ordering via player_id sorting.
 *
 * @param {Object} config - Tournament configuration
 * @param {Array} participants - Participant objects with player_id
 * @returns {{ primary: Array, alternates: Array }} Selected field
 * @throws {Error} If config invalid or participants missing required fields
 */
function selectField(config, participants) {
  const { validateConfig } = require('./validateConfig');

  // Validate config first
  const validation = validateConfig(config);
  if (!validation.valid) {
    throw new Error(`Invalid config for field selection: ${validation.errors.join('; ')}`);
  }

  if (!Array.isArray(participants)) {
    throw new Error('Participants must be an array');
  }

  if (participants.length === 0) {
    return { primary: [], alternates: [] };
  }

  // Validate all participants have required fields
  for (let i = 0; i < participants.length; i++) {
    const p = participants[i];
    if (!p.player_id || typeof p.player_id !== 'string') {
      throw new Error(`Participant at index ${i} missing player_id`);
    }
  }

  // Sort deterministically by player_id
  const sorted = [...participants].sort((a, b) => {
    if (a.player_id < b.player_id) return -1;
    if (a.player_id > b.player_id) return 1;
    return 0;
  });

  // In Iteration 01, field selection is simply sorted participants
  // Primary field is all participants (no capacity limits in iteration 01)
  // Alternates are empty (no overflow handling in iteration 01)
  return {
    primary: sorted,
    alternates: []
  };
}

module.exports = {
  selectField
};
