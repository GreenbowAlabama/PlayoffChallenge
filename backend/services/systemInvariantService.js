/**
 * System Invariant Monitor Service
 *
 * Verifies platform critical invariants without introducing mutations
 * except for monitoring result tracking via system_invariant_runs.
 *
 * Governance Compliance:
 * - All queries are SELECT-only (read-only)
 * - INSERT to system_invariant_runs for monitoring history only (append-only time-series)
 * - Deterministic queries with no randomization
 * - Financial invariant frozen per CLAUDE_RULES.md § 12
 */

const { Pool } = require('pg');

// Simple logger object (can be replaced with actual logger instance)
const logger = {
  error: (type, data) => {
    console.error(`[${type}]`, JSON.stringify(data));
  }
};

/**
 * Run full invariant check: financial, lifecycle, settlement, pipeline, ledger
 * @param {Pool} pool - PostgreSQL connection pool
 * @param {string} [timestamp] - Optional override timestamp for deterministic testing
 * @returns {Promise<Object>} Aggregated invariant check results
 */
async function runFullInvariantCheck(pool, timestamp = null) {
  const startTime = Date.now();
  const checkTimestamp = timestamp || new Date().toISOString();

  try {
    // Execute all invariant checks in parallel
    const [financial, lifecycle, settlement, settlementPool, pipeline, ledger] = await Promise.all([
      checkFinancialInvariant(pool),
      checkLifecycleInvariant(pool),
      checkSettlementInvariant(pool),
      checkSettlementPoolInvariant(pool),
      checkPipelineInvariant(pool),
      checkLedgerInvariant(pool)
    ]);

    // Normalize status names for database storage
    const financialStatus = financial.status === 'BALANCED' ? 'BALANCED' :
                           financial.status === 'DRIFT' ? 'DRIFT' : 'CRITICAL_IMBALANCE';
    const lifecycleStatus = lifecycle.status === 'HEALTHY' ? 'HEALTHY' :
                           lifecycle.status === 'STUCK_TRANSITIONS' ? 'STUCK_TRANSITIONS' : 'ERROR';
    const settlementStatus = settlement.status === 'HEALTHY' ? 'HEALTHY' :
                            settlement.status === 'INCOMPLETE' ? 'INCOMPLETE' : 'ERROR';
    const settlementPoolStatus = settlementPool.status === 'HEALTHY' ? 'HEALTHY' :
                                settlementPool.status === 'DEGRADED' ? 'DEGRADED' : 'ERROR';
    const pipelineStatus = pipeline.status === 'HEALTHY' ? 'HEALTHY' :
                          pipeline.status === 'DEGRADED' ? 'DEGRADED' : 'FAILED';
    const ledgerStatus = ledger.status === 'CONSISTENT' ? 'CONSISTENT' :
                        ledger.status === 'VIOLATIONS' ? 'VIOLATIONS' : 'ERROR';

    // Calculate overall status: HEALTHY only if all subsystems are in good state
    const allHealthy =
      (financial.status === 'BALANCED') &&
      (lifecycle.status === 'HEALTHY') &&
      (settlement.status === 'HEALTHY') &&
      (settlementPool.status === 'HEALTHY') &&
      (pipeline.status === 'HEALTHY') &&
      (ledger.status === 'CONSISTENT');

    const overallStatus = allHealthy ? 'HEALTHY' : 'WARNING';

    const executionTime = Date.now() - startTime;

    const result = {
      overall_status: overallStatus,
      last_check_timestamp: checkTimestamp,
      execution_time_ms: executionTime,
      invariants: {
        financial,
        lifecycle,
        settlement,
        settlement_pool: settlementPool,
        pipeline,
        ledger
      }
    };

    // Insert into system_invariant_runs (non-blocking, fire-and-forget)
    // Append-only monitoring log (new row per execution)
    insertInvariantRun(pool, {
      overall_status: overallStatus,
      financial_status: financialStatus,
      lifecycle_status: lifecycleStatus,
      settlement_status: settlementStatus,
      settlement_pool_status: settlementPoolStatus,
      pipeline_status: pipelineStatus,
      ledger_status: ledgerStatus,
      execution_time_ms: executionTime,
      created_at: checkTimestamp,
      wallet_liability_cents: financial.values?.wallet_liability_cents,
      contest_pools_cents: financial.values?.contest_pools_cents,
      active_contest_pools_cents: financial.details?.active_contest_pools_total_cents,
      deposits_cents: financial.values?.deposits_cents,
      withdrawals_cents: financial.values?.withdrawals_cents,
      invariant_diff_cents: financial.values?.difference_cents,
      stuck_locked_count: lifecycle.details?.stuck_locked_count,
      stuck_live_count: lifecycle.details?.stuck_live_count,
      stuck_settlement_count: settlement.details?.settlement_lag_minutes,
      settlement_pool_violations: settlementPool.details?.finalized_contests_with_violations,
      pipeline_errors: pipeline.anomalies ? JSON.stringify(pipeline.anomalies) : null,
      ledger_anomalies: ledger.anomalies ? JSON.stringify(ledger.anomalies) : null
    }).catch(err => {
      console.error('[systemInvariantService] Background insert failed (non-fatal):', err);
    });

    return result;
  } catch (error) {
    console.error('[systemInvariantService] Full check failed:', error);
    throw error;
  }
}

