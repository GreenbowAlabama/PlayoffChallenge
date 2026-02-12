/**
 * Custom Contest Service
 *
 * Handles contest instance lifecycle using the contest_templates / contest_instances schema.
 *
 * Mental Model:
 * - ContestInstance is user-created (organizer-owned)
 * - ContestTemplate is ops-owned and pre-seeded
 * - Instances reference templates for scoring/lock/settlement strategies
 */

const crypto = require('crypto');
const config = require('../config');
const { validateContestTimeInvariants } = require('./helpers/timeInvariantValidator');
const { advanceContestLifecycleIfNeeded, attemptSystemTransitionWithErrorRecovery } = require('./helpers/contestLifecycleAdvancer');
const { mapContestToApiResponse, mapContestToApiResponseForList } = require('./helpers/contestApiResponseMapper');

// Function to compare two numbers with a fixed precision (e.g., 2 decimal places)
const areScoresEqual = (score1, score2, precision = 2) => {
  if (typeof score1 !== 'number' || typeof score2 !== 'number') {
    return false; // Or throw an error, depending on desired strictness
  }
  return score1.toFixed(precision) === score2.toFixed(precision);
};

// Helper to get raw scores for participants in a contest, then compute ranks in JS
async function _getLiveStandings(pool, contestInstanceId) {
  const result = await pool.query(
    `
    SELECT
        cp.user_id,
        COALESCE(u.username, u.name, 'Unknown') AS user_display_name,
        SUM(COALESCE(s.final_points, 0))::numeric AS total_score
    FROM contest_participants cp
    LEFT JOIN picks p ON cp.contest_instance_id = p.contest_instance_id AND cp.user_id = p.user_id
    LEFT JOIN scores s ON p.player_id = s.player_id AND p.week_number = s.week_number AND p.user_id = s.user_id
    LEFT JOIN users u ON cp.user_id = u.id
    WHERE cp.contest_instance_id = $1
    GROUP BY cp.user_id, user_display_name
    ORDER BY total_score DESC, cp.user_id ASC
    `,
    [contestInstanceId]
  );

  const scoresWithDisplayNames = result.rows.map(row => ({
    user_id: row.user_id,
    user_display_name: row.user_display_name,
    total_score: Number(row.total_score) // Ensure it's a number
  }));

  // Now, compute ranks based on these scores, similar to settlementStrategy's computeRankings
  const rankedScores = [];
  let currentRank = 1;
  scoresWithDisplayNames.forEach((entry, index) => {
    if (index > 0 && !areScoresEqual(entry.total_score, scoresWithDisplayNames[index - 1].total_score)) {
      currentRank = index + 1;
    }
    rankedScores.push({ ...entry, rank: currentRank });
  });

  return rankedScores;
}

// Helper to get complete standings from settlement_records and normalize their shape
async function _getCompleteStandings(pool, contestInstanceId) {
  const result = await pool.query(
    `SELECT results FROM settlement_records WHERE contest_instance_id = $1`,
    [contestInstanceId]
  );

  if (result.rows.length === 0) {
    throw new Error(`Invariant Violation: settlement_records entry missing for COMPLETE contest ${contestInstanceId}.`);
  }

  const settlementResults = result.rows[0].results; // This is a JSONB object from the DB
  if (!settlementResults || !Array.isArray(settlementResults.rankings)) {
    throw new Error(`Invariant Violation: settlement_records.results.rankings for contest ${contestInstanceId} is not an array or is malformed.`);
  }

  // Fetch all user display names in one go to avoid N+1 queries
  const userIds = settlementResults.rankings.map(r => r.user_id);
  const usersResult = await pool.query(
    `SELECT id, COALESCE(username, name, 'Unknown') AS user_display_name FROM users WHERE id = ANY($1::uuid[])`,
    [userIds]
  );
  const userDisplayNames = new Map(usersResult.rows.map(u => [u.id, u.user_display_name]));

  // Normalize shape to match LIVE standings (user_id, user_display_name, total_score, rank)
  const normalizedStandings = settlementResults.rankings.map(ranking => ({
    user_id: ranking.user_id,
    user_display_name: userDisplayNames.get(ranking.user_id) || 'Unknown', // Fallback if user not found
    total_score: Number(ranking.score), // Map 'score' to 'total_score' and ensure numeric
    rank: ranking.rank
  }));

  return normalizedStandings;
}

const VALID_ENV_PREFIXES = ['dev', 'test', 'stg', 'prd'];

// Valid contest lifecycle statuses
const VALID_STATUSES = ['SCHEDULED', 'LOCKED', 'LIVE', 'COMPLETE', 'CANCELLED', 'ERROR'];

/**
 * Two-tier error taxonomy:
 *
 * State errors (externally visible, derived from contest state / environment):
 *   CONTEST_LOCKED        — Contest is locked (past lock_time or status locked)
 *   CONTEST_COMPLETED     — Contest is in a terminal completed state (settled)
 *   CONTEST_UNAVAILABLE   — Contest cannot be joined (cancelled, draft, invalid token)
 *   CONTEST_NOT_FOUND     — No contest matches this token / ID
 *   CONTEST_ENV_MISMATCH  — Token is from a different environment
 *
 * Join-action errors (only on the write path):
 *   ALREADY_JOINED — User has already joined this contest (DB unique constraint)
 *   CONTEST_FULL   — Contest has reached max participants (capacity CTE)
 */
