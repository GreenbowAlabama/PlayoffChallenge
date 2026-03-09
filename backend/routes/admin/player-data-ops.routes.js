/**
 * Player Data Operations Admin Routes
 *
 * Aggregated endpoints for Player Data Ops Dashboard
 * Exposes ingestion health, player pool coverage, snapshot health, and scoring signals.
 */

const express = require('express');
const router = express.Router();
const playerDataOpsService = require('../../services/playerDataOpsService');

/**
 * GET /api/admin/player-data/ops
 *
 * Get complete operational snapshot for player data pipeline.
 * Aggregates signals from ingestion, player pools, snapshots, and workers.
 *
 * Response:
 * {
 *   "server_time": "ISO-8601 timestamp",
 *   "ingestion": {
 *     "latest_runs": [
 *       {
 *         "work_unit_key": "string",
 *         "status": "string",
 *         "started_at": "timestamp",
 *         "completed_at": "timestamp | null",
 *         "error_message": "string | null"
 *       }
 *     ],
 *     "lag_seconds": number | null,
 *     "last_success": "timestamp | null",
 *     "errors_last_hour": number
 *   },
 *   "player_pool": {
 *     "tournaments_with_pool": number,
 *     "missing_pools": number
 *   },
 *   "snapshots": {
 *     "total_snapshots": number,
 *     "latest_snapshot": "timestamp | null",
 *     "snapshot_lag_seconds": number | null,
 *     "contests_missing_snapshots": number
 *   },
 *   "scoring": {
 *     "last_scoring_run": "timestamp | null",
 *     "scoring_lag_seconds": number | null
 *   },
 *   "workers": [
 *     {
 *       "worker_name": "string",
 *       "status": "string",
 *       "last_run_at": "timestamp | null",
 *       "error_count": number
 *     }
 *   ]
 * }
 */
router.get('/ops', async (req, res) => {
  try {
    const pool = req.app.locals.pool;

    const snapshot = await playerDataOpsService.getPlayerDataOpsSnapshot(pool);

    res.json(snapshot);
  } catch (err) {
    console.error('[Player Data Ops - Ops Snapshot] Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
