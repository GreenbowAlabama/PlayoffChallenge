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
 * - Environment variable: INGESTION_WORKER_INTERVAL_MS (optional)
 *   - If set: uses this interval for all contest statuses
 *   - If not set: uses lifecycle-based adaptive polling (LIVE=5s, LOCKED=30s, SCHEDULED=5m, IDLE=60s)
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

const ingestionService = require('../services/ingestionService');

let ingestionWorkerRunning = false;

/**
 * Polling interval configuration (milliseconds)
 *
 * If INGESTION_WORKER_INTERVAL_MS is set, it overrides all lifecycle-based intervals.
 * Otherwise, intervals are adjusted based on highest contest lifecycle state.
 *
 * Environment variable: INGESTION_WORKER_INTERVAL_MS (optional)
 * Default: lifecycle-based adaptive polling
 */
const OVERRIDE_INTERVAL = process.env.INGESTION_WORKER_INTERVAL_MS
  ? Number(process.env.INGESTION_WORKER_INTERVAL_MS)
  : null;

// Lifecycle-based defaults (used only if INGESTION_WORKER_INTERVAL_MS not set)
const POLL_INTERVAL_SCHEDULED = 300000;  // 5 minutes
const POLL_INTERVAL_LOCKED = 30000;      // 30 seconds
const POLL_INTERVAL_LIVE = 5000;         // 5 seconds
const POLL_INTERVAL_IDLE = 60000;        // 60 seconds (no active contests)

/**
 * Determine the highest lifecycle state of active contest instances.
 *
 * Queries for contests with provider_event_id in SCHEDULED/LOCKED/LIVE status
 * and returns the highest state found to determine polling interval.
 *
 * If INGESTION_WORKER_INTERVAL_MS is set, returns that interval regardless of state.
 * Otherwise uses lifecycle-based adaptive intervals.
 *
 * @param {Object} pool - Database connection pool
 * @returns {Promise<Object>} { status, interval } where status is highest state and interval is sleep ms
 */
async function getHighestContestStatus(pool) {
  // If override is set, use it for all states
  if (OVERRIDE_INTERVAL !== null) {
    try {
      const result = await pool.query(
        `SELECT
           CASE
             WHEN MAX(CASE WHEN ci.status = 'LIVE' THEN 1 ELSE 0 END) = 1 THEN 'LIVE'
             WHEN MAX(CASE WHEN ci.status = 'LOCKED' THEN 1 ELSE 0 END) = 1 THEN 'LOCKED'
             WHEN MAX(CASE WHEN ci.status = 'SCHEDULED' THEN 1 ELSE 0 END) = 1 THEN 'SCHEDULED'
             ELSE NULL
           END as highest_status
         FROM contest_instances ci
         JOIN tournament_configs tc
           ON tc.contest_instance_id = ci.id
         WHERE
           tc.provider_event_id IS NOT NULL
           AND ci.status IN ('SCHEDULED','LOCKED','LIVE')`
      );

      const highestStatus = result.rows[0]?.highest_status || 'IDLE';
      return { status: highestStatus, interval: OVERRIDE_INTERVAL };
    } catch (err) {
      console.error('[Ingestion Worker] Failed to determine contest status:', err.message);
      // Use override interval even on error
      return { status: 'IDLE', interval: OVERRIDE_INTERVAL };
    }
  }

  // Otherwise use lifecycle-based adaptive polling
  try {
    const result = await pool.query(
      `SELECT
         CASE
           WHEN MAX(CASE WHEN ci.status = 'LIVE' THEN 1 ELSE 0 END) = 1 THEN 'LIVE'
           WHEN MAX(CASE WHEN ci.status = 'LOCKED' THEN 1 ELSE 0 END) = 1 THEN 'LOCKED'
           WHEN MAX(CASE WHEN ci.status = 'SCHEDULED' THEN 1 ELSE 0 END) = 1 THEN 'SCHEDULED'
           ELSE NULL
         END as highest_status
       FROM contest_instances ci
       JOIN tournament_configs tc
         ON tc.contest_instance_id = ci.id
       WHERE
         tc.provider_event_id IS NOT NULL
         AND ci.status IN ('SCHEDULED','LOCKED','LIVE')`
    );

    const highestStatus = result.rows[0]?.highest_status;

    switch (highestStatus) {
      case 'LIVE':
        return { status: 'LIVE', interval: POLL_INTERVAL_LIVE };
      case 'LOCKED':
        return { status: 'LOCKED', interval: POLL_INTERVAL_LOCKED };
      case 'SCHEDULED':
        return { status: 'SCHEDULED', interval: POLL_INTERVAL_SCHEDULED };
      default:
        return { status: 'IDLE', interval: POLL_INTERVAL_IDLE };
    }
  } catch (err) {
    console.error('[Ingestion Worker] Failed to determine contest status:', err.message);
    // Default to safe interval on error
    return { status: 'IDLE', interval: POLL_INTERVAL_IDLE };
  }
}

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
  ingestionService.resetCycleCache();
  console.debug('[INGESTION] Cycle cache reset');

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
        const playerPoolSummary = await ingestionService.runPlayerPool(instance.id, pool);

        if (playerPoolSummary && playerPoolSummary.status === 'REJECTED') {
          phasesSkipped++;
        } else {
          phasesRun++;
        }

        // ── Phase B: SCORING (runs only for LOCKED/LIVE)
        if (instance.status === 'LOCKED' || instance.status === 'LIVE') {
          const scoringSummary = await ingestionService.runScoring(instance.id, pool);

          if (scoringSummary && scoringSummary.status === 'REJECTED') {
            phasesSkipped++;
          } else {
            phasesRun++;
          }
        } else {
          // SCHEDULED contest: SCORING phase not run (explicit skip, no API call)
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
 * Run a single ingestion cycle with heartbeat publishing.
 *
 * @param {Object} pool - Database connection pool
 * @returns {Promise<Object>} cycle result for adaptive backoff
 */
async function runCycleWithHeartbeat(pool) {
  try {
    const result = await runCycle(pool);

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
        'ingestion_worker',
        'ingestion',
        'HEALTHY',
        new Date(),
        0,
        JSON.stringify({ phases_run: result.phasesRun, phases_skipped: result.phasesSkipped, contests: result.contests })
      ]);
    } catch (err) {
      console.error('[Ingestion Worker] Heartbeat publish failed:', err.message);
      // Do NOT rethrow — ingestion must remain primary
    }

    return result;
  } catch (err) {
    console.error('[Ingestion Worker] Cycle error with heartbeat:', err.message);

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
        'ingestion_worker',
        'ingestion',
        'ERROR',
        new Date(),
        1,
        JSON.stringify({ error: err.message })
      ]);
    } catch (heartbeatErr) {
      console.error('[Ingestion Worker] Heartbeat error publish failed:', heartbeatErr.message);
      // Do NOT rethrow — ingestion must remain primary
    }

    return { phasesRun: 0, phasesSkipped: 0, failed: 1, contests: 0 };
  }
}

