/**
 * Ingestion Worker — 2-Phase Model
 *
 * Background poller that periodically discovers active contest instances
 * and triggers 2-phase ingestion:
 *
 * Phase A (PLAYER_POOL): Player field and baseline tournament metadata
 * - Runs for: SCHEDULED, LOCKED, LIVE
 * - Required for: lineup selection, golfer availability
 *
 * Phase B (SCORING): Leaderboard, live stats, scoring data
 * - Runs for: LOCKED, LIVE only
 * - Required for: contest progression, settlement
 *
 * Configuration:
 * - Interval: 1 minute (60000ms, configurable via INGESTION_WORKER_INTERVAL_MS)
 * - Started only in non-test environments (guarded by server.js NODE_ENV check)
 *
 * Behavior:
 * - On each tick, queries for contests with provider_event_id in status SCHEDULED/LOCKED/LIVE
 * - For SCHEDULED: runs PLAYER_POOL only
 * - For LOCKED/LIVE: runs PLAYER_POOL then SCORING
 * - Logs per-phase results with reason codes for skips
 * - No error throwing (logs and continues)
 * - Non-blocking: worker continues even if individual ingestions fail
 *
 * Startup:
 * - Called from server initialization when NODE_ENV !== 'test'
 * - Always starts unless already running
 */

const { runPlayerPool, runScoring } = require('../services/ingestionService');

let ingestionInterval = null;

/**
 * Run a single ingestion cycle.
 *
 * Queries for contests with provider_event_id in SCHEDULED/LOCKED/LIVE status,
 * then runs appropriate phases:
 * - SCHEDULED: PLAYER_POOL only
 * - LOCKED/LIVE: both PLAYER_POOL and SCORING
 *
 * @param {Object} pool - Database connection pool
 * @returns {Promise<Object>} cycle summary { phasesRun, phasesSkipped, failed, contests }
 */
async function runCycle(pool) {
  try {
    // Query for contest instances with tournament configurations in ingestible status
    // Player pool ingestion: SCHEDULED, LOCKED, LIVE (users need players for lineup selection)
    // Scoring ingestion: LOCKED, LIVE only (scoring data not available in SCHEDULED)
    const result = await pool.query(
      `SELECT
         ci.id,
         ci.status
       FROM contest_instances ci
       JOIN tournament_configs tc
         ON tc.contest_instance_id = ci.id
       WHERE
         tc.provider_event_id IS NOT NULL
         AND ci.status IN ('SCHEDULED','LOCKED','LIVE')
       ORDER BY ci.created_at DESC`
    );

    const contestInstances = result.rows;
    let phasesRun = 0;
    let phasesSkipped = 0;
    let failed = 0;

    for (const instance of contestInstances) {
      try {
        // ── Phase A: PLAYER_POOL (always runs for SCHEDULED+)
        const playerPoolSummary = await runPlayerPool(instance.id, pool);

        if (playerPoolSummary && playerPoolSummary.status === 'REJECTED') {
          console.log(
            `[Ingestion] ${instance.id} PLAYER_POOL skipped: ${playerPoolSummary.reason}`
          );
          phasesSkipped++;
        } else {
          console.log(
            `[Ingestion] ${instance.id} PLAYER_POOL complete: processed=${playerPoolSummary.processed}, skipped=${playerPoolSummary.skipped}, errors=${playerPoolSummary.errors?.length || 0}`
          );
          phasesRun++;
        }

        // ── Phase B: SCORING (runs only for LOCKED/LIVE)
        if (instance.status === 'LOCKED' || instance.status === 'LIVE') {
          const scoringSummary = await runScoring(instance.id, pool);

          if (scoringSummary && scoringSummary.status === 'REJECTED') {
            console.log(
              `[Ingestion] ${instance.id} SCORING skipped: ${scoringSummary.reason}`
            );
            phasesSkipped++;
          } else {
            console.log(
              `[Ingestion] ${instance.id} SCORING complete: processed=${scoringSummary.processed}, skipped=${scoringSummary.skipped}, errors=${scoringSummary.errors?.length || 0}`
            );
            phasesRun++;
          }
        } else {
          // SCHEDULED contest: SCORING phase not run (explicit skip, no API call)
          console.log(
            `[Ingestion] ${instance.id} SCORING skipped: SCHEDULED_STATUS_NO_SCORING`
          );
          phasesSkipped++;
        }
      } catch (err) {
        failed++;
        console.error(`[Ingestion Worker] Failed to ingest ${instance.id}`);
        console.error(err);
      }
    }

    if (contestInstances.length > 0) {
      console.log(
        `[Ingestion] Cycle complete: contests=${contestInstances.length}, phases_run=${phasesRun}, phases_skipped=${phasesSkipped}, failed=${failed}`
      );
    }

    return { phasesRun, phasesSkipped, failed, contests: contestInstances.length };
  } catch (err) {
    console.error(`[Ingestion Worker] Cycle error`);
    console.error(err);
    // Continue on error, do not crash worker
    return { phasesRun: 0, phasesSkipped: 0, failed: 1, contests: 0 };
  }
}

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

  ingestionInterval = setInterval(() => {
    runCycle(pool);
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
  stopIngestionWorker,
  runCycle
};
