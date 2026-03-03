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
 * Get Stripe available balance in cents
 */
async function getStripeBalance() {
  try {
    const balance = await stripe.balance.retrieve();
    // Stripe returns balance.available as an array of amounts by currency
    // Find USD balance
    const usdBalance = balance.available.find(b => b.currency === 'usd');
    return usdBalance ? usdBalance.amount : 0;
  } catch (err) {
    console.error('[FinancialHealth] Stripe API error:', err.message);
    // Return null to indicate Stripe is unreachable
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
 * - balanced: whether ledger.net === 0 (perfect balance across all reference types)
 *
 * In a healthy ledger:
 * - Wallet credits (deposits) = Wallet debits (withdrawals)
 * - Entry fees collected = Prize payouts distributed
 * - Net should equal zero (all money accounted for)
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
    balanced: net === 0,
  };
}

/**
 * Get financial health snapshot
 *
 * Aggregates all financial metrics for operational visibility.
 *
 * Key invariants being monitored:
 * 1. Stripe >= (Wallets + Contests) — we must have sufficient funds
 * 2. Ledger.net === 0 — accounting must balance
 * 3. Liquidity ratio > 1.05 — healthy buffer (5% cushion)
 */
async function getFinancialHealth(pool) {
  // Fetch Stripe balance (may throw if API unreachable)
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
    stripe_available_balance: stripeBalance,
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
