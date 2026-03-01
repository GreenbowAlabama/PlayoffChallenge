/**
 * Lifecycle Health Service
 *
 * Provides aggregated health metrics for contest lifecycle state.
 * Used for admin observability and operational monitoring.
 *
 * All queries are read-only and deterministic.
 */

/**
 * Get comprehensive lifecycle health metrics.
 *
 * Returns counts of:
 * - SCHEDULED contests past lock_time
 * - LOCKED contests past tournament_start_time
 * - LIVE contests past tournament_end_time
 * - COMPLETE contests without settlement records
 * - Settlement records (if failures exist)
 * - Last reconciler run timestamp and transition count
 *
 * @param {Object} pool - Database connection pool
 * @param {Date} now - Current time (for deterministic time comparisons)
 * @returns {Promise<{
 *   scheduledPastLock: number,
 *   lockedPastStart: number,
 *   livePastEnd: number,
 *   completeWithoutSettlement: number,
 *   settlementFailures: number,
 *   lastReconcilerRun: string | null,
 *   transitionsLastRun: number | null
 * }>}
 */
async function getLifecycleHealth(pool, now) {
  // Query 1: SCHEDULED contests past lock_time
  const scheduledPastLockResult = await pool.query(
    `SELECT COUNT(*) as count
     FROM contest_instances
     WHERE status = 'SCHEDULED'
       AND lock_time IS NOT NULL
       AND $1 >= lock_time`,
    [now]
  );
  const scheduledPastLock = parseInt(scheduledPastLockResult.rows[0].count, 10);

  // Query 2: LOCKED contests past tournament_start_time
  const lockedPastStartResult = await pool.query(
    `SELECT COUNT(*) as count
     FROM contest_instances
     WHERE status = 'LOCKED'
       AND tournament_start_time IS NOT NULL
       AND $1 >= tournament_start_time`,
    [now]
  );
  const lockedPastStart = parseInt(lockedPastStartResult.rows[0].count, 10);

  // Query 3: LIVE contests past tournament_end_time
  const livePastEndResult = await pool.query(
    `SELECT COUNT(*) as count
     FROM contest_instances
     WHERE status = 'LIVE'
       AND tournament_end_time IS NOT NULL
       AND $1 >= tournament_end_time`,
    [now]
  );
  const livePastEnd = parseInt(livePastEndResult.rows[0].count, 10);

  // Query 4: COMPLETE contests without settlement records
  const completeWithoutSettlementResult = await pool.query(
    `SELECT COUNT(*) as count
     FROM contest_instances ci
     WHERE ci.status = 'COMPLETE'
       AND NOT EXISTS (
         SELECT 1 FROM settlement_records sr
         WHERE sr.contest_instance_id = ci.id
       )`
  );
  const completeWithoutSettlement = parseInt(
    completeWithoutSettlementResult.rows[0].count,
    10
  );

  // Query 5: Settlement failures (if status column exists)
  let settlementFailures = 0;
  try {
    const settlementFailuresResult = await pool.query(
      `SELECT COUNT(*) as count
       FROM settlement_records
       WHERE status = 'FAILED'`
    );
    settlementFailures = parseInt(settlementFailuresResult.rows[0].count, 10);
  } catch (err) {
    // settlement_records.status may not exist; gracefully skip
    settlementFailures = null;
  }

  // Query 6: Last reconciler run
  let lastReconcilerRun = null;
  let transitionsLastRun = null;

  const lastRunResult = await pool.query(
    `SELECT run_at, transitions_count
     FROM lifecycle_reconciler_runs
     ORDER BY run_at DESC
     LIMIT 1`
  );

  if (lastRunResult.rows && lastRunResult.rows.length > 0) {
    const row = lastRunResult.rows[0];
    const runAtValue = row.run_at;
    // Handle both Date objects and ISO strings
    lastReconcilerRun = typeof runAtValue === 'string' ? runAtValue : runAtValue.toISOString();
    transitionsLastRun = parseInt(row.transitions_count, 10);
  }

  return {
    scheduledPastLock,
    lockedPastStart,
    livePastEnd,
    completeWithoutSettlement,
    settlementFailures,
    lastReconcilerRun,
    transitionsLastRun
  };
}

/**
 * Insert a lifecycle reconciler run record.
 *
 * Called by the reconciler worker after each run.
 * Idempotent: multiple inserts are fine (one row per run).
 *
 * @param {Object} pool - Database connection pool
 * @param {number} transitionsCount - Number of transitions in this run
 * @returns {Promise<{ id: string, run_at: string }>}
 */
async function insertReconcilerRun(pool, transitionsCount) {
  const result = await pool.query(
    `INSERT INTO lifecycle_reconciler_runs (transitions_count)
     VALUES ($1)
     RETURNING id, run_at`,
    [transitionsCount]
  );

  return {
    id: result.rows[0].id,
    run_at: result.rows[0].run_at.toISOString()
  };
}

module.exports = {
  getLifecycleHealth,
  insertReconcilerRun
};