/**
 * Start the ingestion worker with lifecycle-based polling throttling.
 *
 * Configuration:
 * - If INGESTION_WORKER_INTERVAL_MS env var is set, uses that interval for all states
 * - Otherwise, polling intervals adjust based on highest contest lifecycle state:
 *   - LIVE:      5 seconds (frequent updates for active scoring)
 *   - LOCKED:   30 seconds (moderate updates for locked contests)
 *   - SCHEDULED: 5 minutes (infrequent updates for scheduled contests)
 *   - IDLE:     60 seconds (no active contests)
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} options - Legacy configuration options (for backward compatibility with tests)
 * @param {number} options.activeIntervalMs - Interval when work exists (default: 3000 = 3s)
 * @param {number} options.idleIntervalMs - Interval when no work (default: 60000 = 60s)
 */
async function startIngestionWorker(pool, options = {}) {
  // Legacy options for backward compatibility with tests
  const legacyActiveIntervalMs = options.activeIntervalMs;
  const legacyIdleIntervalMs = options.idleIntervalMs;

  if (ingestionWorkerRunning) {
    console.warn(
      'Ingestion worker already running, ignoring start request'
    );
    return;
  }

  ingestionWorkerRunning = true;

  if (OVERRIDE_INTERVAL !== null) {
    console.log(`[Ingestion Worker] Starting with OVERRIDE_INTERVAL=${OVERRIDE_INTERVAL}ms (from INGESTION_WORKER_INTERVAL_MS env var)`);
  } else {
    console.log('[Ingestion Worker] Starting with lifecycle-based adaptive polling (INGESTION_WORKER_INTERVAL_MS not set)');
  }

  while (ingestionWorkerRunning) {
    try {
      const result = await runCycleWithHeartbeat(pool);

      let sleepMs;

      // Use legacy behavior if options provided (for backward compatibility)
      if (legacyActiveIntervalMs !== undefined || legacyIdleIntervalMs !== undefined) {
        const activeIntervalMs = legacyActiveIntervalMs ?? 3000;
        const idleIntervalMs = legacyIdleIntervalMs ?? 60000;
        sleepMs = result.phasesRun > 0 ? activeIntervalMs : idleIntervalMs;
      } else {
        // Lifecycle-based polling: determine interval based on highest contest status
        const contestStatus = await getHighestContestStatus(pool);
        sleepMs = contestStatus.interval;

        if (contestStatus.status !== 'IDLE') {
          console.log(
            `[Ingestion Worker] Active contests status: ${contestStatus.status}, next poll in ${sleepMs}ms`
          );
        }
      }

      await new Promise(resolve => setTimeout(resolve, sleepMs));
    } catch (err) {
      console.error('[Ingestion Worker] Unhandled error:', err.message);
      // Sleep even on error to prevent tight loop
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_IDLE));
    }
  }
}

/**
 * Stop the ingestion worker.
 */
function stopIngestionWorker() {
  if (ingestionWorkerRunning) {
    ingestionWorkerRunning = false;
    console.log('[Ingestion Worker] Stopped');
  }
}

module.exports = {
  startIngestionWorker,
  stopIngestionWorker,
  runCycle,
  runCycleWithHeartbeat
};
