/**
 * PGA Round Validator
 *
 * Validates that a contest's tournament round is open for lineup submissions.
 *
 * CRITICAL INVARIANT:
 * This validator MUST scope all queries by contest_instance_id.
 * It must NEVER use "latest event" globally.
 *
 * BUG TO PREVENT:
 * ❌ WRONG: SELECT * FROM event_data_snapshots ORDER BY ingested_at DESC LIMIT 1
 * ✅ CORRECT: SELECT * FROM event_data_snapshots WHERE contest_instance_id = $1 ORDER BY ingested_at DESC LIMIT 1
 *
 * AUTHORITY:
 * event_data_snapshots table is authoritative per contest_instance_id.
 * No additional validation queries needed.
 */

/**
 * Validate that a contest's tournament round is open for lineup submission.
 *
 * Architecture:
 * 1. Query event_data_snapshots WHERE contest_instance_id = $contestId (contest-scoped!)
 * 2. Read payload to determine round status from ESPN data
 * 3. Return validation result (valid or reason for blocking)
 *
 * @param {Object} pool - Database connection pool
 * @param {string} contestInstanceId - Contest instance UUID
 * @returns {Promise<{valid: boolean, reason?: string}>}
 *          - {valid: true} if round is open or unknown
 *          - {valid: false, reason: "..."} if round is closed or in progress
 */
async function validateRoundOpen(pool, contestInstanceId) {
  // Query the latest event snapshot for THIS CONTEST (contest-scoped!)
  // CRITICAL: WHERE contest_instance_id = $1 ensures we check the right event
  const snapshotResult = await pool.query(
    `SELECT payload
     FROM event_data_snapshots
     WHERE contest_instance_id = $1
     ORDER BY ingested_at DESC
     LIMIT 1`,
    [contestInstanceId]
  );

  // No snapshot available for this contest yet
  // Default to allowing submissions (round state unknown)
  if (snapshotResult.rows.length === 0) {
    return { valid: true };
  }

  const payload = snapshotResult.rows[0].payload;

  // Extract round status from ESPN payload
  const roundStatus = extractRoundStatus(payload);

  // Determine if round is open
  // 'pre' = pre-tournament (lineup submission ALLOWED)
  // 'in' = in-progress (lineup submission BLOCKED)
  // 'post' = post-tournament (lineup submission BLOCKED)
  if (roundStatus === 'in') {
    return {
      valid: false,
      reason: 'Tournament round is in progress. Lineup submission is locked.'
    };
  }

  if (roundStatus === 'post') {
    return {
      valid: false,
      reason: 'Tournament round has ended. Lineup submission is closed.'
    };
  }

  // 'pre' or unknown state defaults to OPEN
  return { valid: true };
}

/**
 * Extract round status from ESPN event payload.
 *
 * Pure function: no I/O, no side effects, no error logging.
 *
 * Reads: events[0].competitions[0].status.type.state
 *
 * Possible values:
 * - 'pre' = pre-tournament
 * - 'in' = in-progress
 * - 'post' = post-tournament
 * - null = unknown/missing
 *
 * @param {Object} payload - Event data snapshot payload (from event_data_snapshots)
 * @returns {string|null} Round status state or null if not found
 */
function extractRoundStatus(payload) {
  try {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const event = payload.events?.[0];
    if (!event) {
      return null;
    }

    const competition = event.competitions?.[0];
    if (!competition) {
      return null;
    }

    const state = competition.status?.type?.state;
    return state || null;
  } catch (err) {
    // Silent failure: malformed payload defaults to allowing submissions
    return null;
  }
}

module.exports = {
  validateRoundOpen,
  extractRoundStatus
};
