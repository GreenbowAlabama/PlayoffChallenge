/**
 * Signal-only logging control
 *
 * Allowed signals:
 * - Contract violations (missing required fields)
 * - Unexpected state (invariant violations)
 * - Mode switches (if decision point matters operationally)
 *
 * Forbidden:
 * - Loop logging
 * - Payload logging
 * - Success confirmations
 * - Count logging (unless actively debugging a bug)
 * - Flow descriptions
 */

const LOG = {
  enabled: true,
  errorOnly: true,  // flip to false ONLY if actively debugging a production issue
};

function logError(message, metadata = null) {
  if (LOG.enabled) {
    if (metadata) {
      console.error(message, metadata);
    } else {
      console.error(message);
    }
  }
}

function logWarn(message, metadata = null) {
  if (LOG.enabled && !LOG.errorOnly) {
    if (metadata) {
      console.warn(message, metadata);
    } else {
      console.warn(message);
    }
  }
}

module.exports = {
  LOG,
  logError,
  logWarn
};
