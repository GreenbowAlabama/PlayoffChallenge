/**
 * PGA Standard Scoring Strategy
 *
 * Converts a normalized golf round payload into per-golfer fantasy point totals.
 * Pure function — no DB calls, no external I/O, no side effects, no randomness.
 *
 * scoring_strategy_key: "pga_standard_v1"
 */

const scoring_strategy_key = 'pga_standard_v1';

/**
 * Default finish position bonus table for PGA fantasy scoring.
 * Applied when template rules don't define a custom finish_bonus configuration.
 *
 * Official PGA Tour finish bonuses:
 * - 1st: +25
 * - 2nd: +18
 * - 3rd: +16
 * - 4th: +14
 * - 5th: +12
 * - 6th: +10
 * - 7th: +8
 * - 8th: +7
 * - 9th: +6
 * - 10th: +5
 * - 11–15: +4
 * - 16–25: +3
 * - 26–40: +2
 * - 41–50: +1
 * - 51+: +0
 */
const DEFAULT_FINISH_BONUS = {
  // Positions 1-10 (unique bonuses)
  1: 25,
  2: 18,
  3: 16,
  4: 14,
  5: 12,
  6: 10,
  7: 8,
  8: 7,
  9: 6,
  10: 5,

  // Positions 11-15 (all → 4)
  11: 4, 12: 4, 13: 4, 14: 4, 15: 4,

  // Positions 16-25 (all → 3)
  16: 3, 17: 3, 18: 3, 19: 3, 20: 3,
  21: 3, 22: 3, 23: 3, 24: 3, 25: 3,

  // Positions 26-40 (all → 2)
  26: 2, 27: 2, 28: 2, 29: 2, 30: 2,
  31: 2, 32: 2, 33: 2, 34: 2, 35: 2,
  36: 2, 37: 2, 38: 2, 39: 2, 40: 2,

  // Positions 41-50 (all → 1)
  41: 1, 42: 1, 43: 1, 44: 1, 45: 1,
  46: 1, 47: 1, 48: 1, 49: 1, 50: 1
  // Positions > 50 return 0 (handled by computeFinishBonus default)
};

/**
 * Coerce a value to a safe numeric score, defaulting to 0 for anything
 * that is not a finite number.
 */
function safeNum(value) {
  return typeof value === 'number' && isFinite(value) ? value : 0;
}

/**
 * Map a hole delta (strokes - par) to a fantasy point value.
 * All scoring rule values are coerced through safeNum so missing
 * template keys default to 0 rather than NaN.
 *
 * @param {number} delta
 * @param {Object} scoring
 * @returns {number}
 */
function holePoints(delta, scoring) {
  if (delta <= -3) return safeNum(scoring.double_eagle_or_better);
  if (delta === -2) return safeNum(scoring.eagle);
  if (delta === -1) return safeNum(scoring.birdie);
  if (delta === 0)  return safeNum(scoring.par);
  if (delta === 1)  return safeNum(scoring.bogey);
  return safeNum(scoring.double_bogey_or_worse);
}

/**
 * Return the streak bonus for a golfer's holes.
 *
 * Scans for contiguous runs of birdies-or-better (delta <= -1).
 * Awards one streak_bonus.points per run whose length >= streak_bonus.length.
 * Overlapping / double-counting is impossible because each run is counted once
 * at the point where it ends (or at end-of-array).
 *
 * @param {Array<{par: number, strokes: number}>} validHoles - pre-filtered for numeric par+strokes
 * @param {{length: number, points: number}} streakBonus
 * @returns {number}
 */
function computeStreakBonus(validHoles, streakBonus) {
  const threshold = safeNum(streakBonus.length);
  const award     = safeNum(streakBonus.points);

  if (threshold <= 0) return 0;

  let bonus = 0;
  let run   = 0;

  for (const hole of validHoles) {
    const delta = hole.strokes - hole.par;
    if (delta <= -1) {
      run += 1;
    } else {
      if (run >= threshold) bonus += award;
      run = 0;
    }
  }
  if (run >= threshold) bonus += award;

  return bonus;
}


