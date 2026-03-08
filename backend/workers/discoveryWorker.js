/**
 * Discovery Worker
 *
 * Background poller that periodically discovers upcoming PGA events
 * and auto-creates contest instances for system-generated templates.
 *
 * Configuration:
 * - ENABLE_DISCOVERY_WORKER=true (required to start)
 * - Interval: 5 minutes (300000ms, configurable via DISCOVERY_WORKER_INTERVAL_MS)
 * - PLATFORM_ORGANIZER_ID: UUID of platform user (required)
 *
 * Behavior:
 * - On each tick, calls runDiscoveryCycle()
 * - Logs cycle summary (events created, skipped, errors)
 * - No error throwing (logs and continues)
 * - Non-blocking: worker continues even if individual cycles fail
 *
 * Startup:
 * - Called from server initialization
 * - Optional: if disabled, no background discovery runs
 */

const { runDiscoveryCycle } = require('../services/discovery/discoveryContestCreationService');

let discoveryInterval = null;

/**
 * Start the discovery worker.
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} options - Configuration options
 * @param {boolean} options.enabled - Whether to start the worker (default: check env var)
 * @param {number} options.intervalMs - Interval in milliseconds (default: 300000 = 5 min)
 * @param {string} options.organizerId - Platform organizer user ID (default: env var)
 */
async function startDiscoveryWorker(pool, options = {}) {
  const enabled = options.enabled ?? process.env.ENABLE_DISCOVERY_WORKER === 'true';
  const intervalMs =
    options.intervalMs ??
    (process.env.DISCOVERY_WORKER_INTERVAL_MS
      ? parseInt(process.env.DISCOVERY_WORKER_INTERVAL_MS, 10)
      : 300000); // 5 minutes default
  const organizerId =
    options.organizerId || process.env.PLATFORM_ORGANIZER_ID;

  if (!enabled) {
    return;
  }

  if (!organizerId) {
    console.error(
      '[Discovery Worker] PLATFORM_ORGANIZER_ID not set. Worker cannot start.'
    );
    return;
  }

  if (discoveryInterval) {
    console.warn(
      'Discovery worker already running, ignoring start request'
    );
    return;
  }

  // Pre-create platform organizer user if it doesn't exist
  try {
    await pool.query(
      `INSERT INTO users (id, username, email)
       VALUES ($1, 'platform-discovery', 'discovery@system.local')
       ON CONFLICT (id) DO NOTHING`,
      [organizerId]
    );
  } catch (err) {
    console.error(
      `[Discovery Worker] Failed to pre-create platform organizer user: ${err.message}`
    );
    return;
  }

  console.log(
    `[Discovery Worker] Starting (interval: ${intervalMs}ms, organizer: ${organizerId})`
  );

  discoveryInterval = setInterval(async () => {
    try {
      const now = new Date();
      const result = await runDiscoveryCycle(pool, now, organizerId);

      if (result.success) {
        console.log(
          `[Discovery] Cycle complete: event=${result.event_id}, template_created=${result.template_created}, instance_created=${result.instance_created}`
        );
      }

      if (result.errors && result.errors.length > 0) {
        console.warn(
          `[Discovery] Cycle errors: ${result.errors.join(', ')}`
        );
      }

      // Publish heartbeat on success
      try {
        await pool.query(`
          INSERT INTO worker_heartbeats
          (worker_name, worker_type, status, last_run_at, error_count, metadata)
          VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT (worker_name)
          DO UPDATE SET
          status = EXCLUDED.status,
          last_run_at = EXCLUDED.last_run_at,
          error_count = EXCLUDED.error_count,
          metadata = EXCLUDED.metadata,
          created_at = NOW();
        `, [
          'discovery_worker',
          'discovery',
          'HEALTHY',
          now,
          0,
          JSON.stringify({ event_id: result.event_id, success: result.success })
        ]);
      } catch (err) {
        console.error('[Discovery Worker] Heartbeat publish failed:', err.message);
        // Do NOT rethrow — discovery must remain primary
      }
    } catch (err) {
      console.error(
        `[Discovery Worker] Cycle error: ${err.message}`
      );

      // Publish heartbeat on error
      try {
        await pool.query(`
          INSERT INTO worker_heartbeats
          (worker_name, worker_type, status, last_run_at, error_count, metadata)
          VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT (worker_name)
          DO UPDATE SET
          status = EXCLUDED.status,
          last_run_at = EXCLUDED.last_run_at,
          error_count = EXCLUDED.error_count,
          metadata = EXCLUDED.metadata,
          created_at = NOW();
        `, [
          'discovery_worker',
          'discovery',
          'ERROR',
          new Date(),
          1,
          JSON.stringify({ error: err.message })
        ]);
      } catch (heartbeatErr) {
        console.error('[Discovery Worker] Heartbeat error publish failed:', heartbeatErr.message);
        // Do NOT rethrow — discovery must remain primary
      }

      // Continue on error, do not crash worker
    }
  }, intervalMs);
}

/**
 * Stop the discovery worker.
 */
function stopDiscoveryWorker() {
  if (discoveryInterval) {
    clearInterval(discoveryInterval);
    discoveryInterval = null;
    console.log('[Discovery Worker] Stopped');
  }
}

module.exports = {
  startDiscoveryWorker,
  stopDiscoveryWorker
};
