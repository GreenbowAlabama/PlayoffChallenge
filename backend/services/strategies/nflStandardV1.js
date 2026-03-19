/**
 * NFL Standard V1 Strategy
 *
 * Contest-level strategy module for standard NFL scoring.
 * Used as default strategy for contests not using PGA scoring.
 * Exports contest operation functions: liveStandings, rosterConfig, rules
 */

/**
 * Get live standings for NFL/standard contests.
 * Fetches from picks and scores tables, aggregates per user.
 *
 * @param {Object} pool - Database pool
 * @param {string} contestInstanceId - Contest UUID
 * @returns {Promise<Array>} Array of { user_id, user_display_name, total_score, rank }
 */
async function liveStandings(pool, contestInstanceId) {
  const result = await pool.query(
    `
    SELECT
        cp.user_id,
        COALESCE(u.username, u.name, 'Unknown') AS user_display_name,
        SUM(COALESCE(s.final_points, 0))::numeric AS total_score
    FROM contest_participants cp
    LEFT JOIN picks p ON cp.contest_instance_id = p.contest_instance_id AND cp.user_id = p.user_id
    LEFT JOIN scores s ON p.player_id = s.player_id AND p.week_number = s.week_number AND p.user_id = s.user_id
    LEFT JOIN users u ON cp.user_id = u.id
    WHERE cp.contest_instance_id = $1
    GROUP BY cp.user_id, user_display_name
    ORDER BY total_score DESC, cp.user_id ASC
    `,
    [contestInstanceId]
  );

  const scoresWithDisplayNames = result.rows.map(row => ({
    id: row.user_id,
    user_id: row.user_id,
    user_display_name: row.user_display_name,
    total_score: Number(row.total_score) // Ensure it's a number
  }));

  // Helper to compare scores with precision
  const areScoresEqual = (score1, score2, precision = 2) => {
    if (typeof score1 !== 'number' || typeof score2 !== 'number') {
      return false;
    }
    return score1.toFixed(precision) === score2.toFixed(precision);
  };

  // Compute ranks based on scores
  const rankedScores = [];
  let currentRank = 1;
  scoresWithDisplayNames.forEach((entry, index) => {
    if (index > 0 && !areScoresEqual(entry.total_score, scoresWithDisplayNames[index - 1].total_score)) {
      currentRank = index + 1;
    }
    rankedScores.push({
      id: entry.id,
      user_id: entry.user_id,
      user_display_name: entry.user_display_name,
      rank: currentRank,
      values: {
        rank: currentRank,
        user_display_name: entry.user_display_name,
        total_score: entry.total_score
      },
      tier: null
    });
  });

  return rankedScores;
}

/**
 * Get roster configuration for NFL/standard contests.
 * Returns minimal/empty config for standard contests.
 *
 * @returns {Object} Roster config
 */
function rosterConfig() {
  return {
    entry_fields: [],
    validation_rules: {}
  };
}

/**
 * Get scoring rules for NFL/standard contests.
 * Returns empty rules for standard contests.
 *
 * @param {Object} contestRow - Contest instance row from database
 * @returns {Object} Empty rules object
 */
function rules(contestRow) {
  return {
    scoringRules: {},
    rosterInfo: {},
    bonuses: {},
    tieHandling: 'shared_rank'
  };
}

module.exports = {
  liveStandings,
  rosterConfig,
  rules
};
