/**
 * @typedef {Object} ContestTimeFields
 * @property {string | Date} [created_at]
 * @property {string | Date} [lock_time]
 * @property {string | Date} [start_time]
 * @property {string | Date} [end_time]
 * @property {string | Date} [settle_time]
 */

/**
 * Enforces time-based invariants for a contest by validating the effective
 * state of a contest after applying updates.
 *
 * Invariants:
 * 1. created_at < lock_time (if created_at and lock_time are present)
 * 2. lock_time <= start_time (if both are present)
 * 3. start_time < end_time (if both are present)
 * 4. end_time <= settle_time (if both are present)
 *
 * `created_at` is handled by the database and is only present in `existing` records.
 * For new records, `existing` is empty, so the `created_at` invariant is skipped.
 *
 * @param {object} params
 * @param {ContestTimeFields} params.existing - The existing contest time fields from the database.
 * @param {ContestTimeFields} params.updates - The proposed updates to the time fields.
 * @throws {Error} if any invariant is violated.
 */
function validateContestTimeInvariants({ existing, updates }) {
  // Merge existing state with updates to get the effective state for validation.
  const effectiveTimes = { ...existing, ...updates };

  const createdAt = effectiveTimes.created_at ? new Date(effectiveTimes.created_at) : null;
  const lockTime = effectiveTimes.lock_time ? new Date(effectiveTimes.lock_time) : null;
  const startTime = effectiveTimes.start_time ? new Date(effectiveTimes.start_time) : null;
  const endTime = effectiveTimes.end_time ? new Date(effectiveTimes.end_time) : null;
  const settleTime = effectiveTimes.settle_time ? new Date(effectiveTimes.settle_time) : null;

  if (createdAt && lockTime) {
    if (createdAt >= lockTime) {
      throw new Error(`Invariant violated: created_at (${createdAt.toISOString()}) must be before lock_time (${lockTime.toISOString()})`);
    }
  }

  if (lockTime && startTime) {
    if (lockTime > startTime) {
      throw new Error(`Invariant violated: lock_time (${lockTime.toISOString()}) must not be after start_time (${startTime.toISOString()})`);
    }
  }

  if (startTime && endTime) {
    if (startTime >= endTime) {
      throw new Error(`Invariant violated: start_time (${startTime.toISOString()}) must be before end_time (${endTime.toISOString()})`);
    }
  }

  if (endTime && settleTime) {
    if (endTime > settleTime) {
      throw new Error(`Invariant violated: end_time (${endTime.toISOString()}) must not be after settle_time (${settleTime.toISOString()})`);
    }
  }
}

module.exports = {
  validateContestTimeInvariants,
};
