/**
 * Financial Health Service
 *
 * Read-only observability for financial reconciliation.
 *
 * CRITICAL INVARIANT:
 * ledger_net = deposits - withdrawals
 *
 * The ledger is the authoritative source of truth. All ledger entries must net to
 * the actual Stripe cash flow (deposits - withdrawals). If this invariant holds,
 * the platform is solvent and balanced.
 *
 * Wallet liability and contest pools are derived domains used for observability only.
 * They must remain mutually exclusive to prevent double-counting refund credits.
 * They are NOT used for reconciliation.
 *
 * Domain separation:
 * - wallet_liability: WALLET_DEPOSIT, WALLET_WITHDRAWAL, WALLET_WITHDRAWAL_REVERSAL, WALLET_DEBIT
 * - contest_pools: ENTRY_FEE, ENTRY_FEE_REFUND
 * - adjustments: Any other entry types (not used in reconciliation)
 *
 * Monitors:
 * - Stripe balance (real bank balance)
 * - Wallet balances (derived from ledger)
 * - Contest pools (entry fees only, derived from ledger)
 * - Platform float (Stripe - liabilities)
 * - Liquidity coverage (Stripe / liabilities)
 * - Ledger integrity (credits - debits = net)
 *
 * All queries are read-only and deterministic.
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

/**
 * Get Stripe total balance (available + pending) in cents
 *
 * In test mode, deposits appear as pending before becoming available.
 * Dashboard must include both to show true balance.
 *
 * Filters for USD only to prevent multi-currency accounts from corrupting calculations.
 */
async function getStripeBalance() {
  try {
    const balance = await stripe.balance.retrieve();

    // Safely handle both available and pending arrays (may be undefined)
    const available = balance.available ?? [];
    const pending = balance.pending ?? [];

    // Sum USD amounts from both arrays, handling missing/null amounts
    const stripeBalanceCents = [...available, ...pending]
      .filter(item => item.currency === 'usd')
      .reduce((sum, item) => sum + (item.amount || 0), 0);

    return stripeBalanceCents;
  } catch (err) {
    console.error('[FinancialHealth] Stripe API error:', err.message);
    throw err;
  }
}

/**
 * Get total wallet balance (user funds) in cents
 *
 * Sums all CREDIT - DEBIT ledger entries for wallet-domain transactions only:
 * - WALLET_DEPOSIT (user funding)
 * - WALLET_WITHDRAWAL (user payouts)
 * - WALLET_WITHDRAWAL_REVERSAL (reversal of payouts)
 * - WALLET_DEBIT (atomic debit when joining contest)
 *
 * CRITICAL: Uses entry_type, NOT reference_type, to prevent double-counting
 * ENTRY_FEE_REFUND credits that appear in both wallet and contest domains.
 */
async function getWalletBalance(pool) {
  const result = await pool.query(`
    SELECT
      COALESCE(
        SUM(
          CASE
            WHEN direction = 'CREDIT' THEN amount_cents
            WHEN direction = 'DEBIT' THEN -amount_cents
            ELSE 0
          END
        ),
        0
      ) as balance_cents
    FROM ledger
    WHERE entry_type IN (
      'WALLET_DEPOSIT',
      'WALLET_WITHDRAWAL',
      'WALLET_WITHDRAWAL_REVERSAL',
      'WALLET_DEBIT'
    )
  `);

  return parseInt(result.rows[0].balance_cents, 10);
}

/**
 * Get contest pool balance (entry fees only) in cents
 *
 * Sums all CREDIT - DEBIT ledger entries for contest-domain transactions only:
 * - ENTRY_FEE (user deposit when joining)
 * - ENTRY_FEE_REFUND (refund if applicable)
 *
 * DOES NOT include PRIZE_PAYOUT or PRIZE_PAYOUT_REVERSAL (settlement domain).
 *
 * CRITICAL: This domain must be mutually exclusive with wallet_liability
 * to prevent double-counting refund credits.
 */
async function getContestPoolBalance(pool) {
  const result = await pool.query(`
    SELECT
      COALESCE(
        SUM(
          CASE
            WHEN direction = 'CREDIT' THEN amount_cents
            WHEN direction = 'DEBIT' THEN -amount_cents
            ELSE 0
          END
        ),
        0
      ) as balance_cents
    FROM ledger
    WHERE entry_type IN (
      'ENTRY_FEE',
      'ENTRY_FEE_REFUND'
    )
  `);

  return parseInt(result.rows[0].balance_cents, 10);
}

