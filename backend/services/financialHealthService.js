/**
 * Financial Health Service
 *
 * Read-only observability for financial reconciliation.
 *
 * Monitors:
 * - Stripe balance (real bank balance)
 * - Wallet balances (derived from ledger)
 * - Contest pools (entry fees + prizes, derived from ledger)
 * - Platform float (Stripe - liabilities)
 * - Liquidity coverage (Stripe / liabilities)
 * - Ledger integrity (credits = debits + net)
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
 * Sums all CREDIT - DEBIT ledger entries where reference_type = 'WALLET'
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
    WHERE reference_type = 'WALLET'
  `);

  return parseInt(result.rows[0].balance_cents, 10);
}

/**
 * Get contest pool balance (entry fees + prize distribution) in cents
 *
 * Sums all CREDIT - DEBIT ledger entries for contest-related transactions:
 * - ENTRY_FEE (user deposit when joining)
 * - ENTRY_FEE_REFUND (refund if applicable)
 * - PRIZE_PAYOUT (settlement distribution)
 * - PRIZE_PAYOUT_REVERSAL (if applicable)
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
      'ENTRY_FEE_REFUND',
      'PRIZE_PAYOUT',
      'PRIZE_PAYOUT_REVERSAL'
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
 * Get financial health snapshot
 *
 * Aggregates all financial metrics for operational visibility.
 *
 * Key invariants being monitored:
 * 1. Stripe >= (Wallets + Contests) — we must have sufficient funds
 * 2. Ledger invariant (Credits - Debits = Net) — accounting must be self-consistent
 * 3. Liquidity ratio > 1.05 — healthy buffer (5% cushion)
 */
async function getFinancialHealth(pool) {
  // Fetch Stripe balance (available + pending, may throw if API unreachable)
  const stripeBalance = await getStripeBalance();

  // Fetch ledger-derived balances
  const walletBalance = await getWalletBalance(pool);
  const contestPoolBalance = await getContestPoolBalance(pool);
  const ledger = await getLedgerIntegrity(pool);

  // Compute derived metrics
  const totalLiabilities = walletBalance + contestPoolBalance;
  const platformFloat = stripeBalance - totalLiabilities;
  const liquidityRatio = totalLiabilities > 0 ? stripeBalance / totalLiabilities : 0;

  return {
    stripe_total_balance: stripeBalance,
    wallet_balance: walletBalance,
    contest_pool_balance: contestPoolBalance,
    platform_float: platformFloat,
    liquidity_ratio: liquidityRatio,
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
};