const JOIN_ERROR_CODES = {
  // State errors
  CONTEST_LOCKED: 'CONTEST_LOCKED',
  CONTEST_COMPLETED: 'CONTEST_COMPLETED',
  CONTEST_UNAVAILABLE: 'CONTEST_UNAVAILABLE',
  CONTEST_NOT_FOUND: 'CONTEST_NOT_FOUND',
  CONTEST_ENV_MISMATCH: 'CONTEST_ENV_MISMATCH',

  // Join-action errors
  ALREADY_JOINED: 'ALREADY_JOINED',
  CONTEST_FULL: 'CONTEST_FULL',
};

/**
 * Get the current environment prefix for join tokens
 * Uses centralized config module
 * @returns {string} Environment prefix (dev, test, stg, prd)
 */
function getEnvPrefix() {
  return config.getAppEnv();
}

/**
 * Generate a full join URL for a contest instance
 * Uses centralized config for JOIN_BASE_URL
 * @param {string} token - The join token
 * @returns {string} Full join URL (e.g., https://app.playoffchallenge.com/join/dev_abc123...)
 */
function generateJoinUrl(token) {
  return config.buildJoinUrl(token);
}

/**
 * Generate a unique join token for contest instances
 * Token format: {env}_{random_hex}
 * @returns {string} Join token with environment-scoped prefix
 */
function generateJoinToken() {
  const envPrefix = getEnvPrefix();
  const randomPart = crypto.randomBytes(16).toString('hex');
  return `${envPrefix}_${randomPart}`;
}

/**
 * Validate a join token for environment isolation
 * Tokens from different environments are rejected deterministically
 *
 * @param {string} token - The join token to validate
 * @returns {Object} Validation result { valid: boolean, tokenId?: string, error?: string }
 */
function validateJoinToken(token) {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Token is required' };
  }

  const parts = token.split('_');
  if (parts.length < 2) {
    return { valid: false, error: 'Malformed token: missing environment prefix' };
  }

  const tokenEnv = parts[0];
  const tokenId = parts.slice(1).join('_');

  if (!VALID_ENV_PREFIXES.includes(tokenEnv)) {
    return { valid: false, error: `Malformed token: unknown environment prefix '${tokenEnv}'` };
  }

  const currentEnv = getEnvPrefix();
  if (tokenEnv !== currentEnv) {
    return {
      valid: false,
      error: `Environment mismatch: token is for '${tokenEnv}' but current environment is '${currentEnv}'`
    };
  }

  return { valid: true, tokenId };
}

/**
 * Validate entry fee against template constraints
 * @param {number} entryFeeCents - Entry fee in cents
 * @param {Object} template - Template with allowed_entry_fee_min_cents and allowed_entry_fee_max_cents
 * @throws {Error} If validation fails
 */
function validateEntryFeeAgainstTemplate(entryFeeCents, template) {
  if (!Number.isInteger(entryFeeCents)) {
    throw new Error('entry_fee_cents must be an integer');
  }
  if (entryFeeCents < 0) {
    throw new Error('entry_fee_cents must be a non-negative integer');
  }
  if (entryFeeCents < template.allowed_entry_fee_min_cents) {
    throw new Error(`entry_fee_cents must be at least ${template.allowed_entry_fee_min_cents}`);
  }
  if (entryFeeCents > template.allowed_entry_fee_max_cents) {
    throw new Error(`entry_fee_cents must be at most ${template.allowed_entry_fee_max_cents}`);
  }
}

/**
 * Validate payout structure against template constraints
 * @param {Object} payoutStructure - Payout structure to validate
 * @param {Object} template - Template with allowed_payout_structures
 * @throws {Error} If validation fails
 */
function validatePayoutStructureAgainstTemplate(payoutStructure, template) {
  if (!payoutStructure || typeof payoutStructure !== 'object') {
    throw new Error('payout_structure is required and must be an object');
  }

  const allowedStructures = template.allowed_payout_structures;
  if (!allowedStructures || !Array.isArray(allowedStructures)) {
    throw new Error('Template has no allowed payout structures defined');
  }

  // Check if the provided structure matches one of the allowed structures
  const structureString = JSON.stringify(payoutStructure);
  const isAllowed = allowedStructures.some(
    allowed => JSON.stringify(allowed) === structureString
  );

  if (!isAllowed) {
    throw new Error('payout_structure must match one of the allowed structures from the template');
  }
}

/**
 * Get a contest template by ID
 * @param {Object} pool - Database connection pool
 * @param {string} templateId - UUID of the template
 * @returns {Promise<Object|null>} Template or null if not found
 */
async function getTemplate(pool, templateId) {
  const result = await pool.query(
    `SELECT * FROM contest_templates WHERE id = $1 AND is_active = true`,
    [templateId]
  );
  return result.rows[0] || null;
}

/**
 * List all active templates
 * @param {Object} pool - Database connection pool
 * @returns {Promise<Array>} Array of active templates
 */
async function listActiveTemplates(pool) {
  const result = await pool.query(
    `SELECT * FROM contest_templates WHERE is_active = true ORDER BY name`
  );
  return result.rows;
}

/**
 * Create a new contest instance
 *
 * @param {Object} pool - Database connection pool
 * @param {string} organizerId - UUID of the user creating the contest
 * @param {Object} input - Contest creation input
 * @param {string} input.template_id - UUID of the template to use
 * @param {number} input.entry_fee_cents - Entry fee in cents
 * @param {Object} input.payout_structure - Payout structure (must match template's allowed structures)
 * @returns {Promise<Object>} Created contest instance
 */
