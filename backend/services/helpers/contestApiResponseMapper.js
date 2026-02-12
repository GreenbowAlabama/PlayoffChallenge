// services/helpers/contestApiResponseMapper.js

const VALID_STATUSES = new Set([
  'SCHEDULED',
  'LOCKED',
  'LIVE',
  'COMPLETE',
  'CANCELLED',
  'ERROR'
]);

/**
 * Maps a contest database row to its API response format,
 * enforcing strict invariants and deriving fields as per GAP-11.
 *
 * @param {object} contestRow - The contest database row, pre-processed by the service layer.
 * @param {object} options - Options for mapping.
 * @param {number|Date} options.currentTimestamp - The current timestamp, either as milliseconds or a Date object.
 * @returns {object} The contest in API response format.
 * @throws {Error} If any invariant is violated.
 */
function mapContestToApiResponse(contestRow, { currentTimestamp }) {
  // --- Strict Invariant Enforcement ---

  // 1. Validate contestRow.status against allowed values
  if (!VALID_STATUSES.has(contestRow.status)) {
    throw new Error(`Invariant Violation: Invalid contest status '${contestRow.status}' provided to mapper.`);
  }

  // 2. Validate entry_count type and value
  if (typeof contestRow.entry_count !== 'number' || isNaN(contestRow.entry_count)) { // MODIFIED LINE
    throw new Error(`Invariant Violation: 'entry_count' must be a valid number, but received '${contestRow.entry_count}'.`); // MODIFIED MESSAGE
  }

  // 3. Validate user_has_entered type
  if (typeof contestRow.user_has_entered !== 'boolean') {
    throw new Error(`Invariant Violation: 'user_has_entered' must be a boolean, but received '${typeof contestRow.user_has_entered}'.`);
  }

  // 4. Validate lock_time for SCHEDULED contests
  if (contestRow.status === 'SCHEDULED' && contestRow.lock_time === null) {
    throw new Error('Invariant Violation: SCHEDULED contest cannot have a null lock_time.');
  }

  // 5. Standings presence and type validation
  const standingsPresentInRow = contestRow.standings !== undefined && contestRow.standings !== null;

  if (contestRow.status === 'LIVE' || contestRow.status === 'COMPLETE') {
    if (!standingsPresentInRow) {
      throw new Error(`Invariant Violation: Standings must be present in contestRow for status '${contestRow.status}'.`);
    }
    if (!Array.isArray(contestRow.standings)) {
      throw new Error(`Invariant Violation: Standings must be an array for status '${contestRow.status}', but received non-array type.`);
    }
  } else {
    // For statuses other than LIVE or COMPLETE (SCHEDULED, LOCKED, CANCELLED, ERROR), standings must NOT be present
    if (standingsPresentInRow) {
      throw new Error(`Invariant Violation: Standings must NOT be present in contestRow for status '${contestRow.status}'.`);
    }
  }

  // 6. Standings absence for ERROR status (specific rule, also covered by general rule above but explicit for clarity)
  if (contestRow.status === 'ERROR' && standingsPresentInRow) {
    throw new Error('Invariant Violation: Standings must never be exposed when contest status is ERROR.');
  }

  // --- Derived Fields Implementation ---

  const nowMs = (currentTimestamp instanceof Date) ? currentTimestamp.getTime() : currentTimestamp;
  if (typeof nowMs !== 'number' || isNaN(nowMs)) {
      throw new Error('Invariant Violation: currentTimestamp must be a valid number or Date object.');
  }


  const status = contestRow.status; // Direct from DB

  const is_locked = status !== 'SCHEDULED'; // Rule: status !== 'SCHEDULED'
  const is_live = status === 'LIVE'; // Rule: status === 'LIVE'
  const is_settled = contestRow.settle_time !== null; // Rule: settle_time !== null

  // entry_count and user_has_entered are expected to be computed and aliased in the service layer
  const entry_count = contestRow.entry_count;
  const user_has_entered = contestRow.user_has_entered;

  let time_until_lock = null;
  if (status === 'SCHEDULED') {
    const lockTimeMs = new Date(contestRow.lock_time).getTime();
    time_until_lock = Math.max(0, Math.floor((lockTimeMs - nowMs) / 1000));
  }

  // standings are included only if status is LIVE or COMPLETE and passed invariants
  const standings = (status === 'LIVE' || status === 'COMPLETE')
    ? contestRow.standings
    : undefined; // Omit entirely if not LIVE or COMPLETE

  // --- Construct API Response ---
  return {
    id: contestRow.id,
    template_id: contestRow.template_id,
    organizer_id: contestRow.organizer_id,
    entry_fee_cents: contestRow.entry_fee_cents,
    payout_structure: contestRow.payout_structure,
    contest_name: contestRow.contest_name,
    start_time: contestRow.start_time,
    end_time: contestRow.end_time,
    max_entries: contestRow.max_entries,
    join_token: contestRow.join_token,
    created_at: contestRow.created_at,
    updated_at: contestRow.updated_at,
    is_platform_owned: contestRow.is_platform_owned,

    // Derived Fields (GAP-11)
    status,
    is_locked,
    is_live,
    is_settled,
    entry_count,
    user_has_entered,
    time_until_lock,
    ...(standings !== undefined && { standings }), // Conditionally include if present
  };
}

