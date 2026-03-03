/**
 * Financial Reconciliation Service
 *
 * Daily verification that platform funds reconcile against the core invariant:
 *
 * Stripe Balance >= Wallet Balance + Contest Pool + Pending Withdrawals + Platform Float
 *
 * All read-only. No ledger mutations. Observation and alerting only.
 */

const financialHealthService = require('./financialHealthService');
const alertService = require('./financialAlertService');

/**
 * Get pending withdrawal amounts in cents
 *
 * Pending withdrawals are ledger entries that are:
 * - entry_type = 'WALLET_WITHDRAWAL'
 * - direction = 'DEBIT' (money leaving our account)
 * - NOT yet settled (no matching WALLET_DEPOSIT in return)
 *
 * For MVP, we assume all withdrawals are immediate settlement.
 * Future: track withdrawal requests awaiting payout.
 */
async function getPendingWithdrawals(pool) {
  const result = await pool.query(`
    SELECT
      COALESCE(
        SUM(amount_cents),
        0
      ) as pending_cents
    FROM ledger
    WHERE entry_type = 'WALLET_WITHDRAWAL'
      AND direction = 'DEBIT'
  `);

  return parseInt(result.rows[0].pending_cents, 10);
}

/**
 * Calculate reconciliation status
 *
 * Returns object with:
 * - status: 'HEALTHY' | 'WARNING' | 'CRITICAL'
 * - reason: human-readable explanation
 *
 * Status rules:
 * - HEALTHY: |difference| < $1 (0.01 in dollars)
 * - WARNING: $1 ≤ |difference| < $10
 * - CRITICAL: |difference| ≥ $10
 */
function calculateReconciliationStatus(
  stripeBalance,
  walletBalance,
  contestPoolBalance,
  pendingWithdrawals,
  platformFloat
) {
  const expectedTotal =
    walletBalance + contestPoolBalance + pendingWithdrawals + platformFloat;
  const difference = stripeBalance - expectedTotal;
  const diffDollars = Math.abs(difference) / 100;

  let status;
  let reason;

  if (diffDollars < 1) {
    status = 'HEALTHY';
    reason = `Within normal variance (${diffDollars.toFixed(2)})`;
  } else if (diffDollars < 10) {
    status = 'WARNING';
    reason = `Minor discrepancy detected (${diffDollars.toFixed(2)})`;
  } else {
    status = 'CRITICAL';
    reason = `Significant discrepancy (${diffDollars.toFixed(2)}) - investigate immediately`;
  }

  return {
    status,
    reason,
    expectedTotal,
    difference,
  };
}

/**
 * Run daily reconciliation
 *
 * Called by scheduler at 02:00 UTC daily.
 * Calculates all financial metrics, determines status, persists record, and alerts if needed.
 */
async function runDailyReconciliation(pool) {
  try {
    console.log('[FinancialReconciliation] Starting daily reconciliation...');

    // Fetch all metrics using existing financial health queries
    const stripeBalance = await financialHealthService.getStripeBalance();
    const walletBalance = await financialHealthService.getWalletBalance(pool);
    const contestPoolBalance =
      await financialHealthService.getContestPoolBalance(pool);
    const ledger = await financialHealthService.getLedgerIntegrity(pool);
    const pendingWithdrawals = await getPendingWithdrawals(pool);

    // Platform float is what's left after covering liabilities
    const liabilities = walletBalance + contestPoolBalance + pendingWithdrawals;
    const platformFloat = stripeBalance - liabilities;

    // Determine reconciliation status
    const { status, reason, expectedTotal, difference } =
      calculateReconciliationStatus(
        stripeBalance,
        walletBalance,
        contestPoolBalance,
        pendingWithdrawals,
        platformFloat
      );

    console.log('[FinancialReconciliation] Reconciliation result:', {
      stripeBalance,
      walletBalance,
      contestPoolBalance,
      pendingWithdrawals,
      platformFloat,
      status,
      difference,
    });

    // Insert reconciliation record
    const reconciliationRecord = await pool.query(
      `INSERT INTO financial_reconciliations (
        stripe_balance,
        wallet_balance,
        contest_pool_balance,
        pending_withdrawals,
        platform_float,
        expected_total,
        difference,
        status,
        notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, created_at, status`,
      [
        stripeBalance,
        walletBalance,
        contestPoolBalance,
        pendingWithdrawals,
        platformFloat,
        expectedTotal,
        difference,
        status,
        reason,
      ]
    );

    const recordId = reconciliationRecord.rows[0].id;
    const recordCreatedAt = reconciliationRecord.rows[0].created_at;

    console.log('[FinancialReconciliation] Record inserted:', {
      recordId,
      status,
    });

    // Alert if warning or critical
    if (status !== 'HEALTHY') {
      const alertPayload = {
        recordId,
        timestamp: recordCreatedAt,
        status,
        stripeBalance,
        walletBalance,
        contestPoolBalance,
        pendingWithdrawals,
        platformFloat,
        difference,
        reason,
      };

      try {
        const alertSent = await alertService.sendFinancialAlert(alertPayload);
        console.log('[FinancialReconciliation] Alert sent:', {
          recordId,
          alertSent,
        });

        // Update record with alert status
        if (alertSent.sent) {
          await pool.query(
            `UPDATE financial_reconciliations
            SET alert_sent = TRUE, alert_channel = $1
            WHERE id = $2`,
            [alertSent.channel, recordId]
          );
        }
      } catch (alertErr) {
        console.error('[FinancialReconciliation] Alert error:', alertErr.message);
        // Don't fail reconciliation if alert fails
      }
    }

    return {
      success: true,
      recordId,
      status,
      difference,
    };
  } catch (err) {
    console.error('[FinancialReconciliation] Error:', err.message);
    throw err;
  }
}

/**
 * Get reconciliation history
 *
 * Returns last N days of reconciliation records, ordered newest first.
 */
async function getReconciliationHistory(pool, days = 30) {
  const result = await pool.query(
    `SELECT
      id,
      created_at,
      stripe_balance,
      wallet_balance,
      contest_pool_balance,
      pending_withdrawals,
      platform_float,
      expected_total,
      difference,
      status,
      alert_sent,
      alert_channel,
      notes
    FROM financial_reconciliations
    WHERE created_at >= NOW() - INTERVAL '1 day' * $1
    ORDER BY created_at DESC`,
    [days]
  );

  return result.rows.map((row) => ({
    id: row.id,
    created_at: row.created_at,
    stripe_balance: row.stripe_balance,
    wallet_balance: row.wallet_balance,
    contest_pool_balance: row.contest_pool_balance,
    pending_withdrawals: row.pending_withdrawals,
    platform_float: row.platform_float,
    expected_total: row.expected_total,
    difference: row.difference,
    status: row.status,
    alert_sent: row.alert_sent,
    alert_channel: row.alert_channel,
    notes: row.notes,
  }));
}

module.exports = {
  runDailyReconciliation,
  getReconciliationHistory,
  getPendingWithdrawals,
  calculateReconciliationStatus,
};
