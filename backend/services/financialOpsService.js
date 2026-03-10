/**
 * Financial Operations Service
 *
 * Provides operational visibility into platform financial health.
 * Aggregates signals from ledger, wallets, contest pools, settlement, and payouts.
 * Used by Control Room dashboard for real-time financial monitoring.
 *
 * This service is read-only and aggregates data from multiple sources:
 * - Ledger totals and integrity
 * - Wallet liability (user funds owed)
 * - Contest pool balance
 * - Settlement pipeline status
 * - Payout execution status
 * - Platform reconciliation
 *
 * CONNECTION SAFETY:
 * - Reuses services that only call pool.query() (compatible with client or pool)
 * - Writes direct queries for metrics not available from services
 * - All operations work with provided client for test/transaction contexts
 *
 * CRITICAL: Reuses existing services. No business logic duplication.
 */

const { v5: uuidv5 } = require('uuid');
const financialHealthService = require('./financialHealthService');
const contestPoolDiagnosticsService = require('./contestPoolDiagnosticsService');
const PayoutJobsRepository = require('../repositories/PayoutJobsRepository');

// Namespace for deterministic UUID v5 generation
const POOL_REPAIR_NAMESPACE = '550e8400-e29b-41d4-a716-446655440000';

/**
 * Get complete operational snapshot for platform finances.
 *
 * Combines:
 * - Ledger totals and integrity
 * - Wallet liability (user funds owed)
 * - Contest pool balance
 * - Settlement pipeline status
 * - Payout execution status
 * - Platform reconciliation
 *
 * @param {Object} pool - Database connection pool or client
 * @param {Object} options - Optional configuration
 * @param {boolean} options.useProvidedClient - If true, pool is actually a client (for testing)
 * @returns {Promise<Object>} Snapshot object with all financial metrics
 * @throws {Error} If database error occurs
 */
async function getFinancialOpsSnapshot(pool, options = {}) {
  const isProvidedClient = options.useProvidedClient === true;
  const client = isProvidedClient ? pool : await pool.connect();
  const shouldRelease = !isProvidedClient;

  try {
    // 1. Server time (reference point for all time-based metrics)
    const serverTimeResult = await client.query('SELECT NOW() AS server_time');
    const serverTime = serverTimeResult.rows[0].server_time;

    // 2. Ledger integrity (REUSE: financialHealthService)
    // Safe to pass client - only calls pool.query()
    const ledgerIntegrity = await financialHealthService.getLedgerIntegrity(client);

    // 3. Wallet balance (REUSE: financialHealthService)
    // Safe to pass client - only calls pool.query()
    const walletBalance = await financialHealthService.getWalletBalance(client);

    // 4. Contest pool balance (REUSE: financialHealthService)
    // Safe to pass client - only calls pool.query()
    const contestPoolBalance = await financialHealthService.getContestPoolBalance(client);

    // 5. Deposit/withdrawal totals (REUSE: financialHealthService)
    // Safe to pass client - only calls pool.query()
    const depositWithdrawals = await financialHealthService.getDepositWithdrawalTotals(client);

    // 6. Negative pool contests (REUSE: contestPoolDiagnosticsService)
    // Safe to pass client - only calls pool.query()
    const negativePoolContests = await contestPoolDiagnosticsService.getNegativePoolContests(client);
    const negativePoolCount = negativePoolContests.length;

    // 7. Count users with positive balance (DIRECT QUERY)
    // Uses ledger.user_id (not reference_id) for user wallets
    const positiveWalletsResult = await client.query(`
      SELECT COUNT(DISTINCT user_id) as count
      FROM (
        SELECT
          user_id,
          SUM(
            CASE
              WHEN direction = 'CREDIT' THEN amount_cents
              WHEN direction = 'DEBIT' THEN -amount_cents
              ELSE 0
            END
          ) as balance_cents
        FROM ledger
        WHERE user_id IS NOT NULL
        GROUP BY user_id
        HAVING SUM(
          CASE
            WHEN direction = 'CREDIT' THEN amount_cents
            WHEN direction = 'DEBIT' THEN -amount_cents
            ELSE 0
          END
        ) > 0
      ) t
    `);
    const usersWithPositiveBalance = parseInt(
      positiveWalletsResult.rows[0].count || 0,
      10
    );

    // 8. Pending settlements (DIRECT QUERY)
    const pendingSettlementsResult = await client.query(`
      SELECT COUNT(*) as count
      FROM settlement_audit
      WHERE status = 'STARTED'
    `);
    const pendingSettlementContests = parseInt(
      pendingSettlementsResult.rows[0].count || 0,
      10
    );

    // 9. Failed settlements (DIRECT QUERY)
    const failedSettlementsResult = await client.query(`
      SELECT COUNT(*) as count
      FROM settlement_audit
      WHERE status = 'FAILED'
    `);
    const settlementFailures = parseInt(
      failedSettlementsResult.rows[0].count || 0,
      10
    );

    // 10. Pending payout jobs (REUSE: PayoutJobsRepository)
    // Safe to pass client - only calls pool.query()
    const pendingPayoutJobs = await PayoutJobsRepository.findPendingOrProcessing(client, 10000);
    const pendingPayoutJobsCount = pendingPayoutJobs.length;

    // 11. Failed payout transfers (DIRECT QUERY)
    const failedTransfersResult = await client.query(`
      SELECT COUNT(*) as count
      FROM payout_transfers
      WHERE status = 'failed_terminal'
    `);
    const failedPayoutTransfers = parseInt(
      failedTransfersResult.rows[0].count || 0,
      10
    );

    // 12. Platform reconciliation
    // CRITICAL INVARIANT:
    // ledger_net = deposits - withdrawals
    //
    // The ledger is the source of truth. All ledger entries must net to the
    // actual Stripe cash flow (deposits - withdrawals). If this invariant holds,
    // the platform is solvent and balanced.
    //
    // Wallet liability and contest pools are derived domains used for observability
    // only. They must remain mutually exclusive to prevent double-counting refunds.
    // They are NOT used for reconciliation.
    const expectedCents = ledgerIntegrity.net;
    const actualCents =
      depositWithdrawals.deposits_cents -
      depositWithdrawals.withdrawals_cents;
    const differenceCents = expectedCents - actualCents;
    const isCoherent = differenceCents === 0;

    // Return complete snapshot
    return {
      server_time: serverTime,

      ledger: {
        total_credits_cents: ledgerIntegrity.credits,
        total_debits_cents: ledgerIntegrity.debits,
        net_cents: ledgerIntegrity.net
      },

      wallets: {
        wallet_liability_cents: walletBalance,
        users_with_positive_balance: usersWithPositiveBalance
      },

      contest_pools: {
        contest_pools_cents: contestPoolBalance,
        negative_pool_contests: negativePoolCount
      },

      settlement: {
        pending_settlement_contests: pendingSettlementContests,
        settlement_failures: settlementFailures
      },

      payouts: {
        pending_payout_jobs: pendingPayoutJobsCount,
        failed_payout_transfers: failedPayoutTransfers
      },

      reconciliation: {
        deposits_cents: depositWithdrawals.deposits_cents,
        withdrawals_cents: depositWithdrawals.withdrawals_cents,
        expected_cents: expectedCents,
        actual_cents: actualCents,
        difference_cents: differenceCents,
        status: isCoherent ? 'balanced' : 'drift'
      }
    };
  } finally {
    if (shouldRelease) {
      client.release();
    }
  }
}

