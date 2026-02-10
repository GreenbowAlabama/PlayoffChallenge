/**
 * services/helpers/contestLifecycleAdvancer.js
 *
 * Pure function to determine if a contest's lifecycle state should be advanced.
 * Does NOT perform database writes, logging, or state validation beyond internal logic.
 * It suggests a new state based on current time and contest properties.
 */

/**
 * STUB: Determines if all games associated with a contest are complete.
 * This needs to be properly implemented for the LIVE -> COMPLETE transition.
 *
 * @param {Object} contest - The contest instance object.
 * @returns {boolean} - Always returns false for now.
 */
function isContestGamesComplete(contest) {
  // TODO: Implement actual game completion logic.
  // This will likely involve querying 'picks', 'players', and 'scores' tables
  // to verify all games for picked players in the contest's relevant week are finished and scored.
  // The relevant week might need to be derived from the contest's end_time or a direct contest-game association.
  // For now, returning false to prevent premature completion.
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

module.exports = {
  advanceContestLifecycleIfNeeded,
};
