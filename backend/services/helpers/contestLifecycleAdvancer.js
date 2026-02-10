/**
 * services/helpers/contestLifecycleAdvancer.js
 *
 * Determines time-driven SYSTEM actor state transitions with ERROR recovery.
 *
 * Core responsibilities:
 *   1. advanceContestLifecycleIfNeeded — pure function suggesting next state
 *   2. attemptSystemTransitionWithErrorRecovery — orchestrates transition execution + ERROR fallback
 *      (caller provides the actual DB operation via callback)
 *   3. Audit trail coordination for SYSTEM transitions (success and failure→ERROR)
 *
 * NOTE: This is not a pure utility module. It orchestrates state transitions with side effects
 * (audit writes). However, actual DB state changes are delegated to the caller via callbacks
 * to avoid circular dependencies with customContestService.
 *
 * This is part of read-path self-healing (GAP-06) and ERROR recovery (GAP-07).
 */

const { ACTORS, assertAllowedDbStatusTransition } = require('./contestTransitionValidator');

/**
 * Write a SYSTEM-driven audit record for state transitions.
 * Uses NULL for actor_id to denote automated SYSTEM action (not admin action).
 *
 * @param {Object} pool - Database connection pool
 * @param {string} contestId - Contest instance UUID
 * @param {string} action - Action type (e.g., 'system_error_transition')
 * @param {string} reason - Human-readable reason for the transition
 * @param {Object} payload - Additional context (error name, attempted status, etc.)
 */
async function writeSystemAudit(pool, contestId, action, reason, payload) {
  try {
    await pool.query(
      `INSERT INTO admin_contest_audit (contest_id, admin_user_id, action, reason, payload)
       VALUES ($1, $2, $3, $4, $5)`,
      [contestId, null, action, reason, JSON.stringify(payload || {})]
    );
  } catch (auditErr) {
    // Log audit failures but do not block the operation
    console.error(`[GAP-07] Failed to write SYSTEM audit for contest ${contestId}:`, auditErr.message);
  }
}

/**
 * Determines whether a contest is eligible to complete based on game state.
 *
 * NOTE: This is intentionally stubbed for v1. LIVE → COMPLETE is gated by
 * settlement readiness, which is implemented in GAP-08.
 *
 * @param {Object} contest - The contest instance object.
 * @returns {boolean} - Always returns false (completion blocked until GAP-08).
 */
function isContestGamesComplete(contest) {
  return false;
}

/**
 * Determines the next logical status for a contest based on time and game completion.
 *
 * @param {Object} contest - The contest instance object (fully loaded from DB).
 * @returns {string|null} - The new status if a transition is due, otherwise null.
 */
function advanceContestLifecycleIfNeeded(contest) {
  const now = Date.now(); // Current time in milliseconds

  switch (contest.status) {
    case 'SCHEDULED':
      if (contest.lock_time && now >= new Date(contest.lock_time).getTime()) {
        return 'LOCKED';
      }
      return null;

    case 'LOCKED':
      if (contest.start_time && now >= new Date(contest.start_time).getTime()) {
        return 'LIVE';
      }
      return null;

    case 'LIVE':
      // LIVE -> COMPLETE is purely based on game completion, not end_time
      if (isContestGamesComplete(contest)) {
        return 'COMPLETE';
      }
      return null;

    case 'COMPLETE':
    case 'CANCELLED':
      // These are terminal states, no further automatic transitions
      return null;

    default:
      // Unknown or unhandled status, no automatic transition
      return null;
  }
}

/**
 * Attempt a SYSTEM-driven status transition with ERROR recovery.
 *
 * Orchestrates the execution of a time-driven state change. If the primary transition fails,
 * attempts to move the contest to ERROR state instead (GAP-07: no silent failures).
 *
 * Actual DB state changes are performed via the provided updateFn callback.
 * This design avoids circular dependencies while maintaining contract guarantees.
 *
 * Contract guarantees:
 *   - Only SYSTEM actor can call this (enforced by transition validator)
 *   - If primary transition fails, attempts ERROR transition
 *   - If ERROR transition succeeds, audit trail is written with failure context
 *   - If ERROR transition also fails, original error is re-thrown (never silent)
 *   - All transitions are idempotent (conditional UPDATE using WHERE status = current)
 *
 * @param {Object} pool - Database connection pool (for audit writes)
 * @param {Object} contestRow - Full contest instance row from database
 * @param {string} nextStatus - Target status from advanceContestLifecycleIfNeeded()
 * @param {Function} updateFn - Async callback: updateFn(pool, contestId, targetStatus)
 *                             Must perform idempotent conditional UPDATE and return updated row or null
 * @returns {Promise<Object|null>} Updated contest row, or null if no change occurred
 */
async function attemptSystemTransitionWithErrorRecovery(pool, contestRow, nextStatus, updateFn) {
  // Guard: if no transition is due, return null
  if (!nextStatus) {
    return null;
  }

  try {
    // Attempt the primary time-driven transition
    return await updateFn(pool, contestRow.id, nextStatus);
  } catch (primaryError) {
    // Primary transition failed. Attempt to move to ERROR as safe harbor (GAP-07).
    const currentStatus = contestRow.status;

    // Safety check: don't attempt ERROR transition if already terminal or in ERROR
    if (currentStatus === 'ERROR' || currentStatus === 'COMPLETE' || currentStatus === 'CANCELLED') {
      throw primaryError;
    }

    try {
      // Validate that SYSTEM actor can transition to ERROR from current status
      assertAllowedDbStatusTransition({
        fromStatus: currentStatus,
        toStatus: 'ERROR',
        actor: ACTORS.SYSTEM
      });
    } catch (validationErr) {
      // ERROR transition not allowed. Re-throw original error.
      throw primaryError;
    }

    try {
      // Attempt conditional UPDATE to ERROR (idempotent)
      const errorRow = await updateFn(pool, contestRow.id, 'ERROR');

      // Successfully transitioned to ERROR. Record the failure in SYSTEM audit trail.
      await writeSystemAudit(
        pool,
        contestRow.id,
        'system_error_transition',
        `Automatic transition to ERROR due to failed attempt to transition to ${nextStatus}`,
        {
          attempted_status: nextStatus,
          error_name: primaryError.name,
          error_message: primaryError.message
        }
      );

      return errorRow;
    } catch (errorTransitionErr) {
      // Even ERROR transition failed. Log but do not mask original error.
      console.error(
        `[GAP-07] Failed to transition contest ${contestRow.id} to ERROR:`,
        errorTransitionErr.message
      );
      throw primaryError;
    }
  }
}

module.exports = {
  advanceContestLifecycleIfNeeded,
  attemptSystemTransitionWithErrorRecovery,
  writeSystemAudit,
};
