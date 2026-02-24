const jwt = require('jsonwebtoken');

/**
 * Middleware to enforce admin-only access on protected routes.
 *
 * Verifies JWT signature, claims, and re-queries database for defense in depth.
 * Logs all authorization failures for audit purposes.
 */
async function requireAdmin(req, res, next) {
  // Skip auth middleware for authentication endpoints
  if (req.path.includes('/auth/')) {
    return next();
  }

  try {
    // Extract Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('[Admin Auth] Missing or invalid Authorization header', {
        timestamp: new Date().toISOString(),
        path: req.path,
        ip: req.ip
      });
      return res.status(401).json({ error: 'Unauthorized: Missing token' });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify JWT signature and decode
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.ADMIN_JWT_SECRET, {
        algorithms: ['HS256']
      });
    } catch (err) {
      console.log('[Admin Auth] Invalid or expired JWT', {
        timestamp: new Date().toISOString(),
        path: req.path,
        error: err.message,
        ip: req.ip
      });
      return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
    }

    // Validate required claims
    if (!decoded.sub || decoded.is_admin !== true || decoded.role !== 'admin') {
      console.log('[Admin Auth] Invalid JWT claims', {
        timestamp: new Date().toISOString(),
        path: req.path,
        claims: { sub: decoded.sub, is_admin: decoded.is_admin, role: decoded.role },
        ip: req.ip
      });
      return res.status(403).json({ error: 'Forbidden: Insufficient privileges' });
    }

    // Defense in depth: Re-query database to verify admin status
    const pool = req.app.locals.pool || require('../db/pool'); // Adjust import as needed
    const result = await pool.query(
      'SELECT id, apple_id, email, is_admin FROM users WHERE id = $1 LIMIT 1',
      [decoded.sub]
    );

    if (result.rows.length === 0) {
      console.log('[Admin Auth] User not found in database', {
        timestamp: new Date().toISOString(),
        userId: decoded.sub,
        path: req.path,
        ip: req.ip
      });
      return res.status(403).json({ error: 'Forbidden: User not found' });
    }

    const user = result.rows[0];

    if (user.is_admin !== true) {
      console.log('[Admin Auth] User admin status revoked', {
        timestamp: new Date().toISOString(),
        userId: user.id,
        appleId: user.apple_id,
        path: req.path,
        ip: req.ip
      });
      return res.status(403).json({ error: 'Forbidden: Admin access revoked' });
    }

    // Attach admin user to request for downstream handlers
    req.adminUser = {
      id: user.id,
      apple_id: user.apple_id,
      email: user.email,
      is_admin: user.is_admin
    };

    next();
  } catch (err) {
    console.error('[Admin Auth] Unexpected error in requireAdmin middleware', {
      timestamp: new Date().toISOString(),
      error: err.message,
      stack: err.stack,
      path: req.path,
      ip: req.ip
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = requireAdmin;
