/**
 * Apply Stroke Play Scoring
 *
 * Applies stroke-play scoring rules to tournament leaderboard.
 * Pure function that transforms leaderboard results into scores.
 *
 * Stroke play scoring: Lower scores are better. Scores = total strokes.
 *
 * Contract:
 * - Returns mapping of player_id → integer strokes (not ranked positions)
 * - Ranking and tie-breaking handled by settlement layer
 * - Sorting by player_id ensures deterministic key ordering for audit
 * - Accepts only integer strokes (no silent correction)
 *
 * @param {Object} config - Tournament configuration
 * @param {Array} leaderboard - Leaderboard entries with player_id, total_strokes
 * @returns {{ scores: Object }} Scores object mapping player_id → total strokes
 * @throws {Error} If config invalid, leaderboard incomplete, strokes non-integer
 */
function applyStrokePlayScoring(config, leaderboard) {
  const { validateConfig } = require('./validateConfig');

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
  for (let i = 0; i < leaderboard.length; i++) {
    const entry = leaderboard[i];

    // Check for undefined fields (truly missing)
    if (entry.player_id === undefined) {
      throw new Error(
        `Leaderboard entry at index ${i} missing required field: player_id`
      );
    }

    if (entry.total_strokes === undefined) {
      throw new Error(
        `Leaderboard entry at index ${i} (player_id: ${entry.player_id || 'UNKNOWN'}) ` +
        `missing required field: total_strokes`
      );
    }

    // Validate total_strokes is a non-negative integer (no silent flooring)
    if (entry.total_strokes === null) {
      throw new Error(
        `Leaderboard entry for player_id ${entry.player_id} has invalid total_strokes: null`
      );
    }

    if (typeof entry.total_strokes !== 'number') {
      throw new Error(
        `Leaderboard entry for player_id ${entry.player_id} has invalid total_strokes type: ${typeof entry.total_strokes}`
      );
    }

    if (Number.isNaN(entry.total_strokes)) {
      throw new Error(
        `Leaderboard entry for player_id ${entry.player_id} has NaN total_strokes`
      );
    }

    if (!Number.isInteger(entry.total_strokes)) {
      throw new Error(
        `Leaderboard entry for player_id ${entry.player_id} has non-integer total_strokes: ${entry.total_strokes}. Strokes must be integers.`
      );
    }

    if (entry.total_strokes < 0) {
      throw new Error(
        `Leaderboard entry for player_id ${entry.player_id} has negative total_strokes: ${entry.total_strokes}`
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
    scores[entry.player_id] = entry.total_strokes;
  }

  return { scores };
}

module.exports = {
  applyStrokePlayScoring
};
