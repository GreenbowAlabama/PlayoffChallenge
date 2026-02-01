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

const VALID_STATUSES = ['draft', 'open', 'locked', 'settled', 'cancelled'];
const VALID_ENV_PREFIXES = ['dev', 'test', 'stg', 'prd'];

/**
 * Get the current environment prefix for join tokens
 * @returns {string} Environment prefix (dev, test, stg, prd)
 */
function getEnvPrefix() {
  const env = process.env.APP_ENV || 'dev';
  if (!VALID_ENV_PREFIXES.includes(env)) {
    return 'dev';
  }
  return env;
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

  // Generate join token
  const joinToken = generateJoinToken();

  const result = await pool.query(
    `INSERT INTO contest_instances (
      template_id,
      organizer_id,
      entry_fee_cents,
      payout_structure,
      status,
      join_token,
      start_time,
      lock_time,
      settlement_time
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *`,
    [
      input.template_id,
      organizerId,
      input.entry_fee_cents,
      JSON.stringify(input.payout_structure),
      'draft',
      joinToken,
      input.start_time || null,
      input.lock_time || null,
      input.settlement_time || null
    ]
  );

  return result.rows[0];
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
      ct.name as template_name,
      ct.sport as template_sport,
      ct.template_type,
      ct.scoring_strategy_key,
      ct.lock_strategy_key,
      ct.settlement_strategy_key
    FROM contest_instances ci
    JOIN contest_templates ct ON ci.template_id = ct.id
    WHERE ci.id = $1`,
    [instanceId]
  );
  return result.rows[0] || null;
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
      ct.name as template_name,
      ct.sport as template_sport,
      ct.template_type,
      ct.scoring_strategy_key,
      ct.lock_strategy_key,
      ct.settlement_strategy_key
    FROM contest_instances ci
    JOIN contest_templates ct ON ci.template_id = ct.id
    WHERE ci.join_token = $1`,
    [token]
  );
  return result.rows[0] || null;
}

/**
 * Resolve a join token and return structured contest information
 * Used for universal join link support (pre-authentication)
 *
 * @param {Object} pool - Database connection pool
 * @param {string} token - The join token to resolve
 * @returns {Promise<Object>} Resolution result
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
        reason: validation.error,
        environment_mismatch: true,
        token_environment: tokenEnv,
        current_environment: currentEnv
      };
    }

    return {
      valid: false,
      reason: validation.error,
      environment_mismatch: false
    };
  }

  const instance = await getContestInstanceByToken(pool, token);

  if (!instance) {
    return {
      valid: false,
      reason: 'Contest not found for this token',
      environment_mismatch: false
    };
  }

  return {
    valid: true,
    contest: {
      id: instance.id,
      template_id: instance.template_id,
      template_name: instance.template_name,
      template_sport: instance.template_sport,
      entry_fee_cents: instance.entry_fee_cents,
      payout_structure: instance.payout_structure,
      status: instance.status,
      start_time: instance.start_time,
      lock_time: instance.lock_time
    }
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
      ct.name as template_name,
      ct.sport as template_sport,
      ct.template_type
    FROM contest_instances ci
    JOIN contest_templates ct ON ci.template_id = ct.id
    WHERE ci.organizer_id = $1
    ORDER BY ci.created_at DESC`,
    [organizerId]
  );
  return result.rows;
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
  if (existing.organizer_id !== organizerId) {
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

  // Verify ownership
  if (existing.organizer_id !== organizerId) {
    throw new Error('Only the organizer can publish contest');
  }

  // Idempotency: if already open, return as-is without any modifications
  if (existing.status === 'open') {
    return existing;
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

  return result.rows[0];
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

  // Token functions
  generateJoinToken,
  validateJoinToken,
  resolveJoinToken,

  // Validation helpers
  validateEntryFeeAgainstTemplate,
  validatePayoutStructureAgainstTemplate,

  // Constants
  VALID_STATUSES,
  VALID_ENV_PREFIXES
};
