/**
 * Admin Users Service
 *
 * Business logic for admin user operations.
 * Delegates data access to adminUsers.repository.
 */

const adminUsersRepository = require('../repositories/adminUsers.repository');

/**
 * Get all users with wallet and contest visibility data.
 *
 * @param {Object} pool - Database connection pool
 * @returns {Promise<Array>} Array of user objects
 */
async function getAllUsersWithWalletVisibility(pool) {
  return adminUsersRepository.getAllUsersWithWalletVisibility(pool);
}

/**
 * Get a single user with full visibility data including recent activity.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID UUID
 * @returns {Promise<Object>} User object with wallet, contests, and recent activity
 */
async function getUserDetailWithActivity(pool, userId) {
  const user = await adminUsersRepository.getUserWithWalletVisibility(pool, userId);

  if (!user) {
    return null;
  }

  // Get recent ledger entries and contests for detail view
  const [recentLedger, contests] = await Promise.all([
    adminUsersRepository.getRecentLedgerEntries(pool, userId),
    adminUsersRepository.getUserContests(pool, userId)
  ]);

  return {
    ...user,
    recent_ledger_entries: recentLedger,
    contests: contests
  };
}

module.exports = {
  getAllUsersWithWalletVisibility,
  getUserDetailWithActivity
};
