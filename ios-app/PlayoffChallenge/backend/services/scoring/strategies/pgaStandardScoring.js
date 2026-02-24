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
  const finishBonusTable = (templateRules && templateRules.finish_bonus) || null;

  const golfer_scores = golfers.map((golfer) => {
    const { golfer_id, holes = [], position } = golfer;

    // Only score holes that carry valid numeric par and strokes
    const validHoles = holes.filter(
      (h) =>
        typeof h.par === 'number' && isFinite(h.par) &&
        typeof h.strokes === 'number' && isFinite(h.strokes)
    );

    let hole_points = 0;
    let bogeyFree   = true;

    for (const hole of validHoles) {
      const delta = hole.strokes - hole.par;
      hole_points += holePoints(delta, scoring);
      if (delta > 0) bogeyFree = false;
    }

    let bonus_points = 0;

    if (bogeyFree) {
      bonus_points += safeNum(scoring.bogey_free_round_bonus);
    }

    if (scoring.streak_bonus) {
      bonus_points += computeStreakBonus(validHoles, scoring.streak_bonus);
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
