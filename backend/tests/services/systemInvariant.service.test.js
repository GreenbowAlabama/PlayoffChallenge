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
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 500 }] }); // contest_pools
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 2000 }] }); // deposits
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 500 }] }); // withdrawals
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // entry breakdown

      const result = await systemInvariantService.checkFinancialInvariant(mockPool);

      expect(result.status).toBe('BALANCED');
      expect(result.values.wallet_liability_cents).toBe(1000);
      expect(result.values.contest_pools_cents).toBe(500);
      expect(result.values.deposits_cents).toBe(2000);
      expect(result.values.withdrawals_cents).toBe(500);
      // 1000 + 500 = 1500, 2000 - 500 = 1500 (balanced)
      expect(result.values.difference_cents).toBe(0);
    });

    it('should return DRIFT status for minor imbalances', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 1000 }] }); // wallet_liability
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 500 }] }); // contest_pools
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
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 500 }] }); // contest_pools
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
  });

  describe('checkLifecycleInvariant', () => {
    it('should return HEALTHY status when no anomalies', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // locked contests
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // live contests

      const result = await systemInvariantService.checkLifecycleInvariant(mockPool);

      expect(result.status).toBe('HEALTHY');
      expect(result.details.stuck_locked_count).toBe(0);
      expect(result.details.stuck_live_count).toBe(0);
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

      const result = await systemInvariantService.checkLifecycleInvariant(mockPool);

      expect(result.status).toBe('STUCK_TRANSITIONS');
      expect(result.details.stuck_locked_count).toBe(1);
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
          tournament_end_time: new Date(Date.now() - 3600000), // 1 hour ago
          minutes_overdue: 60
        }]
      });

      const result = await systemInvariantService.checkLifecycleInvariant(mockPool);

      expect(result.status).toBe('STUCK_TRANSITIONS');
      expect(result.details.stuck_live_count).toBe(1);
      expect(result.anomalies[0].problem).toBe('LIVE_PAST_END');
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
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      const result = await systemInvariantService.checkLifecycleInvariant(mockPool);

      expect(result.status).toBe('ERROR');
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
      // Financial: 5 queries
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 1000 }] }); // wallet_liability
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 500 }] }); // contest_pools
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 2000 }] }); // deposits
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 500 }] }); // withdrawals
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // entry breakdown

      // Lifecycle: 2 queries
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // locked
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // live

      // Settlement: 2 queries
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // anomalies
      mockPool.query.mockResolvedValueOnce({ rows: [{ total_complete: 0, total_settled: 0 }] }); // counts

      // Pipeline: 3 queries
      const now = new Date();
      mockPool.query.mockResolvedValueOnce({ rows: [{ last_run: now, error_count: 0 }] }); // discovery
      mockPool.query.mockResolvedValueOnce({ rows: [{ last_run: now, total_errors: 0 }] }); // lifecycle
      mockPool.query.mockResolvedValueOnce({ rows: [{ stuck_units: 0, minutes_oldest: null }] }); // ingestion

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
      expect(result.invariants).toHaveProperty('pipeline');
      expect(result.invariants).toHaveProperty('ledger');
    });
  });
});
