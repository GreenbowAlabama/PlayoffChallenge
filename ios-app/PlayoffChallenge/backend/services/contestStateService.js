/**
 * Contest State Service (GAP-05)
 *
 * Centralized state transition logic for contest instances, enforcing the
 * Contest Lifecycle Contract v1. This module is the single source of truth
 * for all contest status changes.
 *
 * It provides a single function, `transitionState`, which validates and
 * authorizes all state transitions based on the contract's transition graph.
 * This prepares the system for GAP-06 (automation) by providing a safe,
 * auditable, and centralized mechanism for system-driven state changes.
 *
 * All status updates MUST be routed through this service.
 *
 * The service maps the contract's conceptual states to the database's
 * legacy enum values. This mapping is critical for correct operation.
 *
 * Contract State <-> DB `status` column
 * ---------------------------------------
 * SCHEDULED      <-> 'draft', 'open'
 * LOCKED         <-> 'locked'
 * LIVE           <-> 'live' (Not yet in DB)
 * COMPLETE       <-> 'settled'
 * CANCELLED      <-> 'cancelled'
 * ERROR          <-> 'error'
 *
 * Invalid transitions are rejected by throwing a `StateTransitionError`.
 *
 * TODO: Create a test file for this service (e.g., `tests/services/contestState.service.test.js`)
 */

const STATES = {
  SCHEDULED: 'SCHEDULED',
  LOCKED: 'LOCKED',
  LIVE: 'LIVE',
  COMPLETE: 'COMPLETE',
  CANCELLED: 'CANCELLED',
  ERROR: 'ERROR',
};

const ACTORS = {
  SYSTEM: 'SYSTEM',
  ORGANIZER: 'ORGANIZER',
  ADMIN: 'ADMIN',
};

// Canonical transition graph as per the approved design table
const TRANSITIONS = {
  [STATES.SCHEDULED]: {
    [STATES.LOCKED]: [ACTORS.SYSTEM],
    [STATES.CANCELLED]: [ACTORS.ORGANIZER, ACTORS.ADMIN],
  },
  [STATES.LOCKED]: {
    [STATES.LIVE]: [ACTORS.SYSTEM],
    [STATES.CANCELLED]: [ACTORS.ADMIN],
  },
  [STATES.LIVE]: {
    [STATES.COMPLETE]: [ACTORS.SYSTEM],
    [STATES.ERROR]: [ACTORS.SYSTEM],
    [STATES.CANCELLED]: [ACTORS.ADMIN], // For exceptional circumstances
  },
  [STATES.ERROR]: {
    [STATES.COMPLETE]: [ACTORS.ADMIN],
    [STATES.CANCELLED]: [ACTORS.ADMIN],
  },
  [STATES.COMPLETE]: {}, // Terminal state
  [STATES.CANCELLED]: {}, // Terminal state
};

/**
 * Custom error for invalid state transitions.
 */
class StateTransitionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StateTransitionError';
  }
}

/**
 * Validates and authorizes a contest state transition.
 *
 * This is the single-responsibility enforcer for the contest lifecycle contract.
 * It ensures that every state change adheres to the official transition graph
 * and is performed by an authorized actor.
 *
 * @param {Object} params
 * @param {string} params.currentState - The current status of the contest (e.g., 'SCHEDULED').
 * @param {string} params.newState - The desired new status of the contest (e.g., 'LOCKED').
 * @param {string} params.actor - The entity attempting the transition ('SYSTEM', 'ORGANIZER', 'ADMIN').
 * @throws {StateTransitionError} If the transition is not allowed by the contract.
 * @returns {void} Does not return a value, but throws on invalid transitions.
 */
function transitionState({ currentState, newState, actor }) {
  if (!STATES[currentState]) {
    throw new StateTransitionError(`Invalid current state: '${currentState}'`);
  }
  if (!STATES[newState]) {
    throw new StateTransitionError(`Invalid new state: '${newState}'`);
  }
  if (!ACTORS[actor]) {
    throw new StateTransitionError(`Invalid actor: '${actor}'`);
  }

  const allowedTransitions = TRANSITIONS[currentState];
  if (!allowedTransitions) {
    throw new StateTransitionError(`No transitions defined for state: '${currentState}'`);
  }

  const allowedActors = allowedTransitions[newState];
  if (!allowedActors) {
    throw new StateTransitionError(`Transition from '${currentState}' to '${newState}' is not defined.`);
  }

  if (!allowedActors.includes(actor)) {
    throw new StateTransitionError(
      `Actor '${actor}' is not authorized to transition from '${currentState}' to '${newState}'. ` +
      `Allowed actors: [${allowedActors.join(', ')}].`
    );
  }

  // If we reach here, the transition is valid.
}

module.exports = {
  transitionState,
  STATES,
  ACTORS,
  StateTransitionError,
};
