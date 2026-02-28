/**
 * Lifecycle Reconciler Worker
 *
 * Background poller that periodically reconciles lifecycle transitions.
 * Runs on a fixed 30-second interval when enabled.
 *
 * Configuration:
 * - ENABLE_LIFECYCLE_RECONCILER=true (required to start)
 * - Interval: 30 seconds (configurable via LIFECYCLE_RECONCILER_INTERVAL_MS)
 *
 * Behavior:
 * - On each tick, calls reconcileLifecycle(pool, now)
 * - Logs transition counts (minimal observability)
 * - No error throwing (logs and continues)
 *
 * Startup:
 * - Called from server initialization
 * - Optional: if disabled, no background reconciliation runs
 *
 * Design:
 * - Single entry point: reconcileLifecycle()
 * - No coupling to ingestion, discovery, or domain logic
 * - Pure orchestration (knows when to call, not what to do)
 */

const { reconcileLifecycle } = require('../services/lifecycleReconciliationService');

let reconcilerInterval = null;

/**
 * Start the lifecycle reconciler worker.
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} options - Configuration options
 * @param {boolean} options.enabled - Whether to start the worker (default: check env var)
 * @param {number} options.intervalMs - Interval in milliseconds (default: 30000)
 */
function startLifecycleReconciler(pool, options = {}) {
  const enabled = options.enabled ?? process.env.ENABLE_LIFECYCLE_RECONCILER === 'true';
  const intervalMs = options.intervalMs ?? (process.env.LIFECYCLE_RECONCILER_INTERVAL_MS ? parseInt(process.env.LIFECYCLE_RECONCILER_INTERVAL_MS, 10) : 30000);

  if (!enabled) {
    return;
  }

  if (reconcilerInterval) {
    console.warn('Lifecycle reconciler already running, ignoring start request');
    return;
  }

  console.log(`Starting lifecycle reconciler (interval: ${intervalMs}ms)`);

  reconcilerInterval = setInterval(async () => {
    try {
      const now = new Date();
      const result = await reconcileLifecycle(pool, now);

      if (result.totals.count > 0) {
        console.log(
          `Lifecycle reconciliation: SCHEDULED→LOCKED=${result.scheduledToLocked.count}, LOCKED→LIVE=${result.lockedToLive.count}, LIVE→COMPLETE=${result.liveToCompleted.count}, total=${result.totals.count}`
        );
      }
    } catch (err) {
      console.error('Lifecycle reconciliation error:', err.message);
    }
  }, intervalMs);
}

/**
 * Stop the lifecycle reconciler worker.
 */
function stopLifecycleReconciler() {
  if (reconcilerInterval) {
    clearInterval(reconcilerInterval);
    reconcilerInterval = null;
    console.log('Lifecycle reconciler stopped');
  }
}

module.exports = {
  startLifecycleReconciler,
  stopLifecycleReconciler
};
