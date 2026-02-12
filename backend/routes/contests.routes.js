/**
 * Contests Routes (User-Scoped)
 *
 * All endpoints under /api/contests/*
 * Handles user-specific contest queries.
 * Relies on centralized authentication middleware (req.user).
 *
 * Routes:
 * - GET /api/contests/my - List "My Contests" (contests user entered + SCHEDULED contests open for entry)
 */

const express = require('express');
const router = express.Router();

const customContestService = require('../services/customContestService');

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
 * - 401: Authentication required (req.user missing)
 * - 500: Server error
 *
 * Authentication:
 * - Requires req.user (populated by upstream auth middleware)
 * - userId derived from req.user.id
 * - isAdmin derived from req.user.isAdmin === true
 */
router.get('/my', async (req, res) => {
  try {
    // Require authenticated user from centralized auth middleware
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const pool = req.app.locals.pool;
    const userId = req.user.id;
    const isAdmin = req.user.isAdmin === true; // Fail-closed: default to false

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
 * - 401: Authentication required (req.user missing)
 * - 500: Server error
 *
 * Authentication:
 * - Requires req.user (populated by upstream auth middleware)
 * - userId derived from req.user.id
 */
router.get('/available', async (req, res) => {
  try {
    // Require authenticated user from centralized auth middleware
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const pool = req.app.locals.pool;
    const userId = req.user.id;

    const contests = await customContestService.getAvailableContests(pool, userId);

    res.json(contests);
  } catch (err) {
    console.error('[Contests] Error fetching available contests:', err);
    res.status(500).json({ error: 'Failed to fetch contests' });
  }
});

module.exports = router;
