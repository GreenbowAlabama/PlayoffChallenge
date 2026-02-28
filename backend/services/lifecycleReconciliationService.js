/**
 * Lifecycle Reconciliation Service
 *
 * Single authoritative entry point for lifecycle transitions.
 * This is the ONLY caller of the frozen lifecycle primitives.
 *
 * Responsibilities:
 * - Orchestrate SCHEDULED → LOCKED and LOCKED → LIVE transitions
 * - Maintain transition ordering (SCHEDULED → LOCKED runs first)
 * - Aggregate results for observability
 * - Accept injected time (no raw database clock)
 *
 * This service is NOT responsible for:
 * - Deciding WHEN to call (that's the worker/poller responsibility)
 * - Creating API endpoints (orchestration only)
 * - Any coupling to ingestion, discovery, or other domains
 */

const {
  transitionScheduledToLocked,
  transitionLockedToLive,
  transitionLiveToComplete
} = require('./contestLifecycleService');

/**
 * Reconcile all eligible lifecycle transitions.
 *
 * Executes three phases in order:
 * - Phase 1: SCHEDULED → LOCKED (based on lock_time)
 * - Phase 2: LOCKED → LIVE (based on tournament_start_time)
 * - Phase 3: LIVE → COMPLETE (based on tournament_end_time, via settlement)
 *
 * All transitions are deterministic and idempotent.
 *
 * @param {Object} pool - Database connection pool
 * @param {Date} now - Injected current time (for determinism)
 * @returns {Promise<{
 *   nowISO: string,
 *   scheduledToLocked: { count: number, changedIds: string[] },
 *   lockedToLive: { count: number, changedIds: string[] },
 *   liveToCompleted: { count: number, changedIds: string[] },
 *   totals: { count: number, changedIds: string[] }
 * }>}
 * @throws {Error} On database errors
 */
async function reconcileLifecycle(pool, now) {
  // Phase 1: SCHEDULED → LOCKED
  const scheduledToLocked = await transitionScheduledToLocked(pool, now);

  // Phase 2: LOCKED → LIVE
  const lockedToLive = await transitionLockedToLive(pool, now);

  // Phase 3: LIVE → COMPLETE (via settlement)
  const liveToCompleted = await transitionLiveToComplete(pool, now);

  // Aggregate results
  const totalCount = scheduledToLocked.count + lockedToLive.count + liveToCompleted.count;
  const totalChangedIds = [
    ...scheduledToLocked.changedIds,
    ...lockedToLive.changedIds,
    ...liveToCompleted.changedIds
  ];

  return {
    nowISO: now.toISOString(),
    scheduledToLocked,
    lockedToLive,
    liveToCompleted,
    totals: {
      count: totalCount,
      changedIds: totalChangedIds
    }
  };
}

module.exports = {
  reconcileLifecycle
};