/**
 * Repair contest pools with negative balances.
 *
 * Scans for contests with negative pools and inserts compensating ADJUSTMENT
 * ledger entries. Uses existing contestPoolDiagnosticsService logic to identify
 * which contests need repair and compute the adjustment amounts.
 *
 * Repairs are idempotent: running twice produces no additional ledger entries.
 * Uses deterministic idempotency_key based on contest_id.
 *
 * Ledger governance:
 * - Append-only: inserts only, no mutations of existing rows
 * - Entry type: ADJUSTMENT (existing schema type for general corrections)
 * - Direction: CREDIT (to offset negative balance)
 * - Reference type: POOL_REPAIR (links to the repair operation)
 * - Idempotency key: pool-repair-{contest_id} (deterministic across runs)
 *
 * @param {Object} pool - Database connection pool
 * @returns {Promise<Object>} { contests_scanned, contests_repaired, total_adjusted_cents }
 * @throws {Error} If database error occurs
 */
async function repairContestPools(pool) {
  const client = await pool.connect();
  const shouldRelease = true;

  try {
    // Start transaction for atomic repair
    await client.query('BEGIN');

    // 1. Scan for all contests with negative pools
    // Reuse existing diagnostic service - same logic as Financial Ops page
    const negativePoolContests = await contestPoolDiagnosticsService.getNegativePoolContests(client);

    const LedgerRepository = require('../repositories/LedgerRepository');
    let contestsRepaired = 0;
    let totalAdjustedCents = 0;

    // 2. For each negative pool contest, insert compensating ADJUSTMENT entry
    for (const contest of negativePoolContests) {
      const contestId = contest.contest_id;
      const negativeAmountCents = Math.abs(contest.pool_balance_cents);

      // Debug: confirm repair loop execution and amounts
      console.log('[POOL_REPAIR]', {
        contest: contestId,
        pool_balance: contest.pool_balance_cents,
        repair_amount: negativeAmountCents
      });

      // Generate deterministic idempotency key
      // Format: pool-repair-{contest_id}
      const idempotencyKey = `pool-repair-${contestId}`;

      // Check if repair already exists (idempotency)
      const existingRepair = await LedgerRepository.findByIdempotencyKey(client, idempotencyKey);

      if (!existingRepair) {
        // Generate deterministic reference_id using UUID v5
        // This ensures the same contest always gets the same reference_id
        const referenceId = uuidv5(`pool-repair-${contestId}`, POOL_REPAIR_NAMESPACE);

        // Insert compensating ADJUSTMENT entry (CREDIT to offset negative balance)
        // reference_type='POOL_REPAIR' marks this as a repair operation
        // metadata_json provides semantic detail about the repair
        await LedgerRepository.insertLedgerEntry(client, {
          contest_instance_id: contestId,
          entry_type: 'ADJUSTMENT',
          direction: 'CREDIT',
          amount_cents: negativeAmountCents,
          currency: 'USD',
          reference_type: 'POOL_REPAIR',
          reference_id: referenceId,
          idempotency_key: idempotencyKey,
          metadata_json: {
            repair_operation: 'pool_repair',
            repair_reason: 'Negative pool correction',
            original_balance_cents: contest.pool_balance_cents,
            root_cause: contest.root_cause
          }
        });

        contestsRepaired++;
        totalAdjustedCents += negativeAmountCents;
      }
    }

    // Commit transaction
    await client.query('COMMIT');

    return {
      contests_scanned: negativePoolContests.length,
      contests_repaired: contestsRepaired,
      total_adjusted_cents: totalAdjustedCents
    };
  } catch (err) {
    // Rollback on error
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[FinancialOps] Rollback error:', rollbackErr.message);
    }
    throw err;
  } finally {
    if (shouldRelease) {
      client.release();
    }
  }
}

module.exports = {
  getFinancialOpsSnapshot,
  repairContestPools
};
