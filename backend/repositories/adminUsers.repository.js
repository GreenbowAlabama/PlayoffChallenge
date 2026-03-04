/**
 * Admin Users Repository
 *
 * Data access layer for admin user operations.
 * Handles user queries with wallet and contest aggregation.
 */

/**
 * Get all users with wallet and contest visibility data.
 *
 * Uses subqueries to prevent row multiplication:
 * - ledger_agg: Aggregates wallet data by user_id
 * - contest_agg: Counts active contests by user_id
 *
 * @param {Object} pool - Database connection pool
 * @returns {Promise<Array>} Array of user objects with wallet and contest fields
 */
async function getAllUsersWithWalletVisibility(pool) {
  const result = await pool.query(`
    SELECT
      u.id,
      u.username,
      u.email,
      u.name,
      u.phone,
      u.paid,
      u.is_admin,
      u.apple_id,
      u.created_at,
      u.admin_notes,
      COALESCE(la.wallet_balance_cents, 0) as wallet_balance_cents,
      COALESCE(la.lifetime_deposits_cents, 0) as lifetime_deposits_cents,
      COALESCE(la.lifetime_withdrawals_cents, 0) as lifetime_withdrawals_cents,
      COALESCE(ca.active_contests_count, 0) as active_contests_count,
      ca.last_contest_join_at,
      la.last_wallet_activity_at
    FROM users u
    LEFT JOIN (
      SELECT
        user_id,
        COALESCE(
          SUM(CASE
            WHEN direction = 'CREDIT' THEN amount_cents
            WHEN direction = 'DEBIT' THEN -amount_cents
          END),
          0
        ) as wallet_balance_cents,
        COALESCE(
          SUM(CASE
            WHEN entry_type = 'WALLET_DEPOSIT' THEN amount_cents
            ELSE 0
          END),
          0
        ) as lifetime_deposits_cents,
        COALESCE(
          SUM(CASE
            WHEN entry_type = 'WALLET_WITHDRAWAL' THEN amount_cents
            ELSE 0
          END),
          0
        ) as lifetime_withdrawals_cents,
        MAX(created_at) as last_wallet_activity_at
      FROM ledger
      WHERE user_id IS NOT NULL
      GROUP BY user_id
    ) la ON u.id = la.user_id
    LEFT JOIN (
      SELECT
        cp.user_id,
        COUNT(DISTINCT cp.contest_instance_id) as active_contests_count,
        MAX(cp.joined_at) as last_contest_join_at
      FROM contest_participants cp
      INNER JOIN contest_instances ci ON cp.contest_instance_id = ci.id
      WHERE ci.status IN ('SCHEDULED', 'LOCKED', 'LIVE')
      GROUP BY cp.user_id
    ) ca ON u.id = ca.user_id
    ORDER BY u.username
  `);

  return result.rows;
}

/**
 * Get a single user with wallet and contest visibility data.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID UUID
 * @returns {Promise<Object|null>} User object or null if not found
 */
async function getUserWithWalletVisibility(pool, userId) {
  const result = await pool.query(`
    SELECT
      u.id,
      u.username,
      u.email,
      u.name,
      u.phone,
      u.paid,
      u.is_admin,
      u.apple_id,
      u.created_at,
      u.admin_notes,
      COALESCE(la.wallet_balance_cents, 0) as wallet_balance_cents,
      COALESCE(la.lifetime_deposits_cents, 0) as lifetime_deposits_cents,
      COALESCE(la.lifetime_withdrawals_cents, 0) as lifetime_withdrawals_cents,
      COALESCE(ca.active_contests_count, 0) as active_contests_count,
      ca.last_contest_join_at,
      la.last_wallet_activity_at
    FROM users u
    LEFT JOIN (
      SELECT
        user_id,
        COALESCE(
          SUM(CASE
            WHEN direction = 'CREDIT' THEN amount_cents
            WHEN direction = 'DEBIT' THEN -amount_cents
          END),
          0
        ) as wallet_balance_cents,
        COALESCE(
          SUM(CASE
            WHEN entry_type = 'WALLET_DEPOSIT' THEN amount_cents
            ELSE 0
          END),
          0
        ) as lifetime_deposits_cents,
        COALESCE(
          SUM(CASE
            WHEN entry_type = 'WALLET_WITHDRAWAL' THEN amount_cents
            ELSE 0
          END),
          0
        ) as lifetime_withdrawals_cents,
        MAX(created_at) as last_wallet_activity_at
      FROM ledger
      WHERE user_id IS NOT NULL
      GROUP BY user_id
    ) la ON u.id = la.user_id
    LEFT JOIN (
      SELECT
        cp.user_id,
        COUNT(DISTINCT cp.contest_instance_id) as active_contests_count,
        MAX(cp.joined_at) as last_contest_join_at
      FROM contest_participants cp
      INNER JOIN contest_instances ci ON cp.contest_instance_id = ci.id
      WHERE ci.status IN ('SCHEDULED', 'LOCKED', 'LIVE')
      GROUP BY cp.user_id
    ) ca ON u.id = ca.user_id
    WHERE u.id = $1
  `, [userId]);

  return result.rows[0] || null;
}

/**
 * Get recent ledger entries for a user (last 5).
 *
 * Used for the expand panel detail view.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID UUID
 * @returns {Promise<Array>} Array of recent ledger entries
 */
async function getRecentLedgerEntries(pool, userId) {
  const result = await pool.query(`
    SELECT
      l.id,
      l.entry_type,
      l.direction,
      l.amount_cents,
      l.reference_type,
      l.reference_id,
      l.created_at,
      ci.name as contest_name,
      ci.status as contest_status
    FROM ledger l
    LEFT JOIN contest_instances ci ON l.contest_instance_id = ci.id
    WHERE l.user_id = $1
    ORDER BY l.created_at DESC
    LIMIT 5
  `, [userId]);

  return result.rows;
}

/**
 * Get contests for a user with status.
 *
 * Used for the expand panel detail view.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID UUID
 * @returns {Promise<Array>} Array of user's contests
 */
async function getUserContests(pool, userId) {
  const result = await pool.query(`
    SELECT
      ci.id,
      ci.name,
      ci.status,
      ci.entry_fee_cents,
      ci.created_at,
      ci.lock_time,
      ci.tournament_start_time,
      ct.name as template_name
    FROM contest_instances ci
    INNER JOIN contest_participants cp ON ci.id = cp.contest_instance_id
    LEFT JOIN contest_templates ct ON ci.template_id = ct.id
    WHERE cp.user_id = $1
    ORDER BY ci.created_at DESC
  `, [userId]);

  return result.rows;
}

module.exports = {
  getAllUsersWithWalletVisibility,
  getUserWithWalletVisibility,
  getRecentLedgerEntries,
  getUserContests
};
