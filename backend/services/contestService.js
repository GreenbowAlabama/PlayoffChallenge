/**
 * Contest Service
 *
 * Handles contest creation with owner semantics.
 * Custom Contest Creation v1 - Owner-centric contest management.
 */

const crypto = require('crypto');

const VALID_CONTEST_TYPES = ['playoff_challenge', 'march_madness'];
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
 * Validate contest input fields
 * @param {Object} input - Contest input data
 * @throws {Error} If validation fails
 */
function validateContestInput(input) {
  // Validate contest_type
  if (!VALID_CONTEST_TYPES.includes(input.contest_type)) {
    throw new Error(`Invalid contest_type: ${input.contest_type}`);
  }

  // Validate league_name
  if (!input.league_name || typeof input.league_name !== 'string' || input.league_name.trim() === '') {
    throw new Error('league_name is required and must be a non-empty string');
  }

  // Validate max_entries
  if (!Number.isInteger(input.max_entries)) {
    throw new Error('max_entries must be an integer');
  }
  if (input.max_entries <= 0) {
    throw new Error('max_entries must be a positive integer');
  }

  // Validate entry_fee_cents
  if (!Number.isInteger(input.entry_fee_cents)) {
    throw new Error('entry_fee_cents must be an integer');
  }
  if (input.entry_fee_cents < 0) {
    throw new Error('entry_fee_cents must be a non-negative integer');
  }
}

/**
 * Generate a unique join link for private contests
 * Token format: {env}_{random_hex}
 * @returns {string} Join link URL with environment-scoped token
 */
function generateJoinLink() {
  const envPrefix = getEnvPrefix();
  const randomPart = crypto.randomBytes(16).toString('hex');
  const token = `${envPrefix}_${randomPart}`;
  return `https://app.playoff.com/join/${token}`;
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
 * Create a new contest owned by the specified user
 *
 * @param {Object} pool - Database connection pool
 * @param {string} ownerUserId - UUID of the user creating the contest
 * @param {Object} input - Contest creation input
 * @param {string} input.contest_type - Type of contest (playoff_challenge | march_madness)
 * @param {string} input.league_name - Name of the league
 * @param {number} input.max_entries - Maximum number of entries allowed
 * @param {number} input.entry_fee_cents - Entry fee in cents (0 for free)
 * @param {boolean} input.is_private - Whether the contest is private
 * @returns {Promise<Object>} Created contest object
 */
async function createContest(pool, ownerUserId, input) {
  validateContestInput(input);

  const joinLink = input.is_private ? generateJoinLink() : null;

  const result = await pool.query(
    `INSERT INTO contests (
      created_by_user_id,
      contest_type,
      league_name,
      max_entries,
      entry_fee_cents,
      is_private,
      state,
      current_entries,
      join_link
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *`,
    [
      ownerUserId,
      input.contest_type,
      input.league_name,
      input.max_entries,
      input.entry_fee_cents,
      input.is_private,
      'draft',
      0,
      joinLink
    ]
  );

  return result.rows[0];
}

/**
 * Get all contests for a specific user (including their drafts)
 *
 * @param {Object} pool - Database connection pool
 * @param {string} userId - UUID of the user
 * @returns {Promise<Array>} Array of contests
 */
async function getContestsForUser(pool, userId) {
  const result = await pool.query(
    `SELECT * FROM contests WHERE created_by_user_id = $1`,
    [userId]
  );

  return result.rows;
}

/**
 * Get all contests visible to a user
 * Draft contests are only visible to their owner
 *
 * @param {Object} pool - Database connection pool
 * @param {string} userId - UUID of the requesting user
 * @returns {Promise<Array>} Array of visible contests
 */
async function getVisibleContests(pool, userId) {
  const result = await pool.query(
    `SELECT * FROM contests
     WHERE state != 'draft'
     OR created_by_user_id = $1`,
    [userId]
  );

  return result.rows;
}

/**
 * Join a contest using a join token
 *
 * Validates the token BEFORE any database access.
 * This enforces environment isolation and fail-fast behavior.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} userId - UUID of the user joining
 * @param {string} joinToken - The join token (format: {env}_{tokenId})
 * @returns {Promise<Object>} Created contest entry
 * @throws {Error} If token is invalid, contest not found, or contest not open
 */
async function joinContestByToken(pool, userId, joinToken) {
  // FAIL FAST: Validate token before any DB access
  const validation = validateJoinToken(joinToken);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Token is valid - proceed with contest lookup
  const joinLink = `https://app.playoff.com/join/${joinToken}`;

  const contestResult = await pool.query(
    `SELECT * FROM contests WHERE join_link = $1`,
    [joinLink]
  );

  if (contestResult.rows.length === 0) {
    throw new Error('Contest not found for this token');
  }

  const contest = contestResult.rows[0];

  // Verify contest is open for joining
  if (contest.state !== 'open') {
    throw new Error(`Contest is not open for joining (current state: ${contest.state})`);
  }

  // Create contest entry
  const entryResult = await pool.query(
    `INSERT INTO contest_entries (user_id, contest_id)
     VALUES ($1, $2)
     RETURNING *`,
    [userId, contest.contest_id]
  );

  return entryResult.rows[0];
}

/**
 * Publish a contest (transition from draft to open)
 *
 * Owner-only action. Only draft contests can be published.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} userId - UUID of the user attempting to publish
 * @param {string} contestId - UUID of the contest to publish
 * @returns {Promise<Object>} Updated contest object
 * @throws {Error} If contest not found, user is not owner, or contest is not in draft state
 */
async function publishContest(pool, userId, contestId) {
  // Lookup contest
  const contestResult = await pool.query(
    `SELECT * FROM contests WHERE contest_id = $1`,
    [contestId]
  );

  if (contestResult.rows.length === 0) {
    throw new Error('Contest not found');
  }

  const contest = contestResult.rows[0];

  // Verify ownership
  if (contest.created_by_user_id !== userId) {
    throw new Error('Only the contest owner can publish');
  }

  // Verify state is draft
  if (contest.state !== 'draft') {
    throw new Error(`Cannot publish contest: must be in draft state (current state: ${contest.state})`);
  }

  // Transition to open
  const updateResult = await pool.query(
    `UPDATE contests SET state = 'open' WHERE contest_id = $1 RETURNING *`,
    [contestId]
  );

  return updateResult.rows[0];
}

module.exports = {
  createContest,
  getContestsForUser,
  getVisibleContests,
  validateContestInput,
  validateJoinToken,
  joinContestByToken,
  publishContest,
  VALID_CONTEST_TYPES,
  VALID_ENV_PREFIXES
};
