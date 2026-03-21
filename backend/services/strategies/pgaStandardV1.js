/**
 * PGA Standard V1 Strategy
 *
 * Contest-level strategy module for PGA standard scoring.
 * Exports contest operation functions: liveStandings, rosterConfig, rules
 */

const { aggregateEntryScore } = require('../scoring/pgaEntryAggregation');

/**
 * Get live standings for PGA contests.
 * Fetches golfer_event_scores, aggregates per user (best 6 of 7), ranks with tie awareness.
 *
 * @param {Object} pool - Database pool
 * @param {string} contestInstanceId - Contest UUID
 * @returns {Promise<Array>} Array of { user_id, user_display_name, total_score, rank }
 */
async function liveStandings(pool, contestInstanceId) {
  const result = await pool.query(
    `WITH latest_rosters AS (
       SELECT DISTINCT ON (contest_instance_id, user_id)
         id, contest_instance_id, user_id, player_ids
       FROM entry_rosters
       WHERE contest_instance_id = $1
       ORDER BY contest_instance_id, user_id, updated_at DESC
     ),
     roster_golfers AS (
       SELECT
         lr.user_id,
         UNNEST(lr.player_ids) AS golfer_id
       FROM latest_rosters lr
     ),
     golfer_agg AS (
       SELECT
         golfer_id,
         SUM(hole_points + bonus_points + finish_bonus) AS total
       FROM golfer_event_scores
       WHERE contest_instance_id = $1
       GROUP BY golfer_id
     ),
     golfer_totals AS (
       SELECT
         rg.user_id,
         rg.golfer_id,
         COALESCE(ga.total, 0) AS total_points
       FROM roster_golfers rg
       LEFT JOIN golfer_agg ga
         ON ga.golfer_id = rg.golfer_id
     ),
     ranked AS (
       SELECT
         *,
         ROW_NUMBER() OVER (
           PARTITION BY user_id
           ORDER BY total_points DESC
         ) AS rnk,
         COUNT(*) OVER (PARTITION BY user_id) AS roster_size
       FROM golfer_totals
     ),
     user_totals AS (
       SELECT
         r.user_id,
         SUM(CASE WHEN r.rnk <= 6 THEN r.total_points ELSE 0 END) AS total_score
       FROM ranked r
       GROUP BY r.user_id
     )
     SELECT
       ut.user_id,
       COALESCE(u.username, u.name, 'Unknown') AS user_display_name,
       ut.total_score
     FROM user_totals ut
     JOIN users u ON ut.user_id = u.id
     ORDER BY ut.total_score DESC`,
    [contestInstanceId]
  );

  console.log('[PGA V1] FINAL TOTALS:', result.rows.map(r => ({ user_id: r.user_id, total_score: r.total_score })));

  // Map query results to score objects
  const usersWithScores = result.rows.map(row => ({
    id: row.user_id,
    user_id: row.user_id,
    user_display_name: row.user_display_name,
    total_score: Number(row.total_score) || 0
  }));

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
      total_score: entry.total_score,
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
