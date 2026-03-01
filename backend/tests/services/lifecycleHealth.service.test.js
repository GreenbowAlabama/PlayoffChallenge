/**
 * Lifecycle Health Service Tests
 *
 * Tests for aggregated health metrics queries.
 * All tests are read-only and deterministic.
 */

const { getLifecycleHealth, insertReconcilerRun } = require('../../services/lifecycleHealthService');

describe('Lifecycle Health Service', () => {
  let pool;

  beforeEach(() => {
    pool = {
      query: jest.fn()
    };
  });

  describe('getLifecycleHealth', () => {
    it('returns zero counts when all contests are healthy', async () => {
      const now = new Date('2026-03-01T12:00:00Z');

      // Mock all query responses
      pool.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // scheduled past lock
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // locked past start
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // live past end
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // complete without settlement
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // settlement failures
        .mockResolvedValueOnce({ rows: [] }); // no reconciler runs

      const health = await getLifecycleHealth(pool, now);

      expect(health).toEqual({
        scheduledPastLock: 0,
        lockedPastStart: 0,
        livePastEnd: 0,
        completeWithoutSettlement: 0,
        settlementFailures: 0,
        lastReconcilerRun: null,
        transitionsLastRun: null
      });
    });

    it('detects SCHEDULED contests past lock_time', async () => {
      const now = new Date('2026-03-01T12:00:00Z');

      pool.query
        .mockResolvedValueOnce({ rows: [{ count: '5' }] }) // scheduled past lock
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // locked past start
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // live past end
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // complete without settlement
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // settlement failures
        .mockResolvedValueOnce({ rows: [] }); // no reconciler runs

      const health = await getLifecycleHealth(pool, now);

      expect(health.scheduledPastLock).toBe(5);
      expect(health.lockedPastStart).toBe(0);
    });

    it('detects LOCKED contests past tournament_start_time', async () => {
      const now = new Date('2026-03-01T12:00:00Z');

      pool.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '3' }] }) // locked past start
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      const health = await getLifecycleHealth(pool, now);

      expect(health.lockedPastStart).toBe(3);
    });

    it('detects LIVE contests past tournament_end_time', async () => {
      const now = new Date('2026-03-01T12:00:00Z');

      pool.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '2' }] }) // live past end
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      const health = await getLifecycleHealth(pool, now);

      expect(health.livePastEnd).toBe(2);
    });

    it('detects COMPLETE contests without settlement records', async () => {
      const now = new Date('2026-03-01T12:00:00Z');

      pool.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '1' }] }) // complete without settlement
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      const health = await getLifecycleHealth(pool, now);

      expect(health.completeWithoutSettlement).toBe(1);
    });

    it('handles missing settlement_records.status gracefully', async () => {
      const now = new Date('2026-03-01T12:00:00Z');

      pool.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockRejectedValueOnce(new Error('column "status" does not exist')) // settlement failures fails
        .mockResolvedValueOnce({ rows: [] });

      const health = await getLifecycleHealth(pool, now);

      expect(health.settlementFailures).toBeNull();
    });

    it('returns last reconciler run timestamp and count', async () => {
      const now = new Date('2026-03-01T12:00:00Z');
      const lastRunTime = new Date('2026-03-01T11:59:30Z');

      pool.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({
          rows: [{ run_at: lastRunTime, transitions_count: '5' }]
        });

      const health = await getLifecycleHealth(pool, now);

      expect(health.lastReconcilerRun).toBe(lastRunTime.toISOString());
      expect(health.transitionsLastRun).toBe(5);
    });

    it('uses injected now for all time comparisons', async () => {
      const customNow = new Date('2026-03-15T09:30:00Z');

      pool.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // scheduled past lock
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // locked past start
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // live past end
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // complete without settlement
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // settlement failures
        .mockResolvedValueOnce({ rows: [] }); // no reconciler runs

      await getLifecycleHealth(pool, customNow);

      // Verify first 3 queries use injected now (time-based comparisons)
      const scheduledCall = pool.query.mock.calls[0][1];
      const lockedCall = pool.query.mock.calls[1][1];
      const liveCall = pool.query.mock.calls[2][1];

      expect(scheduledCall[0]).toEqual(customNow);
      expect(lockedCall[0]).toEqual(customNow);
      expect(liveCall[0]).toEqual(customNow);
    });
  });

  describe('insertReconcilerRun', () => {
    it('inserts a reconciler run record', async () => {
      const runTime = new Date('2026-03-01T12:00:00Z');
      const runId = '550e8400-e29b-41d4-a716-446655440000';

      pool.query.mockResolvedValue({
        rows: [{ id: runId, run_at: runTime }]
      });

      const result = await insertReconcilerRun(pool, 3);

      expect(result).toEqual({
        id: runId,
        run_at: runTime.toISOString()
      });

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO lifecycle_reconciler_runs'),
        [3]
      );
    });

    it('accepts zero transitions count', async () => {
      const runId = '550e8400-e29b-41d4-a716-446655440000';
      const runTime = new Date('2026-03-01T12:00:00Z');

      pool.query.mockResolvedValue({
        rows: [{ id: runId, run_at: runTime }]
      });

      const result = await insertReconcilerRun(pool, 0);

      expect(result.id).toBe(runId);
      expect(pool.query.mock.calls[0][1][0]).toBe(0);
    });
  });
});
