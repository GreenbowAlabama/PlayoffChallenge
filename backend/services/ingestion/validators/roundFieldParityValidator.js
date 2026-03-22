/**
 * Round Field Parity Validator
 *
 * Ensures that partial rounds (incomplete field coverage) never get persisted to golfer_event_scores.
 *
 * DETERMINISTIC BASELINE:
 * Baseline golfer count comes ONLY from field_selections.selection_json.primary
 * This is the authoritative player pool established during FIELD_BUILD phase.
 *
 * RULE:
 * For a given contest_instance_id:
 * - Query field_selections for the established field size
 * - ALL incoming rounds must have EXACTLY this golfer count
 * - If field_selections doesn't exist → BLOCK ingestion (not ready)
 * - If any round doesn't match → REJECT (partial or corrupt)
 *
 * NO INFERENCE. NO HEURISTICS. BASELINE NEVER CHANGES.
 *
 * LOGGING:
 * Every rejection includes contest_instance_id, round_number, incoming_count, baseline_count
 */

'use strict';

const logger = require('../../../utils/logger');

/**
 * Validate incoming scores for field parity before persistence.
 *
 * Queries field_selections to get the deterministic baseline golfer count.
 * For each incoming round, enforces exact match against baseline.
 * Rejects all partial/mismatched rounds (all-or-nothing per round).
 *
 * @param {Array} normalizedScores - Incoming score objects with round_number, golfer_id, etc.
 * @param {string} contestInstanceId - Contest UUID
 * @param {PgClient} dbClient - Database client to query field_selections baseline
 * @returns {Promise<Object>} {
 *   validScores: Array (only rounds that matched baseline),
 *   rejectedRounds: Array<{ round_number, incoming_count, baseline_count, reason }>,
 *   baselineGolferCount: number (from field_selections, or null if not ready)
 * }
 */