/**
 * Check financial invariant: wallet_liability + contest_pools = deposits - withdrawals
 * FROZEN per CLAUDE_RULES.md § 12
 */
async function checkFinancialInvariant(pool) {
  try {
    // Fetch wallet_liability
    const walletLiabilityResult = await pool.query(`
      SELECT COALESCE(SUM(
        CASE
          WHEN direction = 'CREDIT' THEN amount_cents
          WHEN direction = 'DEBIT' THEN -amount_cents
        END
      ), 0) as total
      FROM ledger
      WHERE user_id IS NOT NULL
      AND entry_type IN (
        'WALLET_DEPOSIT',
        'WALLET_WITHDRAWAL',
        'ENTRY_FEE',
        'ENTRY_FEE_REFUND',
        'PRIZE_PAYOUT'
      );
    `);
    const walletLiability = parseInt(walletLiabilityResult.rows[0].total, 10);

    // Fetch TOTAL contest_pools (all statuses, informational only)
    const contestPoolsResult = await pool.query(`
      SELECT COALESCE(SUM(
        CASE
          WHEN entry_type = 'ENTRY_FEE' THEN amount_cents
          WHEN entry_type = 'ENTRY_FEE_REFUND' THEN -amount_cents
        END
      ), 0) as total
      FROM ledger
      WHERE entry_type IN ('ENTRY_FEE', 'ENTRY_FEE_REFUND');
    `);
    const contestPools = parseInt(contestPoolsResult.rows[0].total, 10);

    // Fetch ACTIVE contest pools (SCHEDULED, LOCKED, LIVE) for informational reporting
    const activeContestPoolsResult = await pool.query(`
      SELECT COALESCE(SUM(
        CASE
          WHEN l.entry_type = 'ENTRY_FEE' THEN l.amount_cents
          WHEN l.entry_type = 'ENTRY_FEE_REFUND' THEN -l.amount_cents
        END
      ), 0) as total
      FROM ledger l
      INNER JOIN contest_instances ci ON l.reference_id = ci.id
      WHERE l.entry_type IN ('ENTRY_FEE', 'ENTRY_FEE_REFUND')
        AND ci.status IN ('SCHEDULED', 'LOCKED', 'LIVE');
    `);
    const activeContestPools = parseInt(activeContestPoolsResult.rows[0].total, 10);

    // Fetch deposits
    const depositsResult = await pool.query(`
      SELECT COALESCE(SUM(amount_cents), 0) as total
      FROM ledger
      WHERE entry_type = 'WALLET_DEPOSIT';
    `);
    const deposits = parseInt(depositsResult.rows[0].total, 10);

    // Fetch withdrawals
    const withdrawalsResult = await pool.query(`
      SELECT COALESCE(SUM(amount_cents), 0) as total
      FROM ledger
      WHERE entry_type = 'WALLET_WITHDRAWAL';
    `);
    const withdrawals = parseInt(withdrawalsResult.rows[0].total, 10);

    // Calculate invariant
    const leftSide = walletLiability + contestPools;
    const rightSide = deposits - withdrawals;
    const difference = Math.abs(leftSide - rightSide);
    const epsilon = 0.01; // cents

    let status = 'BALANCED';
    if (difference > epsilon && difference < 100) {
      status = 'DRIFT';
    } else if (difference >= 100) {
      status = 'CRITICAL_IMBALANCE';
    }

    // Entry type breakdown
    const breakdownResult = await pool.query(`
      SELECT entry_type, direction,
             COUNT(*) as count,
             SUM(amount_cents) as total_cents
      FROM ledger
      WHERE user_id IS NOT NULL
      GROUP BY entry_type, direction
      ORDER BY entry_type;
    `);

    const entryCountByType = {};
    breakdownResult.rows.forEach(row => {
      const key = `${row.entry_type}_${row.direction}`;
      entryCountByType[key] = {
        count: row.count,
        total_cents: parseInt(row.total_cents, 10)
      };
    });

    return {
      status,
      timestamp: new Date().toISOString(),
      invariant_equation: 'wallet_liability + contest_pools = deposits - withdrawals',
      values: {
        wallet_liability_cents: walletLiability,
        contest_pools_cents: contestPools,
        deposits_cents: deposits,
        withdrawals_cents: withdrawals,
        left_side_cents: leftSide,
        right_side_cents: rightSide,
        difference_cents: difference
      },
      details: {
        entry_count_by_type: entryCountByType,
        active_contest_pools_total_cents: activeContestPools,
        anomalies: status !== 'BALANCED' ? [
          {
            type: status,
            difference_cents: difference,
            message: `Invariant drift detected: ${difference} cents imbalance`
          }
        ] : []
      }
    };
  } catch (error) {
    console.error('[systemInvariantService] Financial check failed:', error);
    return {
      status: 'ERROR',
      timestamp: new Date().toISOString(),
      invariant_equation: 'wallet_liability + contest_pools = deposits - withdrawals',
      values: null,
      details: {
        entry_count_by_type: {},
        anomalies: [{ type: 'QUERY_ERROR', message: error.message }]
      }
    };
  }
}

