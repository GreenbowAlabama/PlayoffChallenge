/**
 * System Invariant Service Tests
 *
 * Tests verify invariant checks return correct status values
 * and aggregate results properly.
 */

const systemInvariantService = require('../../services/systemInvariantService');

// Mock PostgreSQL pool
const mockPool = {
  query: jest.fn()
};

describe('systemInvariantService', () => {
  beforeEach(() => {
    mockPool.query.mockClear();
  });

  describe('checkFinancialInvariant', () => {
    it('should return BALANCED status when equation holds', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 1000 }] }); // wallet_liability
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 500 }] }); // contest_pools (total)
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 300 }] }); // active contest_pools
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 2000 }] }); // deposits
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 500 }] }); // withdrawals
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // entry breakdown

      const result = await systemInvariantService.checkFinancialInvariant(mockPool);

      expect(result.status).toBe('BALANCED');
      expect(result.values.wallet_liability_cents).toBe(1000);
      expect(result.values.contest_pools_cents).toBe(500);
      expect(result.values.deposits_cents).toBe(2000);
      expect(result.values.withdrawals_cents).toBe(500);
      expect(result.details.active_contest_pools_total_cents).toBe(300);
      // 1000 + 500 = 1500, 2000 - 500 = 1500 (balanced)
      expect(result.values.difference_cents).toBe(0);
    });

    it('should return DRIFT status for minor imbalances', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 1000 }] }); // wallet_liability
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 500 }] }); // contest_pools (total)
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 300 }] }); // active contest_pools
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 2050 }] }); // deposits
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 500 }] }); // withdrawals
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // entry breakdown

      const result = await systemInvariantService.checkFinancialInvariant(mockPool);

      expect(result.status).toBe('DRIFT');
      // 1000 + 500 = 1500, 2050 - 500 = 1550, diff = 50 cents
      expect(result.values.difference_cents).toBe(50);
    });

    it('should return CRITICAL_IMBALANCE for major imbalances', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 1000 }] }); // wallet_liability
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 500 }] }); // contest_pools (total)
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 300 }] }); // active contest_pools
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 2500 }] }); // deposits
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 500 }] }); // withdrawals
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // entry breakdown

      const result = await systemInvariantService.checkFinancialInvariant(mockPool);

      expect(result.status).toBe('CRITICAL_IMBALANCE');
      // 1000 + 500 = 1500, 2500 - 500 = 2000, diff = 500 cents
      expect(result.values.difference_cents).toBe(500);
    });

    it('should handle ERROR status on query failure', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB Connection failed'));

      const result = await systemInvariantService.checkFinancialInvariant(mockPool);

      expect(result.status).toBe('ERROR');
      expect(result.details.anomalies).toEqual([
        expect.objectContaining({ type: 'QUERY_ERROR' })
      ]);
    });

    it('A. Successful withdrawal: wallet_liability=50000, withdrawals=50000, BALANCED', async () => {
      // Case A: User deposits 100000, withdraws 50000 successfully
      // wallet_liability = 100000 (DEPOSIT CREDIT) - 50000 (WITHDRAWAL DEBIT) = 50000
      // withdrawals = 50000
      // Equation: 50000 + 0 = 100000 - 50000 ✓
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 50000 }] }); // wallet_liability
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 0 }] }); // contest_pools (total)
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 0 }] }); // active_contest_pools
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 100000 }] }); // deposits
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 50000 }] }); // withdrawals (NET)
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // entry breakdown

      const result = await systemInvariantService.checkFinancialInvariant(mockPool);

      expect(result.status).toBe('BALANCED');
      expect(result.values.wallet_liability_cents).toBe(50000);
      expect(result.values.withdrawals_cents).toBe(50000);
      expect(result.values.difference_cents).toBe(0);
    });

    it('B. Failed withdrawal with reversal: wallet_liability=100000, withdrawals=0, BALANCED', async () => {
      // Case B: User deposits 100000, requests withdrawal 50000 but it fails with reversal
      // wallet_liability = 100000 (DEPOSIT CREDIT) - 50000 (WITHDRAWAL DEBIT) + 50000 (REVERSAL CREDIT) = 100000
      // withdrawals = 50000 - 50000 = 0 (NET: DEBIT minus REVERSAL)
      // Equation: 100000 + 0 = 100000 - 0 ✓
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 100000 }] }); // wallet_liability (deposit restored by reversal)
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 0 }] }); // contest_pools (total)
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 0 }] }); // active_contest_pools
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 100000 }] }); // deposits
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 0 }] }); // withdrawals (NET: 50000 - 50000 = 0)
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // entry breakdown

      const result = await systemInvariantService.checkFinancialInvariant(mockPool);

      expect(result.status).toBe('BALANCED');
      expect(result.values.wallet_liability_cents).toBe(100000);
      expect(result.values.withdrawals_cents).toBe(0);
      expect(result.values.difference_cents).toBe(0);
    });

    it('C. Mixed withdrawals: successful + failed: wallet_liability=100000, withdrawals=100000, BALANCED', async () => {
      // Case C: User deposits 200000, 2 successful withdrawals (100000 total) + 1 failed with reversal
      // wallet_liability = 200000 (DEPOSITS CREDIT) - 100000 (2 successful WITHDRAWALS DEBIT) - 50000 (1 failed WITHDRAWAL DEBIT) + 50000 (REVERSAL CREDIT) = 100000
      // withdrawals = 100000 (successful) + (50000 - 50000) (failed net) = 100000
      // Equation: 100000 + 0 = 200000 - 100000 ✓
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 100000 }] }); // wallet_liability (remaining balance)
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 0 }] }); // contest_pools (total)
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 0 }] }); // active_contest_pools
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 200000 }] }); // deposits
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 100000 }] }); // withdrawals (NET: 100000 successful + 0 from failed)
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // entry breakdown

      const result = await systemInvariantService.checkFinancialInvariant(mockPool);

      expect(result.status).toBe('BALANCED');
      expect(result.values.wallet_liability_cents).toBe(100000);
      expect(result.values.withdrawals_cents).toBe(100000);
      expect(result.values.difference_cents).toBe(0);
    });

    it('D. Invariant violation detection: wallet_liability=100000, incorrect withdrawals=40000, CRITICAL_IMBALANCE', async () => {
      // Case D: Invariant violation detection
      // wallet_liability=100000, deposits=100000, withdrawals=40000 (incorrect/missing)
      // Equation: 100000 + 0 ≠ 100000 - 40000
      // 100000 ≠ 60000, diff = 40000 cents ($400)
      // Expected: CRITICAL_IMBALANCE status + difference_cents=40000
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 100000 }] }); // wallet_liability
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 0 }] }); // contest_pools
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 0 }] }); // active_contest_pools
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 100000 }] }); // deposits
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 40000 }] }); // withdrawals (incorrect/missing 60000)
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // entry breakdown

      const result = await systemInvariantService.checkFinancialInvariant(mockPool);

      expect(result.status).toBe('CRITICAL_IMBALANCE');
      expect(result.values.difference_cents).toBe(40000);
      expect(result.invariant_equation).toBe('wallet_liability + contest_pools = deposits - net_withdrawals');
      expect(result.details.anomalies).toEqual([
        expect.objectContaining({
          type: 'CRITICAL_IMBALANCE',
          difference_cents: 40000
        })
      ]);
    });
  });

  describe('checkLifecycleInvariant', () => {
    it('should return HEALTHY status when no anomalies', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // locked contests
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // live contests
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // critically stuck (NEW)
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [{ total_count: 0 }] }); // total live
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [{ total_count: 0 }] }); // total locked

      const result = await systemInvariantService.checkLifecycleInvariant(mockPool);

      expect(result.status).toBe('HEALTHY');
      expect(result.details.stuck_locked_count).toBe(0);
      expect(result.details.stuck_live_count).toBe(0);
      expect(result.details.critically_stuck_live_count).toBe(0);
      expect(result.details.total_locked_contests).toBe(0);
      expect(result.details.total_live_contests).toBe(0);
      expect(result.anomalies).toEqual([]);
    });

    it('should detect LOCKED_PAST_START anomalies', async () => {
      const mockContestId = '550e8400-e29b-41d4-a716-446655440000';
      mockPool.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          id: mockContestId,
          contest_name: 'Test Contest',
          status: 'LOCKED',
          tournament_start_time: new Date(Date.now() - 3600000), // 1 hour ago
          minutes_overdue: 60
        }]
      });
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // live contests
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // critically stuck (NEW)
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [{ total_count: 2 }] }); // total live
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [{ total_count: 5 }] }); // total locked

      const result = await systemInvariantService.checkLifecycleInvariant(mockPool);

      expect(result.status).toBe('STUCK_TRANSITIONS');
      expect(result.details.stuck_locked_count).toBe(1);
      expect(result.details.critically_stuck_live_count).toBe(0);
      expect(result.details.total_locked_contests).toBe(5);
      expect(result.details.total_live_contests).toBe(2);
      expect(result.anomalies).toHaveLength(1);
      expect(result.anomalies[0].problem).toBe('LOCKED_PAST_START');
    });

    it('should detect LIVE_PAST_END anomalies', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // locked contests
      mockPool.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          id: '550e8400-e29b-41d4-a716-446655440000',
          contest_name: 'Test Contest',
          status: 'LIVE',
          tournament_end_time: new Date(Date.now() - 1800000), // 30 minutes ago (not critically stuck)
          minutes_overdue: 30
        }]
      });
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // critically stuck (NEW)
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [{ total_count: 3 }] }); // total live
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [{ total_count: 0 }] }); // total locked

      const result = await systemInvariantService.checkLifecycleInvariant(mockPool);

      expect(result.status).toBe('STUCK_TRANSITIONS');
      expect(result.details.stuck_live_count).toBe(1);
      expect(result.details.critically_stuck_live_count).toBe(0);
      expect(result.anomalies[0].problem).toBe('LIVE_PAST_END');
      expect(result.anomalies[0].severity).toBe('warning'); // 30 minutes is not critical
    });

    it('should return ERROR status when > 5 contests stuck', async () => {
      const stuckContests = Array.from({ length: 6 }, (_, i) => ({
        id: `contest-${i}`,
        contest_name: `Contest ${i}`,
        status: 'LOCKED',
        tournament_start_time: new Date(),
        minutes_overdue: 60
      }));

      mockPool.query.mockResolvedValueOnce({ rowCount: 6, rows: stuckContests });
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // live
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // critically stuck (NEW)
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [{ total_count: 1 }] }); // total live
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [{ total_count: 10 }] }); // total locked

      const result = await systemInvariantService.checkLifecycleInvariant(mockPool);

      expect(result.status).toBe('ERROR');
    });

    it('should return ERROR status when any LIVE contest is critically stuck (>60 minutes)', async () => {
      const criticallySturkContest = {
        id: 'critical-contest-123',
        contest_name: 'Critically Stuck Contest',
        status: 'LIVE',
        tournament_end_time: new Date(Date.now() - 7200000), // 2 hours ago
        minutes_overdue: 120
      };

      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // locked contests
      mockPool.query.mockResolvedValueOnce({ rowCount: 1, rows: [criticallySturkContest] }); // live contests
      mockPool.query.mockResolvedValueOnce({ rowCount: 1, rows: [criticallySturkContest] }); // critically stuck (NEW)
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [{ total_count: 1 }] }); // total live
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [{ total_count: 0 }] }); // total locked

      const result = await systemInvariantService.checkLifecycleInvariant(mockPool);

      // CRITICAL: Any contest stuck >60 minutes triggers ERROR immediately
      expect(result.status).toBe('ERROR');
      expect(result.details.critically_stuck_live_count).toBe(1);
      expect(result.anomalies[0].severity).toBe('critical');
      expect(result.anomalies[0].details.is_critically_stuck).toBe(true);
    });
  });

  describe('checkSettlementInvariant', () => {
    it('should return HEALTHY status when all COMPLETE contests settled', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // no anomalies
      mockPool.query.mockResolvedValueOnce({
        rows: [{ total_complete: 5, total_settled: 5 }]
      });

      const result = await systemInvariantService.checkSettlementInvariant(mockPool);

      expect(result.status).toBe('HEALTHY');
      expect(result.details.total_complete_contests).toBe(5);
      expect(result.details.total_settled_contests).toBe(5);
      expect(result.anomalies).toEqual([]);
    });

    it('should return INCOMPLETE status when settlements pending', async () => {
      mockPool.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          id: 'contest-1',
          contest_name: 'Test Contest',
          status: 'COMPLETE',
          settlement_status: 'STARTED',
          started_at: new Date(Date.now() - 4000000), // >30 minutes ago
          pending_minutes: 67
        }]
      });
      mockPool.query.mockResolvedValueOnce({
        rows: [{ total_complete: 5, total_settled: 4 }]
      });

      const result = await systemInvariantService.checkSettlementInvariant(mockPool);

      expect(result.status).toBe('INCOMPLETE');
      expect(result.anomalies).toHaveLength(1);
    });
  });

  describe('checkSettlementPoolInvariant', () => {
    it('PASS: COMPLETE contest with entry_fee fully settled (payout = entry_fee)', async () => {
      mockPool.query.mockResolvedValueOnce({
        rowCount: 0,
        rows: [] // No violations (net_pool = 0 for settled contests)
      });
      mockPool.query.mockResolvedValueOnce({
        rows: [{ total_finalized: 1 }]
      });

      const result = await systemInvariantService.checkSettlementPoolInvariant(mockPool);

      expect(result.status).toBe('HEALTHY');
      expect(result.violations).toEqual([]);
      expect(result.details.finalized_contests_checked).toBe(1);
      expect(result.details.finalized_contests_with_violations).toBe(0);
    });

    it('FAIL: COMPLETE contest with entry_fee but no payout (net_pool > 0)', async () => {
      const contestId = '550e8400-e29b-41d4-a716-446655440000';
      mockPool.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          id: contestId,
          contest_name: 'Unsettled Contest',
          status: 'COMPLETE',
          net_pool: 5000 // $50 not distributed
        }]
      });
      mockPool.query.mockResolvedValueOnce({
        rows: [{ total_finalized: 2 }]
      });

      const result = await systemInvariantService.checkSettlementPoolInvariant(mockPool);

      expect(result.status).toBe('DEGRADED');
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].contest_id).toBe(contestId);
      expect(result.violations[0].net_pool_cents).toBe(5000);
      expect(result.violations[0].severity).toBe('funds_not_distributed');
      expect(result.details.finalized_contests_with_violations).toBe(1);
    });

    it('PASS: COMPLETE contest with zero entries (net_pool = 0)', async () => {
      mockPool.query.mockResolvedValueOnce({
        rowCount: 0,
        rows: [] // No ledger rows = net_pool = 0 (valid)
      });
      mockPool.query.mockResolvedValueOnce({
        rows: [{ total_finalized: 1 }]
      });

      const result = await systemInvariantService.checkSettlementPoolInvariant(mockPool);

      expect(result.status).toBe('HEALTHY');
      expect(result.violations).toEqual([]);
    });

    it('PASS: SCHEDULED contest with active funds (NOT evaluated)', async () => {
      // SCHEDULED contests should NOT appear in results (filtered out by WHERE clause)
      mockPool.query.mockResolvedValueOnce({
        rowCount: 0,
        rows: [] // SCHEDULED contests ignored entirely
      });
      mockPool.query.mockResolvedValueOnce({
        rows: [{ total_finalized: 0 }] // Only COMPLETE/CANCELLED are checked
      });

      const result = await systemInvariantService.checkSettlementPoolInvariant(mockPool);

      expect(result.status).toBe('HEALTHY');
      expect(result.violations).toEqual([]);
      expect(result.details.finalized_contests_checked).toBe(0);
    });

    it('PASS: Mixed dataset (active pools + finalized zero pools)', async () => {
      mockPool.query.mockResolvedValueOnce({
        rowCount: 0,
        rows: [] // All finalized contests have net_pool = 0
      });
      mockPool.query.mockResolvedValueOnce({
        rows: [{ total_finalized: 5 }] // 5 finalized, 0 violations
      });

      const result = await systemInvariantService.checkSettlementPoolInvariant(mockPool);

      expect(result.status).toBe('HEALTHY');
      expect(result.violations).toEqual([]);
      expect(result.details.finalized_contests_checked).toBe(5);
      expect(result.details.finalized_contests_with_violations).toBe(0);
    });

    it('FAIL: CANCELLED contest with unrefunded entry fees', async () => {
      const contestId = '550e8400-e29b-41d4-a716-446655440001';
      mockPool.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          id: contestId,
          contest_name: 'Cancelled Contest',
          status: 'CANCELLED',
          net_pool: 10000 // $100 not refunded
        }]
      });
      mockPool.query.mockResolvedValueOnce({
        rows: [{ total_finalized: 1 }]
      });

      const result = await systemInvariantService.checkSettlementPoolInvariant(mockPool);

      expect(result.status).toBe('DEGRADED');
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].current_status).toBe('CANCELLED');
      expect(result.violations[0].net_pool_cents).toBe(10000);
    });

    it('should handle database errors gracefully', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB Connection failed'));

      const result = await systemInvariantService.checkSettlementPoolInvariant(mockPool);

      expect(result.status).toBe('ERROR');
      expect(result.violations).toEqual([]);
      expect(result.details.finalized_contests_checked).toBe(0);
    });
  });

  describe('checkPipelineInvariant', () => {
    it('should return HEALTHY status when all workers have recent healthy heartbeats', async () => {
      const now = new Date();
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

      mockPool.query.mockResolvedValueOnce({
        rows: [
          { worker_name: 'discovery_worker', worker_type: 'discovery', status: 'HEALTHY', last_run_at: now, error_count: 0 },
          { worker_name: 'ingestion_worker', worker_type: 'ingestion', status: 'HEALTHY', last_run_at: now, error_count: 0 },
          { worker_name: 'lifecycle_reconciler', worker_type: 'lifecycle', status: 'HEALTHY', last_run_at: now, error_count: 0 },
          { worker_name: 'payout_scheduler', worker_type: 'payout', status: 'HEALTHY', last_run_at: now, error_count: 0 },
          { worker_name: 'financial_reconciler', worker_type: 'financial', status: 'HEALTHY', last_run_at: now, error_count: 0 }
        ]
      });

      const result = await systemInvariantService.checkPipelineInvariant(mockPool);

      expect(result.status).toBe('HEALTHY');
      expect(result.pipeline_status.discovery_worker.status).toBe('HEALTHY');
      expect(result.pipeline_status.ingestion_worker.status).toBe('HEALTHY');
      expect(result.pipeline_status.lifecycle_reconciler.status).toBe('HEALTHY');
      expect(result.pipeline_status.payout_scheduler.status).toBe('HEALTHY');
      expect(result.pipeline_status.financial_reconciler.status).toBe('HEALTHY');
    });

    it('should return DEGRADED when one worker is DEGRADED', async () => {
      const now = new Date();

      mockPool.query.mockResolvedValueOnce({
        rows: [
          { worker_name: 'discovery_worker', worker_type: 'discovery', status: 'DEGRADED', last_run_at: now, error_count: 2 },
          { worker_name: 'ingestion_worker', worker_type: 'ingestion', status: 'HEALTHY', last_run_at: now, error_count: 0 },
          { worker_name: 'lifecycle_reconciler', worker_type: 'lifecycle', status: 'HEALTHY', last_run_at: now, error_count: 0 },
          { worker_name: 'payout_scheduler', worker_type: 'payout', status: 'HEALTHY', last_run_at: now, error_count: 0 },
          { worker_name: 'financial_reconciler', worker_type: 'financial', status: 'HEALTHY', last_run_at: now, error_count: 0 }
        ]
      });

      const result = await systemInvariantService.checkPipelineInvariant(mockPool);

      expect(result.status).toBe('DEGRADED');
      expect(result.pipeline_status.discovery_worker.status).toBe('DEGRADED');
    });

    it('should return FAILED when any worker is ERROR', async () => {
      const now = new Date();

      mockPool.query.mockResolvedValueOnce({
        rows: [
          { worker_name: 'discovery_worker', worker_type: 'discovery', status: 'ERROR', last_run_at: now, error_count: 10 },
          { worker_name: 'ingestion_worker', worker_type: 'ingestion', status: 'HEALTHY', last_run_at: now, error_count: 0 },
          { worker_name: 'lifecycle_reconciler', worker_type: 'lifecycle', status: 'HEALTHY', last_run_at: now, error_count: 0 },
          { worker_name: 'payout_scheduler', worker_type: 'payout', status: 'HEALTHY', last_run_at: now, error_count: 0 },
          { worker_name: 'financial_reconciler', worker_type: 'financial', status: 'HEALTHY', last_run_at: now, error_count: 0 }
        ]
      });

      const result = await systemInvariantService.checkPipelineInvariant(mockPool);

      expect(result.status).toBe('FAILED');
      expect(result.pipeline_status.discovery_worker.status).toBe('ERROR');
    });

    it('should return UNKNOWN when worker heartbeat is stale (older than freshness window)', async () => {
      const now = new Date();
      const sixMinutesAgo = new Date(now.getTime() - 6 * 60 * 1000); // Older than 5-minute window for discovery

      mockPool.query.mockResolvedValueOnce({
        rows: [
          { worker_name: 'discovery_worker', worker_type: 'discovery', status: 'HEALTHY', last_run_at: sixMinutesAgo, error_count: 0 },
          { worker_name: 'ingestion_worker', worker_type: 'ingestion', status: 'HEALTHY', last_run_at: now, error_count: 0 },
          { worker_name: 'lifecycle_reconciler', worker_type: 'lifecycle', status: 'HEALTHY', last_run_at: now, error_count: 0 },
          { worker_name: 'payout_scheduler', worker_type: 'payout', status: 'HEALTHY', last_run_at: now, error_count: 0 },
          { worker_name: 'financial_reconciler', worker_type: 'financial', status: 'HEALTHY', last_run_at: now, error_count: 0 }
        ]
      });

      const result = await systemInvariantService.checkPipelineInvariant(mockPool);

      expect(result.status).toBe('DEGRADED');
      expect(result.pipeline_status.discovery_worker.status).toBe('UNKNOWN');
    });

    it('should return UNKNOWN when no worker heartbeats exist', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: []
      });

      const result = await systemInvariantService.checkPipelineInvariant(mockPool);

      expect(result.status).toBe('FAILED');
      expect(result.pipeline_status.discovery_worker.status).toBe('UNKNOWN');
      expect(result.pipeline_status.ingestion_worker.status).toBe('UNKNOWN');
      expect(result.pipeline_status.lifecycle_reconciler.status).toBe('UNKNOWN');
      expect(result.pipeline_status.payout_scheduler.status).toBe('UNKNOWN');
      expect(result.pipeline_status.financial_reconciler.status).toBe('UNKNOWN');
    });

    it('should respect different freshness windows for different workers', async () => {
      const now = new Date();
      const sixMinutesAgo = new Date(now.getTime() - 6 * 60 * 1000); // Stale for 5-min workers
      const elevenMinutesAgo = new Date(now.getTime() - 11 * 60 * 1000); // Stale for 10-min workers

      mockPool.query.mockResolvedValueOnce({
        rows: [
          { worker_name: 'discovery_worker', worker_type: 'discovery', status: 'HEALTHY', last_run_at: sixMinutesAgo, error_count: 0 }, // STALE
          { worker_name: 'ingestion_worker', worker_type: 'ingestion', status: 'HEALTHY', last_run_at: now, error_count: 0 }, // FRESH
          { worker_name: 'lifecycle_reconciler', worker_type: 'lifecycle', status: 'HEALTHY', last_run_at: now, error_count: 0 }, // FRESH
          { worker_name: 'payout_scheduler', worker_type: 'payout', status: 'HEALTHY', last_run_at: elevenMinutesAgo, error_count: 0 }, // STALE for 10-min
          { worker_name: 'financial_reconciler', worker_type: 'financial', status: 'HEALTHY', last_run_at: now, error_count: 0 } // FRESH
        ]
      });

      const result = await systemInvariantService.checkPipelineInvariant(mockPool);

      expect(result.status).toBe('DEGRADED');
      expect(result.pipeline_status.discovery_worker.status).toBe('UNKNOWN');
      expect(result.pipeline_status.payout_scheduler.status).toBe('UNKNOWN');
      expect(result.pipeline_status.ingestion_worker.status).toBe('HEALTHY');
    });

    it('should handle database errors gracefully', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB Connection failed'));

      const result = await systemInvariantService.checkPipelineInvariant(mockPool);

      expect(result.status).toBe('ERROR');
      expect(result.anomalies).toEqual([
        expect.objectContaining({ type: 'QUERY_ERROR' })
      ]);
    });
  });

  describe('checkLedgerInvariant', () => {
    it('should return CONSISTENT when no violations', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ violation_count: 0 }] }); // entry_fee direction
      mockPool.query.mockResolvedValueOnce({ rows: [{ invalid_count: 0 }] }); // direction validity
      mockPool.query.mockResolvedValueOnce({ rows: [{ invalid_count: 0 }] }); // entry_type validity
      mockPool.query.mockResolvedValueOnce({ rows: [{ duplicate_count: 0 }] }); // idempotency
      mockPool.query.mockResolvedValueOnce({ rows: [{ negative_balance_count: 0 }] }); // balance check
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 10000 }] }); // total entries

      const result = await systemInvariantService.checkLedgerInvariant(mockPool);

      expect(result.status).toBe('CONSISTENT');
      expect(result.anomalies).toEqual([]);
      expect(result.details.constraint_violations).toBe(0);
    });

    it('should detect ENTRY_FEE direction violations', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ violation_count: 3 }] }); // entry_fee direction VIOLATED
      mockPool.query.mockResolvedValueOnce({ rows: [{ invalid_count: 0 }] }); // direction validity
      mockPool.query.mockResolvedValueOnce({ rows: [{ invalid_count: 0 }] }); // entry_type validity
      mockPool.query.mockResolvedValueOnce({ rows: [{ duplicate_count: 0 }] }); // idempotency
      mockPool.query.mockResolvedValueOnce({ rows: [{ negative_balance_count: 0 }] }); // balance check
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 10000 }] }); // total entries

      const result = await systemInvariantService.checkLedgerInvariant(mockPool);

      expect(result.status).toBe('VIOLATIONS');
      expect(result.anomalies).toEqual([
        expect.objectContaining({ type: 'ENTRY_FEE_NOT_DEBIT', count: 3 })
      ]);
    });

    it('should detect negative user balances', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ violation_count: 0 }] });
      mockPool.query.mockResolvedValueOnce({ rows: [{ invalid_count: 0 }] });
      mockPool.query.mockResolvedValueOnce({ rows: [{ invalid_count: 0 }] });
      mockPool.query.mockResolvedValueOnce({ rows: [{ duplicate_count: 0 }] });
      mockPool.query.mockResolvedValueOnce({ rows: [{ negative_balance_count: 2 }] }); // VIOLATION
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 10000 }] });

      const result = await systemInvariantService.checkLedgerInvariant(mockPool);

      expect(result.status).toBe('VIOLATIONS');
      expect(result.details.balance_status).toBe('DRIFT');
    });
  });

  describe('runFullInvariantCheck', () => {
    it('should return result with execution_time_ms and timestamp', async () => {
      // Mock just the database queries for a healthy check
      // Financial: 6 queries (added active_contest_pools)
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 1000 }] }); // wallet_liability
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 500 }] }); // contest_pools (total)
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 300 }] }); // active contest_pools
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 2000 }] }); // deposits
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 500 }] }); // withdrawals
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // entry breakdown

      // Lifecycle: 5 queries (locked, live, critically stuck, total live, total locked)
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // locked
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // live
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // critically stuck
      mockPool.query.mockResolvedValueOnce({ rows: [{ total_count: 0 }] }); // total live
      mockPool.query.mockResolvedValueOnce({ rows: [{ total_count: 0 }] }); // total locked

      // Settlement: 2 queries
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // anomalies
      mockPool.query.mockResolvedValueOnce({ rows: [{ total_complete: 0, total_settled: 0 }] }); // counts

      // Settlement Pool: 2 queries
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // no violations
      mockPool.query.mockResolvedValueOnce({ rows: [{ total_finalized: 0 }] }); // total finalized

      // Pipeline: 1 query
      const now = new Date();
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { worker_name: 'discovery_worker', worker_type: 'discovery', status: 'HEALTHY', last_run_at: now, error_count: 0 },
          { worker_name: 'ingestion_worker', worker_type: 'ingestion', status: 'HEALTHY', last_run_at: now, error_count: 0 },
          { worker_name: 'lifecycle_reconciler', worker_type: 'lifecycle', status: 'HEALTHY', last_run_at: now, error_count: 0 },
          { worker_name: 'payout_scheduler', worker_type: 'payout', status: 'HEALTHY', last_run_at: now, error_count: 0 },
          { worker_name: 'financial_reconciler', worker_type: 'financial', status: 'HEALTHY', last_run_at: now, error_count: 0 }
        ]
      });

      // Ledger: 6 queries
      mockPool.query.mockResolvedValueOnce({ rows: [{ violation_count: 0 }] }); // entry_fee direction
      mockPool.query.mockResolvedValueOnce({ rows: [{ invalid_count: 0 }] }); // direction validity
      mockPool.query.mockResolvedValueOnce({ rows: [{ invalid_count: 0 }] }); // entry_type validity
      mockPool.query.mockResolvedValueOnce({ rows: [{ duplicate_count: 0 }] }); // idempotency
      mockPool.query.mockResolvedValueOnce({ rows: [{ negative_balance_count: 0 }] }); // balance
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 10000 }] }); // total entries

      // Insert record
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await systemInvariantService.runFullInvariantCheck(mockPool);

      expect(result).toHaveProperty('overall_status');
      expect(result).toHaveProperty('last_check_timestamp');
      expect(result).toHaveProperty('execution_time_ms');
      expect(result).toHaveProperty('invariants');
      expect(result.execution_time_ms).toBeGreaterThanOrEqual(0);
      expect(typeof result.last_check_timestamp).toBe('string');
      expect(result.invariants).toHaveProperty('financial');
      expect(result.invariants).toHaveProperty('lifecycle');
      expect(result.invariants).toHaveProperty('settlement');
      expect(result.invariants).toHaveProperty('settlement_pool');
      expect(result.invariants).toHaveProperty('pipeline');
      expect(result.invariants).toHaveProperty('ledger');
    });
  });

});
