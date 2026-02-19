/**
 * Presentation Derivation Service
 *
 * Pure functions that derive presentation-layer fields from contest state.
 * These are deterministic, side-effect-free functions used to compute
 * API response fields that depend on contest status and settlement state.
 *
 * Iteration 01 constraint: All derived state is computed from stable sources
 * (DB fields), never from transient or asynchronous operations.
 */

/**
 * Derive leaderboard_state from contest status and settlement existence.
 *
 * Rules:
 * - if contestRow.status === 'ERROR' return 'error'
 * - else if settlementRecordExists return 'computed'
 * - else return 'pending'
 *
 * This keeps the contract honest and deterministic by only emitting states
 * that are backed by persistent data.
 *
 * @param {Object} contestRow - Contest instance database row
 * @param {string} contestRow.status - Contest status (SCHEDULED, LOCKED, LIVE, COMPLETE, CANCELLED, ERROR)
 * @param {boolean} settlementRecordExists - Whether a settlement_records row exists for this contest
 * @returns {string} Leaderboard state: 'error', 'computed', or 'pending'
 */
function deriveLeaderboardState(contestRow, settlementRecordExists) {
  if (contestRow.status === 'ERROR') {
    return 'error';
  }
  if (settlementRecordExists) {
    return 'computed';
  }
  return 'pending';
}

/**
 * Derive available actions for a contest based on its status and user context.
 *
 * @param {Object} contestRow - Contest instance database row
 * @param {string} contestRow.status - Contest status
 * @param {string|null} contestRow.organizer_id - UUID of the contest organizer (creator)
 * @param {Date|string|null} contestRow.lock_time - Lock time for SCHEDULED contests
 * @param {string} leaderboardState - Derived leaderboard state ('error', 'computed', 'pending')
 * @param {Object} userContext - User context relative to this contest
 * @param {boolean} userContext.user_has_entered - Whether user has already joined
 * @param {number} userContext.entry_count - Current participant count
 * @param {number|null} userContext.max_entries - Maximum allowed participants (null = unlimited)
 * @param {number} currentTimestamp - Current time in milliseconds
 * @param {string|null} authenticatedUserId - UUID of authenticated user, or null if unauthenticated
 * @returns {Object} Actions object with boolean flags
 */
function deriveContestActions(contestRow, leaderboardState, userContext, currentTimestamp, authenticatedUserId = null) {
  const nowMs = currentTimestamp || Date.now();
  const lockTimeMs = contestRow.lock_time ? new Date(contestRow.lock_time).getTime() : null;

  const can_join =
    contestRow.status === 'SCHEDULED' &&
    lockTimeMs !== null &&
    nowMs < lockTimeMs &&
    (userContext.max_entries === null || userContext.entry_count < userContext.max_entries) &&
    userContext.user_has_entered === false;

  const can_edit_entry =
    contestRow.status === 'SCHEDULED' &&
    lockTimeMs !== null &&
    nowMs < lockTimeMs &&
    userContext.user_has_entered === true;

  const is_live = contestRow.status === 'LIVE';
  const is_closed = ['COMPLETE', 'CANCELLED', 'ERROR'].includes(contestRow.status);

  const is_scoring =
    ['pending'].includes(leaderboardState) &&
    ['LIVE', 'COMPLETE'].includes(contestRow.status);

  const is_scored = leaderboardState === 'computed';

  const is_read_only = !(can_join || can_edit_entry);

  // Share capability: true if authenticated user AND contest is not in ERROR state
  // ERROR is an uncontrolled system state that must not be virally propagated.
  // COMPLETE and CANCELLED are controlled outcomes and may be shared.
  const can_share_invite = authenticatedUserId !== null && contestRow.status !== 'ERROR';

  // Manage capability: true only if authenticated user is the contest creator (organizer)
  // Case-insensitive UUID comparison to handle potential casing inconsistencies
  const can_manage_contest = authenticatedUserId !== null &&
    authenticatedUserId.toLowerCase() === contestRow.organizer_id.toLowerCase();

  // Delete capability: true only if organizer AND contest is SCHEDULED
  // Organizers may only delete before lock_time
  const can_delete =
    contestRow.status === 'SCHEDULED' &&
    authenticatedUserId !== null &&
    authenticatedUserId.toLowerCase() === contestRow.organizer_id.toLowerCase();

  // Unjoin capability: true if user has entered AND contest is SCHEDULED
  // Organizers can unjoin if they have an entry. Ownership is independent of participation.
  const can_unjoin =
    contestRow.status === 'SCHEDULED' &&
    userContext.user_has_entered === true &&
    authenticatedUserId !== null;

  return {
    can_join,
    can_edit_entry,
    is_live,
    is_closed,
    is_scoring,
    is_scored,
    is_read_only,
    can_share_invite,
    can_manage_contest,
    can_delete,
    can_unjoin
  };
}

