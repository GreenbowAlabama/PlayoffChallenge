/**
 * Admin Ingestion Routes
 *
 * Endpoints for manual ingestion operations.
 * All endpoints under /api/admin/ingestion/*
 * Protected by existing admin middleware (requireAdmin).
 */

const express = require('express');
const router = express.Router();
const ingestionService = require('../services/ingestionService');

/**
 * POST /api/admin/ingestion/run
 * Manually trigger ingestion for all active contest instances.
 * Used for testing and manual intervention in staging.
 *
 * Response: {
 *   success: boolean,
 *   message: string,
 *   timestamp: ISO string,
 *   contestsProcessed: number,
 *   duration_ms: number,
 *   results: Array<{
 *     contest_instance_id: uuid,
 *     status: 'COMPLETED' | 'REJECTED' | 'ERROR',
 *     processed?: number,
 *     skipped?: number,
 *     errors?: number,
 *     error?: string
 *   }>
 * }
 */
router.post('/run', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const startTime = Date.now();

    // Find all active contest instances that need ingestion
    const result = await pool.query(
      `SELECT id FROM contest_instances
       WHERE status IN ('SCHEDULED', 'LOCKED', 'LIVE')
       ORDER BY created_at DESC`
    );

    const contestInstances = result.rows;
    const ingestionResults = [];

    // Trigger ingestion for each active contest
    for (const instance of contestInstances) {
      try {
        const summary = await ingestionService.run(instance.id, pool);

        ingestionResults.push({
          contest_instance_id: instance.id,
          status: summary.status || 'COMPLETED',
          processed: summary.processed || 0,
          skipped: summary.skipped || 0,
          errors: summary.errors?.length || 0
        });

        console.log(
          `[Admin Ingestion] Triggered for ${instance.id}: status=${summary.status}, processed=${summary.processed}`
        );
      } catch (err) {
        ingestionResults.push({
          contest_instance_id: instance.id,
          status: 'ERROR',
          error: err.message
        });

        console.error(
          `[Admin Ingestion] Failed for ${instance.id}: ${err.message}`
        );
      }
    }

    const duration = Date.now() - startTime;

    res.json({
      success: true,
      message: 'Ingestion triggered successfully',
      timestamp: new Date().toISOString(),
      contestsProcessed: ingestionResults.length,
      duration_ms: duration,
      results: ingestionResults
    });
  } catch (err) {
    console.error('[Admin Ingestion] Trigger failed:', err.message);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

module.exports = router;