/**
 * Check lifecycle invariant: detect stuck state transitions
 */
async function checkLifecycleInvariant(pool) {
  try {
    // Rule 1: LOCKED contests that should transition to LIVE
    const lockedResult = await pool.query(`
      SELECT
        ci.id,
        ci.contest_name,
        ci.status,
        ci.tournament_start_time,
        EXTRACT(EPOCH FROM (NOW() - ci.tournament_start_time)) / 60 as minutes_overdue
      FROM contest_instances ci
      WHERE ci.status = 'LOCKED'
        AND ci.tournament_start_time < NOW()
        AND NOT EXISTS (
          SELECT 1 FROM contest_state_transitions cst
          WHERE cst.contest_instance_id = ci.id
            AND cst.from_state = 'LOCKED'
            AND cst.to_state = 'LIVE'
            AND cst.created_at >= ci.tournament_start_time
        );
    `);

    // Rule 2: LIVE contests that should transition to COMPLETE
    const liveResult = await pool.query(`
      SELECT
        ci.id,
        ci.contest_name,
        ci.status,
        ci.tournament_end_time,
        EXTRACT(EPOCH FROM (NOW() - ci.tournament_end_time)) / 60 as minutes_overdue
      FROM contest_instances ci
      WHERE ci.status = 'LIVE'
        AND ci.tournament_end_time < NOW()
        AND NOT EXISTS (
          SELECT 1 FROM contest_state_transitions cst
          WHERE cst.contest_instance_id = ci.id
            AND cst.from_state = 'LIVE'
            AND cst.to_state = 'COMPLETE'
            AND cst.created_at >= ci.tournament_end_time
        );
    `);

    // Rule 3: CRITICAL GUARD - LIVE contests stuck for >60 minutes (regression detector)
    // Prevents silent lifecycle stalls that could go unnoticed
    const criticallyStuckResult = await pool.query(`
      SELECT
        ci.id,
        ci.contest_name,
        ci.status,
        ci.tournament_end_time,
        EXTRACT(EPOCH FROM (NOW() - ci.tournament_end_time)) / 60 as minutes_overdue
      FROM contest_instances ci
      WHERE ci.status = 'LIVE'
        AND ci.tournament_end_time < NOW() - INTERVAL '60 minutes'
        AND NOT EXISTS (
          SELECT 1 FROM contest_state_transitions cst
          WHERE cst.contest_instance_id = ci.id
            AND cst.from_state = 'LIVE'
            AND cst.to_state = 'COMPLETE'
            AND cst.created_at >= ci.tournament_end_time
        );
    `);

    // Count TOTAL LIVE contests (not just stuck ones)
    const totalLiveResult = await pool.query(`
      SELECT COUNT(*) as total_count
      FROM contest_instances
      WHERE status = 'LIVE';
    `);

    // Count TOTAL LOCKED contests (not just stuck ones)
    const totalLockedResult = await pool.query(`
      SELECT COUNT(*) as total_count
      FROM contest_instances
      WHERE status = 'LOCKED';
    `);

    const allAnomalies = [];
    const stuckLockedCount = lockedResult.rowCount;
    const stuckLiveCount = liveResult.rowCount;
    const criticallyStuckCount = criticallyStuckResult.rowCount;
    const totalLockedContests = parseInt(totalLockedResult.rows[0].total_count, 10);
    const totalLiveContests = parseInt(totalLiveResult.rows[0].total_count, 10);

    // Add LOCKED anomalies
    lockedResult.rows.forEach(row => {
      allAnomalies.push({
        contest_id: row.id,
        contest_name: row.contest_name,
        current_status: row.status,
        expected_status: 'LIVE',
        problem: 'LOCKED_PAST_START',
        time_overdue_minutes: Math.floor(row.minutes_overdue),
        severity: 'warning',
        details: {
          tournament_start_time: row.tournament_start_time
        }
      });
    });

    // Add LIVE anomalies (with severity based on how overdue)
    liveResult.rows.forEach(row => {
      const isCritical = row.minutes_overdue > 60;
      allAnomalies.push({
        contest_id: row.id,
        contest_name: row.contest_name,
        current_status: row.status,
        expected_status: 'COMPLETE',
        problem: 'LIVE_PAST_END',
        time_overdue_minutes: Math.floor(row.minutes_overdue),
        severity: isCritical ? 'critical' : 'warning',
        details: {
          tournament_end_time: row.tournament_end_time,
          is_critically_stuck: isCritical
        }
      });
    });

    // Determine status
    let status = 'HEALTHY';
    if (criticallyStuckCount > 0) {
      // CRITICAL: Any contest stuck for >60 minutes is an ERROR
      status = 'ERROR';
    } else if (stuckLockedCount + stuckLiveCount > 5) {
      status = 'ERROR';
    } else if (stuckLockedCount + stuckLiveCount > 0) {
      status = 'STUCK_TRANSITIONS';
    }

    return {
      status,
      timestamp: new Date().toISOString(),
      anomalies: allAnomalies,
      details: {
        total_locked_contests: totalLockedContests,
        total_live_contests: totalLiveContests,
        stuck_locked_count: stuckLockedCount,
        stuck_live_count: stuckLiveCount,
        critically_stuck_live_count: criticallyStuckCount
      }
    };
  } catch (error) {
    console.error('[systemInvariantService] Lifecycle check failed:', error);
    return {
      status: 'ERROR',
      timestamp: new Date().toISOString(),
      anomalies: [{ type: 'QUERY_ERROR', message: error.message }],
      details: {
        total_locked_contests: 0,
        total_live_contests: 0,
        stuck_locked_count: 0,
        stuck_live_count: 0,
        critically_stuck_live_count: 0
      }
    };
  }
}

