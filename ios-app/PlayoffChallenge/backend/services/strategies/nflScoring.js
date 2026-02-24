/**
 * NFL Fantasy Scoring Strategy
 *
 * Extracted from scoringService.js. Contains all NFL-specific scoring
 * logic: DB rule query, stat multipliers, kicker flat scoring, defense
 * bracket scoring, and yardage bonuses.
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} stats - Player statistics object
 * @returns {Promise<number>} - Calculated fantasy points (rounded to 2 decimal places)
 */
async function nflScoringFn(pool, stats) {
  try {
    const rulesResult = await pool.query(
      'SELECT stat_name, points FROM scoring_rules WHERE is_active = true'
    );

    const rules = {};
    for (const row of rulesResult.rows) {
      rules[row.stat_name] = parseFloat(row.points);
    }

    let points = 0;

    // Passing
    points += (stats.pass_yd || 0) * (rules.pass_yd || 0);
    points += (stats.pass_td || 0) * (rules.pass_td || 0);
    points += (stats.pass_int || 0) * (rules.pass_int || 0);
    points += (stats.pass_2pt || 0) * (rules.pass_2pt || 0);

    // Rushing
    points += (stats.rush_yd || 0) * (rules.rush_yd || 0);
    points += (stats.rush_td || 0) * (rules.rush_td || 0);
    points += (stats.rush_2pt || 0) * (rules.rush_2pt || 0);

    // Receiving
    points += (stats.rec || 0) * (rules.rec || 0);
    points += (stats.rec_yd || 0) * (rules.rec_yd || 0);
    points += (stats.rec_td || 0) * (rules.rec_td || 0);
    points += (stats.rec_2pt || 0) * (rules.rec_2pt || 0);

    // Fumbles
    points += (stats.fum_lost || 0) * (rules.fum_lost || 0);

    // Kicker stats - flat scoring
    points += (stats.fg_made || 0) * 3;
    points += (stats.xp_made || 0) * 1;
    points += (stats.fg_missed || 0) * -1;
    points += (stats.xp_missed || 0) * -1;

    // Defense stats
    if (stats.def_sack !== undefined) {
      points += (stats.def_sack || 0) * (rules.def_sack || 1);
      points += (stats.def_int || 0) * (rules.def_int || 2);
      points += (stats.def_fum_rec || 0) * (rules.def_fum_rec || 2);
      points += (stats.def_td || 0) * (rules.def_td || 6);
      points += (stats.def_safety || 0) * (rules.def_safety || 2);
      points += (stats.def_block || 0) * (rules.def_block || 4);
      points += (stats.def_ret_td || 0) * (rules.def_ret_td || 6);

      const ptsAllowed = stats.def_pts_allowed || 0;
      if (ptsAllowed === 0) points += 20;
      else if (ptsAllowed <= 6) points += 15;
      else if (ptsAllowed <= 13) points += 10;
      else if (ptsAllowed <= 20) points += 5;
      else if (ptsAllowed <= 27) points += 0;
      else if (ptsAllowed <= 34) points += -1;
      else points += -4;
    }

    // Bonuses
    if (stats.pass_yd >= 400) points += (rules.pass_yd_bonus || 0);
    if (stats.rush_yd >= 150) points += (rules.rush_yd_bonus || 0);
    if (stats.rec_yd >= 150) points += (rules.rec_yd_bonus || 0);

    return parseFloat(points.toFixed(2));
  } catch (err) {
    console.error('Error calculating points:', err);
    return 0;
  }
}

module.exports = { nflScoringFn };
