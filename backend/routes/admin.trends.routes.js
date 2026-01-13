/**
 * Admin Trends Routes
 *
 * All endpoints under /api/admin/trends/*
 * Protected by existing admin middleware (requireAdmin).
 *
 * IMPORTANT: All routes are strictly read-only. No mutations.
 */

const express = require('express');
const router = express.Router();

const trendsService = require('../services/adminTrends.service');

// Valid weekRange values
const VALID_WEEK_RANGES = ['current', 'all'];

/**
 * Validates weekRange query parameter.
 * Defaults to 'all' if not provided or invalid.
 *
 * @param {string|undefined} weekRange - Query parameter value
 * @returns {string} Validated week range
 */
function validateWeekRange(weekRange) {
  if (!weekRange || !VALID_WEEK_RANGES.includes(weekRange)) {
    return 'all';
  }
  return weekRange;
}

// ============================================
// PLAYER PICK TRENDS
// ============================================

/**
 * GET /api/admin/trends/players
 * Returns player pick trends aggregated across paid users.
 *
 * Query params:
 *   - weekRange: 'current' (current NFL week) or 'all' (entire contest)
 *
 * Response:
 *   - playerId: string
 *   - playerName: string
 *   - position: string
 *   - team: string
 *   - pickCount: number
 */
router.get('/players', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const weekRange = validateWeekRange(req.query.weekRange);

    const trends = await trendsService.getPlayerTrends(pool, weekRange);

    res.json({
      timestamp: new Date().toISOString(),
      weekRange,
      count: trends.length,
      trends
    });
  } catch (err) {
    console.error('[Admin Trends] Error fetching player trends:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// TEAM PICK TRENDS
// ============================================

/**
 * GET /api/admin/trends/teams
 * Returns team pick trends aggregated across paid users.
 *
 * Query params:
 *   - weekRange: 'current' (current NFL week) or 'all' (entire contest)
 *
 * Response:
 *   - teamAbbr: string
 *   - pickCount: number
 */
router.get('/teams', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const weekRange = validateWeekRange(req.query.weekRange);

    const trends = await trendsService.getTeamTrends(pool, weekRange);

    res.json({
      timestamp: new Date().toISOString(),
      weekRange,
      count: trends.length,
      trends
    });
  } catch (err) {
    console.error('[Admin Trends] Error fetching team trends:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// CONFERENCE PICK TRENDS
// ============================================

/**
 * GET /api/admin/trends/conferences
 * Returns AFC vs NFC pick distribution aggregated across paid users.
 *
 * Query params:
 *   - weekRange: 'current' (current NFL week) or 'all' (entire contest)
 *
 * Response:
 *   - conference: 'AFC' | 'NFC'
 *   - pickCount: number
 */
router.get('/conferences', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const weekRange = validateWeekRange(req.query.weekRange);

    const trends = await trendsService.getConferenceTrends(pool, weekRange);

    res.json({
      timestamp: new Date().toISOString(),
      weekRange,
      count: trends.length,
      trends
    });
  } catch (err) {
    console.error('[Admin Trends] Error fetching conference trends:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