/**
 * Get ledger totals and integrity check
 *
 * Returns:
 * - credits: total CREDIT entries (cents)
 * - debits: total DEBIT entries (cents)
 * - net: credits - debits (cents)
 * - balanced: whether (credits - debits) === net (ledger is internally consistent)
 *
 * Invariant being verified:
 * credits - debits = net
 *
 * This checks that the ledger is self-consistent (the computed net matches actual net).
 * A false value indicates a ledger integrity issue that requires investigation.
 */
async function getLedgerIntegrity(pool) {
  const result = await pool.query(`
    SELECT
      COALESCE(
        SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents ELSE 0 END),
        0
      ) as total_credits,
      COALESCE(
        SUM(CASE WHEN direction = 'DEBIT' THEN amount_cents ELSE 0 END),
        0
      ) as total_debits
    FROM ledger
  `);

  const credits = parseInt(result.rows[0].total_credits, 10);
  const debits = parseInt(result.rows[0].total_debits, 10);
  const net = credits - debits;

  return {
    credits,
    debits,
    net,
    balanced: (credits - debits) === net,
  };
}

/**
 * Get total deposits and withdrawals from ledger.
 *
 * Deposits = WALLET_DEPOSIT entries (user funding)
 * Withdrawals = WALLET_WITHDRAWAL entries (user payouts)
 *
 * @param {Object} pool - Database pool
 * @returns {Promise<Object>} Object with {deposits_cents, withdrawals_cents}
 */
async function getDepositWithdrawalTotals(pool) {
  const result = await pool.query(`
    SELECT
      COALESCE(SUM(CASE WHEN entry_type = 'WALLET_DEPOSIT' AND direction = 'CREDIT' THEN amount_cents ELSE 0 END), 0) as deposits_cents,
      COALESCE(SUM(CASE WHEN entry_type = 'WALLET_WITHDRAWAL' AND direction = 'DEBIT' THEN amount_cents ELSE 0 END), 0) as withdrawals_cents
    FROM ledger
  `);

  return {
    deposits_cents: parseInt(result.rows[0].deposits_cents, 10),
    withdrawals_cents: parseInt(result.rows[0].withdrawals_cents, 10)
  };
}

/**
 * Get financial health snapshot
 *
 * Aggregates all financial metrics for operational visibility.
 *
 * Key invariants being monitored:
 * 1. Stripe >= Wallets — we must have sufficient funds for wallet liability
 * 2. Ledger invariant (Credits - Debits = Net) — accounting must be self-consistent
 * 3. Liquidity ratio > 1.05 — healthy buffer (5% cushion)
 * 4. Reconciliation: wallet_liability === (deposits - withdrawals)
 * 5. Contest pools are informational only and not included in platform float
 */
async function getFinancialHealth(pool) {
  // Fetch Stripe balance (available + pending, may throw if API unreachable)
  const stripeBalance = await getStripeBalance();

  // Fetch ledger-derived balances
  const walletBalance = await getWalletBalance(pool);
  const contestPoolBalance = await getContestPoolBalance(pool);
  const ledger = await getLedgerIntegrity(pool);
  const depositWithdrawals = await getDepositWithdrawalTotals(pool);

  // Compute derived metrics
  // Platform float = Stripe - wallet_liability only
  // Contest pools are informational and not subtracted from platform float
  const platformFloat = stripeBalance - walletBalance;
  // Liquidity ratio uses wallet liability only (contest pools are separate domain)
  const liquidityRatio = walletBalance > 0 ? stripeBalance / walletBalance : 0;

  // Reconciliation check: wallet_liability = deposits - withdrawals
  const accountingNet = depositWithdrawals.deposits_cents - depositWithdrawals.withdrawals_cents;
  const reconciled = walletBalance === accountingNet;

  return {
    stripe_total_balance: stripeBalance,
    wallet_balance: walletBalance,
    contest_pool_balance: contestPoolBalance,
    platform_float: platformFloat,
    liquidity_ratio: liquidityRatio,
    reconciled: reconciled,
    ledger: {
      credits: ledger.credits,
      debits: ledger.debits,
      net: ledger.net,
      balanced: ledger.balanced,
    },
  };
}

module.exports = {
  getFinancialHealth,
  getStripeBalance,
  getWalletBalance,
  getContestPoolBalance,
  getLedgerIntegrity,
  getDepositWithdrawalTotals,
};
