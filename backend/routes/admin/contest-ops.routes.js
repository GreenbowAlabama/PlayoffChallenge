/**
 * Contest Operations Admin Routes
 *
 * Aggregated endpoints for Contest Ops Dashboard
 * Exposes missing picks, financial health, and reconciliation metrics.
 */

const express = require('express');
const router = express.Router();
const contestOpsService = require('../../services/contestOpsService');
const financialHealthService = require('../../services/financialHealthService');

/**
 * GET /api/admin/contest-ops/missing-picks
 *
 * Get missing picks aggregation for all contests.
 * Computes: missing_picks = max_entries - participant_count
 *
 * Query params:
 * - statuses (optional): comma-separated list of contest statuses to filter by
 *   e.g., ?statuses=SCHEDULED,LOCKED
 *
 * Response:
 * {
 *   "missing_picks": [
 *     {
 *       "contest_id": "uuid",
 *       "contest_name": "String",
 *       "status": "SCHEDULED|LOCKED|LIVE|COMPLETE|CANCELLED",
 *       "max_entries": number,
 *       "participant_count": number,
 *       "missing_picks": number
 *     }
 *   ],
 *   "total_contests": number,
 *   "total_missing_picks": number,
 *   "timestamp": "ISO-8601"
 * }
 */
router.get('/missing-picks', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { statuses } = req.query;

    // Parse statuses filter if provided
    let statusArray = null;
    if (statuses) {
      statusArray = statuses.split(',').map(s => s.trim().toUpperCase());
    }

    const missingPicks = await contestOpsService.getMissingPicks(pool, statusArray);

    // Calculate aggregates
    const totalMissingPicks = missingPicks.reduce((sum, c) => sum + c.missing_picks, 0);

    res.json({
      missing_picks: missingPicks,
      total_contests: missingPicks.length,
      total_missing_picks: totalMissingPicks,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('[Contest Ops - Missing Picks] Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/contest-ops/financial-health
 *
 * Get platform financial health including reconciliation flag.
 *
 * Response:
 * {
 *   "stripe_total_balance": number (cents),
 *   "wallet_balance": number (cents),
 *   "contest_pool_balance": number (cents),
 *   "platform_float": number (cents),
 *   "liquidity_ratio": number,
 *   "reconciled": boolean,
 *   "ledger": {
 *     "credits": number,
 *     "debits": number,
 *     "net": number,
 *     "balanced": boolean
 *   },
 *   "timestamp": "ISO-8601"
 * }
 */
router.get('/financial-health', async (req, res) => {
  try {
    const pool = req.app.locals.pool;

    const health = await financialHealthService.getFinancialHealth(pool);

    res.json({
      ...health,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('[Contest Ops - Financial Health] Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
