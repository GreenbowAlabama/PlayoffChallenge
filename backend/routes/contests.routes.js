/**
 * Contests Routes (User-Scoped)
 *
 * All endpoints under /api/contests/*
 * Handles user-specific contest queries.
 * Supports both Bearer token (Authorization header) and X-User-Id header authentication.
 *
 * Routes:
 * - GET /api/contests/my - List "My Contests" (contests user entered + SCHEDULED contests open for entry)
 * - GET /api/contests/available - List available contests (SCHEDULED, not entered, not full)
 */

const express = require('express');
const router = express.Router();

const customContestService = require('../services/customContestService');

/**
 * Middleware to extract user ID and admin flag from request.
 * Accepts either Bearer token (Authorization header) or X-User-Id header.
 * Optionally extracts X-User-Is-Admin header to indicate admin status.
 * Validates UUID format before allowing request to proceed.
 * Returns 401 if no auth header present.
 * Returns 400 if auth header present but invalid UUID format.
 */
function extractUserId(req, res, next) {
  let userId;
  const authHeader = req.headers['authorization'];
  const xUserId = req.headers['x-user-id'];
  const xUserIsAdmin = req.headers['x-user-is-admin'];

  if (authHeader && authHeader.startsWith('Bearer ')) {
    userId = authHeader.substring(7, authHeader.length);
  } else if (xUserId) {
    userId = xUserId;
  } else {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(userId)) {
    return res.status(400).json({ error: 'Invalid user ID format' });
  }

  if (process.env.LOG_AUTH_DEBUG === 'true') {
    console.log('[Auth]', req.method, req.originalUrl, 'user_id_suffix:', userId.slice(-6));
  }
  req.userId = userId;
  req.isAdmin = xUserIsAdmin === 'true'; // Extract admin flag, default to false
  next();
}

/**
 * GET /api/contests/my
 *
 * Returns "My Contests" - contests the user has entered, plus SCHEDULED contests open for entry.
 *
 * Contract (GAP-12):
 * - Data scope: contests user entered OR status = SCHEDULED
 * - Sorting: 6-tier sort (LIVE, LOCKED, SCHEDULED, COMPLETE, CANCELLED, ERROR)
 * - ERROR contests hidden from non-admin users (fail-closed)
 * - Metadata-only: no standings (deterministic, scalable list endpoint)
 * - Non-mutating: does not trigger lifecycle advancement
 *
 * Query Parameters:
 * - limit: Page size (default 50, clamped to [1, 200])
 * - offset: Page offset (default 0, clamped to >= 0)
 *
 * Response:
 * - 200: Array of contest objects (ordered by contract rules)
 * - 400: Invalid query parameters
 * - 401: Authentication required
 * - 500: Server error
 *
 * Authentication:
 * - Requires extractUserId middleware (Bearer token or X-User-Id header)
 * - userId from req.userId (extracted by middleware)
 * - isAdmin from X-User-Is-Admin header (extracted by middleware, defaults to false)
 */
router.get('/my', extractUserId, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.userId;
    const isAdmin = req.isAdmin === true; // Fail-closed: default to false

    // Parse and validate pagination parameters
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;

    if (isNaN(limit) || isNaN(offset)) {
      return res.status(400).json({ error: 'Invalid pagination parameters' });
    }

    const contests = await customContestService.getContestsForUser(
      pool,
      userId,
      isAdmin,
      limit,
      offset
    );

    res.json(contests);
  } catch (err) {
    console.error('[Contests] Error fetching my contests:', err);
    res.status(500).json({ error: 'Failed to fetch contests' });
  }
});

/**
 * GET /api/contests/available
 *
 * Returns SCHEDULED contests available for user to join.
 *
 * Contract:
 * - Data scope: SCHEDULED contests user has NOT entered, not full
 * - Sorting: is_platform_owned DESC, created_at DESC
 * - Metadata-only: no standings, user_has_entered always false
 * - Single parameterized query, no N+1
 *
 * Response:
 * - 200: Array of contest objects
 * - 401: Authentication required
 * - 500: Server error
 *
 * Authentication:
 * - Requires extractUserId middleware (Bearer token or X-User-Id header)
 * - userId from req.userId (extracted by middleware)
 */
router.get('/available', extractUserId, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.userId;

    const contests = await customContestService.getAvailableContests(pool, userId);

    res.json(contests);
  } catch (err) {
    console.error('[Contests] Error fetching available contests:', err);
    res.status(500).json({ error: 'Failed to fetch contests' });
  }
});

module.exports = router;
