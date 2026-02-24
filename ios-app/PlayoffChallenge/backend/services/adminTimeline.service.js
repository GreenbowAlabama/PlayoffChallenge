/**
 * Admin Timeline Service
 *
 * Read-only service for reconstructing per-user event timelines.
 * Data sources: users, picks, scores, player_swaps tables
 *
 * IMPORTANT: This service is strictly read-only. No mutations.
 * Uses only existing timestamps - no new event tracking.
 */

/**
 * Retrieves reconstructed event timeline for a specific user.
 * Aggregates timestamps from multiple tables and returns sorted events.
 *
 * @param {Pool} pool - PostgreSQL connection pool
 * @param {string} userId - UUID of the user
 * @returns {Promise<Array>} Array of timeline events sorted by timestamp
 */
async function getUserTimeline(pool, userId) {
  const events = [];

  // 1. Account created (from users table)
  const userResult = await pool.query(`
    SELECT
      created_at,
      updated_at,
      payment_date,
      payment_method,
      tos_accepted_at,
      eligibility_confirmed_at,
      state_certification_date
    FROM users
    WHERE id = $1
  `, [userId]);

  if (userResult.rows.length === 0) {
    return null; // User not found
  }

  const user = userResult.rows[0];

  if (user.created_at) {
    events.push({
      event_type: 'account_created',
      description: 'Account created',
      timestamp: user.created_at
    });
  }

  // 2. TOS accepted (if available)
  if (user.tos_accepted_at) {
    events.push({
      event_type: 'tos_accepted',
      description: 'Terms of service accepted',
      timestamp: user.tos_accepted_at
    });
  }

  // 3. Eligibility confirmed (if available)
  if (user.eligibility_confirmed_at) {
    events.push({
      event_type: 'eligibility_confirmed',
      description: 'Eligibility confirmed',
      timestamp: user.eligibility_confirmed_at
    });
  }

  // 4. State certification (if available)
  if (user.state_certification_date) {
    events.push({
      event_type: 'state_certified',
      description: 'State eligibility certified',
      timestamp: user.state_certification_date
    });
  }

  // 5. Payment event (if stored)
  if (user.payment_date) {
    events.push({
      event_type: 'payment_completed',
      description: `Payment completed via ${user.payment_method || 'unknown method'}`,
      timestamp: user.payment_date
    });
  }

  // 6. First pick submitted (team creation proxy)
  const firstPickResult = await pool.query(`
    SELECT MIN(created_at) AS first_pick_at
    FROM picks
    WHERE user_id = $1
  `, [userId]);

  if (firstPickResult.rows[0]?.first_pick_at) {
    events.push({
      event_type: 'first_pick_submitted',
      description: 'First pick submitted (team created)',
      timestamp: firstPickResult.rows[0].first_pick_at
    });
  }

  // 7. Picks per week (draft activity)
  const weeklyPicksResult = await pool.query(`
    SELECT
      week_number,
      MIN(created_at) AS picks_submitted_at,
      COUNT(*) AS pick_count
    FROM picks
    WHERE user_id = $1
    GROUP BY week_number
    ORDER BY week_number
  `, [userId]);

  for (const row of weeklyPicksResult.rows) {
    events.push({
      event_type: 'picks_submitted',
      description: `Week ${row.week_number} picks submitted (${row.pick_count} picks)`,
      timestamp: row.picks_submitted_at,
      metadata: {
        week_number: row.week_number,
        pick_count: parseInt(row.pick_count)
      }
    });
  }

  // 8. Player swaps (if any)
  const swapsResult = await pool.query(`
    SELECT
      week_number,
      swapped_at,
      position
    FROM player_swaps
    WHERE user_id = $1
    ORDER BY swapped_at
  `, [userId]);

  for (const row of swapsResult.rows) {
    events.push({
      event_type: 'player_swap',
      description: `Week ${row.week_number} ${row.position} player swapped`,
      timestamp: row.swapped_at,
      metadata: {
        week_number: row.week_number,
        position: row.position
      }
    });
  }

  // 9. Last scoring update (most recent score timestamp)
  const lastScoreResult = await pool.query(`
    SELECT MAX(updated_at) AS last_score_update
    FROM scores
    WHERE user_id = $1
  `, [userId]);

  if (lastScoreResult.rows[0]?.last_score_update) {
    events.push({
      event_type: 'last_score_update',
      description: 'Most recent scoring update',
      timestamp: lastScoreResult.rows[0].last_score_update
    });
  }

  // Sort events by timestamp (ascending)
  events.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  return events;
}

/**
 * Retrieves summary timeline statistics for all users.
 * Useful for dashboard overview.
 *
 * @param {Pool} pool - PostgreSQL connection pool
 * @returns {Promise<Object>} Summary statistics
 */
async function getTimelineSummary(pool) {
  const result = await pool.query(`
    SELECT
      (SELECT COUNT(DISTINCT user_id) FROM picks) AS users_with_picks,
      (SELECT COUNT(DISTINCT user_id) FROM scores) AS users_with_scores,
      (SELECT COUNT(*) FROM users WHERE payment_date IS NOT NULL) AS users_with_payment,
      (SELECT MAX(created_at) FROM picks) AS latest_pick_at,
      (SELECT MAX(updated_at) FROM scores) AS latest_score_at
  `);

  return result.rows[0];
}

module.exports = {
  getUserTimeline,
  getTimelineSummary
};
