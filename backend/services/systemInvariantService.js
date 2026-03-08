/**
 * System Invariant Monitor Service
 *
 * Verifies platform critical invariants without introducing mutations
 * except for monitoring result tracking via system_invariant_runs.
 *
 * Governance Compliance:
 * - All queries are SELECT-only (read-only)
 * - INSERT to system_invariant_runs for monitoring history only
 * - Deterministic queries with no randomization
 * - Idempotent result storage via ON CONFLICT
 * - Financial invariant frozen per CLAUDE_RULES.md § 12
 */

const { Pool } = require('pg');

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
    const [financial, lifecycle, settlement, pipeline, ledger] = await Promise.all([
      checkFinancialInvariant(pool),
      checkLifecycleInvariant(pool),
      checkSettlementInvariant(pool),
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
    const pipelineStatus = pipeline.status === 'HEALTHY' ? 'HEALTHY' :
                          pipeline.status === 'DEGRADED' ? 'DEGRADED' : 'FAILED';
    const ledgerStatus = ledger.status === 'CONSISTENT' ? 'CONSISTENT' :
                        ledger.status === 'VIOLATIONS' ? 'VIOLATIONS' : 'ERROR';

    // Calculate overall status based on normalized statuses
    let overallStatus = 'HEALTHY';

    // CRITICAL if any check has error conditions
    if (financialStatus === 'CRITICAL_IMBALANCE' || lifecycleStatus === 'ERROR' ||
        settlementStatus === 'ERROR' || pipelineStatus === 'FAILED' || ledgerStatus === 'ERROR') {
      overallStatus = 'CRITICAL';
    }
    // WARNING if any check has non-critical issues
    else if (financialStatus === 'DRIFT' || lifecycleStatus === 'STUCK_TRANSITIONS' ||
             settlementStatus === 'INCOMPLETE' || pipelineStatus === 'DEGRADED' ||
             ledgerStatus === 'VIOLATIONS') {
      overallStatus = 'WARNING';
    }

    const executionTime = Date.now() - startTime;

    const result = {
      overall_status: overallStatus,
      last_check_timestamp: checkTimestamp,
      execution_time_ms: executionTime,
      invariants: {
        financial,
        lifecycle,
        settlement,
        pipeline,
        ledger
      }
    };

    // Insert into system_invariant_runs (non-blocking, fire-and-forget)
    // Idempotent via ON CONFLICT on timestamp
    insertInvariantRun(pool, {
      overall_status: overallStatus,
      financial_status: financialStatus,
      lifecycle_status: lifecycleStatus,
      settlement_status: settlementStatus,
      pipeline_status: pipelineStatus,
      ledger_status: ledgerStatus,
      execution_time_ms: executionTime,
      created_at: checkTimestamp,
      wallet_liability_cents: financial.values?.wallet_liability_cents,
      contest_pools_cents: financial.values?.contest_pools_cents,
      deposits_cents: financial.values?.deposits_cents,
      withdrawals_cents: financial.values?.withdrawals_cents,
      invariant_diff_cents: financial.values?.difference_cents,
      stuck_locked_count: lifecycle.details?.stuck_locked_count,
      stuck_live_count: lifecycle.details?.stuck_live_count,
      stuck_settlement_count: settlement.details?.settlement_lag_minutes,
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

    // Fetch contest_pools
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

    const allAnomalies = [];
    const stuckLockedCount = lockedResult.rowCount;
    const stuckLiveCount = liveResult.rowCount;

    // Add LOCKED anomalies
    lockedResult.rows.forEach(row => {
      allAnomalies.push({
        contest_id: row.id,
        contest_name: row.contest_name,
        current_status: row.status,
        expected_status: 'LIVE',
        problem: 'LOCKED_PAST_START',
        time_overdue_minutes: Math.floor(row.minutes_overdue),
        details: {
          tournament_start_time: row.tournament_start_time
        }
      });
    });

    // Add LIVE anomalies
    liveResult.rows.forEach(row => {
      allAnomalies.push({
        contest_id: row.id,
        contest_name: row.contest_name,
        current_status: row.status,
        expected_status: 'COMPLETE',
        problem: 'LIVE_PAST_END',
        time_overdue_minutes: Math.floor(row.minutes_overdue),
        details: {
          tournament_end_time: row.tournament_end_time
        }
      });
    });

    // Determine status
    let status = 'HEALTHY';
    if (stuckLockedCount + stuckLiveCount > 5) {
      status = 'ERROR';
    } else if (stuckLockedCount + stuckLiveCount > 0) {
      status = 'STUCK_TRANSITIONS';
    }

    return {
      status,
      timestamp: new Date().toISOString(),
      anomalies: allAnomalies,
      details: {
        total_locked_contests: stuckLockedCount,
        total_live_contests: stuckLiveCount,
        stuck_locked_count: stuckLockedCount,
        stuck_live_count: stuckLiveCount
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
        stuck_live_count: 0
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
 * Check pipeline health: discovery worker, lifecycle reconciler, ingestion
 */
async function checkPipelineInvariant(pool) {
  try {
    // Discovery worker health
    const discoveryResult = await pool.query(`
      SELECT
        MAX(created_at) as last_run,
        SUM(CASE WHEN status IN ('ERROR', 'FAILED') THEN 1 ELSE 0 END) as error_count
      FROM discovery_worker_runs
      WHERE created_at > NOW() - INTERVAL '1 hour';
    `);

    // Lifecycle reconciler health
    const lifecycleResult = await pool.query(`
      SELECT
        MAX(run_at) as last_run,
        COALESCE(SUM(error_count), 0) as total_errors
      FROM lifecycle_reconciler_runs
      WHERE run_at > NOW() - INTERVAL '1 hour';
    `);

    // Ingestion pipeline health
    const ingestionResult = await pool.query(`
      SELECT
        COUNT(*) as stuck_units,
        MAX(EXTRACT(EPOCH FROM (NOW() - created_at))) / 60 as minutes_oldest
      FROM work_units
      WHERE status = 'PROCESSING'
        AND created_at < NOW() - INTERVAL '15 minutes';
    `);

    const discoveryLastRun = discoveryResult.rows[0]?.last_run;
    const discoveryErrors = parseInt(discoveryResult.rows[0]?.error_count || 0, 10);
    const discoveryStatus = !discoveryLastRun ? 'UNKNOWN' :
                           discoveryErrors > 0 ? 'DEGRADED' : 'HEALTHY';

    const lifecycleLastRun = lifecycleResult.rows[0]?.last_run;
    const lifecycleErrors = parseInt(lifecycleResult.rows[0]?.total_errors || 0, 10);
    const lifecycleStatus = !lifecycleLastRun ? 'UNKNOWN' :
                           lifecycleErrors > 0 ? 'DEGRADED' : 'HEALTHY';

    const stuckUnits = parseInt(ingestionResult.rows[0]?.stuck_units || 0, 10);
    const ingestionStatus = stuckUnits > 0 ? 'DEGRADED' : 'HEALTHY';

    const statusCounts = {
      HEALTHY: [discoveryStatus, lifecycleStatus, ingestionStatus].filter(s => s === 'HEALTHY').length,
      DEGRADED: [discoveryStatus, lifecycleStatus, ingestionStatus].filter(s => s === 'DEGRADED').length,
      UNKNOWN: [discoveryStatus, lifecycleStatus, ingestionStatus].filter(s => s === 'UNKNOWN').length
    };

    let overallStatus = 'HEALTHY';
    if (statusCounts.DEGRADED >= 2 || statusCounts.UNKNOWN >= 2) {
      overallStatus = 'FAILED';
    } else if (statusCounts.DEGRADED > 0 || statusCounts.UNKNOWN > 0) {
      overallStatus = 'DEGRADED';
    }

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      pipeline_status: {
        discovery_worker: {
          status: discoveryStatus,
          last_run: discoveryLastRun ? discoveryLastRun.toISOString() : null,
          error_count_1h: discoveryErrors,
          details: discoveryStatus === 'HEALTHY' ? 'Discovery worker operational' :
                   discoveryStatus === 'DEGRADED' ? `${discoveryErrors} errors in last hour` :
                   'No recent runs detected'
        },
        lifecycle_reconciler: {
          status: lifecycleStatus,
          last_run: lifecycleLastRun ? lifecycleLastRun.toISOString() : null,
          error_count_1h: lifecycleErrors,
          details: lifecycleStatus === 'HEALTHY' ? 'Lifecycle reconciler operational' :
                   lifecycleStatus === 'DEGRADED' ? `${lifecycleErrors} errors in last hour` :
                   'No recent runs detected'
        },
        ingestion_worker: {
          status: ingestionStatus,
          last_run: null, // Inferred from work_units
          error_count_1h: stuckUnits,
          details: ingestionStatus === 'HEALTHY' ? 'No stuck work units' :
                   `${stuckUnits} work units stuck > 15 minutes`
        }
      },
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
          error_count_1h: 0,
          details: error.message
        },
        lifecycle_reconciler: {
          status: 'UNKNOWN',
          last_run: null,
          error_count_1h: 0,
          details: error.message
        },
        ingestion_worker: {
          status: 'UNKNOWN',
          last_run: null,
          error_count_1h: 0,
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
 * Insert invariant run result into system_invariant_runs (idempotent via ON CONFLICT)
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
      ON CONFLICT (created_at) DO NOTHING
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
  checkPipelineInvariant,
  checkLedgerInvariant
};
