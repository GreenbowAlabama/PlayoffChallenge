/**
 * Admin Diagnostics Service
 *
 * Read-only service for user entitlement and auth diagnostics.
 * Data sources: users table
 *
 * IMPORTANT: This service is strictly read-only. No mutations.
 */

/**
 * Retrieves user entitlement and auth diagnostics for all users.
 *
 * @param {Pool} pool - PostgreSQL connection pool
 * @returns {Promise<Array>} Array of user diagnostic records
 */
async function getAllUserDiagnostics(pool) {
  const result = await pool.query(`
    SELECT
      u.id AS user_id,
      u.username,
      u.email,
      u.paid,
      u.is_admin,
      CASE
        WHEN u.apple_id IS NOT NULL THEN 'apple'
        WHEN u.email IS NOT NULL THEN 'email'
        ELSE 'unknown'
      END AS auth_provider,
      u.created_at AS account_created_at,
      u.updated_at AS last_activity_at,
      u.state,
      u.age_verified,
      u.tos_version,
      u.tos_accepted_at,
      CAST(COALESCE(
        SUM(CASE WHEN l.direction = 'CREDIT' THEN l.amount_cents ELSE 0 END) -
        SUM(CASE WHEN l.direction = 'DEBIT' THEN l.amount_cents ELSE 0 END),
        0
      ) AS INTEGER) AS wallet_balance_cents,
      CAST(COALESCE(
        SUM(CASE WHEN l.entry_type = 'WALLET_DEPOSIT' THEN l.amount_cents ELSE 0 END),
        0
      ) AS INTEGER) AS total_deposits_cents,
      CAST(COALESCE(
        SUM(CASE WHEN l.entry_type = 'ENTRY_FEE' THEN l.amount_cents ELSE 0 END),
        0
      ) AS INTEGER) AS total_entry_fees_cents,
      CAST(COALESCE(
        SUM(CASE WHEN l.entry_type = 'PRIZE_PAYOUT' THEN l.amount_cents ELSE 0 END),
        0
      ) AS INTEGER) AS total_payouts_cents,
      CAST(COALESCE(
        SUM(CASE WHEN l.entry_type = 'ENTRY_FEE_REFUND' THEN l.amount_cents ELSE 0 END),
        0
      ) AS INTEGER) AS total_refunds_cents,
      CAST(COALESCE(COUNT(l.id), 0) AS INTEGER) AS ledger_entry_count
    FROM users u
    LEFT JOIN ledger l ON u.id = l.user_id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `);

  return result.rows;
}

/**
 * Retrieves user entitlement and auth diagnostics for a specific user.
 *
 * @param {Pool} pool - PostgreSQL connection pool
 * @param {string} userId - UUID of the user
 * @returns {Promise<Object|null>} User diagnostic record or null if not found
 */
async function getUserDiagnostics(pool, userId) {
  const result = await pool.query(`
    SELECT
      id AS user_id,
      username,
      email,
      paid,
      is_admin,
      CASE
        WHEN apple_id IS NOT NULL THEN 'apple'
        WHEN email IS NOT NULL THEN 'email'
        ELSE 'unknown'
      END AS auth_provider,
      created_at AS account_created_at,
      updated_at AS last_activity_at,
      state,
      age_verified,
      tos_version,
      tos_accepted_at,
      payment_method,
      payment_date,
      eligibility_confirmed_at
    FROM users
    WHERE id = $1
  `, [userId]);

  return result.rows[0] || null;
}

/**
 * Retrieves aggregate user statistics for diagnostics dashboard.
 *
 * @param {Pool} pool - PostgreSQL connection pool
 * @returns {Promise<Object>} Aggregate statistics
 */
async function getUserStats(pool) {
  const result = await pool.query(`
    SELECT
      COUNT(*) AS total_users,
      COUNT(*) FILTER (WHERE paid = true) AS paid_users,
      COUNT(*) FILTER (WHERE is_admin = true) AS admin_users,
      COUNT(*) FILTER (WHERE apple_id IS NOT NULL) AS apple_auth_users,
      COUNT(*) FILTER (WHERE apple_id IS NULL AND email IS NOT NULL) AS email_auth_users,
      COUNT(*) FILTER (WHERE age_verified = true) AS age_verified_users,
      COUNT(*) FILTER (WHERE tos_accepted_at IS NOT NULL) AS tos_accepted_users
    FROM users
  `);

  return result.rows[0];
}

module.exports = {
  getAllUserDiagnostics,
  getUserDiagnostics,
  getUserStats
};
