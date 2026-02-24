/**
 * Users Service
 *
 * Extracted from server.js as part of SOLID refactor.
 * Contains user-related business logic with injected dependencies.
 */
const bcrypt = require('bcrypt');
const geoip = require('geoip-lite');

// Restricted states (fantasy sports prohibited or heavily restricted)
const RESTRICTED_STATES = ['NV', 'HI', 'ID', 'MT', 'WA'];

/**
 * Check if a state is restricted for fantasy sports.
 *
 * @param {string} state - State abbreviation
 * @returns {boolean}
 */
function isRestrictedState(state) {
  if (!state) return false;
  return RESTRICTED_STATES.includes(state.toUpperCase());
}

/**
 * Get IP-based state from request for compliance auditing.
 *
 * @param {Object} req - Express request object
 * @returns {string|null} - State abbreviation or null
 */
function getIPState(req) {
  try {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded ? forwarded.split(',')[0].trim() : req.connection.remoteAddress;

    // Handle localhost/private IPs
    if (!ip || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
      console.log('[COMPLIANCE] Local/private IP detected, skipping geolocation');
      return null;
    }

    const geo = geoip.lookup(ip);
    const state = geo?.region || null;

    if (state) {
      console.log(`[COMPLIANCE] IP ${ip} → State: ${state}`);
    } else {
      console.log(`[COMPLIANCE] IP ${ip} → State: unknown`);
    }

    return state;
  } catch (err) {
    console.error('[COMPLIANCE] Error in IP geolocation:', err);
    return null;
  }
}

/**
 * Log signup attempt for compliance auditing.
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} params - Signup attempt parameters
 * @returns {Promise<void>}
 */
