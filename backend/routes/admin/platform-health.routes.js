/**
 * Platform Health Admin Routes
 *
 * Single aggregated endpoint for UI consumption.
 * Provides operator-facing platform health status.
 *
 * This is the anti-corruption layer between diagnostics and UI.
 * UI only knows about /api/admin/platform-health.
 * All internal signal aggregation happens server-side.
 */

const express = require('express');
const router = express.Router();
const platformHealthService = require('../../services/adminPlatformHealth.service');

/**
 * GET /api/admin/platform-health
 *
 * Returns aggregated platform health status for operators.
 *
 * Response:
 * {
 *   "status": "healthy" | "degraded" | "critical",
 *   "timestamp": "2026-03-08T19:24:00Z",
 *   "services": {
 *     "database": "healthy",
 *     "externalApis": "healthy",
 *     "workers": "healthy",
 *     "contestLifecycle": "healthy",
 *     "invariants": "healthy"
 *   }
 * }
 */
router.get('/', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const health = await platformHealthService.getPlatformHealth(pool);

    // Set appropriate HTTP status based on platform health
    const httpStatus =
      health.status === 'critical' ? 503 :
      health.status === 'degraded' ? 200 :
      200;

    res.status(httpStatus).json(health);
  } catch (err) {
    console.error('[Platform Health Route] Error:', err);
    res.status(500).json({
      status: 'critical',
      timestamp: new Date().toISOString(),
      error: 'Platform health check failed'
    });
  }
});

module.exports = router;
