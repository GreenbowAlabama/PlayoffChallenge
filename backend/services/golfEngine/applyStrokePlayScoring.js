/**
 * Apply Stroke Play Scoring
 *
 * Applies stroke-play scoring rules to tournament leaderboard.
 * Pure function that transforms leaderboard results into scores.
 *
 * Stroke play scoring: Lower scores are better. Scores = total strokes.
 *
 * @param {Object} config - Tournament configuration
 * @param {Array} leaderboard - Leaderboard entries with player_id, round scores
 * @param {Object} results - Contest results (metadata, not used in Iteration 01)
 * @returns {{ scores: Object }} Scores object mapping player_id → total strokes
 * @throws {Error} If config invalid, leaderboard incomplete, or results missing required players
 */
function applyStrokePlayScoring(config, leaderboard, results) {
  const { validateConfig } = require('./validateConfig');
  const { selectField } = require('./selectField');

  // Validate config first
  const validation = validateConfig(config);
  if (!validation.valid) {
    throw new Error(`Invalid config for scoring: ${validation.errors.join('; ')}`);
  }

  if (!Array.isArray(leaderboard)) {
    throw new Error('Leaderboard must be an array');
  }

  if (leaderboard.length === 0) {
    return { scores: {} };
  }

  // Validate all leaderboard entries have required fields
  const requiredLeaderboardFields = ['player_id', 'total_strokes'];
  for (let i = 0; i < leaderboard.length; i++) {
    const entry = leaderboard[i];

    for (const field of requiredLeaderboardFields) {
      if (entry[field] === undefined || entry[field] === null) {
        throw new Error(
          `Leaderboard entry at index ${i} (player_id: ${entry.player_id || 'UNKNOWN'}) ` +
          `missing required field: ${field}`
        );
      }
    }

    // Validate total_strokes is a number
    if (typeof entry.total_strokes !== 'number' || entry.total_strokes < 0) {
      throw new Error(
        `Leaderboard entry for player_id ${entry.player_id} has invalid total_strokes: ${entry.total_strokes}`
      );
    }
  }

  // Build scores object with deterministic ordering (sorted by player_id)
  const scores = {};
  const sorted = [...leaderboard].sort((a, b) => {
    if (a.player_id < b.player_id) return -1;
    if (a.player_id > b.player_id) return 1;
    return 0;
  });

  for (const entry of sorted) {
    scores[entry.player_id] = Math.floor(entry.total_strokes);
  }

  return { scores };
}

module.exports = {
  applyStrokePlayScoring
};
