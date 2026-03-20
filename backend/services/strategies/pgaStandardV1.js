/**
 * PGA Standard V1 Strategy
 *
 * Contest-level strategy module for PGA standard scoring.
 * Exports contest operation functions: liveStandings, rosterConfig, rules
 */

const { aggregateEntryScore } = require('../scoring/pgaEntryAggregation');

/**
 * Get live standings for PGA contests.
 * Fetches golfer_scores, aggregates per user (best 6 of 7), ranks with tie awareness.
 *
 * @param {Object} pool - Database pool
 * @param {string} contestInstanceId - Contest UUID
 * @returns {Promise<Array>} Array of { user_id, user_display_name, total_score, rank }
 */
async function liveStandings(pool, contestInstanceId) {
  const result = await pool.query(
    `SELECT
      cp.user_id,
      COALESCE(u.username, u.name, 'Unknown') AS user_display_name,
      array_agg(
        json_build_object(
          'golfer_id', gs.golfer_id,
          'total_points', gs.total_points
        ) ORDER BY gs.golfer_id
      ) AS golfer_scores_array
     FROM contest_participants cp
     LEFT JOIN users u ON cp.user_id = u.id
     LEFT JOIN (
       SELECT contest_instance_id, user_id, golfer_id,
         SUM(COALESCE(hole_points, 0) + COALESCE(bonus_points, 0) + COALESCE(finish_bonus, 0)) AS total_points
       FROM golfer_scores
       WHERE contest_instance_id = $1
       GROUP BY contest_instance_id, user_id, golfer_id
     ) gs ON cp.contest_instance_id = gs.contest_instance_id
       AND cp.user_id = gs.user_id
     WHERE cp.contest_instance_id = $1
     GROUP BY cp.user_id, user_display_name
     ORDER BY cp.user_id ASC`,
    [contestInstanceId]
  );

  console.log('[LEADERBOARD_DEBUG]', {
    contestId: contestInstanceId,
    participantRows: result.rows.length
  });

  // Compute aggregated scores per user (best 6 of 7 golfers)
  const usersWithScores = result.rows.map(row => {
    // Parse golfer_scores_array and filter out nulls
    const golferScores = (row.golfer_scores_array || [])
      .filter(g => g && g.golfer_id)
      .map(g => ({
        golfer_id: g.golfer_id,
        total_points: Number(g.total_points) || 0
      }));

    // Apply best-6-of-7 aggregation
    const aggregatedScore = aggregateEntryScore(golferScores);

    return {
      id: row.user_id,
      user_id: row.user_id,
      user_display_name: row.user_display_name,
      total_score: aggregatedScore.entry_total
    };
  });

  // Sort by total_score DESC, then apply tie-aware ranking
  usersWithScores.sort((a, b) => {
    if (Math.abs(a.total_score - b.total_score) > 0.01) {
      return b.total_score - a.total_score;
    }
    return a.user_id.localeCompare(b.user_id);
  });

  // Apply tie-aware ranking (helper from parent)
  const areScoresEqual = (score1, score2, precision = 2) => {
    if (typeof score1 !== 'number' || typeof score2 !== 'number') {
      return false;
    }
    return score1.toFixed(precision) === score2.toFixed(precision);
  };

  const rankedScores = [];
  let currentRank = 1;
  usersWithScores.forEach((entry, index) => {
    if (index > 0 && !areScoresEqual(entry.total_score, usersWithScores[index - 1].total_score)) {
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
 * Get roster configuration for PGA contests.
 * Returns the roster size and validation rules.
 *
 * Includes both generic fields (roster_size, entry_fields, validation_rules)
 * and PGA-specific fields (lineup_size, scoring_count, drop_lowest).
 *
 * @returns {Object} Roster config with PGA fields
 */
function rosterConfig() {
  return {
    // Generic fields (backward compatibility)
    roster_size: 7,
    entry_fields: ['player_ids'],
    validation_rules: {
      no_duplicates: true,
      must_be_in_field: true
    },

    // PGA-specific fields (iOS consumption)
    lineup_size: 7,
    scoring_count: 6,
    drop_lowest: true
  };
}

/**
 * Get scoring rules for PGA contests.
 * Returns hole scoring values, roster info, and bonuses.
 *
 * @param {Object} contestRow - Contest instance row from database
 * @returns {Object} Rules with scoringRules, rosterInfo, bonuses
 */
function rules(contestRow) {
  const scoringRules = {
    double_eagle_or_better: 5,
    eagle: 4,
    birdie: 3,
    par: 1,
    bogey: -1,
    double_bogey_or_worse: -2
  };

  const rosterInfo = {
    roster_size: 7,
    scoring_format: 'best_6_of_7',
    description: 'Best 6 of 7 golfers'
  };

  const bonuses = {
    streak_bonus: 'Configurable per template (contiguous birdies or better)',
    finish_bonus: 'Position-keyed table, final round only',
    bogey_free_round_bonus: 'Configurable per template'
  };

  return {
    scoringRules,
    rosterInfo,
    bonuses,
    tieHandling: 'shared_rank'
  };
}

module.exports = {
  liveStandings,
  rosterConfig,
  rules
};
