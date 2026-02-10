
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
  if (fromStatus === 'settled' || fromStatus === 'cancelled') {
    throw new TransitionNotAllowedError(
      `Transition from '${fromStatus}' to '${toStatus}' is not allowed for ${actor}`
    );
  }

  const allowedTransitions = {
    [ACTORS.ORGANIZER]: {
      draft: ['open', 'cancelled'],
      open: ['locked', 'cancelled'],
    },
    [ACTORS.ADMIN]: {
      draft: ['open', 'cancelled'],
      open: ['draft', 'cancelled'],
      locked: ['cancelled'],
    },
    [ACTORS.SYSTEM]: {
      open: ['locked'],
      locked: ['settled'],
    },
  };

  const transitionsForActor = allowedTransitions[actor];

  if (!transitionsForActor || !transitionsForActor[fromStatus] || !transitionsForActor[fromStatus].includes(toStatus)) {
    throw new TransitionNotAllowedError(
      `Transition from '${fromStatus}' to '${toStatus}' is not allowed for ${actor}`
    );
  }

  // Special rule for ADMIN: open -> draft
  if (actor === ACTORS.ADMIN && fromStatus === 'open' && toStatus === 'draft') {
    if (context.hasOnlyOrganizerParticipant !== true) {
      throw new TransitionNotAllowedError(
        `Transition from 'open' to 'draft' is not allowed for ${actor}: Contest must have only the organizer as a participant`
      );
    }
  }

  return true;
}

module.exports = {
  ACTORS,
  TransitionNotAllowedError,
  assertAllowedDbStatusTransition,
};
