/**
 * PGA Diagnostics Admin Routes
 *
 * Operational diagnostic endpoints for PGA contests.
 * Read-only diagnostic endpoints for scoring validation.
 */

const express = require('express');
const router = express.Router();
const pgaLeaderboardDebugService = require('../../services/pgaLeaderboardDebugService');

/**
 * GET /api/admin/pga/leaderboard-debug
 *
 * Operational diagnostic endpoint used to validate PGA scoring.
 * Returns the current leaderboard with raw stroke totals and the
 * computed fantasy score using the contest scoring strategy.
 *
 * This endpoint is read-only and intended for internal debugging and
 * verification that the scoring pipeline works end-to-end.
 *
 * Response: Array of PgaLeaderboardEntry objects
 */
router.get('/leaderboard-debug', async (req, res) => {
  try {
    const pool = req.app.locals.pool;

    const leaderboard = await pgaLeaderboardDebugService.getPgaLeaderboardWithScores(pool);

    res.json(leaderboard);
  } catch (err) {
    console.error('[PGA Diagnostics - Leaderboard Debug] Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