/**
 * Check settlement invariant: verify COMPLETE contests are settled
 */
async function checkSettlementInvariant(pool) {
  try {
    const result = await pool.query(`
      SELECT
        ci.id,
        ci.contest_name,
        ci.status,
        sa.id as settlement_run_id,
        sa.status as settlement_status,
        sa.started_at,
        EXTRACT(EPOCH FROM (NOW() - sa.started_at)) / 60 as pending_minutes
      FROM contest_instances ci
      LEFT JOIN settlement_audit sa
        ON sa.contest_instance_id = ci.id
      WHERE ci.status = 'COMPLETE'
        AND (
          sa.id IS NULL
          OR (sa.status = 'STARTED' AND NOW() - sa.started_at > INTERVAL '30 minutes')
        );
    `);

    const anomalies = result.rows.map(row => ({
      contest_id: row.id,
      contest_name: row.contest_name,
      current_status: row.status,
      settlement_run_id: row.settlement_run_id,
      settlement_status: row.settlement_status || 'NO_SETTLEMENT',
      started_at: row.started_at,
      time_pending_minutes: row.pending_minutes ? Math.floor(row.pending_minutes) : null
    }));

    // Get total counts
    const totalResult = await pool.query(`
      SELECT
        COUNT(*) as total_complete,
        (SELECT COUNT(*) FROM settlement_records WHERE settlement_records.id IS NOT NULL) as total_settled
      FROM contest_instances
      WHERE status = 'COMPLETE';
    `);

    const totalComplete = parseInt(totalResult.rows[0].total_complete, 10);
    const totalSettled = parseInt(totalResult.rows[0].total_settled, 10);

    let status = 'HEALTHY';
    if (anomalies.length > 0) {
      status = 'INCOMPLETE';
    }

    return {
      status,
      timestamp: new Date().toISOString(),
      anomalies,
      details: {
        total_complete_contests: totalComplete,
        total_settled_contests: totalSettled,
        settlement_lag_minutes: anomalies.length > 0 ?
          Math.max(...anomalies.map(a => a.time_pending_minutes || 0)) : 0
      }
    };
  } catch (error) {
    console.error('[systemInvariantService] Settlement check failed:', error);
    return {
      status: 'ERROR',
      timestamp: new Date().toISOString(),
      anomalies: [{ type: 'QUERY_ERROR', message: error.message }],
      details: {
        total_complete_contests: 0,
        total_settled_contests: 0,
        settlement_lag_minutes: 0
      }
    };
  }
}

