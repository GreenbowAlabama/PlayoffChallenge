/**
 * Lock Strategy Interface (Scaffold)
 *
 * Purpose:
 * Defines when a contest instance should transition from 'open' to 'locked'.
 * Lock strategies are TIME-BASED and DETERMINISTIC - they compute lock time
 * from known inputs without side effects.
 *
 * Mental Model:
 * - Template specifies a lock_strategy_key (e.g., 'first_game_kickoff', 'fixed_time')
 * - Lock strategy computes when locking should occur
 * - NO background jobs in this module - scheduling is handled elsewhere
 * - Pure computation: given inputs, returns deterministic lock time
 *
 * Supported Strategies:
 * 1. first_game_kickoff - Lock when first game of the week/round kicks off
 * 2. fixed_time - Lock at a specific configured time
 * 3. manual - No automatic lock (organizer triggers manually)
 *
 * Integration Points:
 * - Called during contest publish to compute lock_time
 * - Called by external scheduler to check if lock should occur
 * - Read-only: does not modify contest state directly
 *
 * TODO: Implementation steps:
 * 1. Implement computeLockTime(strategyKey, context) for each strategy
 * 2. Implement shouldLock(strategyKey, contestInstance, currentTime)
 * 3. Integrate with external scheduler (cron job or event-driven)
 */

const VALID_STRATEGIES = ['first_game_kickoff', 'fixed_time', 'manual'];

/**
 * Registry of lock strategy implementations
 *
 * Each strategy is a function that computes the lock time
 * given a context object containing relevant data.
 */
const strategyImplementations = {
  /**
   * first_game_kickoff: Lock at the kickoff time of the first game
   *
   * Context required:
   * - games: Array of { kickoff_time: Date } for the relevant week/round
   *
   * TODO: Implement
   */
  first_game_kickoff: (context) => {
    // TODO: Implement
    // const { games } = context;
    // if (!games || games.length === 0) return null;
    // const firstKickoff = games
    //   .map(g => new Date(g.kickoff_time))
    //   .sort((a, b) => a - b)[0];
    // return firstKickoff;

    throw new Error('Not implemented: first_game_kickoff strategy');
  },

  /**
   * fixed_time: Lock at a specific configured time
   *
   * Context required:
   * - lock_time: Date (explicit lock time from contest instance)
   *
   * TODO: Implement
   */
  fixed_time: (context) => {
    // TODO: Implement
    // const { lock_time } = context;
    // return lock_time ? new Date(lock_time) : null;

    throw new Error('Not implemented: fixed_time strategy');
  },

  /**
   * manual: No automatic lock time
   *
   * Returns null - organizer must manually trigger lock.
   */
  manual: (context) => {
    return null;
  }
};

/**
 * Compute the lock time for a contest based on its strategy
 *
 * Pure function: given strategy and context, returns deterministic lock time.
 *
 * @param {string} strategyKey - The lock strategy key from template
 * @param {Object} context - Context data needed by the strategy
 * @returns {Date|null} Computed lock time, or null if manual/undetermined
 */
function computeLockTime(strategyKey, context) {
  if (!VALID_STRATEGIES.includes(strategyKey)) {
    throw new Error(`Unknown lock strategy: ${strategyKey}`);
  }

  const strategy = strategyImplementations[strategyKey];
  return strategy(context);
}

/**
 * Check if a contest should be locked based on current time
 *
 * Deterministic check: compares lock_time with current time.
 * Does NOT perform the lock - just returns whether it should happen.
 *
 * @param {Object} contestInstance - Contest instance with lock_time
 * @param {Date} currentTime - Current time (injected for testability)
 * @returns {boolean} True if contest should be locked
 */
function shouldLock(contestInstance, currentTime = new Date()) {
  if (contestInstance.status !== 'open') {
    return false;
  }

  if (!contestInstance.lock_time) {
    return false;
  }

  const lockTime = new Date(contestInstance.lock_time);
  return currentTime >= lockTime;
}

/**
 * Validate a lock strategy key
 *
 * @param {string} strategyKey - Strategy key to validate
 * @returns {boolean} True if valid
 */
function isValidStrategy(strategyKey) {
  return VALID_STRATEGIES.includes(strategyKey);
}

module.exports = {
  // Core interface
  computeLockTime,
  shouldLock,

  // Validation
  isValidStrategy,

  // Constants
  VALID_STRATEGIES
};
