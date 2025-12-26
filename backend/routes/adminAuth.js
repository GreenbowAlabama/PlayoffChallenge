const express = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { exchangeAppleAuthCode, verifyAppleIdToken } = require('../auth/appleVerify');

const router = express.Router();

/**
 * Generates Apple client secret (signed JWT).
 * Required for Apple token exchange.
 *
 * @param {string} teamId - Apple Team ID
 * @param {string} clientId - Apple Service ID (client ID)
 * @param {string} keyId - Apple Key ID
 * @param {string} privateKey - Apple private key (PEM format)
 * @returns {string} Signed JWT
 */
function generateAppleClientSecret(teamId, clientId, keyId, privateKey) {
  const now = Math.floor(Date.now() / 1000);

  const payload = {
    iss: teamId,
    iat: now,
    exp: now + 3600, // 1 hour
    aud: 'https://appleid.apple.com',
    sub: clientId
  };

  const options = {
    algorithm: 'ES256',
    header: {
      alg: 'ES256',
      kid: keyId
    }
  };

  return jwt.sign(payload, privateKey, options);
}

/**
 * POST /api/admin/auth/apple
 *
 * Authenticates admin user via Sign in with Apple (web flow).
 *
 * Steps:
 * 1. Exchange authorization code for Apple id_token
 * 2. Verify id_token (signature, claims, jti replay protection)
 * 3. Lookup user by apple_id in database
 * 4. Verify is_admin = true
 * 5. Issue admin-scoped JWT
 * 6. Return JWT to client
 *
 * Request body:
 * - code: Authorization code from Apple redirect
 * - redirectUri: Redirect URI used in initial request (must match)
 *
 * Response:
 * - token: Admin JWT (1 hour expiry)
 * - user: { id, apple_id, email }
 */
router.post('/auth/apple', async (req, res) => {
  const { code, redirectUri } = req.body;

  if (!code || !redirectUri) {
    console.log('[Admin Auth] Missing code or redirectUri', {
      timestamp: new Date().toISOString(),
      ip: req.ip
    });
    return res.status(400).json({ error: 'Missing code or redirectUri' });
  }

  try {
    // Validate required environment variables
    const {
      APPLE_TEAM_ID,
      APPLE_CLIENT_ID,
      APPLE_KEY_ID,
      APPLE_PRIVATE_KEY,
      ADMIN_JWT_SECRET
    } = process.env;

    if (!APPLE_TEAM_ID || !APPLE_CLIENT_ID || !APPLE_KEY_ID || !APPLE_PRIVATE_KEY || !ADMIN_JWT_SECRET) {
      console.error('[Admin Auth] Missing required environment variables', {
        timestamp: new Date().toISOString(),
        missing: {
          APPLE_TEAM_ID: !APPLE_TEAM_ID,
          APPLE_CLIENT_ID: !APPLE_CLIENT_ID,
          APPLE_KEY_ID: !APPLE_KEY_ID,
          APPLE_PRIVATE_KEY: !APPLE_PRIVATE_KEY,
          ADMIN_JWT_SECRET: !ADMIN_JWT_SECRET
        }
      });
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Generate Apple client secret
    const clientSecret = generateAppleClientSecret(
      APPLE_TEAM_ID,
      APPLE_CLIENT_ID,
      APPLE_KEY_ID,
      APPLE_PRIVATE_KEY
    );

    // Exchange authorization code for id_token
    let idToken;
    try {
      idToken = await exchangeAppleAuthCode(code, APPLE_CLIENT_ID, clientSecret, redirectUri);
    } catch (err) {
      console.log('[Admin Auth] Apple token exchange failed', {
        timestamp: new Date().toISOString(),
        error: err.message,
        ip: req.ip
      });
      return res.status(401).json({ error: 'Apple authentication failed', details: err.message });
    }

    // Verify Apple id_token
    let applePayload;
    try {
      applePayload = await verifyAppleIdToken(idToken, APPLE_CLIENT_ID);
    } catch (err) {
      console.log('[Admin Auth] Apple token verification failed', {
        timestamp: new Date().toISOString(),
        error: err.message,
        ip: req.ip
      });
      return res.status(401).json({ error: 'Invalid Apple token', details: err.message });
    }

    const { apple_id, email } = applePayload;

    // Lookup user in database
    const pool = req.app.locals.pool || require('../db/pool'); // Adjust import as needed
    const userResult = await pool.query(
      'SELECT id, apple_id, email, is_admin FROM users WHERE apple_id = $1 LIMIT 1',
      [apple_id]
    );

    if (userResult.rows.length === 0) {
      console.log('[Admin Auth] User not found', {
        timestamp: new Date().toISOString(),
        apple_id,
        email,
        ip: req.ip
      });
      return res.status(403).json({ error: 'Access denied: User not found' });
    }

    const user = userResult.rows[0];

    if (user.is_admin !== true) {
      console.log('[Admin Auth] User is not admin', {
        timestamp: new Date().toISOString(),
        userId: user.id,
        apple_id: user.apple_id,
        email: user.email,
        ip: req.ip
      });
      return res.status(403).json({ error: 'Access denied: Insufficient privileges' });
    }

    // Issue admin-scoped JWT
    const adminJwtPayload = {
      sub: user.id,
      apple_id: user.apple_id,
      is_admin: true,
      role: 'admin',
      jti: uuidv4(),
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600 // 1 hour
    };

    const adminToken = jwt.sign(adminJwtPayload, ADMIN_JWT_SECRET, { algorithm: 'HS256' });

    console.log('[Admin Auth] Admin login successful', {
      timestamp: new Date().toISOString(),
      userId: user.id,
      apple_id: user.apple_id,
      email: user.email,
      ip: req.ip
    });

    return res.json({
      token: adminToken,
      user: {
        id: user.id,
        apple_id: user.apple_id,
        email: user.email
      }
    });
  } catch (err) {
    console.error('[Admin Auth] Unexpected error in /auth/apple', {
      timestamp: new Date().toISOString(),
      error: err.message,
      stack: err.stack,
      ip: req.ip
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
