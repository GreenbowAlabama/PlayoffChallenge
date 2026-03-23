/**
 * Orphaned Funds Service
 *
 * Handles identification and refunding of stranded funds in cancelled contests.
 * All operations are deterministic and idempotent.
 */

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

/**
 * Get summary of all contests with stranded funds (cancelled contests with ENTRY_FEE debits).
 * Excludes contests where all entry fees have been fully refunded.
 *
 * @param {Object} pool - Database pool
 * @returns {Promise<Array>} Array of contests with stranded funds
 */
async function getOrphanedFundsSummary(pool) {
  const result = await pool.query(
    `SELECT
       ci.id,
       ci.contest_name,
       ci.status,
       ci.created_at,
       COUNT(DISTINCT debit_ledger.user_id) as affected_user_count,
       SUM(CASE WHEN debit_ledger.direction = 'DEBIT' THEN debit_ledger.amount_cents ELSE 0 END) as total_debit_cents,
       COALESCE(SUM(CASE WHEN refund_ledger.entry_type = 'ENTRY_FEE_REFUND' AND refund_ledger.direction = 'CREDIT' THEN refund_ledger.amount_cents ELSE 0 END), 0) as total_refund_cents,
       MAX(refund_ledger.created_at) as refunded_at
     FROM contest_instances ci
     LEFT JOIN ledger debit_ledger ON ci.id = debit_ledger.contest_instance_id
       AND debit_ledger.entry_type = 'ENTRY_FEE'
       AND debit_ledger.direction = 'DEBIT'
     LEFT JOIN ledger refund_ledger ON ci.id = refund_ledger.contest_instance_id
       AND refund_ledger.entry_type = 'ENTRY_FEE_REFUND'
       AND refund_ledger.direction = 'CREDIT'
     WHERE ci.status = 'CANCELLED'
     GROUP BY ci.id, ci.contest_name, ci.status, ci.created_at
     HAVING SUM(CASE WHEN debit_ledger.direction = 'DEBIT' THEN debit_ledger.amount_cents ELSE 0 END) > 0
       AND SUM(CASE WHEN debit_ledger.direction = 'DEBIT' THEN debit_ledger.amount_cents ELSE 0 END)
         > COALESCE(SUM(CASE WHEN refund_ledger.entry_type = 'ENTRY_FEE_REFUND' AND refund_ledger.direction = 'CREDIT' THEN refund_ledger.amount_cents ELSE 0 END), 0)
     ORDER BY SUM(CASE WHEN debit_ledger.direction = 'DEBIT' THEN debit_ledger.amount_cents ELSE 0 END) - COALESCE(SUM(CASE WHEN refund_ledger.entry_type = 'ENTRY_FEE_REFUND' AND refund_ledger.direction = 'CREDIT' THEN refund_ledger.amount_cents ELSE 0 END), 0) DESC`
  );

  return result.rows.map(row => ({
    contest_id: row.id,
    contest_name: row.contest_name,
    status: row.status,
    affected_user_count: parseInt(row.affected_user_count, 10),
    total_stranded_cents: parseInt(row.total_debit_cents, 10) - parseInt(row.total_refund_cents, 10),
    created_at: row.created_at,
    refunded_at: row.refunded_at
  }));
}

/**
 * Get affected users for a specific contest with stranded funds.
 *
 * @param {Object} pool - Database pool
 * @param {string} contestId - Contest instance ID
 * @returns {Promise<Object>} Object with contest info and affected users array
 */
async function getContestAffectedUsers(pool, contestId) {
  // Get contest info
  const contestResult = await pool.query(
    `SELECT id, contest_name, status FROM contest_instances WHERE id = $1`,
    [contestId]
  );

  if (contestResult.rows.length === 0) {
    throw new Error(`Contest ${contestId} not found`);
  }

  const contest = contestResult.rows[0];

  // Get affected users
  const usersResult = await pool.query(
    `SELECT
       l.user_id,
       u.email,
       u.username,
       SUM(CASE WHEN l.direction = 'DEBIT' THEN l.amount_cents ELSE 0 END) as stranded_cents
     FROM ledger l
     LEFT JOIN users u ON l.user_id = u.id
     WHERE l.contest_instance_id = $1
       AND l.entry_type = 'ENTRY_FEE'
       AND l.direction = 'DEBIT'
     GROUP BY l.user_id, u.email, u.username
     ORDER BY stranded_cents DESC`,
    [contestId]
  );

  const totalStrandedCents = usersResult.rows.reduce(
    (sum, row) => sum + parseInt(row.stranded_cents, 10),
    0
  );

  return {
    contest_id: contest.id,
    contest_name: contest.contest_name,
    status: contest.status,
    affected_users: usersResult.rows.map(row => ({
      user_id: row.user_id,
      email: row.email,
      username: row.username,
      stranded_cents: parseInt(row.stranded_cents, 10)
    })),
    total_stranded_cents: totalStrandedCents
  };
}