async function createContestInstance(pool, organizerId, input) {
  // Validate required fields
  if (!input.template_id) {
    throw new Error('template_id is required');
  }
  if (input.entry_fee_cents === undefined || input.entry_fee_cents === null) {
    throw new Error('entry_fee_cents is required');
  }
  if (!input.payout_structure) {
    throw new Error('payout_structure is required');
  }

  // Fetch template and validate it exists
  const template = await getTemplate(pool, input.template_id);
  if (!template) {
    throw new Error('Template not found or inactive');
  }

  // Validate against template constraints
  validateEntryFeeAgainstTemplate(input.entry_fee_cents, template);
  validatePayoutStructureAgainstTemplate(input.payout_structure, template);

  // Derive and validate contest_name (non-null, non-empty string)
  const contestName = (input.contest_name ?? input.contestName ?? '').trim();
  if (!contestName) {
    throw new Error('contest_name is required and must be a non-empty string');
  }

  // Normalize max_entries: accept both snake_case and camelCase, default to 20
  let maxEntries = input.max_entries ?? input.maxEntries ?? 20;
  maxEntries = Number(maxEntries);
  if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
    throw new Error('max_entries must be a positive integer');
  }



  // Note: join_token is generated at publish time, not creation time

  // Validate time invariants before insert
  const timeUpdates = {
    lock_time: input.lock_time,
    start_time: input.start_time,
    end_time: input.end_time
  };
  validateContestTimeInvariants({ existing: {}, updates: timeUpdates });

  const result = await pool.query(
    `INSERT INTO contest_instances (
      template_id,
      organizer_id,
      contest_name,
      max_entries,
      entry_fee_cents,
      payout_structure,
      status,
      start_time,
      lock_time,
      end_time
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *`,
    [
      input.template_id,
      organizerId,
      contestName,
      maxEntries,
      input.entry_fee_cents,
      JSON.stringify(input.payout_structure),
      'SCHEDULED',
      input.start_time ?? null,
      input.lock_time ?? null,
      input.end_time ?? null
    ]
  );

  const instance = result.rows[0];
  return instance;
}

/**
 * Get a contest instance by ID
 *
 * @param {Object} pool - Database connection pool
 * @param {string} instanceId - UUID of the contest instance
 * @returns {Promise<Object|null>} Contest instance with template info, or null
 */
async function getContestInstance(pool, instanceId, requestingUserId = null) {
  const result = await pool.query(
    `SELECT
      ci.id,
      ci.template_id,
      ci.organizer_id,
      ci.entry_fee_cents,
      ci.payout_structure,
      ci.status,
      ci.start_time,
      ci.lock_time,
      ci.created_at,
      ci.updated_at,
      ci.join_token,
      ci.max_entries,
      ci.contest_name,
      ci.end_time,
      ci.settle_time,
      COALESCE(u.username, u.name, 'Unknown') as organizer_name,
      (SELECT COUNT(*) FROM contest_participants cp WHERE cp.contest_instance_id = ci.id)::int as entry_count,
      ${requestingUserId ? `EXISTS(SELECT 1 FROM contest_participants WHERE contest_instance_id = ci.id AND user_id = $2)` : 'FALSE'} AS user_has_entered
    FROM contest_instances ci
    LEFT JOIN users u ON u.id = ci.organizer_id
    WHERE ci.id = $1`,
    requestingUserId ? [instanceId, requestingUserId] : [instanceId]
  );
  let row = result.rows[0];

  if (!row) return null;

  const currentTimestamp = Date.now();

  // Advance contest lifecycle if needed (read-path self-healing)
  const newStatus = advanceContestLifecycleIfNeeded(row);
  if (newStatus) {
    const updatedRow = await attemptSystemTransitionWithErrorRecovery(
      pool,
      row,
      newStatus,
      updateContestStatusForSystem
    );
    if (updatedRow) {
      row = updatedRow;
    }
  }

  // Fetch standings if required
  if (row.status === 'LIVE') {
    row.standings = await _getLiveStandings(pool, row.id);
  } else if (row.status === 'COMPLETE') {
    row.standings = await _getCompleteStandings(pool, row.id);
  }

  // Map to API response format using the mapper
  return mapContestToApiResponse(row, { currentTimestamp });
}

/**
 * Get a contest instance by join token
 *
 * @param {Object} pool - Database connection pool
 * @param {string} token - Join token
 * @returns {Promise<Object|null>} Contest instance with template info, or null
 */
async function getContestInstanceByToken(pool, token, requestingUserId = null) {
  // Validate token first (fail-fast)
  const validation = validateJoinToken(token);
  if (!validation.valid) {
    return null;
  }

  const result = await pool.query(
    `SELECT
      ci.id,
      ci.template_id,
      ci.organizer_id,
      ci.entry_fee_cents,
      ci.payout_structure,
      ci.status,
      ci.start_time,
      ci.lock_time,
      ci.created_at,
      ci.updated_at,
      ci.join_token,
      ci.max_entries,
      ci.contest_name,
      ci.end_time,
      ci.settle_time,
      COALESCE(u.username, u.name, 'Unknown') as organizer_name,
      (SELECT COUNT(*) FROM contest_participants cp WHERE cp.contest_instance_id = ci.id)::int as entry_count,
      ${requestingUserId ? `EXISTS(SELECT 1 FROM contest_participants WHERE contest_instance_id = ci.id AND user_id = $2)` : 'FALSE'} AS user_has_entered
    FROM contest_instances ci
    LEFT JOIN users u ON u.id = ci.organizer_id
    WHERE ci.join_token = $1`,
    requestingUserId ? [token, requestingUserId] : [token]
  );
  let row = result.rows[0];
  if (!row) return null;

  const currentTimestamp = Date.now();

  // Advance contest lifecycle if needed (read-path self-healing)
  const newStatus = advanceContestLifecycleIfNeeded(row);
  if (newStatus) {
    const updatedRow = await attemptSystemTransitionWithErrorRecovery(
      pool,
      row,
      newStatus,
      updateContestStatusForSystem
    );
    if (updatedRow) {
      row = updatedRow;
    }
  }

  // Fetch standings if required
  if (row.status === 'LIVE') {
    row.standings = await _getLiveStandings(pool, row.id);
  } else if (row.status === 'COMPLETE') {
    row.standings = await _getCompleteStandings(pool, row.id);
  }

  // Map to API response format using the mapper
  return mapContestToApiResponse(row, { currentTimestamp });
}

