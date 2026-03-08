/**
 * System Invariants Admin Routes
 *
 * Endpoints for monitoring and verifying platform critical invariants.
 * All routes require admin authentication.
 */

const express = require('express');
const router = express.Router();
const systemInvariantService = require('../../services/systemInvariantService');
const requireAdmin = require('../../middleware/adminAuth');

/**
 * GET /api/admin/system-invariants
 * Execute full invariant check and return aggregated results
 */
router.get('/', requireAdmin, async (req, res) => {
  try {
    const result = await systemInvariantService.runFullInvariantCheck(req.app.locals.pool);
    res.status(200).json(result);
  } catch (error) {
    console.error('[systemInvariantsRouter] GET / failed:', error);
    res.status(500).json({
      error_code: 'INVARIANT_CHECK_FAILED',
      reason: 'Unable to execute invariant check',
      details: error.message
    });
  }
});

/**
 * GET /api/admin/system-invariants/history
 * Retrieve historical invariant check results
 */
router.get('/history', requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || 100), 1000);
    const offset = parseInt(req.query.offset || 0);

    const result = await req.app.locals.pool.query(
      `SELECT id, overall_status, financial_status, lifecycle_status,
              settlement_status, pipeline_status, ledger_status,
              execution_time_ms, created_at
       FROM system_invariant_runs
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await req.app.locals.pool.query(
      `SELECT COUNT(*) as count FROM system_invariant_runs`
    );

    res.status(200).json({
      records: result.rows.map(row => ({
        id: row.id,
        overall_status: row.overall_status,
        execution_time_ms: row.execution_time_ms,
        created_at: row.created_at,
        summary: {
          financial_status: row.financial_status,
          lifecycle_status: row.lifecycle_status,
          settlement_status: row.settlement_status,
          pipeline_status: row.pipeline_status,
          ledger_status: row.ledger_status
        }
      })),
      total_count: parseInt(countResult.rows[0].count),
      limit,
      offset
    });
  } catch (error) {
    console.error('[systemInvariantsRouter] GET /history failed:', error);
    res.status(500).json({
      error_code: 'HISTORY_FETCH_FAILED',
      reason: 'Unable to retrieve history',
      details: error.message
    });
  }
});

/**
 * GET /api/admin/system-invariants/latest
 * Get the most recent invariant check result
 */
router.get('/latest', requireAdmin, async (req, res) => {
  try {
    const result = await req.app.locals.pool.query(
      `SELECT id, overall_status, financial_status, lifecycle_status,
              settlement_status, pipeline_status, ledger_status,
              execution_time_ms, created_at
       FROM system_invariant_runs
       ORDER BY created_at DESC
       LIMIT 1`
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error_code: 'NO_RUNS_FOUND',
        reason: 'No invariant checks have been recorded'
      });
    }

    const row = result.rows[0];
    res.status(200).json({
      id: row.id,
      overall_status: row.overall_status,
      execution_time_ms: row.execution_time_ms,
      created_at: row.created_at,
      summary: {
        financial_status: row.financial_status,
        lifecycle_status: row.lifecycle_status,
        settlement_status: row.settlement_status,
        pipeline_status: row.pipeline_status,
        ledger_status: row.ledger_status
      }
    });
  } catch (error) {
    console.error('[systemInvariantsRouter] GET /latest failed:', error);
    res.status(500).json({
      error_code: 'LATEST_FETCH_FAILED',
      reason: 'Unable to retrieve latest check',
      details: error.message
    });
  }
});

module.exports = router;
