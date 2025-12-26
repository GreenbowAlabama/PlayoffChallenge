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
 * Authenticates admin user via Sign in with Apple (web redirect flow).
 * Apple POSTs form-encoded data with both code and id_token.
 *
 * Steps:
 * 1. Verify id_token from Apple POST (signature, claims, jti replay protection)
 * 2. Lookup user by apple_id in database
 * 3. Verify is_admin = true
 * 4. Issue admin-scoped JWT
 * 5. Redirect to web-admin with token
 *
 * Form data (from Apple POST):
 * - code: Authorization code from Apple
 * - id_token: Signed JWT from Apple
 * - state: State parameter (should be 'web-admin')
 *
 * Response:
 * - Redirects to web-admin with token in URL
 */
router.post('/auth/apple', async (req, res) => {
  const { id_token, code, state } = req.body;

  console.log('[Admin Auth] Apple callback received', {
    timestamp: new Date().toISOString(),
    hasIdToken: !!id_token,
    hasCode: !!code,
    state,
    ip: req.ip
  });

  if (!id_token) {
    console.log('[Admin Auth] Missing id_token in POST body', {
      timestamp: new Date().toISOString(),
      ip: req.ip,
      body: req.body
    });
    return res.status(400).json({ error: 'Missing id_token' });
  }

  try {
    // Validate required environment variables
    const {
      APPLE_CLIENT_ID,
      ADMIN_JWT_SECRET
    } = process.env;

    if (!APPLE_CLIENT_ID || !ADMIN_JWT_SECRET) {
      console.error('[Admin Auth] Missing required environment variables', {
        timestamp: new Date().toISOString(),
        missing: {
          APPLE_CLIENT_ID: !APPLE_CLIENT_ID,
          ADMIN_JWT_SECRET: !ADMIN_JWT_SECRET
        }
      });
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Verify Apple id_token (Apple provides it directly in POST body)
    let applePayload;
    try {
      applePayload = await verifyAppleIdToken(id_token, APPLE_CLIENT_ID);
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

    // Redirect to web-admin with token
    const webAdminUrl = process.env.WEB_ADMIN_URL || 'https://upbeat-analysis-production.up.railway.app';
    const redirectUrl = `${webAdminUrl}?token=${adminToken}`;

    return res.redirect(redirectUrl);
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
