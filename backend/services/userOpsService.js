/**
 * User Ops Service
 *
 * Provides operational visibility into user growth, engagement, and wallet health.
 * Used by admin troubleshooting UI to diagnose platform adoption and user onboarding issues.
 *
 * This service is read-only and aggregates data from:
 * - users
 * - contest_participants
 * - ledger (for wallet balance calculations)
 */

/**
 * Get complete operational snapshot for user growth and engagement.
 *
 * @param {Object} pool - Database connection pool or client
 * @param {Object} options - Optional configuration
 * @param {boolean} options.useProvidedClient - If true, pool is actually a client (for testing)
 * @returns {Promise<Object>} Snapshot object with user growth and engagement data
 * @throws {Error} If database error occurs
 */
async function getUserOpsSnapshot(pool, options = {}) {
  const isProvidedClient = options.useProvidedClient === true;
  const client = isProvidedClient ? pool : await pool.connect();
  const shouldRelease = !isProvidedClient;

  try {
    // 1. Server time (reference point for all time-based diagnostics)
    const serverTimeResult = await client.query('SELECT NOW() AS server_time');
    const serverTime = serverTimeResult.rows[0].server_time;

    // 2. User counts
    const userCountsResult = await client.query(
      `SELECT
        COUNT(*) AS users_total
      FROM users`
    );
    const usersTotal = parseInt(userCountsResult.rows[0]?.users_total || 0, 10);

    // 3. Users created today
    const usersCreatedTodayResult = await client.query(
      `SELECT COUNT(*) AS users_created_today
       FROM users
       WHERE created_at >= DATE_TRUNC('day', NOW())`
    );
    const usersCreatedToday = parseInt(usersCreatedTodayResult.rows[0]?.users_created_today || 0, 10);

    // 4. Users created last 7 days
    const usersCreatedLast7DaysResult = await client.query(
      `SELECT COUNT(*) AS users_created_last_7_days
       FROM users
       WHERE created_at >= NOW() - INTERVAL '7 days'`
    );
    const usersCreatedLast7Days = parseInt(usersCreatedLast7DaysResult.rows[0]?.users_created_last_7_days || 0, 10);

    // 5. Wallet signals - compute from ledger
    // Calculate user balances using ONLY wallet-domain ledger entries:
    // WALLET_DEPOSIT, WALLET_WITHDRAWAL, WALLET_WITHDRAWAL_REVERSAL, WALLET_DEBIT
    // Excludes: ENTRY_FEE, ENTRY_FEE_REFUND, PRIZE_PAYOUT, ADJUSTMENT
    const userWalletBalancesResult = await client.query(
      `SELECT
        user_id,
        SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents ELSE 0 END) -
        SUM(CASE WHEN direction = 'DEBIT' THEN amount_cents ELSE 0 END) AS balance_cents
       FROM ledger
       WHERE user_id IS NOT NULL
       AND entry_type IN ('WALLET_DEPOSIT', 'WALLET_WITHDRAWAL', 'WALLET_WITHDRAWAL_REVERSAL', 'WALLET_DEBIT')
       GROUP BY user_id`
    );

    const userBalances = userWalletBalancesResult.rows;
    const usersWithWalletBalance = userBalances.filter(row => parseInt(row.balance_cents, 10) > 0).length;
    const usersWithZeroBalance = usersTotal - usersWithWalletBalance;
    const walletBalanceTotal = userBalances.reduce((sum, row) => sum + parseInt(row.balance_cents || 0, 10), 0);
    const walletBalanceAvg = usersTotal > 0 ? Math.floor(walletBalanceTotal / usersTotal) : 0;

    // 6. Contest participation - today
    const usersJoinedTodayResult = await client.query(
      `SELECT COUNT(DISTINCT user_id) AS users_joined_contests_today
       FROM contest_participants
       WHERE joined_at >= DATE_TRUNC('day', NOW())`
    );
    const usersJoinedContestsToday = parseInt(usersJoinedTodayResult.rows[0]?.users_joined_contests_today || 0, 10);

    // 7. Contest participation - last 7 days
    const usersJoinedLast7DaysResult = await client.query(
      `SELECT COUNT(DISTINCT user_id) AS users_joined_contests_last_7_days
       FROM contest_participants
       WHERE joined_at >= NOW() - INTERVAL '7 days'`
    );
    const usersJoinedContestsLast7Days = parseInt(usersJoinedLast7DaysResult.rows[0]?.users_joined_contests_last_7_days || 0, 10);

    // 8. Average contests per user
    const avgContestsResult = await client.query(
      `SELECT
        AVG(entry_count) AS avg_contests_per_user
       FROM (
         SELECT user_id, COUNT(*) AS entry_count
         FROM contest_participants
         GROUP BY user_id
       ) t`
    );
    const avgContestsPerUser = avgContestsResult.rows[0]?.avg_contests_per_user
      ? parseFloat(avgContestsResult.rows[0].avg_contests_per_user).toFixed(2)
      : 0;

    // 9. Users with no entries
    const usersNoEntriesResult = await client.query(
      `SELECT COUNT(*) AS users_with_no_entries
       FROM users u
       WHERE NOT EXISTS (
         SELECT 1
         FROM contest_participants cp
         WHERE cp.user_id = u.id
       )`
    );
    const usersWithNoEntries = parseInt(usersNoEntriesResult.rows[0]?.users_with_no_entries || 0, 10);

    // Return complete snapshot
    return {
      server_time: serverTime,
      users: {
        users_total: usersTotal,
        users_created_today: usersCreatedToday,
        users_created_last_7_days: usersCreatedLast7Days
      },
      wallets: {
        users_with_wallet_balance: usersWithWalletBalance,
        users_with_zero_balance: usersWithZeroBalance,
        wallet_balance_total: walletBalanceTotal,
        wallet_balance_avg: walletBalanceAvg
      },
      participation: {
        users_joined_contests_today: usersJoinedContestsToday,
        users_joined_contests_last_7_days: usersJoinedContestsLast7Days,
        avg_contests_per_user: parseFloat(avgContestsPerUser),
        users_with_no_entries: usersWithNoEntries
      }
    };
  } finally {
    if (shouldRelease) {
      client.release();
    }
  }
}

module.exports = {
  getUserOpsSnapshot
};