async function validateRoundParity(normalizedScores, contestInstanceId, dbClient) {
  if (!normalizedScores || normalizedScores.length === 0) {
    return { validScores: [], rejectedRounds: [], baselineGolferCount: null };
  }

  // Step 1: Query the deterministic baseline from field_selections
  // This is set by FIELD_BUILD phase and never changes
  const fieldSelectionsResult = await dbClient.query(
    `
    SELECT jsonb_array_length(selection_json->'primary') as golfer_count
    FROM field_selections
    WHERE contest_instance_id = $1
    `,
    [contestInstanceId]
  );

  // Safety check: field_selections should be unique per contest
  // Multiple rows indicate data integrity violation
  if (fieldSelectionsResult.rows.length > 1) {
    logger.error('[ROUND_PARITY_VALIDATOR] MULTIPLE FIELD_SELECTIONS ROWS (DATA INTEGRITY VIOLATION)', {
      contest_instance_id: contestInstanceId,
      row_count: fieldSelectionsResult.rows.length
    });
  }

  let baseline = null;

  if (fieldSelectionsResult.rows.length === 0) {
    // field_selections not found: PLAYER_POOL hasn't completed yet
    logger.warn('[ROUND_PARITY_VALIDATOR] Blocking ingestion - field not ready', {
      contest_instance_id: contestInstanceId,
      reason: 'field_selections not found'
    });

    // Group by round and create one rejection per round
    const roundGroups = {};
    normalizedScores.forEach(score => {
      if (!roundGroups[score.round_number]) {
        roundGroups[score.round_number] = new Set();
      }
      roundGroups[score.round_number].add(score.golfer_id);
    });

    const rejectedRounds = Object.entries(roundGroups).map(([round, golfers]) => ({
      round_number: parseInt(round),
      incoming_golfer_count: golfers.size,
      baseline_golfer_count: null,
      reason: 'field_selections not ready (PLAYER_POOL phase incomplete)'
    }));

    return {
      validScores: [],
      rejectedRounds,
      baselineGolferCount: null
    };
  }

  // Null safety: check if golfer_count field exists and is valid
  if (!fieldSelectionsResult.rows[0] || fieldSelectionsResult.rows[0].golfer_count === null) {
    logger.error('[ROUND_PARITY_VALIDATOR] INVALID FIELD_SELECTIONS SHAPE', {
      contest_instance_id: contestInstanceId,
      reason: 'golfer_count field is null or missing'
    });

    // Group by round and create one rejection per round
    const roundGroups = {};
    normalizedScores.forEach(score => {
      if (!roundGroups[score.round_number]) {
        roundGroups[score.round_number] = new Set();
      }
      roundGroups[score.round_number].add(score.golfer_id);
    });

    const rejectedRounds = Object.entries(roundGroups).map(([round, golfers]) => ({
      round_number: parseInt(round),
      incoming_golfer_count: golfers.size,
      baseline_golfer_count: null,
      reason: 'field_selections primary array is invalid or empty'
    }));

    return {
      validScores: [],
      rejectedRounds,
      baselineGolferCount: null
    };
  }

  // Strict type safety: ensure baseline is a valid positive integer
  baseline = parseInt(fieldSelectionsResult.rows[0].golfer_count, 10);

  if (Number.isNaN(baseline) || baseline <= 0) {
    logger.error('[ROUND_PARITY_VALIDATOR] INVALID BASELINE VALUE', {
      contest_instance_id: contestInstanceId,
      baseline_value: baseline,
      reason: 'baseline is NaN or <= 0'
    });

    // Group by round and create one rejection per round
    const roundGroups = {};
    normalizedScores.forEach(score => {
      if (!roundGroups[score.round_number]) {
        roundGroups[score.round_number] = new Set();
      }
      roundGroups[score.round_number].add(score.golfer_id);
    });

    const rejectedRounds = Object.entries(roundGroups).map(([round, golfers]) => ({
      round_number: parseInt(round),
      incoming_golfer_count: golfers.size,
      baseline_golfer_count: baseline,
      reason: 'baseline is invalid (NaN or <= 0)'
    }));

    return {
      validScores: [],
      rejectedRounds,
      baselineGolferCount: baseline
    };
  }

  if (baseline <= 0) {
    // field_selections exists but is empty: something is wrong
    logger.warn('[ROUND_PARITY_VALIDATOR] Blocking ingestion - empty field', {
      contest_instance_id: contestInstanceId,
      baseline_golfer_count: baseline,
      reason: 'field_selections primary array is empty'
    });

    // Group by round and create one rejection per round
    const roundGroups = {};
    normalizedScores.forEach(score => {
      if (!roundGroups[score.round_number]) {
        roundGroups[score.round_number] = new Set();
      }
      roundGroups[score.round_number].add(score.golfer_id);
    });

    const rejectedRounds = Object.entries(roundGroups).map(([round, golfers]) => ({
      round_number: parseInt(round),
      incoming_golfer_count: golfers.size,
      baseline_golfer_count: baseline,
      reason: 'field_selections primary array is empty'
    }));

    return {
      validScores: [],
      rejectedRounds,
      baselineGolferCount: baseline
    };
  }

  // Step 2: Group incoming scores by round_number and count golfers per round
  const roundGroups = {};
  normalizedScores.forEach(score => {
    const roundNum = Number(score.round_number);
    if (!roundGroups[roundNum]) {
      roundGroups[roundNum] = new Set();
    }
    roundGroups[roundNum].add(score.golfer_id);
  });

  // Step 3: Validate each round against deterministic baseline
  const validScores = [];
  const rejectedRounds = [];

  for (const roundNum in roundGroups) {
    const roundNumInt = parseInt(roundNum, 10);
    const incomingGolferCount = roundGroups[roundNum].size;

    if (incomingGolferCount === baseline) {
      // Exact match: accept this round
      normalizedScores
        .filter(s => Number(s.round_number) === roundNumInt)
        .forEach(score => validScores.push(score));
    } else {
      // Mismatch: reject this round (partial or corrupt)
      rejectedRounds.push({
        round_number: roundNumInt,
        incoming_golfer_count: incomingGolferCount,
        baseline_golfer_count: baseline,
        reason: `Field mismatch: ${incomingGolferCount} golfers vs baseline ${baseline}`
      });
    }
  }

  return {
    validScores,
    rejectedRounds,
    baselineGolferCount: baseline
  };
}

module.exports = {
  validateRoundParity
};
