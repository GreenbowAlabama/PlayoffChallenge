/**
 * Worker Heartbeat Service
 *
 * Surfaces worker operational status for operator visibility.
 * Detects stalled ingestion, scoring pipeline lag, lifecycle worker failure.
 *
 * Read-only service that queries worker_heartbeats table.
 */

/**
 * Get current status of all critical workers
 *
 * Returns detailed worker health with:
 * - Status (HEALTHY, DEGRADED, ERROR, UNKNOWN)
 * - Last heartbeat timestamp
 * - Error count in recent runs
 * - Freshness assessment
 *
 * @param {Pool} pool - PostgreSQL connection pool
 * @returns {Promise<Object>} Worker status aggregation
 */
async function getWorkerStatus(pool) {
  // Define freshness windows for each worker (minutes)
  const FRESHNESS_WINDOWS = {
    discovery_worker: 5,
    ingestion_worker: 5,
    lifecycle_reconciler: 5,
    payout_scheduler: 10,
    financial_reconciler: 10
  };

  const EXPECTED_WORKERS = Object.keys(FRESHNESS_WINDOWS);

  try {
    // Fetch latest heartbeat for each worker
    const heartbeatResult = await pool.query(`
      SELECT
        worker_name,
        worker_type,
        status,
        last_run_at,
        error_count,
        metadata,
        created_at
      FROM worker_heartbeats
      WHERE worker_name = ANY($1::text[])
      ORDER BY worker_name, created_at DESC
    `, [EXPECTED_WORKERS]);

    // Index heartbeats by worker_name (latest only)
    const heartbeatsByWorker = {};
    const now = new Date();

    heartbeatResult.rows.forEach(row => {
      if (!heartbeatsByWorker[row.worker_name]) {
        heartbeatsByWorker[row.worker_name] = row;
      }
    });

    // Evaluate each worker
    const workers = [];
    let overallHealthy = true;
    let overallDegraded = false;

    EXPECTED_WORKERS.forEach(workerName => {
      const heartbeat = heartbeatsByWorker[workerName];
      const freshnessMins = FRESHNESS_WINDOWS[workerName];
      const isCritical = ['discovery_worker', 'lifecycle_reconciler', 'ingestion_worker'].includes(workerName);

      let status = 'UNKNOWN';
      let statusColor = 'gray';
      let freshness = null;
      let lastRun = null;
      let errorCount = 0;
      let staleMessage = null;

      if (heartbeat) {
        lastRun = heartbeat.last_run_at ? heartbeat.last_run_at.toISOString() : null;
        errorCount = heartbeat.error_count || 0;

        // Check if heartbeat is stale
        const minutesSinceLastRun = (now - heartbeat.last_run_at) / (60 * 1000);
        const isStale = minutesSinceLastRun > freshnessMins;

        freshness = {
          minutes_old: Math.floor(minutesSinceLastRun),
          window_minutes: freshnessMins,
          is_stale: isStale
        };

        if (isStale) {
          status = 'STALE';
          statusColor = 'orange';
          staleMessage = `Heartbeat stale (${Math.floor(minutesSinceLastRun)}m old, max ${freshnessMins}m)`;
          overallDegraded = true;
          if (isCritical) overallHealthy = false;
        } else if (heartbeat.status === 'ERROR') {
          status = 'ERROR';
          statusColor = 'red';
          overallHealthy = false;
        } else if (heartbeat.status === 'DEGRADED') {
          status = 'DEGRADED';
          statusColor = 'orange';
          overallDegraded = true;
          if (isCritical) overallHealthy = false;
        } else if (heartbeat.status === 'HEALTHY') {
          status = 'HEALTHY';
          statusColor = 'green';
        }
      } else {
        statusColor = 'gray';
        overallDegraded = true;
        if (isCritical) overallHealthy = false;
      }

      workers.push({
        name: workerName,
        type: heartbeat?.worker_type || 'unknown',
        status,
        status_color: statusColor,
        is_critical: isCritical,
        last_run: lastRun,
        error_count: errorCount,
        freshness,
        stale_message: staleMessage
      });
    });

    const overallStatus = overallHealthy ? 'healthy' : (overallDegraded ? 'degraded' : 'unknown');

    return {
      timestamp: new Date().toISOString(),
      overall_status: overallStatus,
      workers: workers.sort((a, b) => {
        // Critical workers first, then by status severity
        const statusOrder = { ERROR: 0, STALE: 1, DEGRADED: 2, HEALTHY: 3, UNKNOWN: 4 };
        if (a.is_critical !== b.is_critical) return a.is_critical ? -1 : 1;
        return (statusOrder[a.status] || 5) - (statusOrder[b.status] || 5);
      })
    };
  } catch (error) {
    console.error('[workerHeartbeatService] Failed to get worker status:', error);
    return {
      timestamp: new Date().toISOString(),
      overall_status: 'unknown',
      error: error.message,
      workers: []
    };
  }
}

module.exports = {
  getWorkerStatus
};