/**
 * Resolve a join token and return structured contest information
 * Used for universal join link support (pre-authentication)
 *
 * Only OPEN contests resolve as valid. All other statuses are explicit rejections.
 * Validation failures (bad format, env mismatch) short-circuit before any DB query.
 *
 * Returns structured error codes (two-tier taxonomy):
 *   State errors  — CONTEST_UNAVAILABLE, CONTEST_ENV_MISMATCH, CONTEST_NOT_FOUND,
 *                   CONTEST_LOCKED, CONTEST_COMPLETED
 *   (Join-action errors are not emitted here — preview is pre-auth)
 *
 * @param {Object} pool - Database connection pool
 * @param {string} token - The join token to resolve
 * @returns {Promise<Object>} Resolution result with error_code if invalid
 */
async function resolveJoinToken(pool, token) {
  const validation = validateJoinToken(token);

  if (!validation.valid) {
    const isEnvMismatch = validation.error && validation.error.includes('Environment mismatch');

    if (isEnvMismatch) {
      const parts = token.split('_');
      const tokenEnv = parts[0];
      const currentEnv = getEnvPrefix();

      return {
        valid: false,
        error_code: JOIN_ERROR_CODES.CONTEST_ENV_MISMATCH,
        reason: validation.error,
        environment_mismatch: true,
        token_environment: tokenEnv,
        current_environment: currentEnv
      };
    }

    // Malformed / unrecognised token → CONTEST_UNAVAILABLE (collapsed)
    return {
      valid: false,
      error_code: JOIN_ERROR_CODES.CONTEST_UNAVAILABLE,
      reason: validation.error,
      environment_mismatch: false
    };
  }

  // Enriched query: include organizer name and current participant count
  const result = await pool.query(
    `SELECT
      ci.id,
      ci.template_id,
      ci.organizer_id,
      ci.entry_fee_cents,
      ci.payout_structure,
      ci.status,
      ci.start_time,
      ci.lock_time,
      ci.created_at,
      ci.updated_at,
      ci.join_token,
      ci.max_entries,
      ci.contest_name,
      ci.end_time,
      ci.settle_time,
      COALESCE(u.username, u.name, 'Unknown') as organizer_name,
      (SELECT COUNT(*) FROM contest_participants cp WHERE cp.contest_instance_id = ci.id)::int as entry_count,
      FALSE AS user_has_entered -- Pre-auth endpoint, user_has_entered is always false
    FROM contest_instances ci
    LEFT JOIN users u ON ci.organizer_id = u.id
    WHERE ci.join_token = $1`,
    [token]
  );
  let instance = result.rows[0];

  if (!instance) {
    return {
      valid: false,
      error_code: JOIN_ERROR_CODES.CONTEST_NOT_FOUND,
      reason: 'Contest not found for this token',
      environment_mismatch: false
    };
  }

  // Fail closed: reject unknown statuses before mapper call
  if (!VALID_STATUSES.includes(instance.status)) {
    return {
      valid: false,
      error_code: JOIN_ERROR_CODES.CONTEST_NOT_FOUND,
      reason: 'Contest is not in a joinable state',
      environment_mismatch: false
    };
  }

  const currentTimestamp = Date.now();

  // Advance contest lifecycle if needed (read-path self-healing)
  const newStatus = advanceContestLifecycleIfNeeded(instance);
  if (newStatus) {
    const updatedInstance = await attemptSystemTransitionWithErrorRecovery(
      pool,
      instance,
      newStatus,
      updateContestStatusForSystem
    );
    if (updatedInstance) {
      instance = updatedInstance; // Use the newly updated instance for further processing
    }
  }

  // Map the instance to the API response format to get derived fields
  const mappedContest = mapContestToApiResponse(instance, { currentTimestamp });

  // Only SCHEDULED (not locked) contests resolve as valid for joining
  if (mappedContest.status === 'SCHEDULED' && !mappedContest.is_locked) {
    return {
      valid: true,
      contest: {
        ...mappedContest,
        join_url: generateJoinUrl(token)
      }
    };
  }

  // Handle other states (check explicit terminal states before generic locked check)
  if (mappedContest.status === 'CANCELLED') {
    return {
      valid: false,
      error_code: JOIN_ERROR_CODES.CONTEST_UNAVAILABLE,
      reason: 'Contest is cancelled and no longer accepting participants',
      environment_mismatch: false,
      contest: {
        id: mappedContest.id,
        status: mappedContest.status
      }
    };
  }

  if (mappedContest.status === 'COMPLETE') {
    return {
      valid: false,
      error_code: JOIN_ERROR_CODES.CONTEST_COMPLETED,
      reason: 'Contest is settled and no longer accepting participants',
      environment_mismatch: false,
      contest: {
        id: mappedContest.id,
        status: mappedContest.status
      }
    };
  }

  if (mappedContest.is_locked) {
    return {
      valid: false,
      error_code: JOIN_ERROR_CODES.CONTEST_LOCKED,
      reason: 'Contest join window has closed',
      environment_mismatch: false,
      contest: {
        id: mappedContest.id,
        status: mappedContest.status,
        lock_time: mappedContest.lock_time,
        is_locked: mappedContest.is_locked
      }
    };
  }

  // Unknown status — fail closed
  return {
    valid: false,
    error_code: JOIN_ERROR_CODES.CONTEST_NOT_FOUND,
    reason: 'Contest is not in a joinable state',
    environment_mismatch: false
  };
}

