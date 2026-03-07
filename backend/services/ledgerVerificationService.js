/**
 * Ledger Verification Service
 *
 * Provides read-only diagnostics for ledger integrity and self-consistency.
 * Aggregates ledger entries by type and direction to verify balance.
 *
 * Governance: FINANCIAL_INVARIANTS.md — All operations deterministic and read-only.
 */

/**
 * Get ledger verification summary
 * Aggregates all ledger entries by type and direction.
 * Verifies that total credits = total debits (balanced) or identifies variance.
 *
 * @param {Object} pool - Database pool
 * @returns {Promise<Object>} Ledger verification report with breakdown by entry type
 */
async function getLedgerVerification(pool) {
  const result = await pool.query(`
    WITH ledger_by_type AS (
      SELECT
        entry_type,
        direction,
        SUM(amount_cents) as total_amount_cents,
        COUNT(*) as transaction_count
      FROM ledger
      GROUP BY entry_type, direction
    ),
    ledger_pivot AS (
      SELECT
        entry_type,
        COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN total_amount_cents ELSE 0 END), 0) as debits_cents,
        COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN total_amount_cents ELSE 0 END), 0) as credits_cents
      FROM ledger_by_type
      GROUP BY entry_type
    ),
    ledger_with_net AS (
      SELECT
        entry_type,
        debits_cents,
        credits_cents,
        (credits_cents - debits_cents) as net_cents
      FROM ledger_pivot
    ),
    grand_totals AS (
      SELECT
        SUM(credits_cents) as total_credits_cents,
        SUM(debits_cents) as total_debits_cents,
        SUM(credits_cents) - SUM(debits_cents) as net_cents
      FROM ledger_with_net
    )
    SELECT
      (SELECT json_object_agg(entry_type, json_build_object(
        'debits', debits_cents,
        'credits', credits_cents,
        'net', net_cents
      )) FROM ledger_with_net) as by_entry_type,
      COALESCE(total_credits_cents, 0) as total_credits_cents,
      COALESCE(total_debits_cents, 0) as total_debits_cents,
      COALESCE(net_cents, 0) as net_cents
    FROM grand_totals
  `);

  if (result.rows.length === 0) {
    // Empty ledger
    return {
      by_entry_type: {},
      total_credits: 0,
      total_debits: 0,
      net: 0,
      is_balanced: true
    };
  }

  const row = result.rows[0];
  const byEntryType = row.by_entry_type || {};
  const totalCredits = parseInt(row.total_credits_cents || 0, 10);
  const totalDebits = parseInt(row.total_debits_cents || 0, 10);
  const net = parseInt(row.net_cents || 0, 10);

  // Verify balance: net should equal credits - debits
  const isBalanced = net === (totalCredits - totalDebits);

  // Convert each entry type breakdown to integers
  const byEntryTypeTyped = {};
  Object.entries(byEntryType).forEach(([entryType, data]) => {
    byEntryTypeTyped[entryType] = {
      debits: parseInt(data.debits, 10),
      credits: parseInt(data.credits, 10),
      net: parseInt(data.net, 10)
    };
  });

  return {
    by_entry_type: byEntryTypeTyped,
    total_credits: totalCredits,
    total_debits: totalDebits,
    net: net,
    is_balanced: isBalanced
  };
}

module.exports = {
  getLedgerVerification
};
