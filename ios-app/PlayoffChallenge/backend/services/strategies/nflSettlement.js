/**
 * NFL Playoff Cumulative Settlement Strategy
 *
 * Extracted from settlementStrategy.executeSettlement. Contains the
 * NFL-specific part: querying playoff_start_week from game_settings
 * and aggregating participant scores across playoff weeks.
 *
 * Returns an array of { user_id, total_score }. Platform code handles
 * rankings, payouts, hashing, and persistence.
 *
 * @param {string} contestInstanceId - The contest instance UUID
 * @param {Object} client - Database client (within transaction)
 * @returns {Promise<Array<{user_id: string, total_score: number}>>}
 */
async function nflSettlementFn(contestInstanceId, client) {
  // Fetch playoff start week
  const startWeekResult = await client.query(
    'SELECT playoff_start_week FROM game_settings LIMIT 1'
  );
  const startWeek = startWeekResult.rows[0]?.playoff_start_week || 19;
  const endWeek = startWeek + 3;

  // Fetch participant scores
  const scoresResult = await client.query(`
    SELECT
      cp.user_id,
      COALESCE(SUM(s.final_points), 0) as total_score
    FROM contest_participants cp
    LEFT JOIN scores s ON s.user_id = cp.user_id AND s.week_number BETWEEN $2 AND $3
    WHERE cp.contest_instance_id = $1
    GROUP BY cp.user_id
  `, [contestInstanceId, startWeek, endWeek]);

  return scoresResult.rows;
}

module.exports = { nflSettlementFn };