/**
 * Derive payout table from payout_structure JSONB.
 *
 * Transforms the stored payout_structure into a standardized array format
 * for presentation layer consumption.
 *
 * Handles both semantic type descriptors (e.g., { type: "winner_take_all" })
 * and numeric payout objects (e.g., { first: 100, second: 50 }).
 *
 * @param {Object|null} payoutStructureJson - Payout structure from contest_instances.payout_structure
 * @returns {Array} Array of payout rows with integer payout_percent
 * @throws {Error} If semantic type is unsupported or payout values are invalid
 */
function derivePayoutTable(payoutStructureJson) {
  if (!payoutStructureJson) {
    return [];
  }

  // Parse if string (defensive, in case JSONB came back as stringified)
  let structure = payoutStructureJson;
  if (typeof payoutStructureJson === 'string') {
    try {
      structure = JSON.parse(payoutStructureJson);
    } catch {
      return [];
    }
  }

  // Validate structure is an object
  if (typeof structure !== 'object' || structure === null) {
    return [];
  }

  // Transform semantic type descriptors into numeric payout structures
  // Handles iOS app format: { type: "winner_takes_all" | "winner_take_all" }
  if (structure.type && typeof structure.type === 'string') {
    const typeString = structure.type.toLowerCase().replace(/_/g, '');

    switch (typeString) {
      case 'winnertakesall':
      case 'winnertakeall':
        // Winner-take-all: entire pot to first place
        structure = { first: 100 };
        break;
      // Other semantic types would be handled here
      // Fail loudly on unknown types to prevent silent degradation
      default:
        throw new Error(`Unsupported payout structure type: ${structure.type}`);
    }
  }

  // Transform structure into array of payout rows
  // Expected format: { first: 70, second: 20, third: 10 } or { first: 100 } etc.
  const payoutTable = [];
  const entries = Object.entries(structure).sort((a, b) => {
    const order = ['first', 'second', 'third', 'fourth', 'fifth'];
    return order.indexOf(a[0]) - order.indexOf(b[0]);
  });

  let currentRank = 1;
  for (const [place, payout_percent] of entries) {
    // Strict type validation: payout_percent must be number or null
    // After semantic transformation, values should already be numeric
    if (payout_percent !== null && typeof payout_percent !== 'number') {
      throw new Error(`Invalid payout_percent type for place '${place}': expected number or null, got ${typeof payout_percent}`);
    }

    payoutTable.push({
      place,
      rank_min: currentRank,
      rank_max: currentRank,
      amount: null, // Computed at settlement time
      payout_percent: payout_percent == null ? null : Math.trunc(payout_percent),
      currency: 'USD'
    });
    currentRank += 1;
  }

  return payoutTable;
}

/**
 * Derive roster configuration from contest template.
 *
 * In Iteration 01, returns a minimal stable config based on available template data.
 * This is a placeholder for future template-driven roster schema.
 *
 * @param {Object|null} templateRow - Contest template database row
 * @returns {Object} Roster configuration object
 */
function deriveRosterConfig(templateRow) {
  if (!templateRow) {
    return {
      entry_fields: [],
      validation_rules: {}
    };
  }

  // Minimal stable config based on template type
  return {
    entry_fields: [],
    validation_rules: {}
  };
}

/**
 * Derive column schema for leaderboard rendering.
 *
 * Returns a deterministic schema for the leaderboard columns.
 * In Iteration 01, uses a stable default schema.
 *
 * @param {Object|null} templateRow - Contest template database row
 * @returns {Array} Array of column schema objects
 */
function deriveColumnSchema(templateRow) {
  // Stable default schema that supports existing standings shape
  return [
    {
      key: 'rank',
      label: 'Rank',
      type: 'number',
      sortable: true
    },
    {
      key: 'user_display_name',
      label: 'Participant',
      type: 'string',
      sortable: true
    },
    {
      key: 'total_score',
      label: 'Score',
      type: 'number',
      sortable: true
    }
  ];
}

module.exports = {
  deriveLeaderboardState,
  deriveContestActions,
  derivePayoutTable,
  deriveRosterConfig,
  deriveColumnSchema
};
