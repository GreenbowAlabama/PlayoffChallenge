const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

// In-memory cache for Apple JWKs (public keys)
const appleJwksClient = jwksClient({
  jwksUri: 'https://appleid.apple.com/auth/keys',
  cache: true,
  cacheMaxAge: 3600000, // 1 hour
  rateLimit: true,
  jwksRequestsPerMinute: 10
});

// In-memory TTL cache for JTI replay protection
// Map<jti, expiryTimestamp>
const jtiCache = new Map();

// Cleanup expired JTIs every minute
setInterval(() => {
  const now = Date.now();
  for (const [jti, expiry] of jtiCache.entries()) {
    if (expiry < now) {
      jtiCache.delete(jti);
    }
  }
}, 60000);

/**
 * Fetches Apple's public signing key for the given key ID (kid).
 */
function getAppleSigningKey(kid) {
  return new Promise((resolve, reject) => {
    appleJwksClient.getSigningKey(kid, (err, key) => {
      if (err) {
        return reject(err);
      }
      const signingKey = key.getPublicKey();
      resolve(signingKey);
    });
  });
}

/**
 * Verifies Apple ID token signature, claims, and replay protection.
 *
 * @param {string} idToken - The Apple ID token (JWT)
 * @param {string} clientId - Expected audience (client_id)
 * @returns {Promise<object>} Decoded token payload with apple_id (sub) and email
 * @throws {Error} If verification fails
 */
async function verifyAppleIdToken(idToken, clientId) {
  // Decode header to extract kid (without verification)
  let decoded;
  try {
    decoded = jwt.decode(idToken, { complete: true });
  } catch (err) {
    throw new Error(`Invalid token format: ${err.message}`);
  }

  if (!decoded || !decoded.header || !decoded.header.kid) {
    throw new Error('Invalid token: missing kid in header');
  }

  const kid = decoded.header.kid;

  // Fetch Apple's public key for this kid
  let signingKey;
  try {
    signingKey = await getAppleSigningKey(kid);
  } catch (err) {
    throw new Error(`Failed to fetch Apple signing key: ${err.message}`);
  }

  // Verify JWT signature and claims
  let payload;
  try {
    payload = jwt.verify(idToken, signingKey, {
      issuer: 'https://appleid.apple.com',
      audience: clientId,
      algorithms: ['RS256']
    });
  } catch (err) {
    throw new Error(`Token verification failed: ${err.message}`);
  }

  // Validate required claims
  if (!payload.sub) {
    throw new Error('Invalid token: missing sub claim');
  }

  // Check jti for replay protection (if provided)
  if (payload.jti) {
    const jti = payload.jti;
    const now = Date.now();

    if (jtiCache.has(jti)) {
      throw new Error('Token replay detected: jti already used');
    }

    // Store jti with 10-minute expiry
    const expiryTime = now + 10 * 60 * 1000; // 10 minutes
    jtiCache.set(jti, expiryTime);
  }

  // Return verified payload
  return {
    apple_id: payload.sub,
    email: payload.email || null,
    jti: payload.jti || null,
    iat: payload.iat,
    exp: payload.exp
  };
}

/**
 * Exchanges Apple authorization code for id_token.
 *
 * @param {string} code - Authorization code from Apple
 * @param {string} clientId - Apple client ID
 * @param {string} clientSecret - Apple client secret (signed JWT)
 * @param {string} redirectUri - Redirect URI used in initial request
 * @returns {Promise<string>} Apple ID token
 * @throws {Error} If exchange fails
 */
async function exchangeAppleAuthCode(code, clientId, clientSecret, redirectUri) {
  const fetch = require('node-fetch');

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code: code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri
  });

  const response = await fetch('https://appleid.apple.com/auth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Apple token exchange failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();

  if (!data.id_token) {
    throw new Error('Apple token exchange did not return id_token');
  }

  return data.id_token;
}

module.exports = {
  verifyAppleIdToken,
  exchangeAppleAuthCode
};
