/**
 * Contest Pool Diagnostics Service
 *
 * Identifies contests with negative pool balances and classifies root causes.
 * Used for operational observability and debugging financial issues.
 */

/**
 * Get all contests with negative pool balances
 * Calculates entry fee net (debits - refunds) and prize net (payouts - reversals)
 * Classifies root cause based on ledger composition
 *
 * @param {Object} pool - Database pool
 * @returns {Promise<Array>} Array of contests with negative pools, ordered by most negative first
 */
async function getNegativePoolContests(pool) {
  const result = await pool.query(`
    WITH contest_ledger_summary AS (
      SELECT
        ci.id,
        ci.contest_name,
        ci.status,
        ci.created_at,
        (SELECT COUNT(DISTINCT user_id) FROM contest_participants WHERE contest_instance_id = ci.id) as participant_count,
        -- Pool balance: canonical formula using ledger direction
        -- DEBIT = positive (deducted from pool), CREDIT = negative (credited to pool)
        COALESCE(
          SUM(
            CASE
              WHEN l.direction = 'DEBIT' THEN l.amount_cents
              WHEN l.direction = 'CREDIT' THEN -l.amount_cents
              ELSE 0
            END
          ),
          0
        ) as pool_balance_cents,
        -- Ledger breakdown for root cause analysis
        COALESCE(SUM(CASE WHEN l.entry_type = 'ENTRY_FEE' AND l.direction = 'DEBIT' THEN l.amount_cents ELSE 0 END), 0) as entry_fee_debits_cents,
        COALESCE(SUM(CASE WHEN l.entry_type = 'ENTRY_FEE_REFUND' AND l.direction = 'CREDIT' THEN l.amount_cents ELSE 0 END), 0) as entry_fee_refunds_cents,
        COALESCE(SUM(CASE WHEN l.entry_type = 'PRIZE_PAYOUT' AND l.direction = 'CREDIT' THEN l.amount_cents ELSE 0 END), 0) as prize_payout_cents,
        COALESCE(SUM(CASE WHEN l.entry_type = 'PRIZE_PAYOUT_REVERSAL' AND l.direction = 'DEBIT' THEN l.amount_cents ELSE 0 END), 0) as prize_reversal_cents
      FROM contest_instances ci
      LEFT JOIN ledger l ON ci.id = l.contest_instance_id
      GROUP BY ci.id, ci.contest_name, ci.status, ci.created_at
    ),
    classified_pools AS (
      SELECT
        id,
        contest_name,
        status,
        created_at,
        participant_count,
        entry_fee_debits_cents,
        entry_fee_refunds_cents,
        (entry_fee_debits_cents - entry_fee_refunds_cents) as entry_fee_net_cents,
        prize_payout_cents,
        prize_reversal_cents,
        (prize_payout_cents - prize_reversal_cents) as prize_net_cents,
        pool_balance_cents,
        CASE
          -- Payouts exist but no entry fees collected (most specific)
          WHEN entry_fee_debits_cents = 0 AND prize_payout_cents > 0 THEN 'NO_ENTRIES_WITH_PAYOUTS'
          -- Entry fees were refunded but payouts still exist
          WHEN entry_fee_refunds_cents > 0 AND prize_payout_cents > 0 THEN 'REFUNDED_ENTRIES_WITH_PAYOUTS'
          -- Payouts exceed available entry fees
          WHEN prize_payout_cents > entry_fee_debits_cents THEN 'PAYOUTS_EXCEED_ENTRIES'
          -- Multiple issues
          ELSE 'MIXED'
        END as root_cause
      FROM contest_ledger_summary
      WHERE pool_balance_cents < 0
        AND status IN ('SCHEDULED','LOCKED','LIVE','COMPLETE')
    )
    SELECT
      id as contest_id,
      contest_name,
      status,
      created_at,
      participant_count,
      entry_fee_debits_cents,
      entry_fee_refunds_cents,
      entry_fee_net_cents,
      prize_payout_cents,
      prize_reversal_cents,
      prize_net_cents,
      pool_balance_cents,
      root_cause
    FROM classified_pools
    ORDER BY pool_balance_cents ASC
  `);

  return result.rows.map(row => ({
    contest_id: row.contest_id,
    contest_name: row.contest_name,
    status: row.status,
    created_at: row.created_at,
    participant_count: parseInt(row.participant_count, 10),
    entry_fee_debits_cents: parseInt(row.entry_fee_debits_cents, 10),
    entry_fee_refunds_cents: parseInt(row.entry_fee_refunds_cents, 10),
    entry_fee_net_cents: parseInt(row.entry_fee_net_cents, 10),
    prize_payout_cents: parseInt(row.prize_payout_cents, 10),
    prize_reversal_cents: parseInt(row.prize_reversal_cents, 10),
    prize_net_cents: parseInt(row.prize_net_cents, 10),
    pool_balance_cents: parseInt(row.pool_balance_cents, 10),
    root_cause: row.root_cause
  }));
}

/**
 * Get detailed ledger breakdown for a specific contest
 * Shows all ledger entries grouped by type and direction
 *
 * @param {Object} pool - Database pool
 * @param {string} contestId - Contest instance ID
 * @returns {Promise<Object>} Contest details with ledger breakdown
 * @throws {Error} If contest not found
 */
async function getContestPoolDetails(pool, contestId) {
  // Verify contest exists
  const contestResult = await pool.query(
    `SELECT id, contest_name, status, created_at FROM contest_instances WHERE id = $1`,
    [contestId]
  );

  if (contestResult.rows.length === 0) {
    throw new Error(`Contest ${contestId} not found`);
  }

  const contest = contestResult.rows[0];

  // Get participant count
  const participantResult = await pool.query(
    `SELECT COUNT(DISTINCT user_id) as participant_count FROM contest_participants WHERE contest_instance_id = $1`,
    [contestId]
  );

  const participantCount = participantResult.rows.length > 0
    ? parseInt(participantResult.rows[0].participant_count, 10)
    : 0;

  // Get ledger breakdown grouped by entry type and direction
  const ledgerResult = await pool.query(`
    SELECT
      entry_type,
      direction,
      COUNT(*) as transaction_count,
      SUM(amount_cents) as total_amount_cents,
      MIN(created_at) as first_transaction_at,
      MAX(created_at) as last_transaction_at
    FROM ledger
    WHERE contest_instance_id = $1
    GROUP BY entry_type, direction
    ORDER BY entry_type, direction
  `, [contestId]);

  const ledgerBreakdown = ledgerResult.rows.map(row => ({
    entry_type: row.entry_type,
    direction: row.direction,
    transaction_count: parseInt(row.transaction_count, 10),
    total_amount_cents: parseInt(row.total_amount_cents, 10),
    first_transaction_at: row.first_transaction_at,
    last_transaction_at: row.last_transaction_at
  }));

  return {
    contest_id: contestId,
    contest_name: contest.contest_name,
    status: contest.status,
    created_at: contest.created_at,
    participant_count: participantCount,
    ledger_breakdown: ledgerBreakdown
  };
}

module.exports = {
  getNegativePoolContests,
  getContestPoolDetails
};