/**
 * Check settlement pool invariant: ONLY finalized contests (COMPLETE, CANCELLED) must have net_pool = 0
 * ACTIVE contests (SCHEDULED, LOCKED, LIVE) are allowed to hold funds.
 *
 * This prevents false positives where SCHEDULED contests correctly hold entry fees.
 */
async function checkSettlementPoolInvariant(pool) {
  try {
    // Query ONLY finalized contests (COMPLETE, CANCELLED)
    // Compute net_pool = ENTRY_FEE - ENTRY_FEE_REFUND - PRIZE_PAYOUT + PRIZE_PAYOUT_REVERSAL
    const resultQuery = `
      SELECT
        ci.id,
        ci.contest_name,
        ci.status,
        COALESCE(SUM(CASE
          WHEN l.entry_type = 'ENTRY_FEE' THEN l.amount_cents
          WHEN l.entry_type = 'ENTRY_FEE_REFUND' THEN -l.amount_cents
          WHEN l.entry_type = 'PRIZE_PAYOUT' THEN -l.amount_cents
          WHEN l.entry_type = 'PRIZE_PAYOUT_REVERSAL' THEN l.amount_cents
        END), 0) AS net_pool
      FROM contest_instances ci
      LEFT JOIN ledger l
        ON l.reference_id = ci.id
      WHERE ci.status IN ('COMPLETE', 'CANCELLED')
      GROUP BY ci.id, ci.contest_name, ci.status
      HAVING COALESCE(SUM(CASE
        WHEN l.entry_type = 'ENTRY_FEE' THEN l.amount_cents
        WHEN l.entry_type = 'ENTRY_FEE_REFUND' THEN -l.amount_cents
        WHEN l.entry_type = 'PRIZE_PAYOUT' THEN -l.amount_cents
        WHEN l.entry_type = 'PRIZE_PAYOUT_REVERSAL' THEN l.amount_cents
      END), 0) != 0;
    `;

    const result = await pool.query(resultQuery);

    // Each row is a violation: finalized contest with net_pool != 0
    const violations = result.rows.map(row => {
      logger.error('INVARIANT_VIOLATION', {
        contestId: row.id,
        status: row.status,
        netPool: row.net_pool
      });

      return {
        contest_id: row.id,
        contest_name: row.contest_name,
        current_status: row.status,
        net_pool_cents: row.net_pool,
        severity: row.net_pool > 0 ? 'funds_not_distributed' : 'over_payout'
      };
    });

    // Get total finalized contests checked
    const totalResult = await pool.query(`
      SELECT COUNT(*) as total_finalized
      FROM contest_instances
      WHERE status IN ('COMPLETE', 'CANCELLED');
    `);

    const totalFinalized = parseInt(totalResult.rows[0].total_finalized, 10);

    let status = 'HEALTHY';
    if (violations.length > 0) {
      status = 'DEGRADED';
    }

    return {
      status,
      timestamp: new Date().toISOString(),
      violations,
      details: {
        finalized_contests_checked: totalFinalized,
        finalized_contests_with_violations: violations.length,
        violation_summary: violations.length > 0 ?
          `${violations.length} finalized contest(s) with non-zero pool balance` : 'All finalized contests settled correctly'
      }
    };
  } catch (error) {
    console.error('[systemInvariantService] Settlement pool check failed:', error);
    return {
      status: 'ERROR',
      timestamp: new Date().toISOString(),
      violations: [],
      details: {
        finalized_contests_checked: 0,
        finalized_contests_with_violations: 0,
        violation_summary: `Query error: ${error.message}`
      }
    };
  }
}

