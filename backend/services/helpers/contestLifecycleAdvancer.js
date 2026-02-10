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
 * Records automated SYSTEM actions using the canonical SYSTEM user ID.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} contestId - Contest instance UUID
 * @param {string} action - Action type (e.g., 'system_error_transition')
 * @param {string} reason - Human-readable reason for the transition
 * @param {Object} payload - Additional context (error name, attempted status, etc.)
 */
async function writeSystemAudit(pool, contestId, action, reason, payload) {
  // Canonical SYSTEM user ID for automated actions
  const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

  try {
    await pool.query(
      `INSERT INTO admin_contest_audit (contest_id, admin_user_id, action, reason, payload)
       VALUES ($1, $2, $3, $4, $5)`,
      [contestId, SYSTEM_USER_ID, action, reason, JSON.stringify(payload || {})]
    );
  } catch (auditErr) {
    // Log audit failures but do not block the operation
    console.error(`[GAP-07] Failed to write SYSTEM audit for contest ${contestId}:`, auditErr.message);
  }
}

/**
 * Determines whether a contest is eligible to complete based on game state AND settlement.
 *
 * IMPORTANT: Settlement is a PRECONDITION for COMPLETE state, not a post-condition.
 * This function checks if the contest can advance to COMPLETE by verifying:
 * 1. Games have finished (end_time has passed)
 * 2. Settlement is ready (verified via isReadyForSettlement)
 *
 * If settlement readiness check fails, the error bubbles up to the caller
 * (attemptSystemTransitionWithErrorRecovery), which catches it and transitions
 * the contest to ERROR (LIVE→ERROR).
 *
 * Contract guarantee: Contests only reach COMPLETE if settlement readiness succeeds.
 *
 * CRITICAL: This function is READ-ONLY. It does not persist any data, does not
 * write settle_time, and has no side effects. Settlement execution (writing results,
 * timestamps) happens in GAP-09 after the contest reaches COMPLETE state.
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} contest - The contest instance object.
 * @returns {Promise<boolean>} - True if games are complete AND settlement is ready, false otherwise.
 * @throws {Error} - If settlement readiness check fails (caught by attemptSystemTransitionWithErrorRecovery)
 */
async function isContestGamesComplete(pool, contest) {
  // Step 1: Check if end_time has passed (time gate)
  const now = Date.now();
  if (!contest.end_time || now < new Date(contest.end_time).getTime()) {
    // Games are still in progress or end_time not yet reached
    return false;
  }

  // Step 2: If end_time has passed, verify settlement readiness
  // This will throw if settlement is not ready, and the error propagates
  // to attemptSystemTransitionWithErrorRecovery, which transitions to ERROR.

  const settlementStrategy = require('../settlementStrategy');

  // Check if settlement is ready (all participants have scores for all weeks)
  const isReady = await settlementStrategy.isReadyForSettlement(pool, contest.id);

  if (!isReady) {
    // Settlement preconditions not met (e.g., scores not finalized)
    // Return false to keep contest in LIVE state
    return false;
  }

  // Settlement readiness check passed. Return true to allow COMPLETE transition.
  // The actual settlement execution (writing results, setting settle_time) is deferred
  // to GAP-09 and happens when the contest is in COMPLETE state, not here.
  return true;
}

/**
 * Determines the next logical status for a contest based on time and game completion.
 *
 * PURE FUNCTION: No database access, no side effects. This is used for read-path
 * self-healing to suggest the next state. The actual validation happens in
 * attemptSystemTransitionWithErrorRecovery where pool is available.
 *
 * For LIVE→COMPLETE transition, this suggests COMPLETE based on end_time only.
 * Settlement readiness validation happens inside the error recovery boundary
 * (in attemptSystemTransitionWithErrorRecovery), not here.
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
      // Suggest COMPLETE if end_time has passed
      // Settlement readiness validation happens in attemptSystemTransitionWithErrorRecovery
      if (contest.end_time && now >= new Date(contest.end_time).getTime()) {
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
 * SPECIAL CASE (GAP-08): When attempting LIVE→COMPLETE, failures are settlement-related
 * (isContestGamesComplete checks settlement readiness). These failures are marked in the
 * audit trail with settlement_failure: true, error_origin: 'settlement_readiness_check',
 * and error stack trace for debugging.
 *
 * Actual DB state changes are performed via the provided updateFn callback.
 * This design avoids circular dependencies while maintaining contract guarantees.
 *
 * Contract guarantees:
 *   - Only SYSTEM actor can call this (enforced by transition validator)
 *   - If primary transition fails, attempts ERROR transition
 *   - If ERROR transition succeeds, audit trail is written with failure context (enhanced for settlement)
 *   - If ERROR transition also fails, original error is re-thrown (never silent)
 *   - All transitions are idempotent (conditional UPDATE using WHERE status = current)
 *   - Settlement failures are distinguishable from other time-driven errors in audit trail
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
    // GAP-08: Settlement validation must occur inside recovery boundary
    // If attempting LIVE→COMPLETE, verify settlement is ready before DB update
    if (nextStatus === 'COMPLETE' && contestRow.status === 'LIVE') {
      // This call may throw if settlement is not ready
      // The error will be caught below and trigger ERROR recovery
      await isContestGamesComplete(pool, contestRow);
    }

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
      // GAP-08: Enhance payload for settlement-triggered failures (LIVE→COMPLETE)
      const auditPayload = {
        attempted_status: nextStatus,
        error_name: primaryError.name,
        error_message: primaryError.message
      };

      // If this was a LIVE→COMPLETE failure, mark as settlement-related
      if (nextStatus === 'COMPLETE' && currentStatus === 'LIVE') {
        auditPayload.settlement_failure = true;
        auditPayload.error_origin = 'settlement_readiness_check';
        // Include stack trace for settlement failures (helps debugging settlement logic)
        if (primaryError.stack) {
          auditPayload.error_stack = primaryError.stack.substring(0, 1000);
        }
      }

      await writeSystemAudit(
        pool,
        contestRow.id,
        'system_error_transition',
        `Automatic transition to ERROR due to failed attempt to transition to ${nextStatus}`,
        auditPayload
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
  isContestGamesComplete, // Exported for testing (GAP-08)
};