/**
 * Maps a contest database row to API list response format (GAP-12).
 *
 * This mapper is for list endpoints only (e.g., GET /api/contests/my).
 * It omits standings and does not enforce the standings invariant.
 *
 * Rationale:
 * - List endpoints are metadata-focused, not detail-focused
 * - Standings require per-row database queries (N+1 risk)
 * - This mapper avoids that cost by design
 * - Clients can fetch standings separately from detail endpoints
 *
 * This is a CQRS-style separation of read models:
 * - Detail read model (mapContestToApiResponse): full invariants, standings required
 * - List read model (mapContestToApiResponseForList): metadata-only, no standings
 *
 * @param {object} contestRow - The contest database row
 * @param {object} options - Options for mapping
 * @param {number|Date} options.currentTimestamp - The current timestamp
 * @returns {object} The contest in API list response format (no standings)
 * @throws {Error} If core invariants are violated
 */
function mapContestToApiResponseForList(contestRow, { currentTimestamp }) {
  // --- Strict Invariant Enforcement (subset of detail mapper) ---

  // 1. Validate status against allowed values
  if (!VALID_STATUSES.has(contestRow.status)) {
    throw new Error(`Invariant Violation: Invalid contest status '${contestRow.status}' provided to mapper.`);
  }

  // 2. Validate entry_count type and value
  if (typeof contestRow.entry_count !== 'number' || isNaN(contestRow.entry_count)) {
    throw new Error(`Invariant Violation: 'entry_count' must be a valid number, but received '${contestRow.entry_count}'.`);
  }

  // 3. Validate user_has_entered type
  if (typeof contestRow.user_has_entered !== 'boolean') {
    throw new Error(`Invariant Violation: 'user_has_entered' must be a boolean, but received '${typeof contestRow.user_has_entered}'.`);
  }

  // 4. Validate lock_time for SCHEDULED contests
  if (contestRow.status === 'SCHEDULED' && contestRow.lock_time === null) {
    throw new Error('Invariant Violation: SCHEDULED contest cannot have a null lock_time.');
  }

  // NOTE: We deliberately do NOT enforce standings presence/absence.
  // List endpoints are metadata-only. Standings are fetched in detail endpoints only.

  // --- Derived Fields Implementation ---

  const nowMs = (currentTimestamp instanceof Date) ? currentTimestamp.getTime() : currentTimestamp;
  if (typeof nowMs !== 'number' || isNaN(nowMs)) {
    throw new Error('Invariant Violation: currentTimestamp must be a valid number or Date object.');
  }

  const status = contestRow.status; // Direct from DB

  const is_locked = status !== 'SCHEDULED';
  const is_live = status === 'LIVE';
  const is_settled = contestRow.settle_time !== null;

  const entry_count = contestRow.entry_count;
  const user_has_entered = contestRow.user_has_entered;

  let time_until_lock = null;
  if (status === 'SCHEDULED') {
    const lockTimeMs = new Date(contestRow.lock_time).getTime();
    time_until_lock = Math.max(0, Math.floor((lockTimeMs - nowMs) / 1000));
  }

  // --- Construct API List Response (no standings) ---
  return {
    id: contestRow.id,
    template_id: contestRow.template_id,
    organizer_id: contestRow.organizer_id,
    entry_fee_cents: contestRow.entry_fee_cents,
    payout_structure: contestRow.payout_structure,
    contest_name: contestRow.contest_name,
    start_time: contestRow.start_time,
    end_time: contestRow.end_time,
    lock_time: contestRow.lock_time,
    max_entries: contestRow.max_entries,
    join_token: contestRow.join_token,
    created_at: contestRow.created_at,
    updated_at: contestRow.updated_at,
    is_platform_owned: contestRow.is_platform_owned,

    // Derived Fields (subset for list surface)
    status,
    is_locked,
    is_live,
    is_settled,
    entry_count,
    user_has_entered,
    time_until_lock,
    // Explicitly omitted: standings (list endpoints are metadata-only)
  };
}

module.exports = {
  mapContestToApiResponse,
  mapContestToApiResponseForList,
};