/**
 * Check pipeline health using worker heartbeats
 *
 * Reads explicit worker telemetry from worker_heartbeats table.
 * No indirect inference. Workers must publish heartbeats.
 *
 * Freshness windows (minutes):
 * - discovery_worker: 5
 * - ingestion_worker: 5
 * - lifecycle_reconciler: 5
 * - payout_scheduler: 10
 * - financial_reconciler: 10
 */
async function checkPipelineInvariant(pool) {
  // Define freshness windows for each worker (minutes)
  const FRESHNESS_WINDOWS = {
    discovery_worker: 5,
    ingestion_worker: 5,
    lifecycle_reconciler: 5,
    payout_scheduler: 10,
    financial_reconciler: 10
  };

  // Expected worker names
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
        metadata
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
    const pipeline_status = {};
    let hasError = false;
    let hasDegraded = false;
    let hasUnknown = false;

    EXPECTED_WORKERS.forEach(workerName => {
      const heartbeat = heartbeatsByWorker[workerName];
      const freshnessMins = FRESHNESS_WINDOWS[workerName];

      // Determine worker status
      let workerStatus = 'UNKNOWN'; // Default: no heartbeat
      let lastRun = null;
      let errorCount = 0;
      let details = 'No heartbeat detected';

      if (heartbeat) {
        lastRun = heartbeat.last_run_at ? heartbeat.last_run_at.toISOString() : null;
        errorCount = heartbeat.error_count || 0;

        // Check if heartbeat is stale
        const minutesSinceLastRun = (now - heartbeat.last_run_at) / (60 * 1000);
        const isStale = minutesSinceLastRun > freshnessMins;

        if (isStale) {
          workerStatus = 'UNKNOWN';
          details = `Heartbeat stale (${Math.floor(minutesSinceLastRun)} minutes old, freshness window: ${freshnessMins} min)`;
          hasUnknown = true;
        } else if (heartbeat.status === 'ERROR') {
          workerStatus = 'ERROR';
          details = `Worker reported ERROR status (${errorCount} errors)`;
          hasError = true;
        } else if (heartbeat.status === 'DEGRADED') {
          workerStatus = 'DEGRADED';
          details = `Worker reported DEGRADED status (${errorCount} errors)`;
          hasDegraded = true;
        } else if (heartbeat.status === 'HEALTHY') {
          workerStatus = 'HEALTHY';
          details = `Worker operational (${errorCount} errors in recent runs)`;
        }
      } else {
        hasUnknown = true;
      }

      pipeline_status[workerName] = {
        status: workerStatus,
        last_run: lastRun,
        error_count: errorCount,
        freshness_window_minutes: freshnessMins,
        details
      };
    });

    // Determine overall status based on core workers only
    // Core workers: discovery_worker, lifecycle_reconciler, ingestion_worker
    const CORE_WORKERS = ['discovery_worker', 'lifecycle_reconciler', 'ingestion_worker'];

    const coreWorkerStatuses = CORE_WORKERS.map(w => pipeline_status[w].status);
    const coreHasError = coreWorkerStatuses.some(s => s === 'ERROR');
    const allCoreUnknown = coreWorkerStatuses.every(s => s === 'UNKNOWN');
    const allCoreHealthy = coreWorkerStatuses.every(s => s === 'HEALTHY');

    let overallStatus = 'HEALTHY';
    if (coreHasError) {
      overallStatus = 'FAILED';
    } else if (allCoreUnknown) {
      overallStatus = 'FAILED';
    } else if (!allCoreHealthy) {
      overallStatus = 'DEGRADED';
    }

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      pipeline_status,
      anomalies: []
    };
  } catch (error) {
    console.error('[systemInvariantService] Pipeline check failed:', error);
    return {
      status: 'ERROR',
      timestamp: new Date().toISOString(),
      pipeline_status: {
        discovery_worker: {
          status: 'UNKNOWN',
          last_run: null,
          error_count: 0,
          freshness_window_minutes: FRESHNESS_WINDOWS.discovery_worker,
          details: error.message
        },
        ingestion_worker: {
          status: 'UNKNOWN',
          last_run: null,
          error_count: 0,
          freshness_window_minutes: FRESHNESS_WINDOWS.ingestion_worker,
          details: error.message
        },
        lifecycle_reconciler: {
          status: 'UNKNOWN',
          last_run: null,
          error_count: 0,
          freshness_window_minutes: FRESHNESS_WINDOWS.lifecycle_reconciler,
          details: error.message
        },
        payout_scheduler: {
          status: 'UNKNOWN',
          last_run: null,
          error_count: 0,
          freshness_window_minutes: FRESHNESS_WINDOWS.payout_scheduler,
          details: error.message
        },
        financial_reconciler: {
          status: 'UNKNOWN',
          last_run: null,
          error_count: 0,
          freshness_window_minutes: FRESHNESS_WINDOWS.financial_reconciler,
          details: error.message
        }
      },
      anomalies: [{ type: 'QUERY_ERROR', message: error.message }]
    };
  }
}

