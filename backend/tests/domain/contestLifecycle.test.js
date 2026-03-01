// contestLifecycle.test.js

const { createMockPool, mockQueryResponses } = require('../../tests/mocks/mockPool');
const { applyLifecycleTransition } = require('../../domain/contest-lifecycle/contestLifecycleEngine');
const { computeNextStatus } = require('../../domain/contest-lifecycle/contestLifecycleTransitions');

describe('Contest Lifecycle Engine', () => {
  const TEST_ID = 'contest-123';

  describe('computeNextStatus (pure function)', () => {
    it('UPCOMING → ACTIVE when now >= start_time', () => {
      const instance = {
        status: 'UPCOMING',
        start_time: '2026-01-01T10:00:00Z',
        end_time: '2026-01-02T10:00:00Z',
      };

      const now = new Date('2026-01-01T10:00:00Z');

      const next = computeNextStatus(instance, now);
      expect(next).toBe('ACTIVE');
    });

    it('ACTIVE → COMPLETED when now >= end_time', () => {
      const instance = {
        status: 'ACTIVE',
        start_time: '2026-01-01T10:00:00Z',
        end_time: '2026-01-02T10:00:00Z',
      };

      const now = new Date('2026-01-02T10:00:00Z');

      const next = computeNextStatus(instance, now);
      expect(next).toBe('COMPLETED');
    });

    it('returns null when no transition needed', () => {
      const instance = {
        status: 'UPCOMING',
        start_time: '2026-01-01T10:00:00Z',
        end_time: '2026-01-02T10:00:00Z',
      };

      const now = new Date('2025-12-31T10:00:00Z');

      const next = computeNextStatus(instance, now);
      expect(next).toBeNull();
    });

    it('throws when UPCOMING missing start_time', () => {
      expect(() =>
        computeNextStatus({ status: 'UPCOMING' }, new Date())
      ).toThrow();
    });

    it('throws when ACTIVE missing end_time', () => {
      expect(() =>
        computeNextStatus({ status: 'ACTIVE' }, new Date())
      ).toThrow();
    });
  });

  describe('applyLifecycleTransition (transactional)', () => {
    let mockPool;

    beforeEach(() => {
      mockPool = createMockPool();
    });

    it('transitions UPCOMING → ACTIVE and writes audit', async () => {
      const instance = {
        id: TEST_ID,
        status: 'UPCOMING',
        start_time: '2026-01-01T10:00:00Z',
        end_time: '2026-01-02T10:00:00Z',
      };

      mockPool.setQueryResponse(
        /SELECT id, status, start_time, end_time[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(instance)
      );

      mockPool.setQueryResponse(
        /UPDATE contest_instances/,
        mockQueryResponses.single({ ...instance, status: 'ACTIVE' })
      );

      mockPool.setQueryResponse(
        /INSERT INTO admin_contest_audit/,
        mockQueryResponses.single({ id: 'audit-1' })
      );

      const result = await applyLifecycleTransition(
        mockPool,
        TEST_ID,
        new Date('2026-01-01T10:00:00Z')
      );

      expect(result.changed).toBe(true);
      expect(result.toStatus).toBe('ACTIVE');
    });

    it('is idempotent when run twice', async () => {
      const activeInstance = {
        id: TEST_ID,
        status: 'ACTIVE',
        start_time: '2026-01-01T10:00:00Z',
        end_time: '2026-01-02T10:00:00Z',
      };

      mockPool.setQueryResponse(
        /SELECT id, status, start_time, end_time[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(activeInstance)
      );

      const result = await applyLifecycleTransition(
        mockPool,
        TEST_ID,
        new Date('2026-01-01T10:00:00Z')
      );

      expect(result.changed).toBe(false);
    });

    it('does nothing for terminal status', async () => {
      const instance = {
        id: TEST_ID,
        status: 'COMPLETED',
        start_time: '2026-01-01T10:00:00Z',
        end_time: '2026-01-02T10:00:00Z',
      };

      mockPool.setQueryResponse(
        /SELECT id, status, start_time, end_time[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(instance)
      );

      const result = await applyLifecycleTransition(
        mockPool,
        TEST_ID,
        new Date()
      );

      expect(result.changed).toBe(false);
    });

    it('handles race condition (0 row UPDATE)', async () => {
      const instance = {
        id: TEST_ID,
        status: 'UPCOMING',
        start_time: '2026-01-01T10:00:00Z',
        end_time: '2026-01-02T10:00:00Z',
      };

      mockPool.setQueryResponse(
        /SELECT id, status, start_time, end_time[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(instance)
      );

      mockPool.setQueryResponse(
        /UPDATE contest_instances/,
        { rows: [], rowCount: 0 }
      );

      const result = await applyLifecycleTransition(
        mockPool,
        TEST_ID,
        new Date('2026-01-01T10:00:00Z')
      );

      expect(result.changed).toBe(false);
    });
  });
});
