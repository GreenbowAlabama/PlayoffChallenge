// contestLifecycleTransitions.js

const TERMINAL_STATUSES = new Set(['COMPLETED', 'CANCELLED']);

function isTerminal(status) {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Pure function.
 * Does NOT mutate input.
 * Returns next status or null.
 * Throws on invalid invariant.
 */
function computeNextStatus(instance, now) {
  if (!instance) throw new Error('Instance required');

  const { status, start_time, end_time } = instance;

  if (!status) throw new Error('Missing status');

  if (isTerminal(status)) {
    return null;
  }

  const nowTs = new Date(now).getTime();

  if (status === 'UPCOMING') {
    if (!start_time) {
      throw new Error('UPCOMING contest missing start_time');
    }

    const startTs = new Date(start_time).getTime();

    if (nowTs >= startTs) {
      return 'ACTIVE';
    }

    return null;
  }

  if (status === 'ACTIVE') {
    if (!end_time) {
      throw new Error('ACTIVE contest missing end_time');
    }

    const endTs = new Date(end_time).getTime();

    if (nowTs >= endTs) {
      return 'COMPLETED';
    }

    return null;
  }

  return null;
}

module.exports = {
  isTerminal,
  computeNextStatus,
};
