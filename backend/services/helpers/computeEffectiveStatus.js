/**
 * Compute Effective Contest Status
 *
 * LIVE is a derived temporal state, not persisted.
 * This utility computes it deterministically from:
 * - contest.status (persisted: SCHEDULED, COMPLETE, CANCELLED)
 * - contest.start_time
 * - now (injected, replay-safe)
 *
 * Invariants:
 * 1. Terminal states (COMPLETE, CANCELLED) always override derivation
 * 2. SCHEDULED + now >= start_time → LIVE
 * 3. SCHEDULED + now < start_time → SCHEDULED
 * 4. Deterministic: same inputs → same output
 * 5. Replay-safe: uses injected now, not Date.now()
 *
 * Usage:
 *   const effectiveStatus = computeEffectiveStatus(contest, now);
 *   // effectiveStatus will be one of: SCHEDULED, LIVE, COMPLETE, CANCELLED
 *
 * Never returns LIVE from the database.
 * LIVE is only derived at read time.
 */

/**
 * Compute effective status for a contest
 *
 * @param {Object} contest - Contest object with `status` and `start_time`
 * @param {Date|number} now - Current time (injected for determinism)
 *
 * @returns {string} Effective status: SCHEDULED, LIVE, COMPLETE, or CANCELLED
 *
 * @throws {Error} If contest.status is invalid or now is not a valid Date/number
 */
function computeEffectiveStatus(contest, now) {
  // Validate inputs
  if (!contest || typeof contest !== 'object') {
    throw new Error('contest must be a non-null object');
  }

  if (!contest.status || typeof contest.status !== 'string') {
    throw new Error('contest.status is required and must be a string');
  }

  // Validate now parameter
  const nowMs = now instanceof Date ? now.getTime() : now;
  if (typeof nowMs !== 'number' || isNaN(nowMs)) {
    throw new Error('now must be a valid Date or milliseconds number');
  }

  const persistedStatus = contest.status.toUpperCase();

  // ===== TERMINAL STATES =====
  // These override any derivation
  if (persistedStatus === 'COMPLETE') return 'COMPLETE';
  if (persistedStatus === 'CANCELLED') return 'CANCELLED';

  // ===== DERIVE LIVE FROM SCHEDULED =====
  // LIVE is temporal: status = SCHEDULED AND now >= start_time
  if (persistedStatus === 'SCHEDULED') {
    if (!contest.start_time) {
      // No start_time: remains SCHEDULED indefinitely
      return 'SCHEDULED';
    }

    const startTimeMs = contest.start_time instanceof Date
      ? contest.start_time.getTime()
      : new Date(contest.start_time).getTime();

    if (isNaN(startTimeMs)) {
      // Invalid start_time: treat as indefinite SCHEDULED
      return 'SCHEDULED';
    }

    // Deterministic comparison: now >= start_time → LIVE
    if (nowMs >= startTimeMs) {
      return 'LIVE';
    }

    return 'SCHEDULED';
  }

  // ===== UNKNOWN STATUS =====
  // Return persisted status for ERROR or other states
  return persistedStatus;
}

module.exports = { computeEffectiveStatus };
