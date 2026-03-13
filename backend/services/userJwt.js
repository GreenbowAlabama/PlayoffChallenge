const jwt = require('jsonwebtoken');

/**
 * Generate a JWT token for an authenticated user.
 *
 * @param {Object} user - User object
 * @param {string} user.id - User ID
 * @param {string} user.email - User email
 * @returns {string} JWT token
 * @throws {Error} If JWT_SECRET is not set
 */
function generateUserToken(user) {
  const payload = {
    sub: user.id,
    user_id: user.id,
    email: user.email,
  };

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }

  const token = jwt.sign(payload, secret, {
    algorithm: 'HS256',
    expiresIn: '24h',
  });

  return token;
}

module.exports = {
  generateUserToken,
};