async function logSignupAttempt(pool, params) {
  const { appleId, email, name, attemptedState, ipState, blocked, blockedReason } = params;
  try {
    await pool.query(
      `INSERT INTO signup_attempts
        (apple_id, email, name, attempted_state, ip_state_verified, blocked, blocked_reason)
        VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [appleId, email, name, attemptedState, ipState, blocked, blockedReason]
    );
  } catch (err) {
    console.error('[COMPLIANCE] Error logging signup attempt:', err);
    // Don't fail signup if logging fails
  }
}

/**
 * Find user by Apple ID.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} appleId - Apple ID
 * @returns {Promise<Object|null>}
 */
async function findUserByAppleId(pool, appleId) {
  const result = await pool.query(
    'SELECT * FROM users WHERE apple_id = $1 LIMIT 1',
    [appleId]
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Find user by email.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} email - Email address
 * @returns {Promise<Object|null>}
 */
async function findUserByEmail(pool, email) {
  const result = await pool.query(
    'SELECT * FROM users WHERE email = $1 LIMIT 1',
    [email.toLowerCase()]
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Find user by ID.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>}
 */
async function findUserById(pool, userId) {
  const result = await pool.query(
    'SELECT * FROM users WHERE id = $1 LIMIT 1',
    [userId]
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Update user email and/or name if currently NULL.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID
 * @param {string|null} email - Email to set
 * @param {string|null} name - Name to set
 * @returns {Promise<Object>} - Updated user
 */
async function updateUserEmailName(pool, userId, email, name) {
  const result = await pool.query(
    `UPDATE users
      SET email = COALESCE($1, email),
          name = COALESCE($2, name),
          updated_at = NOW()
      WHERE id = $3
      RETURNING *`,
    [email || null, name || null, userId]
  );
  return result.rows[0];
}

/**
 * Generate a username from email or random string.
 *
 * @param {string|null} email - Email address
 * @returns {string}
 */
function generateUsername(email) {
  if (email) {
    return email.split('@')[0];
  }
  return 'User_' + Math.random().toString(36).substring(2, 10);
}

/**
 * Create a new user with Apple Sign In and compliance fields.
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} params - User creation parameters
 * @returns {Promise<Object>} - Created user
 */
async function createAppleUser(pool, params) {
  const { appleId, email, name, state, ipState, tosVersion } = params;
  const generatedUsername = generateUsername(email);

  const result = await pool.query(
    `INSERT INTO users (
      id, apple_id, email, name, username,
      state, ip_state_verified, state_certification_date,
      eligibility_confirmed_at, age_verified, tos_version,
      created_at, updated_at, paid
    )
    VALUES (
      gen_random_uuid(), $1, $2, $3, $4,
      $5, $6, NOW(),
      NOW(), true, $7,
      NOW(), NOW(), true
    )
    RETURNING *`,
    [
      appleId,
      email || null,
      name || null,
      generatedUsername,
      state.toUpperCase(),
      ipState,
      tosVersion || '2025-12-12'
    ]
  );

  return result.rows[0];
}

/**
 * Create a new user with email/password authentication.
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} params - User creation parameters
 * @returns {Promise<Object>} - Created user (without password_hash)
 */
async function createEmailUser(pool, params) {
  const { email, password, name, state, ipState, tosVersion } = params;
  const generatedUsername = generateUsername(email);

  // Hash password
  const saltRounds = 10;
  const password_hash = await bcrypt.hash(password, saltRounds);

  const result = await pool.query(
    `INSERT INTO users (
      id, email, password_hash, name, username, auth_method,
      state, ip_state_verified, state_certification_date,
      eligibility_confirmed_at, age_verified, tos_version,
      created_at, updated_at, paid
    )
    VALUES (
      gen_random_uuid(), $1, $2, $3, $4, 'email',
      $5, $6, NOW(),
      NOW(), true, $7,
      NOW(), NOW(), true
    )
    RETURNING *`,
    [
      email.toLowerCase(),
      password_hash,
      name || null,
      generatedUsername,
      state.toUpperCase(),
      ipState,
      tosVersion || '2025-12-12'
    ]
  );

  const user = result.rows[0];
  delete user.password_hash;
  return user;
}

/**
 * Verify user password.
 *
 * @param {string} password - Plain text password
 * @param {string} passwordHash - Hashed password from database
 * @returns {Promise<boolean>}
 */
async function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

/**
 * Validate username format.
 *
 * @param {string} username - Username to validate
 * @returns {{valid: boolean, error?: string}}
 */
function validateUsername(username) {
  const usernameRegex = /^[a-zA-Z0-9_-]{3,30}$/;
  if (!usernameRegex.test(username)) {
    return {
      valid: false,
      error: 'Username must be 3-30 characters and contain only letters, numbers, underscores, and dashes'
    };
  }
  return { valid: true };
}

/**
 * Check if username is available.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} username - Username to check
 * @param {string} excludeUserId - User ID to exclude from check
 * @returns {Promise<boolean>}
 */
async function isUsernameAvailable(pool, username, excludeUserId) {
  const result = await pool.query(
    'SELECT id FROM users WHERE username = $1 AND id != $2',
    [username, excludeUserId]
  );
  return result.rows.length === 0;
}

/**
 * Check if email already exists.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} email - Email to check
 * @returns {Promise<boolean>}
 */
async function isEmailRegistered(pool, email) {
  const result = await pool.query(
    'SELECT id FROM users WHERE email = $1',
    [email.toLowerCase()]
  );
  return result.rows.length > 0;
}

/**
 * Update user profile fields.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} - Updated user (without password_hash)
 */
async function updateUserProfile(pool, userId, updates) {
  const { username, email, phone, name } = updates;

  const updateParts = [];
  const values = [];
  let paramCount = 1;

  if (username !== undefined) {
    updateParts.push(`username = $${paramCount}`);
    values.push(username);
    paramCount++;
  }

  if (email !== undefined) {
    updateParts.push(`email = $${paramCount}`);
    values.push(email);
    paramCount++;
  }

  if (phone !== undefined) {
    updateParts.push(`phone = $${paramCount}`);
    values.push(phone);
    paramCount++;
  }

  if (name !== undefined) {
    updateParts.push(`name = $${paramCount}`);
    values.push(name);
    paramCount++;
  }

  // Always update the updated_at timestamp
  updateParts.push(`updated_at = NOW()`);

  // Add userId as the last parameter for WHERE clause
  values.push(userId);

  const query = `
    UPDATE users
    SET ${updateParts.join(', ')}
    WHERE id = $${paramCount}
    RETURNING *
  `;

  const result = await pool.query(query, values);

  if (result.rows.length === 0) {
    return null;
  }

  const user = result.rows[0];
  delete user.password_hash;
  return user;
}

/**
 * Accept Terms of Service.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID
 * @param {string} tosVersion - TOS version accepted
 * @returns {Promise<Object|null>} - Updated user or null if not found
 */
async function acceptTos(pool, userId, tosVersion) {
  const result = await pool.query(
    `UPDATE users
      SET tos_accepted_at = NOW(),
          tos_version = $1,
          updated_at = NOW()
      WHERE id = $2
      RETURNING *`,
    [tosVersion || '2025-12-12', userId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  console.log(`[COMPLIANCE] User ${userId} accepted TOS version ${tosVersion}`);
  return result.rows[0];
}

/**
 * Delete a user and all related data.
 * Caller is responsible for transaction management (BEGIN/COMMIT/ROLLBACK).
 *
 * @param {Object} client - Database client from pool.connect()
 * @param {string} userId - User ID
 * @returns {Promise<Object>} - Deleted user
 */
async function deleteUserById(client, userId) {
  // Delete in order: picks, player_swaps, scores, then user
  await client.query('DELETE FROM picks WHERE user_id = $1', [userId]);
  await client.query('DELETE FROM player_swaps WHERE user_id = $1', [userId]);
  await client.query('DELETE FROM scores WHERE user_id = $1', [userId]);
  const result = await client.query('DELETE FROM users WHERE id = $1 RETURNING *', [userId]);
  return result;
}

/**
 * Get current TOS version from rules_content.
 *
 * @param {Object} pool - Database connection pool
 * @returns {Promise<string|null>}
 */
async function getCurrentTosVersion(pool) {
  try {
    const result = await pool.query(`
      SELECT updated_at FROM rules_content WHERE section = 'terms_of_service'
    `);
    if (result.rows.length > 0) {
      return result.rows[0].updated_at.toISOString().split('T')[0];
    }
    return null;
  } catch (err) {
    console.warn('[flags] Could not fetch current TOS version:', err.message);
    return null;
  }
}

/**
 * Get user's TOS status for flags endpoint.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} - TOS status object or null if user not found
 */
async function getUserTosStatus(pool, userId) {
  const userResult = await pool.query(
    'SELECT tos_accepted_at, tos_version FROM users WHERE id = $1',
    [userId]
  );

  if (userResult.rows.length === 0) {
    return null;
  }

  const user = userResult.rows[0];
  const currentTermsVersion = await getCurrentTosVersion(pool);

  // Determine if TOS is required
  let requiresTos = false;
  if (!user.tos_accepted_at) {
    requiresTos = true;
  } else if (currentTermsVersion && user.tos_version !== currentTermsVersion) {
    requiresTos = true;
  }

  return {
    requires_tos: requiresTos,
    tos_version_required: currentTermsVersion,
    tos_accepted_at: user.tos_accepted_at,
    tos_version_accepted: user.tos_version
  };
}

module.exports = {
  // Constants
  RESTRICTED_STATES,

  // Compliance helpers
  isRestrictedState,
  getIPState,
  logSignupAttempt,

  // User lookup
  findUserByAppleId,
  findUserByEmail,
  findUserById,

  // User creation
  generateUsername,
  createAppleUser,
  createEmailUser,

  // Auth
  verifyPassword,

  // Validation
  validateUsername,
  isUsernameAvailable,
  isEmailRegistered,

  // User updates
  updateUserEmailName,
  updateUserProfile,

  // TOS
  acceptTos,
  getCurrentTosVersion,
  getUserTosStatus,

  // Deletion
  deleteUserById
};