/**
 * Get all contest instances for a specific organizer
 *
 * @param {Object} pool - Database connection pool
 * @param {string} organizerId - UUID of the organizer
 * @param {string} requestingUserId - UUID of the requesting user (for user_has_entered computation)
 * @returns {Promise<Array>} Array of contest instances
 */
async function getContestInstancesForOrganizer(pool, organizerId, requestingUserId = null) {
  const result = await pool.query(
    `SELECT
      ci.id,
      ci.template_id,
      ci.organizer_id,
      ci.entry_fee_cents,
      ci.payout_structure,
      ci.status,
      ci.start_time,
      ci.lock_time,
      ci.created_at,
      ci.updated_at,
      ci.join_token,
      ci.max_entries,
      ci.contest_name,
      ci.end_time,
      ci.settle_time,
      COALESCE(u.username, u.name, 'Unknown') as organizer_name,
      cct.name AS template_name,
      cct.sport AS template_sport,
      cct.template_type AS template_type,
      (SELECT COUNT(*) FROM contest_participants cp WHERE cp.contest_instance_id = ci.id)::int as entry_count,
      ${requestingUserId ? `EXISTS(SELECT 1 FROM contest_participants WHERE contest_instance_id = ci.id AND user_id = $2)` : 'FALSE'} AS user_has_entered
    FROM contest_instances ci
    LEFT JOIN users u ON u.id = ci.organizer_id
    LEFT JOIN contest_templates cct ON cct.id = ci.template_id
    WHERE ci.organizer_id = $1
    ORDER BY ci.created_at DESC`,
    requestingUserId ? [organizerId, requestingUserId] : [organizerId]
  );

  const currentTimestamp = Date.now();
  const processedContests = [];

  for (let row of result.rows) {
    // Advance contest lifecycle if needed (read-path self-healing)
    const newStatus = advanceContestLifecycleIfNeeded(row);
    if (newStatus) {
      const updatedRow = await attemptSystemTransitionWithErrorRecovery(
        pool,
        row,
        newStatus,
        updateContestStatusForSystem
      );
      if (updatedRow) {
        row = updatedRow;
      }
    }

    // Fetch standings if required
    if (row.status === 'LIVE') {
      row.standings = await _getLiveStandings(pool, row.id);
    } else if (row.status === 'COMPLETE') {
      row.standings = await _getCompleteStandings(pool, row.id);
    }
    processedContests.push(mapContestToApiResponse(row, { currentTimestamp }));
  }

  return processedContests;
}

/**
 * Update contest instance status
 * Only the organizer can update status
 *
 * @param {Object} pool - Database connection pool
 * @param {string} instanceId - UUID of the contest instance
 * @param {string} organizerId - UUID of the user attempting the update
 * @param {string} newStatus - New status value
 * @returns {Promise<Object>} Updated contest instance
 */
