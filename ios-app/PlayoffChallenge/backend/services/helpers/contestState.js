/**
 * Contest State Helpers
 *
 * Shared helpers for computing derived contest state.
 * Used by customContestService and any endpoint returning contest data.
 */

const JOIN_STATES = {
  JOINABLE: 'JOINABLE',
  LOCKED: 'LOCKED',
  COMPLETED: 'COMPLETED',
  UNAVAILABLE: 'UNAVAILABLE',
};

/**
 * Compute the join state for a contest instance row.
 *
 * Rules:
 *   JOINABLE   — status allows joining AND (lock_time is null OR now < lock_time)
 *   LOCKED     — status allows joining AND lock_time is not null AND now >= lock_time
 *                OR status is 'locked'
 *   COMPLETED  — status is 'settled'
 *   UNAVAILABLE — status is 'cancelled', 'draft', or any unrecognised state
 *
 * @param {Object} instanceRow - Must contain at least { status, lock_time }
 * @param {Date}   [now=new Date()] - Clock override for testability
 * @returns {string} One of JOIN_STATES values
 */
function computeJoinState(instanceRow, now = new Date()) {
  const { status, lock_time } = instanceRow;

  if (status === 'COMPLETE') return JOIN_STATES.COMPLETED;
  if (status === 'CANCELLED') return JOIN_STATES.UNAVAILABLE;
  if (status === 'LOCKED') return JOIN_STATES.LOCKED;
  if (status === 'LIVE') return JOIN_STATES.UNAVAILABLE; // LIVE contests are not joinable
  if (status === 'ERROR') return JOIN_STATES.UNAVAILABLE; // ERROR contests are not joinable

  if (status === 'SCHEDULED') {
    if (lock_time !== null && lock_time !== undefined && now >= new Date(lock_time)) {
      return JOIN_STATES.LOCKED;
    }
    return JOIN_STATES.JOINABLE;
  }

  // Unknown status — fail closed
  return JOIN_STATES.UNAVAILABLE;
}

module.exports = { computeJoinState, JOIN_STATES };
