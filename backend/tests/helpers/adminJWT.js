/**
 * Admin JWT Test Helper
 *
 * Generates valid JWT tokens for admin testing.
 * Used to bypass requireAdmin middleware in integration tests.
 */

const jwt = require('jsonwebtoken');

/**
 * Generate a valid admin JWT token
 *
 * @param {string} userId - User ID to embed in token
 * @param {string} secret - JWT secret (defaults to process.env.ADMIN_JWT_SECRET)
 * @returns {string} JWT token
 */
function generateAdminJWT(userId, secret = process.env.ADMIN_JWT_SECRET) {
  if (!secret) {
    throw new Error('ADMIN_JWT_SECRET not configured');
  }

  const token = jwt.sign(
    {
      sub: userId,
      is_admin: true,
      role: 'admin',
      iat: Math.floor(Date.now() / 1000)
    },
    secret,
    {
      algorithm: 'HS256',
      expiresIn: '1h'
    }
  );

  return token;
}

module.exports = {
  generateAdminJWT
};
