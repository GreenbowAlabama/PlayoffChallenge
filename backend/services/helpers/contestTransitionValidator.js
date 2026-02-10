
class TransitionNotAllowedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TransitionNotAllowedError';
  }
}

const ACTORS = {
  SYSTEM: 'SYSTEM',
  ORGANIZER: 'ORGANIZER',
  ADMIN: 'ADMIN',
};

function assertAllowedDbStatusTransition({ fromStatus, toStatus, actor, context = {} }) {
  // Terminal states guard
  if (fromStatus === 'COMPLETE' || fromStatus === 'CANCELLED') {
    throw new TransitionNotAllowedError(
      `Transition from terminal state '${fromStatus}' is not allowed for ${actor}`
    );
  }

  const allowedTransitions = {
    [ACTORS.ORGANIZER]: {
      SCHEDULED: ['LOCKED', 'CANCELLED'],
    },
    [ACTORS.SYSTEM]: {
      SCHEDULED: ['LOCKED'],
      LOCKED: ['LIVE'],
      LIVE: ['COMPLETE', 'ERROR'],
    },
    [ACTORS.ADMIN]: {
      SCHEDULED: ['LOCKED', 'CANCELLED'],
      LOCKED: ['LIVE', 'CANCELLED'],
      LIVE: ['COMPLETE', 'ERROR'],
      ERROR: ['COMPLETE', 'CANCELLED'],
    },
  };

  const transitionsForActor = allowedTransitions[actor];

  if (transitionsForActor && transitionsForActor[fromStatus] && transitionsForActor[fromStatus].includes(toStatus)) {
    return true;
  }

  throw new TransitionNotAllowedError(
    `Transition from '${fromStatus}' to '${toStatus}' is not allowed for ${actor}`
  );
}

module.exports = {
  ACTORS,
  TransitionNotAllowedError,
  assertAllowedDbStatusTransition,
};
