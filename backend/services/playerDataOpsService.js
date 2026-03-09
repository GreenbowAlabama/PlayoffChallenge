/**
 * Player Data Ops Service
 *
 * Provides operational visibility into ingestion, player pool coverage, snapshots, and scoring health.
 * Used by admin troubleshooting UI to diagnose player data and scoring issues.
 *
 * This service is read-only and aggregates data from multiple tables:
 * - ingestion_runs
 * - field_selections (player pool coverage)
 * - event_data_snapshots
 * - worker_heartbeats
 * - contest_instances
 */

/**
 * Get complete operational snapshot for player data.
 *
 * @param {Object} pool - Database connection pool or client
 * @param {Object} options - Optional configuration
 * @param {boolean} options.useProvidedClient - If true, pool is actually a client (for testing)
 * @returns {Promise<Object>} Snapshot object with all operational data
 * @throws {Error} If database error occurs
 */
async function getPlayerDataOpsSnapshot(pool, options = {}) {
  const isProvidedClient = options.useProvidedClient === true;
  const client = isProvidedClient ? pool : await pool.connect();
  const shouldRelease = !isProvidedClient;

  try {
    // 1. Server time (reference point for all time-based diagnostics)
    const serverTimeResult = await client.query('SELECT NOW() AS server_time');
    const serverTime = serverTimeResult.rows[0].server_time;

    // 2. Ingestion runs (latest 5)
    const ingestionRunsResult = await client.query(
      `SELECT
        work_unit_key,
        status,
        started_at,
        completed_at,
        error_message
      FROM ingestion_runs
      ORDER BY started_at DESC
      LIMIT 5`
    );

    const ingestionRuns = ingestionRunsResult.rows;

    // Compute ingestion lag metrics
    const lastSuccessRun = ingestionRuns.find(run => run.status === 'COMPLETE');
    const lastSuccess = lastSuccessRun ? lastSuccessRun.completed_at : null;
    const lagSeconds = lastSuccess ? Math.floor((serverTime - new Date(lastSuccess)) / 1000) : null;

    // 3. Player pool coverage
    // Count contests with player pools (via field_selections)
    const poolCoverageResult = await client.query(
      `SELECT COUNT(DISTINCT contest_instance_id) as tournaments_with_pool
      FROM field_selections`
    );

    const tournamentsWithPool = parseInt(poolCoverageResult.rows[0]?.tournaments_with_pool || 0, 10);

    // Count tournaments without player pools
    const missingPoolsResult = await client.query(
      `SELECT COUNT(*) as missing_count
      FROM contest_instances ci
      WHERE ci.provider_event_id IS NOT NULL
      AND ci.id NOT IN (
        SELECT DISTINCT fs.contest_instance_id
        FROM field_selections fs
      )`
    );

    const missingPools = parseInt(missingPoolsResult.rows[0]?.missing_count || 0, 10);

    // 4. Snapshot health
    const snapshotHealthResult = await client.query(
      `SELECT
        COUNT(*) as total_snapshots,
        MAX(ingested_at) as latest_snapshot
      FROM event_data_snapshots`
    );

    const snapshotHealth = snapshotHealthResult.rows[0] || {
      total_snapshots: 0,
      latest_snapshot: null
    };

    const totalSnapshots = parseInt(snapshotHealth.total_snapshots, 10);
    const latestSnapshot = snapshotHealth.latest_snapshot;
    const snapshotLagSeconds = latestSnapshot ? Math.floor((serverTime - new Date(latestSnapshot)) / 1000) : null;

    // Count contests that should have snapshots but don't
    const missingSnapshotsResult = await client.query(
      `SELECT COUNT(*) as missing_count
      FROM contest_instances
      WHERE provider_event_id IS NOT NULL
      AND status IN ('LOCKED', 'LIVE')
      AND id NOT IN (
        SELECT DISTINCT contest_instance_id
        FROM event_data_snapshots
      )`
    );

    const contestsMissingSnapshots = parseInt(missingSnapshotsResult.rows[0]?.missing_count || 0, 10);

    // 5. Scoring signal (use latest snapshot as proxy)
    const lastScoringRun = latestSnapshot;
    const scoringLagSeconds = latestSnapshot ? Math.floor((serverTime - new Date(latestSnapshot)) / 1000) : null;

    // 6. Ingestion errors in last hour
    const ingestionErrorsResult = await client.query(
      `SELECT COUNT(*) as error_count
      FROM ingestion_runs
      WHERE status = 'ERROR'
      AND started_at > NOW() - INTERVAL '1 hour'`
    );

    const errorsLastHour = parseInt(ingestionErrorsResult.rows[0]?.error_count || 0, 10);

    // 7. Worker heartbeats
    const workersResult = await client.query(
      `SELECT
        worker_name,
        status,
        last_run_at,
        error_count
      FROM worker_heartbeats
      ORDER BY worker_name`
    );

    const workers = workersResult.rows;

    // Return complete snapshot
    return {
      server_time: serverTime,
      ingestion: {
        latest_runs: ingestionRuns,
        lag_seconds: lagSeconds,
        last_success: lastSuccess,
        errors_last_hour: errorsLastHour
      },
      player_pool: {
        tournaments_with_pool: tournamentsWithPool,
        missing_pools: missingPools
      },
      snapshots: {
        total_snapshots: totalSnapshots,
        latest_snapshot: latestSnapshot,
        snapshot_lag_seconds: snapshotLagSeconds,
        contests_missing_snapshots: contestsMissingSnapshots
      },
      scoring: {
        last_scoring_run: lastScoringRun,
        scoring_lag_seconds: scoringLagSeconds
      },
      workers
    };
  } finally {
    if (shouldRelease) {
      client.release();
    }
  }
}

module.exports = {
  getPlayerDataOpsSnapshot
};
