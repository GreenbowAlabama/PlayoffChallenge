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

  // Use template-provided finish_bonus if available, otherwise use strategy defaults
  const finishBonusTable =
    templateRules && typeof templateRules === 'object' && templateRules.finish_bonus
      ? templateRules.finish_bonus
      : DEFAULT_FINISH_BONUS;

  // Check if we have template rules for complex scoring
  const hasTemplateRules = scoring && Object.keys(scoring).length > 0;

  // ── Compute leaderboard ranking from cumulative tournament strokes (final round only) ────
  // CRITICAL: When is_final_round === true, ALWAYS recompute positions from tournament_strokes.
  // Ignore any position values coming from ESPN (curatedRank, order, position).
  // ESPN positions often have many ties (position 2), which we must override.
  if (is_final_round && Array.isArray(golfers) && golfers.length > 0) {
    // Step 1: Create a sorted copy by cumulative tournament strokes (ascending, lower is better)
    const sorted = [...golfers].sort((a, b) => {
      const aStrokes = (typeof a.tournament_strokes === 'number' && isFinite(a.tournament_strokes)) ? a.tournament_strokes : 0;
      const bStrokes = (typeof b.tournament_strokes === 'number' && isFinite(b.tournament_strokes)) ? b.tournament_strokes : 0;
      return aStrokes - bStrokes;
    });

    // Step 2: Assign positions with proper tie handling
    // Track: position (current rank), previousStrokes (for tie detection), playersSeen (count)
    let position = 1;
    let previousStrokes = null;
    let playersSeen = 0;

    for (const golfer of sorted) {
      const strokes = (typeof golfer.tournament_strokes === 'number' && isFinite(golfer.tournament_strokes)) ? golfer.tournament_strokes : 0;

      // When strokes differ from previous golfer, advance position to skip after ties
      // Example: [270, 271, 271, 273] → positions [1, 2, 2, 4]
      if (previousStrokes !== null && strokes !== previousStrokes) {
        position = playersSeen + 1;
      }

      golfer.position = position;
      previousStrokes = strokes;
      playersSeen++;
    }

    // Step 3: Map computed positions back to original golfers array using golfer_id
    // This ensures the original array (used for scoring) has correct positions
    const positionMap = {};
    for (const golfer of sorted) {
      positionMap[golfer.golfer_id] = golfer.position;
    }

    // Explicitly set position on every golfer in the original array
    // This overrides any position values from ESPN (which often have ties)
    for (const golfer of golfers) {
      const computedPosition = positionMap[golfer.golfer_id];
      if (typeof computedPosition === 'number') {
        golfer.position = computedPosition;
      } else {
        // Golfer has no match in positionMap (shouldn't happen, but default to unranked)
        golfer.position = 0;
      }
    }
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