/**
 * Execute refund for all affected users in a contest.
 * Idempotent: Multiple calls produce same result (single ledger entry per user).
 *
 * @param {Object} pool - Database pool
 * @param {string} contestId - Contest instance ID
 * @param {string} adminId - Admin user ID (audit trail)
 * @param {string} reason - Human-readable reason for refund
 * @returns {Promise<Object>} Refund run result
 */
async function refundContest(pool, contestId, adminId, reason) {
  const client = await pool.connect();
  const refundRunId = uuidv4();

  try {
    await client.query('BEGIN');

    // Get affected users and their stranded amounts
    const usersResult = await client.query(
      `SELECT
         l.user_id,
         SUM(CASE WHEN l.direction = 'DEBIT' THEN l.amount_cents ELSE 0 END) as stranded_cents
       FROM ledger l
       WHERE l.contest_instance_id = $1
         AND l.entry_type = 'ENTRY_FEE'
         AND l.direction = 'DEBIT'
       GROUP BY l.user_id`,
      [contestId]
    );

    let refundedCount = 0;
    let totalRefundedCents = 0;
    const refundErrors = [];

    // Process each affected user
    for (const userRow of usersResult.rows) {
      const userId = userRow.user_id;
      const strandedCents = parseInt(userRow.stranded_cents, 10);

      // Deterministic idempotency key
      const idempotencyKey = computeRefundIdempotencyKey(contestId, userId);

      try {
        // Check if refund already exists for this user
        const existingResult = await client.query(
          `SELECT id, amount_cents FROM ledger
           WHERE idempotency_key = $1`,
          [idempotencyKey]
        );

        if (existingResult.rows.length > 0) {
          // Refund already exists; verify it matches expected amount
          const existing = existingResult.rows[0];
          if (existing.amount_cents !== strandedCents) {
            refundErrors.push({
              user_id: userId,
              error: 'Field mismatch: existing refund has different amount',
              expected: strandedCents,
              actual: existing.amount_cents
            });
            continue;
          }
          // Refund already exists with correct amount; count as refunded
          refundedCount += 1;
          totalRefundedCents += strandedCents;
          continue;
        }

        // Insert refund ledger entry (CREDIT)
        await client.query(
          `INSERT INTO ledger (
             user_id,
             entry_type,
             direction,
             amount_cents,
             currency,
             reference_type,
             reference_id,
             idempotency_key,
             metadata_json,
             created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
          [
            userId,
            'ENTRY_FEE_REFUND',
            'CREDIT',
            strandedCents,
            'USD',
            'CONTEST',
            contestId,
            idempotencyKey,
            JSON.stringify({
              refund_run_id: refundRunId,
              admin_id: adminId,
              reason: reason
            })
          ]
        );

        refundedCount += 1;
        totalRefundedCents += strandedCents;
      } catch (err) {
        // Log error but continue processing other users
        refundErrors.push({
          user_id: userId,
          error: err.message
        });
      }
    }

    await client.query('COMMIT');

    return {
      success: refundErrors.length === 0,
      refund_run_id: refundRunId,
      contest_id: contestId,
      refunded_count: refundedCount,
      total_refunded_cents: totalRefundedCents,
      errors: refundErrors.length > 0 ? refundErrors : undefined,
      timestamp: new Date().toISOString()
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Compute deterministic idempotency key for a refund.
 * Used to ensure idempotency across multiple refund runs.
 *
 * @param {string} contestId - Contest instance ID
 * @param {string} userId - User ID
 * @returns {string} Deterministic idempotency key
 */
function computeRefundIdempotencyKey(contestId, userId) {
  const input = `refund:${contestId}:${userId}`;
  return crypto.createHash('sha256').update(input).digest('hex');
}

module.exports = {
  getOrphanedFundsSummary,
  getContestAffectedUsers,
  refundContest
};
