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
const { computeJoinState } = require('./helpers/contestState');

const VALID_STATUSES = ['draft', 'open', 'locked', 'settled', 'cancelled'];
const VALID_ENV_PREFIXES = ['dev', 'test', 'stg', 'prd'];

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

  // CONTRACT CHECK: normalized values before insert
  console.log(`CONTRACT CHECK createContestInstance: contestName="${contestName}", maxEntries=${maxEntries}`);

  // Note: join_token is generated at publish time, not creation time
  // Database constraint requires join_token to be NULL for draft status

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
      settlement_time
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *`,
    [
      input.template_id,
      organizerId,
      contestName,
      maxEntries,
      input.entry_fee_cents,
      JSON.stringify(input.payout_structure),
      'draft',
      input.start_time ?? null,
      input.lock_time ?? null,
      input.settlement_time ?? null
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
async function getContestInstance(pool, instanceId) {
  const result = await pool.query(
    `SELECT
      ci.*,
      ci.contest_name,
      ci.max_entries,
      ci.lock_time,
      ci.status,
      ct.name as template_name,
      ct.sport as template_sport,
      ct.template_type,
      ct.scoring_strategy_key,
      ct.lock_strategy_key,
      ct.settlement_strategy_key,
      COALESCE(u.username, u.name, 'Unknown') as organizer_name,
      (SELECT COUNT(*) FROM contest_participants cp WHERE cp.contest_instance_id = ci.id)::int as entries_current
    FROM contest_instances ci
    JOIN contest_templates ct ON ci.template_id = ct.id
    LEFT JOIN users u ON u.id = ci.organizer_id
    WHERE ci.id = $1`,
    [instanceId]
  );
  const row = result.rows[0];
  if (!row) return null;

  // Enforce instance-owned fields; hard-delete template leakage
  row.contest_name = row.contest_name;
  row.max_entries = row.max_entries;
  delete row.name;
  delete row.template_name;

  // CONTRACT CHECK: values returned from getContestInstance
  console.log(`CONTRACT CHECK getContestInstance: contest_name="${row.contest_name}", max_entries=${row.max_entries}`);

  return {
    ...row,
    join_url: row.join_token ? generateJoinUrl(row.join_token) : null,
    computedJoinState: computeJoinState(row)
  };
}

/**
 * Get a contest instance by join token
 *
 * @param {Object} pool - Database connection pool
 * @param {string} token - Join token
 * @returns {Promise<Object|null>} Contest instance with template info, or null
 */
async function getContestInstanceByToken(pool, token) {
  // Validate token first (fail-fast)
  const validation = validateJoinToken(token);
  if (!validation.valid) {
    return null;
  }

  const result = await pool.query(
    `SELECT
      ci.*,
      ci.contest_name,
      ci.max_entries,
      ci.lock_time,
      ci.status,
      ct.name as template_name,
      ct.sport as template_sport,
      ct.template_type,
      ct.scoring_strategy_key,
      ct.lock_strategy_key,
      ct.settlement_strategy_key,
      COALESCE(u.username, u.name, 'Unknown') as organizer_name,
      (SELECT COUNT(*) FROM contest_participants cp WHERE cp.contest_instance_id = ci.id)::int as entries_current
    FROM contest_instances ci
    JOIN contest_templates ct ON ci.template_id = ct.id
    LEFT JOIN users u ON u.id = ci.organizer_id
    WHERE ci.join_token = $1`,
    [token]
  );
  const row = result.rows[0];
  if (!row) return null;

  // Enforce instance-owned fields; hard-delete template leakage
  row.contest_name = row.contest_name;
  row.max_entries = row.max_entries;
  delete row.name;
  delete row.template_name;

  return {
    ...row,
    join_url: generateJoinUrl(row.join_token),
    computedJoinState: computeJoinState(row)
  };
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
      ci.*,
      ct.name as template_name,
      ct.sport as template_sport,
      ct.template_type,
      ct.scoring_strategy_key,
      ct.lock_strategy_key,
      ct.settlement_strategy_key,
      COALESCE(u.username, u.name, 'Unknown') as creator_display_name,
      (SELECT COUNT(*) FROM contest_participants cp WHERE cp.contest_instance_id = ci.id)::int as entries_current
    FROM contest_instances ci
    JOIN contest_templates ct ON ci.template_id = ct.id
    LEFT JOIN users u ON ci.organizer_id = u.id
    WHERE ci.join_token = $1`,
    [token]
  );
  const instance = result.rows[0];

  if (!instance) {
    return {
      valid: false,
      error_code: JOIN_ERROR_CODES.CONTEST_NOT_FOUND,
      reason: 'Contest not found for this token',
      environment_mismatch: false
    };
  }

  const joinState = computeJoinState(instance);

  // Only OPEN + JOINABLE contests resolve as valid
  if (instance.status === 'open' && joinState === 'JOINABLE') {
    return {
      valid: true,
      contest: {
        id: instance.id,
        template_id: instance.template_id,
        contest_name: instance.contest_name,
        max_entries: instance.max_entries,
        template_name: instance.template_name,
        template_sport: instance.template_sport,
        entry_fee_cents: instance.entry_fee_cents,
        payout_structure: instance.payout_structure,
        status: instance.status,
        start_time: instance.start_time,
        lock_time: instance.lock_time,
        join_url: generateJoinUrl(token),
        computedJoinState: joinState,
        creatorName: instance.creator_display_name,
        entriesCurrent: instance.entries_current,
        maxEntries: instance.max_entries
      }
    };
  }

  // Open but past lock_time
  if (instance.status === 'open' && joinState === 'LOCKED') {
    return {
      valid: false,
      error_code: JOIN_ERROR_CODES.CONTEST_LOCKED,
      reason: 'Contest join window has closed',
      environment_mismatch: false,
      contest: {
        id: instance.id,
        status: instance.status,
        lock_time: instance.lock_time,
        computedJoinState: joinState
      }
    };
  }

  if (instance.status === 'draft') {
    // Draft → CONTEST_UNAVAILABLE (collapsed from NOT_PUBLISHED)
    return {
      valid: false,
      error_code: JOIN_ERROR_CODES.CONTEST_UNAVAILABLE,
      reason: 'Contest has not been published yet',
      environment_mismatch: false,
      contest: {
        id: instance.id,
        status: instance.status,
        computedJoinState: joinState
      }
    };
  }

  if (instance.status === 'locked') {
    return {
      valid: false,
      error_code: JOIN_ERROR_CODES.CONTEST_LOCKED,
      reason: 'Contest is locked and no longer accepting participants',
      environment_mismatch: false,
      contest: {
        id: instance.id,
        status: instance.status,
        lock_time: instance.lock_time,
        computedJoinState: joinState
      }
    };
  }

  if (instance.status === 'settled') {
    return {
      valid: false,
      error_code: JOIN_ERROR_CODES.CONTEST_COMPLETED,
      reason: 'Contest is settled and no longer accepting participants',
      environment_mismatch: false,
      contest: {
        id: instance.id,
        status: instance.status,
        computedJoinState: joinState
      }
    };
  }

  if (instance.status === 'cancelled') {
    return {
      valid: false,
      error_code: JOIN_ERROR_CODES.CONTEST_UNAVAILABLE,
      reason: 'Contest is cancelled and no longer accepting participants',
      environment_mismatch: false,
      contest: {
        id: instance.id,
        status: instance.status,
        computedJoinState: joinState
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
 * @returns {Promise<Array>} Array of contest instances
 */
async function getContestInstancesForOrganizer(pool, organizerId) {
  const result = await pool.query(
    `SELECT
      ci.*,
      ci.contest_name,
      ci.max_entries,
      ci.lock_time,
      ci.status,
      ct.name as template_name,
      ct.sport as template_sport,
      ct.template_type,
      COALESCE(u.username, u.name, 'Unknown') as organizer_name,
      (SELECT COUNT(*) FROM contest_participants cp WHERE cp.contest_instance_id = ci.id)::int as entries_current
    FROM contest_instances ci
    JOIN contest_templates ct ON ci.template_id = ct.id
    LEFT JOIN users u ON u.id = ci.organizer_id
    WHERE ci.organizer_id = $1
    ORDER BY ci.created_at DESC`,
    [organizerId]
  );
  return result.rows.map(row => {
    // Enforce instance-owned fields; hard-delete template leakage
    row.contest_name = row.contest_name;
    row.max_entries = row.max_entries;
    delete row.name;
    delete row.template_name;

    return {
      ...row,
      join_url: row.join_token ? generateJoinUrl(row.join_token) : null,
      computedJoinState: computeJoinState(row)
    };
  });
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
    draft: ['open', 'cancelled'],
    open: ['locked', 'cancelled'],
    locked: ['settled', 'cancelled'],
    settled: [],
    cancelled: []
  };

  const allowedNext = validTransitions[existing.status];
  if (!allowedNext.includes(newStatus)) {
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
  const existing = await getContestInstance(pool, instanceId);
  if (!existing) {
    throw new Error('Contest instance not found');
  }

  // Verify ownership (case-insensitive UUID comparison)
  if (existing.organizer_id.toLowerCase() !== organizerId.toLowerCase()) {
    throw new Error('Only the organizer can publish contest');
  }

  // Idempotency: if already open, return as-is without any modifications
  if (existing.status === 'open') {
    return {
      ...existing,
      join_url: generateJoinUrl(existing.join_token),
      computedJoinState: computeJoinState(existing)
    };
  }

  // Only draft contests can be published
  if (existing.status !== 'draft') {
    throw new Error(`Cannot transition from '${existing.status}' to 'open'`);
  }

  // Ensure join_token exists (required by database constraint for non-draft status)
  // If draft has no token (edge case), generate one during publish
  const joinToken = existing.join_token || generateJoinToken();

  // Perform atomic update: set status to open and ensure join_token is set
  const result = await pool.query(
    `UPDATE contest_instances SET status = 'open', join_token = $1, updated_at = NOW() WHERE id = $2 AND organizer_id = $3 RETURNING *`,
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
    join_url: generateJoinUrl(instance.join_token),
    computedJoinState: computeJoinState(instance)
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

    // Lock the contest row to serialize concurrent joins
    const contestResult = await client.query(
      'SELECT id, status, max_entries, lock_time FROM contest_instances WHERE id = $1 FOR UPDATE',
      [contestInstanceId]
    );

    if (contestResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return {
        joined: false,
        error_code: JOIN_ERROR_CODES.CONTEST_NOT_FOUND,
        reason: 'Contest not found'
      };
    }

    const contest = contestResult.rows[0];

    // Only open contests can be joined
    if (contest.status !== 'open') {
      await client.query('ROLLBACK');

      if (contest.status === 'draft') {
        return { joined: false, error_code: JOIN_ERROR_CODES.CONTEST_UNAVAILABLE, reason: 'Contest has not been published yet' };
      }
      if (contest.status === 'locked') {
        return { joined: false, error_code: JOIN_ERROR_CODES.CONTEST_LOCKED, reason: 'Contest is locked' };
      }
      if (contest.status === 'settled') {
        return { joined: false, error_code: JOIN_ERROR_CODES.CONTEST_COMPLETED, reason: 'Contest is settled' };
      }
      if (contest.status === 'cancelled') {
        return { joined: false, error_code: JOIN_ERROR_CODES.CONTEST_UNAVAILABLE, reason: 'Contest is cancelled' };
      }
      return { joined: false, error_code: JOIN_ERROR_CODES.CONTEST_NOT_FOUND, reason: 'Contest is not in a joinable state' };
    }

    // Enforce lock_time: if lock_time has passed, the join window is closed
    if (contest.lock_time !== null && new Date() >= new Date(contest.lock_time)) {
      await client.query('ROLLBACK');
      return { joined: false, error_code: JOIN_ERROR_CODES.CONTEST_LOCKED, reason: 'Contest join window has closed' };
    }

    // Capacity-checked insert: only succeeds if under max_entries
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
      return {
        joined: false,
        error_code: JOIN_ERROR_CODES.CONTEST_FULL,
        reason: 'Contest has reached maximum participants'
      };
    }

    await client.query('COMMIT');
    return {
      joined: true,
      participant: insertResult.rows[0]
    };
  } catch (err) {
    await client.query('ROLLBACK');

    // Map PG unique violation to ALREADY_JOINED
    if (err.code === '23505') {
      return {
        joined: false,
        error_code: JOIN_ERROR_CODES.ALREADY_JOINED,
        reason: 'User has already joined this contest'
      };
    }

    throw err;
  } finally {
    client.release();
  }
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
  updateContestInstanceStatus,
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
  computeJoinState,

  // Constants
  VALID_STATUSES,
  VALID_ENV_PREFIXES,
  JOIN_ERROR_CODES,
};
