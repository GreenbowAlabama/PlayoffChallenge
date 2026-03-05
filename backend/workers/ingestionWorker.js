/**
 * Ingestion Worker
 *
 * Background poller that periodically discovers active contest instances
 * and triggers ingestion to populate player pools with live data.
 *
 * Configuration:
 * - Interval: 1 minute (60000ms, configurable via INGESTION_WORKER_INTERVAL_MS)
 * - Started only in non-test environments (guarded by server.js NODE_ENV check)
 *
 * Behavior:
 * - On each tick, queries for ingestible contest instances (status IN LOCKED, LIVE)
 * - For each instance, calls ingestionService.run()
 * - Logs cycle summary (contests processed, errors)
 * - No error throwing (logs and continues)
 * - Non-blocking: worker continues even if individual ingestions fail
 *
 * Startup:
 * - Called from server initialization when NODE_ENV !== 'test'
 * - Always starts unless already running
 */

const ingestionService = require('../services/ingestionService');

let ingestionInterval = null;

/**
 * Start the ingestion worker.
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} options - Configuration options
 * @param {number} options.intervalMs - Interval in milliseconds (default: 60000 = 1 min)
 */
function startIngestionWorker(pool, options = {}) {
  const intervalMs =
    options.intervalMs ??
    (process.env.INGESTION_WORKER_INTERVAL_MS
      ? parseInt(process.env.INGESTION_WORKER_INTERVAL_MS, 10)
      : 60000); // 1 minute default

  if (ingestionInterval) {
    console.warn(
      'Ingestion worker already running, ignoring start request'
    );
    return;
  }

  console.log(
    `[Ingestion Worker] Starting (interval: ${intervalMs}ms)`
  );

  ingestionInterval = setInterval(async () => {
    try {
      // Query for ingestible contest instances with tournament configurations
      // Only ingest contests in LOCKED or LIVE status
      // Ingestion is driven by tournament provider events with matching contest status
      const result = await pool.query(
        `SELECT
           ci.id
         FROM contest_instances ci
         JOIN tournament_configs tc
           ON tc.contest_instance_id = ci.id
         WHERE
           tc.provider_event_id IS NOT NULL
           AND ci.status IN ('LOCKED','LIVE')
         ORDER BY ci.created_at DESC`
      );

      const contestInstances = result.rows;
      let processed = 0;
      let failed = 0;

      for (const instance of contestInstances) {
        try {
          const summary = await ingestionService.run(instance.id, pool);

          if (summary && summary.status === 'REJECTED') {
            // Rejection may occur for contests already completed or locked from further ingestion
            console.log(
              `[Ingestion] Skipped ${instance.id}: ${summary.reason}`
            );
          } else {
            processed++;
            console.log(
              `[Ingestion] Processed ${instance.id}: processed=${summary.processed}, skipped=${summary.skipped}, errors=${summary.errors?.length || 0}`
            );
          }
        } catch (err) {
          failed++;
          console.error(`[Ingestion Worker] Failed to ingest ${instance.id}`);
          console.error(err);
        }
      }

      if (contestInstances.length > 0) {
        console.log(
          `[Ingestion] Cycle complete: total=${contestInstances.length}, processed=${processed}, failed=${failed}`
        );
      }
    } catch (err) {
      console.error(`[Ingestion Worker] Cycle error`);
      console.error(err);
      // Continue on error, do not crash worker
    }
  }, intervalMs);
}

/**
 * Stop the ingestion worker.
 */
function stopIngestionWorker() {
  if (ingestionInterval) {
    clearInterval(ingestionInterval);
    ingestionInterval = null;
    console.log('[Ingestion Worker] Stopped');
  }
}

module.exports = {
  startIngestionWorker,
  stopIngestionWorker
};