/**
 * Check ledger integrity: constraint violations and balance consistency
 */
async function checkLedgerInvariant(pool) {
  try {
    // Check 1: Entry Fee Direction Violation
    const entryFeeDirectionResult = await pool.query(`
      SELECT COUNT(*) as violation_count
      FROM ledger
      WHERE entry_type = 'ENTRY_FEE'
        AND direction != 'DEBIT';
    `);
    const entryFeeViolations = parseInt(entryFeeDirectionResult.rows[0].violation_count, 10);

    // Check 2: Direction Validity
    const directionValidityResult = await pool.query(`
      SELECT COUNT(*) as invalid_count
      FROM ledger
      WHERE direction NOT IN ('CREDIT', 'DEBIT');
    `);
    const invalidDirections = parseInt(directionValidityResult.rows[0].invalid_count, 10);

    // Check 3: Entry Type Validity
    const entryTypeValidityResult = await pool.query(`
      SELECT COUNT(*) as invalid_count
      FROM ledger
      WHERE entry_type NOT IN (
        'ENTRY_FEE', 'ENTRY_FEE_REFUND', 'PRIZE_PAYOUT',
        'PRIZE_PAYOUT_REVERSAL', 'ADJUSTMENT',
        'WALLET_DEPOSIT', 'WALLET_DEBIT',
        'WALLET_WITHDRAWAL', 'WALLET_WITHDRAWAL_REVERSAL'
      );
    `);
    const invalidEntryTypes = parseInt(entryTypeValidityResult.rows[0].invalid_count, 10);

    // Check 4: Idempotency Key Uniqueness
    const idempotencyResult = await pool.query(`
      SELECT COUNT(*) as duplicate_count
      FROM (
        SELECT idempotency_key, COUNT(*) as cnt
        FROM ledger
        WHERE idempotency_key IS NOT NULL
        GROUP BY idempotency_key
        HAVING COUNT(*) > 1
      ) t;
    `);
    const duplicateIdempotencyKeys = parseInt(idempotencyResult.rows[0].duplicate_count, 10);

    // Check 5: Per-User Balance Check
    const balanceResult = await pool.query(`
      WITH user_balances AS (
        SELECT
          user_id,
          SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents ELSE 0 END) as credits,
          SUM(CASE WHEN direction = 'DEBIT' THEN amount_cents ELSE 0 END) as debits
        FROM ledger
        WHERE user_id IS NOT NULL
        GROUP BY user_id
      )
      SELECT COUNT(*) as negative_balance_count
      FROM user_balances
      WHERE credits < debits;
    `);
    const negativeBalances = parseInt(balanceResult.rows[0].negative_balance_count, 10);

    // Aggregate anomalies
    const anomalies = [];
    if (entryFeeViolations > 0) {
      anomalies.push({
        type: 'ENTRY_FEE_NOT_DEBIT',
        count: entryFeeViolations,
        sample_ids: [],
        details: 'ENTRY_FEE entries must have direction=DEBIT'
      });
    }
    if (invalidDirections > 0) {
      anomalies.push({
        type: 'DIRECTION_VIOLATION',
        count: invalidDirections,
        sample_ids: [],
        details: 'Invalid direction values (must be CREDIT or DEBIT)'
      });
    }
    if (invalidEntryTypes > 0) {
      anomalies.push({
        type: 'ENTRY_TYPE_VIOLATION',
        count: invalidEntryTypes,
        sample_ids: [],
        details: 'Invalid entry_type values'
      });
    }
    if (duplicateIdempotencyKeys > 0) {
      anomalies.push({
        type: 'IDEMPOTENCY_VIOLATION',
        count: duplicateIdempotencyKeys,
        sample_ids: [],
        details: 'Duplicate idempotency keys found'
      });
    }
    if (negativeBalances > 0) {
      anomalies.push({
        type: 'BALANCE_CHECK',
        count: negativeBalances,
        sample_ids: [],
        details: 'Users with negative balances (more debits than credits)'
      });
    }

    // Get total entry count
    const totalCountResult = await pool.query(`
      SELECT COUNT(*) as total FROM ledger;
    `);
    const totalEntries = parseInt(totalCountResult.rows[0].total, 10);

    const constraintViolations = entryFeeViolations + invalidDirections + invalidEntryTypes +
                                 duplicateIdempotencyKeys + negativeBalances;

    let status = 'CONSISTENT';
    if (constraintViolations > 0) {
      status = 'VIOLATIONS';
    }

    return {
      status,
      timestamp: new Date().toISOString(),
      anomalies,
      details: {
        total_entries: totalEntries,
        constraint_violations: constraintViolations,
        balance_status: negativeBalances > 0 ? 'DRIFT' : 'VERIFIED'
      }
    };
  } catch (error) {
    console.error('[systemInvariantService] Ledger check failed:', error);
    return {
      status: 'ERROR',
      timestamp: new Date().toISOString(),
      anomalies: [{ type: 'QUERY_ERROR', message: error.message }],
      details: {
        total_entries: 0,
        constraint_violations: 0,
        balance_status: 'ERROR'
      }
    };
  }
}