/**
 * Return the finish-position bonus from the template's finish_bonus table.
 * Returns 0 if position is not in the table or the table is absent.
 * Does not mutate inputs.
 *
 * @param {number} position
 * @param {Object|null|undefined} finishBonusTable
 * @returns {number}
 */
function computeFinishBonus(position, finishBonusTable) {
  if (finishBonusTable == null) return 0;
  const value = finishBonusTable[String(position)];
  return typeof value === 'number' ? value : 0;
}

/**
 * Score a single golf round for all golfers in the normalized payload.
 *
 * Final round detection: the ingestion adapter sets
 * `normalizedRoundPayload.is_final_round = true` on the highest round.
 * This strategy never assumes or hardcodes a round number.
 *
 * TEMPORARY SCORING (v0.1):
 * When template rules are not defined, uses simple par-based scoring:
 * - hole_points = (par_total - strokes_total) * 1
 * - bonus_points = 0
 * - finish_bonus = finish position bonus (if final round)
 *
 * @param {Object} params
 * @param {Object} params.normalizedRoundPayload
 * @param {Object} params.templateRules
 * @returns {{ event_id: string, round_number: number, golfer_scores: Array }}
 */
function scoreRound({ normalizedRoundPayload, templateRules }) {
  const {
    event_id,
    round_number,
    golfers        = [],
    is_final_round = false
  } = normalizedRoundPayload;

  const scoring          = (templateRules && templateRules.scoring)      || {};

  // Build finish bonus table: always start with DEFAULT_FINISH_BONUS.
  // Only override with template values if they are explicitly valid numbers.
  // This prevents incomplete/malformed template tables from breaking bonus distribution.
  let finishBonusTable = { ...DEFAULT_FINISH_BONUS };
  if (templateRules && typeof templateRules === 'object' && templateRules.finish_bonus) {
    const templateBonuses = templateRules.finish_bonus;
    // Safely overlay template values only where they exist and are valid
    for (const [posStr, bonus] of Object.entries(templateBonuses)) {
      if (typeof bonus === 'number' && isFinite(bonus)) {
        finishBonusTable[posStr] = bonus;
      }
    }
  }

  // Check if we have template rules for complex scoring
  const hasTemplateRules = scoring && Object.keys(scoring).length > 0;

  // ── Compute leaderboard ranking from cumulative tournament strokes (final round only) ────
  // CRITICAL: When is_final_round === true, recompute positions from tournament_strokes if available.
  // Ignore any position values coming from ESPN (curatedRank, order, position).
  // ESPN positions often have many ties (position 2), which we must override.
  // CRITICAL FIX: Invalid tournament_strokes (NaN, null, undefined) must NOT default to 0,
  // as this creates false position-1 ties and corrupts finish_bonus distribution.
  // If tournament_strokes are not available, use the positions as provided (for backward compatibility with unit tests).
  if (is_final_round && Array.isArray(golfers) && golfers.length > 0) {
    // Check if ANY golfers have valid tournament_strokes
    const hasAnyValidTournamentStrokes = golfers.some(
      g => typeof g.tournament_strokes === 'number' && isFinite(g.tournament_strokes)
    );

    // Only recompute positions if we have tournament_strokes data
    if (hasAnyValidTournamentStrokes) {
      // Step 0: Separate valid from invalid golfers
      // A valid golfer has tournament_strokes that is a finite number
      const validGolfers = [];
      const invalidGolfers = [];

      for (const golfer of golfers) {
        const strokes = golfer.tournament_strokes;
        const isValid = typeof strokes === 'number' && isFinite(strokes);

        if (isValid) {
          validGolfers.push(golfer);
        } else {
          invalidGolfers.push(golfer);
        }
      }

      // Step 1: Create a sorted copy of VALID golfers by cumulative tournament strokes (ascending)
      const sorted = [...validGolfers].sort((a, b) => {
        const aStrokes = a.tournament_strokes;  // Already validated as finite number
        const bStrokes = b.tournament_strokes;  // Already validated as finite number
        return aStrokes - bStrokes;
      });

      // Step 2: Assign positions to valid golfers with proper tie handling
      // Track: position (current rank), previousStrokes (for tie detection), playersSeen (count)
      let position = 1;
      let previousStrokes = null;
      let playersSeen = 0;

      for (const golfer of sorted) {
        const strokes = golfer.tournament_strokes;

        // When strokes differ from previous golfer, advance position to skip after ties
        // Example: [270, 271, 271, 273] → positions [1, 2, 2, 4]
        if (previousStrokes !== null && strokes !== previousStrokes) {
          position = playersSeen + 1;
        }

        golfer.position = position;
        previousStrokes = strokes;
        playersSeen++;
      }

      // Step 3: Handle invalid golfers
      // Assign them positions >= 51 so they get 0 finish bonus from the table
      // (DEFAULT_FINISH_BONUS only has explicit entries for 1-50, so 51+ returns 0)
      const startInvalidPosition = Math.max(51, playersSeen + 1);  // At least 51 to get 0 bonus
      for (let i = 0; i < invalidGolfers.length; i++) {
        const golfer = invalidGolfers[i];
        golfer.position = startInvalidPosition + i;
      }

      // Step 4: Map computed positions back to original golfers array using golfer_id
      // This ensures the original array (used for scoring) has correct positions
      const positionMap = {};
      for (const golfer of sorted) {
        positionMap[golfer.golfer_id] = golfer.position;
      }
      for (const golfer of invalidGolfers) {
        positionMap[golfer.golfer_id] = golfer.position;
      }

      // Explicitly set position on every golfer in the original array
      // This overrides any position values from ESPN (which often have ties)
      for (const golfer of golfers) {
        const computedPosition = positionMap[golfer.golfer_id];
        if (typeof computedPosition === 'number') {
          golfer.position = computedPosition;
        } else {
          // Golfer has no match in positionMap (shouldn't happen, but default to unranked high)
          golfer.position = 999;
        }
      }
    }
    // If no tournament_strokes data, use positions as provided
  }

  const golfer_scores = golfers.map((golfer) => {
    const { golfer_id, holes = [], position = 0 } = golfer;

    // Only score holes that carry valid numeric par and strokes
    const validHoles = holes.filter(
      (h) =>
        typeof h.par === 'number' && isFinite(h.par) &&
        typeof h.strokes === 'number' && isFinite(h.strokes)
    );

    let hole_points = 0;
    let bonus_points = 0;

    // TEMPORARY SCORING: Use leaderboard score when holes are missing
    if (!hasTemplateRules) {
      // If holes are available, use hole-by-hole calculation
      if (validHoles.length > 0) {
        const parTotal = validHoles.reduce((sum, hole) => sum + hole.par, 0);
        const strokesTotal = validHoles.reduce((sum, hole) => sum + hole.strokes, 0);
        hole_points = parTotal - strokesTotal;
      } else if (golfer.score !== undefined && golfer.score !== null) {
        // Use leaderboard score (relative to par) when hole data is missing
        const scoreToPar = parseInt(golfer.score, 10) || 0;
        hole_points = -scoreToPar;
      } else {
        hole_points = 0;
      }
      bonus_points = 0;
    } else {
      // STANDARD SCORING: Use template rules for per-hole scoring
      let bogeyFree = true;

      for (const hole of validHoles) {
        const delta = hole.strokes - hole.par;
        hole_points += holePoints(delta, scoring);
        if (delta > 0) bogeyFree = false;
      }

      if (bogeyFree) {
        bonus_points += safeNum(scoring.bogey_free_round_bonus);
      }

      if (scoring.streak_bonus) {
        bonus_points += computeStreakBonus(validHoles, scoring.streak_bonus);
      }
    }

    const finish_bonus = is_final_round
      ? computeFinishBonus(position, finishBonusTable)
      : 0;

    const total_points = hole_points + bonus_points + finish_bonus;

    return {
      golfer_id,
      hole_points,
      bonus_points,
      finish_bonus,
      total_points
    };
  });

  return { event_id, round_number, golfer_scores };
}

module.exports = {
  scoring_strategy_key,
  scoreRound,
  computeFinishBonus,
  computeStreakBonus
};
