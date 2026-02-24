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
 * Supported Strategies (from LOCK_STRATEGY_REGISTRY):
 * 1. first_game_kickoff - Lock when first game of the week/round kicks off (NFL)
 * 2. fixed_time - Lock at a specific configured time (TODO: implement)
 * 3. manual - No automatic lock (organizer triggers manually)
 * 4. time_based_lock_v1 - Generic time-based lock (sport-agnostic, suitable for golf, custom contests)
 *
 * Integration Points:
 * - Called during contest publish to compute lock_time
 * - Called by external scheduler to check if lock should occur
 * - Read-only: does not modify contest state directly
 *
 * Registry Architecture:
 * - LOCK_STRATEGY_REGISTRY is the single source of truth
 * - VALID_STRATEGIES is derived from Object.keys(LOCK_STRATEGY_REGISTRY)
 * - This prevents drift: all registered strategies are automatically whitelisted
 *
 * TODO: Implementation steps:
 * 1. Implement computeLockTime(strategyKey, context) for each strategy
 * 2. Implement shouldLock(strategyKey, contestInstance, currentTime)
 * 3. Integrate with external scheduler (cron job or event-driven)
 */

/**
 * Registry of lock strategy implementations (SINGLE SOURCE OF TRUTH)
 *
 * Each strategy is a function that computes the lock time
 * given a context object containing relevant data.
 *
 * IMPORTANT: Add new strategies here. VALID_STRATEGIES is auto-derived
 * from this registry via Object.keys(), preventing duplication and drift.
 */
const LOCK_STRATEGY_REGISTRY = {
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
  },

  /**
   * time_based_lock_v1: Generic time-based lock (sport-agnostic)
   *
   * Behavior: Contest locks when now >= lock_time.
   * No sport-specific logic, no provider lookups, no schedule dependency.
   * Suitable for contests where the organizer sets a fixed lock time
   * (e.g., golf, custom contests).
   *
   * Context required:
   * - lock_time: Date (explicit lock time from contest instance)
   *
   * Returns: The lock_time if present, null otherwise
   */
  time_based_lock_v1: (context) => {
    const { lock_time } = context;
    return lock_time ? new Date(lock_time) : null;
  }
};

// Derive valid strategies from registry (single source of truth)
const VALID_STRATEGIES = Object.freeze(Object.keys(LOCK_STRATEGY_REGISTRY));

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

  const strategy = LOCK_STRATEGY_REGISTRY[strategyKey];
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