async function updateContestInstanceStatus(pool, instanceId, organizerId, newStatus) {
  if (!VALID_STATUSES.includes(newStatus)) {
    throw new Error(`Invalid status: ${newStatus}. Must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  // Verify ownership
  const existing = await getContestInstance(pool, instanceId);
  if (!existing) {
    throw new Error('Contest instance not found');
  }
  // Case-insensitive UUID comparison
  if (existing.organizer_id.toLowerCase() !== organizerId.toLowerCase()) {
    throw new Error('Only the organizer can update contest status');
  }

  // Validate status transitions
  const validTransitions = {
    SCHEDULED: ['LOCKED', 'CANCELLED'],
    LOCKED: ['LIVE', 'CANCELLED'],
    LIVE: ['COMPLETE', 'ERROR'],
    COMPLETE: [],
    CANCELLED: [],
    ERROR: ['COMPLETE', 'CANCELLED']
  };

  const allowedNext = validTransitions[existing.status];
  if (!allowedNext || !allowedNext.includes(newStatus)) {
    throw new Error(`Cannot transition from '${existing.status}' to '${newStatus}'`);
  }

  const result = await pool.query(
    `UPDATE contest_instances SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [newStatus, instanceId]
  );

  return result.rows[0];
}

/**
 * Publish a contest (transition from draft to open)
 *
 * Idempotent: If the contest is already open, returns the existing instance
 * without modification (no token regeneration, no timestamp updates, no error).
 *
 * When publishing from draft, ensures join_token exists to satisfy the database
 * constraint (join_token IS NOT NULL when status != 'draft').
 *
 * @param {Object} pool - Database connection pool
 * @param {string} instanceId - UUID of the contest instance
 * @param {string} organizerId - UUID of the user attempting to publish
 * @returns {Promise<Object>} Contest instance (updated or existing if already open)
 */
async function publishContestInstance(pool, instanceId, organizerId) {
  // Fetch current state
  const existing = await getContestInstance(pool, instanceId, organizerId);
  if (!existing) {
    throw new Error('Contest instance not found');
  }

  // Verify ownership (case-insensitive UUID comparison)
  if (existing.organizer_id.toLowerCase() !== organizerId.toLowerCase()) {
    throw new Error('Only the organizer can publish contest');
  }

  // Idempotency: if a join token already exists, it's already "published".
  if (existing.join_token) {
    return {
      ...existing,
      join_url: generateJoinUrl(existing.join_token)
    };
  }

  // Only SCHEDULED contests can be published (i.e., made joinable)
  if (existing.status !== 'SCHEDULED') {
    throw new Error(`Cannot publish a contest with status '${existing.status}'. Only 'SCHEDULED' contests can be published.`);
  }

  // Generate the join token
  const joinToken = generateJoinToken();

  // Perform atomic update: set the join_token
  const result = await pool.query(
    `UPDATE contest_instances SET join_token = $1, updated_at = NOW() WHERE id = $2 AND LOWER(organizer_id::text) = LOWER($3) RETURNING *`,
    [joinToken, instanceId, organizerId]
  );

  if (result.rows.length === 0) {
    // Race condition: contest was modified between fetch and update
    throw new Error('Contest was modified by another operation');
  }

  // Auto-join organizer as first participant
  await pool.query(
    'INSERT INTO contest_participants (contest_instance_id, user_id) VALUES ($1, $2) ON CONFLICT (contest_instance_id, user_id) DO NOTHING',
    [instanceId, organizerId]
  );

  const instance = result.rows[0];
  return {
    ...instance,
    join_url: generateJoinUrl(instance.join_token)
  };
}

/**
 * Join a contest as a participant (authenticated operation)
 *
 * Uses a transaction with SELECT FOR UPDATE to serialize concurrent joins.
 * Capacity is enforced via a CTE that conditionally inserts only when
 * current_count < max_entries (or max_entries IS NULL for unlimited).
 *
 * DB constraints are the source of truth:
 * - Unique (contest_instance_id, user_id) → ALREADY_JOINED
 * - CTE returns 0 rows → CONTEST_FULL
 *
 * @param {Object} pool - Database connection pool
 * @param {string} contestInstanceId - UUID of the contest instance
 * @param {string} userId - UUID of the user joining
 * @returns {Promise<Object>} Join result { joined, participant? } or { joined, error_code, reason }
 */
async function joinContest(pool, contestInstanceId, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock the row and get data
    const contestResult = await client.query(
      'SELECT id, status, max_entries, lock_time, join_token FROM contest_instances WHERE id = $1 FOR UPDATE',
      [contestInstanceId]
    );

    if (contestResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { joined: false, error_code: JOIN_ERROR_CODES.CONTEST_NOT_FOUND, reason: 'Contest not found' };
    }
    const contest = contestResult.rows[0];

    // 2. Attempt INSERT to check for ALREADY_JOINED and CONTEST_FULL first
    const insertResult = await client.query(
      `WITH capacity AS (
        SELECT max_entries,
          (SELECT COUNT(*) FROM contest_participants WHERE contest_instance_id = $1) AS current_count
        FROM contest_instances
        WHERE id = $1
      )
      INSERT INTO contest_participants (contest_instance_id, user_id)
      SELECT $1, $2
      FROM capacity
      WHERE capacity.max_entries IS NULL OR capacity.current_count < capacity.max_entries
      RETURNING *`,
      [contestInstanceId, userId]
    );

    if (insertResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return { joined: false, error_code: JOIN_ERROR_CODES.CONTEST_FULL, reason: 'Contest has reached maximum participants' };
    }

    // 3. Now that user has been added, validate the contest state.
    // If these checks fail, we rollback the INSERT.
    if (contest.status !== 'SCHEDULED' || !contest.join_token) {
      await client.query('ROLLBACK');
      // Refine reasons for UNAVAILABLE based on the specific non-SCHEDULED status
      if (!contest.join_token) {
        return { joined: false, error_code: JOIN_ERROR_CODES.CONTEST_UNAVAILABLE, reason: 'Contest is not joinable (no join token)' };
      }
      if (contest.status === 'LOCKED') {
        return { joined: false, error_code: JOIN_ERROR_CODES.CONTEST_LOCKED, reason: 'Contest is locked' };
      }
      if (contest.status === 'COMPLETE') {
        return { joined: false, error_code: JOIN_ERROR_CODES.CONTEST_COMPLETED, reason: 'Contest is complete' };
      }
      if (contest.status === 'CANCELLED') {
        return { joined: false, error_code: JOIN_ERROR_CODES.CONTEST_UNAVAILABLE, reason: 'Contest is cancelled' };
      }
      if (contest.status === 'LIVE' || contest.status === 'ERROR') { // LIVE and ERROR are also not joinable
        return { joined: false, error_code: JOIN_ERROR_CODES.CONTEST_UNAVAILABLE, reason: `Contest is in state '${contest.status}' and not joinable` };
      }
      return { joined: false, error_code: JOIN_ERROR_CODES.CONTEST_UNAVAILABLE, reason: 'Contest is not in a joinable state' };
    }

    // 4. Enforce lock_time
    if (contest.lock_time !== null && new Date() >= new Date(contest.lock_time)) {
      await client.query('ROLLBACK');
      return { joined: false, error_code: JOIN_ERROR_CODES.CONTEST_LOCKED, reason: 'Contest join window has closed' };
    }

    // 5. All checks passed.
    await client.query('COMMIT');
    return { joined: true, participant: insertResult.rows[0] };

  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return { joined: false, error_code: JOIN_ERROR_CODES.ALREADY_JOINED, reason: 'User has already joined this contest' };
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Thin wrapper for SYSTEM-driven status transitions.
 * Routes to _updateContestStatusInternal with SYSTEM actor authority.
 *
 * Used as updateFn callback for attemptSystemTransitionWithErrorRecovery.
 * Ensures all SYSTEM transitions flow through the same internal primitive
 * and are subject to transition validation + audit recording.
 */
async function updateContestStatusForSystem(pool, contestId, targetStatus) {
  return _updateContestStatusInternal(pool, contestId, targetStatus);
}

/**
 * Internal helper to update a contest's status directly in the database.
 * This function bypasses organizerId checks and should only be used for
 * automated or internally validated transitions.
 *
 * It ensures the transition is valid via contestTransitionValidator.
 * It is idempotent and concurrency-safe.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} contestId - UUID of the contest instance
 * @param {string} newStatus - The new status to set
 * @returns {Promise<Object|null>} The updated contest instance row from the database, or null if no update occurred (e.g., status already changed).
 * @throws {Error} If the contest is not found or the transition is invalid.
 */
async function _updateContestStatusInternal(pool, contestId, newStatus) {
  const contestTransitionValidator = require('./helpers/contestTransitionValidator');

  // Fetch the current contest status for transition validation
  const currentStatusResult = await pool.query(
    `SELECT status FROM contest_instances WHERE id = $1`,
    [contestId]
  );

  if (currentStatusResult.rows.length === 0) {
    // If contest not found, this is an error, it should exist to be transitioned.
    throw new Error(`Contest instance with ID ${contestId} not found for status transition.`);
  }
  const existingContestStatus = currentStatusResult.rows[0].status;

  // Validate the potential transition using the central validator
  // This will throw if the transition is invalid
  contestTransitionValidator.assertAllowedDbStatusTransition({
    fromStatus: existingContestStatus,
    toStatus: newStatus,
    actor: contestTransitionValidator.ACTORS.SYSTEM
  });

  // GAP-09: Execute settlement BEFORE status update for LIVE→COMPLETE
  // Settlement must succeed before we transition to COMPLETE, otherwise error recovery
  // will move the contest to ERROR state (GAP-08).
  if (newStatus === 'COMPLETE' && existingContestStatus === 'LIVE') {
    const settlementStrategy = require('./settlementStrategy');

    // Fetch full contest instance for settlement
    const contestResult = await pool.query(
      'SELECT * FROM contest_instances WHERE id = $1',
      [contestId]
    );
    const contestInstance = contestResult.rows[0];

    // Execute settlement (throws on failure, caught by error recovery)
    await settlementStrategy.executeSettlement(contestInstance, pool);

    // Settlement succeeded, safe to update status
  }

  // Attempt to update the status, but only if the status is still the one we validated against.
  // This handles race conditions where another process might have already updated the status.
  const result = await pool.query(
    `UPDATE contest_instances SET status = $1, updated_at = NOW() WHERE id = $2 AND status = $3 RETURNING *`,
    [newStatus, contestId, existingContestStatus]
  );

  if (result.rows.length === 0) {
    // No rows were updated. This means either:
    // 1. The status was already newStatus (harmless idempotency)
    // 2. The status was changed by another concurrent process to something else (another valid transition or error)
    // In either case, we return null to indicate no change was made by THIS operation.
    return null;
  }

  return result.rows[0];
}

/**
 * Get My Contests (GAP-12)
 *
 * Returns contests the user has entered, plus SCHEDULED contests open for entry.
 * Implements exact contract sorting: 6-tier sort by status, then status-specific time field.
 * Non-mutating: does NOT trigger lifecycle advancement.
 * Fails closed on ERROR: non-admin users never see ERROR contests.
 *
 * This is a metadata-only list endpoint: no standings, no per-row queries.
 * Standings retrieval belongs in contest detail endpoints.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} userId - UUID of requesting user
 * @param {boolean} isAdmin - Whether user has admin privileges (from server auth context, not client)
 * @param {number} limit - Results limit (default 50, clamped to [1, 200])
 * @param {number} offset - Results offset (default 0, clamped to >= 0)
 * @returns {Promise<Array>} Array of contest objects sorted by contract rules
 */
async function getContestsForUser(pool, userId, isAdmin = false, limit = 50, offset = 0) {
  // Clamp pagination parameters
  const limitValue = parseInt(limit, 10);
  const offsetValue = parseInt(offset, 10);
  const safeLimit = Math.max(1, Math.min(200, isNaN(limitValue) ? 50 : limitValue));
  const safeOffset = Math.max(0, isNaN(offsetValue) ? 0 : offsetValue);

  const result = await pool.query(
    `
    SELECT
      ci.id,
      ci.template_id,
      ci.organizer_id,
      ci.entry_fee_cents,
      ci.payout_structure,
      ci.status,
      ci.start_time,
      ci.lock_time,
      ci.created_at,
      ci.updated_at,
      ci.join_token,
      ci.max_entries,
      ci.contest_name,
      ci.end_time,
      ci.settle_time,
      COALESCE(u.username, u.name, 'Unknown') as organizer_name,
      (SELECT COUNT(*) FROM contest_participants cp WHERE cp.contest_instance_id = ci.id)::int as entry_count,
      EXISTS(SELECT 1 FROM contest_participants WHERE contest_instance_id = ci.id AND user_id = $1) AS user_has_entered,
      CASE ci.status
        WHEN 'LIVE' THEN 0
        WHEN 'LOCKED' THEN 1
        WHEN 'SCHEDULED' THEN 2
        WHEN 'COMPLETE' THEN 3
        WHEN 'CANCELLED' THEN 4
        WHEN 'ERROR' THEN 5
        ELSE 99
      END AS tier,
      CASE WHEN ci.status = 'LIVE' THEN ci.end_time END AS live_end_time,
      CASE WHEN ci.status = 'LOCKED' THEN ci.start_time END AS locked_start_time,
      CASE WHEN ci.status = 'SCHEDULED' THEN ci.lock_time END AS scheduled_lock_time,
      CASE WHEN ci.status = 'COMPLETE' THEN ci.settle_time END AS complete_settle_time,
      CASE WHEN ci.status = 'CANCELLED' THEN ci.created_at END AS cancelled_created_at,
      CASE WHEN ci.status = 'ERROR' THEN ci.created_at END AS error_created_at
    FROM contest_instances ci
    LEFT JOIN users u ON u.id = ci.organizer_id
    WHERE
      (
        EXISTS (
          SELECT 1 FROM contest_participants cp
          WHERE cp.contest_instance_id = ci.id
          AND cp.user_id = $1
        )
        OR ci.status = 'SCHEDULED'
      )
      AND (
        $2 = true
        OR ci.status != 'ERROR'
      )
    ORDER BY
      tier ASC,
      live_end_time ASC NULLS LAST,
      locked_start_time ASC NULLS LAST,
      scheduled_lock_time ASC NULLS LAST,
      complete_settle_time DESC NULLS LAST,
      cancelled_created_at DESC NULLS LAST,
      error_created_at DESC NULLS LAST,
      ci.id ASC
    LIMIT $3
    OFFSET $4
    `,
    [userId, isAdmin, safeLimit, safeOffset]
  );

  const currentTimestamp = Date.now();

  // Map each row to list API response format.
  // Uses mapContestToApiResponseForList which omits standings (metadata-only).
  // No lifecycle advancement, no per-row queries (non-mutating).
  const processedContests = result.rows.map(row =>
    mapContestToApiResponseForList(row, { currentTimestamp })
  );

  return processedContests;
}

/**
 * Get Available Contests (SCHEDULED, user hasn't entered, not full)
 *
 * Returns SCHEDULED contests that:
 * - User has NOT entered
 * - Are not full (entries_current < max_entries OR max_entries IS NULL)
 *
 * Ordered by:
 * 1. is_platform_owned DESC (platform contests first)
 * 2. created_at DESC (newest first)
 *
 * @param {Object} pool - Database connection pool
 * @param {string} userId - UUID of requesting user
 * @returns {Promise<Array>} Array of available contest objects
 */
async function getAvailableContests(pool, userId) {
  const result = await pool.query(
    `
    SELECT
      ci.id,
      ci.template_id,
      ci.organizer_id,
      ci.entry_fee_cents,
      ci.payout_structure,
      ci.status,
      ci.start_time,
      ci.lock_time,
      ci.created_at,
      ci.updated_at,
      ci.join_token,
      ci.max_entries,
      ci.contest_name,
      ci.end_time,
      ci.settle_time,
      ci.is_platform_owned,
      COALESCE(u.username, u.name, 'Unknown') as organizer_name,
      COUNT(cp.id)::int AS entry_count,
      FALSE AS user_has_entered
    FROM contest_instances ci
    LEFT JOIN contest_participants cp
      ON cp.contest_instance_id = ci.id
    LEFT JOIN users u ON u.id = ci.organizer_id
    WHERE ci.status = 'SCHEDULED'
    AND NOT EXISTS (
      SELECT 1
      FROM contest_participants cp2
      WHERE cp2.contest_instance_id = ci.id
      AND cp2.user_id = $1
    )
    GROUP BY
      ci.id,
      ci.template_id,
      ci.organizer_id,
      ci.entry_fee_cents,
      ci.payout_structure,
      ci.status,
      ci.start_time,
      ci.lock_time,
      ci.created_at,
      ci.updated_at,
      ci.join_token,
      ci.max_entries,
      ci.contest_name,
      ci.end_time,
      ci.settle_time,
      ci.is_platform_owned,
      u.id,
      u.username,
      u.name
    HAVING
      ci.max_entries IS NULL
      OR COUNT(cp.id) < ci.max_entries
    ORDER BY
      ci.is_platform_owned DESC,
      ci.created_at DESC
    `,
    [userId]
  );

  const currentTimestamp = Date.now();

  // Map each row to API response format (metadata-only, no standings)
  const processedContests = result.rows.map(row =>
    mapContestToApiResponseForList(row, { currentTimestamp })
  );

  return processedContests;
}

module.exports = {
  // Template functions
  getTemplate,
  listActiveTemplates,

  // Instance lifecycle
  createContestInstance,
  getContestInstance,
  getContestInstanceByToken,
  getContestInstancesForOrganizer,
  getContestsForUser,
  getAvailableContests,
  updateContestInstanceStatus,
  updateContestStatusForSystem,
  publishContestInstance,
  joinContest,

  // Token functions
  generateJoinToken,
  generateJoinUrl,
  validateJoinToken,
  resolveJoinToken,

  // Validation helpers
  validateEntryFeeAgainstTemplate,
  validatePayoutStructureAgainstTemplate,

  // State helpers

  // Constants
  VALID_ENV_PREFIXES,
  JOIN_ERROR_CODES,
};