/**
 * Insert invariant run result into system_invariant_runs (append-only monitoring log)
 */
async function insertInvariantRun(pool, data) {
  try {
    await pool.query(`
      INSERT INTO system_invariant_runs (
        overall_status, financial_status, lifecycle_status, settlement_status,
        pipeline_status, ledger_status, execution_time_ms, created_at,
        wallet_liability_cents, contest_pools_cents, deposits_cents,
        withdrawals_cents, invariant_diff_cents,
        stuck_locked_count, stuck_live_count, stuck_settlement_count,
        pipeline_errors, ledger_anomalies
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
      )
    `, [
      data.overall_status, data.financial_status, data.lifecycle_status,
      data.settlement_status, data.pipeline_status, data.ledger_status,
      data.execution_time_ms, data.created_at,
      data.wallet_liability_cents, data.contest_pools_cents, data.deposits_cents,
      data.withdrawals_cents, data.invariant_diff_cents,
      data.stuck_locked_count, data.stuck_live_count, data.stuck_settlement_count,
      data.pipeline_errors, data.ledger_anomalies
    ]);
  } catch (error) {
    // Log but don't fail the check - monitoring must not break the system
    console.warn('[systemInvariantService] Failed to insert run record:', error);
  }
}

module.exports = {
  runFullInvariantCheck,
  checkFinancialInvariant,
  checkLifecycleInvariant,
  checkSettlementInvariant,
  checkSettlementPoolInvariant,
  checkPipelineInvariant,
  checkLedgerInvariant
};
