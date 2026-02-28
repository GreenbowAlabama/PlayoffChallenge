/**
 * Lifecycle Orchestration — Phase 2A
 *
 * Manages reconciliation loops for contest state transitions.
 * Currently enabled: LOCKED → LIVE only (Phase 2A).
 * Other transitions are PENDING Phase 2B+ implementation.
 *
 * Each loop runs independently on its own schedule and is safe under
 * concurrent execution due to atomic database operations in the underlying
 * primitives (UPDATE...WHERE with status guard, idempotent logic).
 *
 * Multi-Instance Safety:
 * All instances in a horizontally-scaled deployment will run orchestration.
 * This is acceptable because primitives use atomic UPDATE and idempotent logic.
 * If single-instance enforcement becomes necessary, add DB-based leader election.
 *
 * Validation: See STAGING_VALIDATION.md for 24-48 hour observation checklist.
 */

const logger = require('../utils/logger');
const { transitionLockedToLive } = require('./contestLifecycleService');

// Configurable intervals (ms)
const LOCKED_TO_LIVE_INTERVAL_MS = 10000;      // 10 seconds (tight, tournaments active)
const SCHEDULED_TO_LOCKED_INTERVAL_MS = 30000; // 30 seconds (PENDING Phase 2B)
const LIVE_TO_COMPLETE_INTERVAL_MS = 30000;    // 30 seconds (PENDING Phase 2C, touches settlement)

class LifecycleOrchestrator {
  constructor(pool) {
    this.pool = pool;
    this.timers = {};
    this.started = false;
  }

  // =========================================================================
  // PHASE 2A: LOCKED → LIVE (Tournament Start Time) — ENABLED
  // =========================================================================

  async lockedToLiveLoop() {
    const startTime = Date.now();
    const now = new Date();

    try {
      const result = await transitionLockedToLive(this.pool, now);
      const duration = Date.now() - startTime;

      if (result.count > 0) {
        // Signal: Log only when transitions occur
        logger.info('LOCKED→LIVE reconciliation: transitioned', {
          count: result.count,
          ids_sample: result.changedIds.slice(0, 5),
          duration_ms: duration,
          tick_timestamp: now.toISOString()
        });
      } else {
        // Noise filter: Debug level for no-ops
        logger.debug?.('LOCKED→LIVE reconciliation: no-op', {
          duration_ms: duration,
          tick_timestamp: now.toISOString()
        });
      }
    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error('LOCKED→LIVE reconciliation failed', {
        error: err.message,
        duration_ms: duration,
        tick_timestamp: now.toISOString()
      });
    }
  }

  startLockedToLiveLoop() {
    const run = async () => {
      try {
        await this.lockedToLiveLoop();
      } catch (err) {
        logger.error('LOCKED→LIVE loop fatal error', err);
      } finally {
        // Recursive setTimeout: guarantees sequential execution, no overlap
        this.timers.lockedToLive = setTimeout(run, LOCKED_TO_LIVE_INTERVAL_MS);
      }
    };

    // Delay first execution by interval (allows system to warm up, prevents boot spike)
    this.timers.lockedToLive = setTimeout(run, LOCKED_TO_LIVE_INTERVAL_MS);
  }

  // =========================================================================
  // PHASE 2B: SCHEDULED → LOCKED (Lock Time) — PENDING
  // =========================================================================

  async scheduledToLockedLoop() {
    const now = new Date();
    // PENDING: Implement after lock_time validation and strategy completion
    // const result = await forceLockEligibleContests(this.pool, now);
  }

  startScheduledToLockedLoop() {
    // DISABLED: Phase 2B not yet approved
    // const run = async () => { ... };
  }

  // =========================================================================
  // PHASE 2C: LIVE → COMPLETE (Settlement) — PENDING
  // =========================================================================

  async liveToCompleteLoop() {
    const now = new Date();
    // PENDING: Implement last (touches settlement, payouts, ledger)
    // const result = await settleEligibleContests(this.pool, now);
  }

  startLiveToCompleteLoop() {
    // DISABLED: Phase 2C not yet approved
    // const run = async () => { ... };
  }

  // =========================================================================
  // Lifecycle Control
  // =========================================================================

  start() {
    // Guard: prevent double start
    if (this.started) {
      logger.warn('Lifecycle orchestration already started, ignoring duplicate start');
      return;
    }

    this.started = true;
    logger.info('Lifecycle orchestration starting', {
      phase: '2A',
      enabled: 'LOCKED→LIVE only',
      interval_ms: LOCKED_TO_LIVE_INTERVAL_MS
    });

    // Phase 2A: LOCKED → LIVE enabled
    this.startLockedToLiveLoop();

    // Phase 2B: SCHEDULED → LOCKED disabled (pending)
    // this.startScheduledToLockedLoop();

    // Phase 2C: LIVE → COMPLETE disabled (pending)
    // this.startLiveToCompleteLoop();
  }

  stop() {
    // Guard: prevent stop if never started
    if (!this.started) {
      logger.warn('Lifecycle orchestration not started, ignoring stop');
      return;
    }

    this.started = false;
    logger.info('Lifecycle orchestration stopping');

    // Clear timers safely (guard against undefined values)
    Object.values(this.timers).forEach(t => t && clearTimeout(t));
    this.timers = {};
  }
}

module.exports = LifecycleOrchestrator;
