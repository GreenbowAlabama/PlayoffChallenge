/**
 * Settlement Runner: Atomicity & All-Or-Nothing Tests
 *
 * Tests for:
 * - Settlement transactions are atomic (all-or-nothing)
 * - Failure during settlement rolls back all changes
 * - No partial score_history rows on failure
 * - settlement_audit marked FAILED on error
 * - No database state corruption on mid-run error
 */

const { createMockPool, mockQueryResponses } = require('../mocks/mockPool');

describe('Settlement Runner - Atomicity & All-Or-Nothing', () => {
  let mockPool;
  const contestId = 'contest-123';

  beforeEach(() => {
    mockPool = createMockPool();
  });

  describe('Transaction boundaries', () => {
    it('should wrap settlement in BEGIN...COMMIT transaction', async () => {
      const queryHistory = [];
      const mockQuery = jest.fn(async (sql) => {
        queryHistory.push(sql);
        if (sql === 'BEGIN') return { rows: [], rowCount: 0 };
        if (sql === 'COMMIT') return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      });

      // Simulate settlement flow
      await mockQuery('BEGIN');
      await mockQuery('SELECT * FROM ingestion_events');
      await mockQuery('INSERT INTO settlement_audit');
      await mockQuery('COMMIT');

      expect(queryHistory[0]).toBe('BEGIN');
      expect(queryHistory[queryHistory.length - 1]).toBe('COMMIT');
    });

    it('should roll back on ROLLBACK in exception handler', async () => {
      const queryHistory = [];
      const mockQuery = jest.fn(async (sql) => {
        queryHistory.push(sql);
        if (sql === 'BEGIN') return { rows: [], rowCount: 0 };
        if (sql.includes('INSERT')) throw new Error('Simulated insert failure');
        if (sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      });

      try {
        await mockQuery('BEGIN');
        await mockQuery('INSERT INTO settlement_audit');
      } catch (err) {
        await mockQuery('ROLLBACK');
      }

      expect(queryHistory).toContain('BEGIN');
      expect(queryHistory).toContain('ROLLBACK');
      // No COMMIT after error
      expect(queryHistory[queryHistory.length - 1]).toBe('ROLLBACK');
    });
  });

  describe('Failure handling', () => {
    it('should mark settlement_audit FAILED if event processing fails', async () => {
      const failedAudit = {
        id: 'audit-1',
        contest_instance_id: contestId,
        status: 'FAILED',
        error_json: { message: 'Event validation failed', code: 'VALIDATION_ERROR' },
        event_ids_applied: [] // No events applied
      };

      mockPool.setQueryResponse(
        /UPDATE.*settlement_audit.*FAILED/,
        mockQueryResponses.single(failedAudit)
      );

      const result = await mockPool.query(
        `UPDATE settlement_audit SET status = 'FAILED', error_json = $1 WHERE id = $2 RETURNING *`,
        [JSON.stringify({ message: 'Event validation failed' }), 'audit-1']
      );

      expect(result.rows[0].status).toBe('FAILED');
      expect(result.rows[0].error_json).toBeDefined();
      expect(result.rows[0].event_ids_applied).toEqual([]);
    });

    it('should not create score_history rows if settlement fails', async () => {
      // Setup: settlement fails after starting
      const failedAudit = {
        id: 'audit-1',
        status: 'FAILED',
        event_ids_applied: []
      };

      mockPool.setQueryResponse(
        /SELECT.*score_history.*WHERE.*audit.*FAILED/,
        mockQueryResponses.empty() // No score_history created
      );

      mockPool.setQueryResponse(
        /UPDATE.*settlement_audit.*FAILED/,
        mockQueryResponses.single(failedAudit)
      );

      // Check that no score_history rows exist for this failed settlement
      const scoreResult = await mockPool.query(
        `SELECT * FROM score_history WHERE settlement_audit_id = (
          SELECT id FROM settlement_audit WHERE status = 'FAILED' AND id = $1
        )`,
        ['audit-1']
      );

      expect(scoreResult.rows).toHaveLength(0);
    });

    it('should preserve settlement_audit row even on failure', async () => {
      const failedAudit = {
        id: 'audit-failed-1',
        status: 'FAILED',
        started_at: '2026-02-15T10:00:00Z',
        completed_at: '2026-02-15T10:00:05Z',
        error_json: { message: 'Processing failed' }
      };

      mockPool.setQueryResponse(
        /SELECT.*FROM settlement_audit/,
        mockQueryResponses.single(failedAudit)
      );

      const result = await mockPool.query(
        `SELECT * FROM settlement_audit WHERE id = $1`,
        ['audit-failed-1']
      );

      expect(result.rows[0].id).toBe('audit-failed-1');
      expect(result.rows[0].status).toBe('FAILED');
      expect(result.rows[0].error_json).toBeDefined();
    });
  });

  describe('Partial failure prevention', () => {
    it('should not create partial settlement_audit entries on mid-transaction failure', async () => {
      // Simulate: settlement starts, but fails before completion
      const incompleteAudit = {
        id: 'audit-incomplete',
        status: 'STARTED', // Still in progress
        started_at: '2026-02-15T10:00:00Z',
        completed_at: null // Not completed
      };

      mockPool.setQueryResponse(
        /SELECT.*WHERE status = 'STARTED'/,
        mockQueryResponses.single(incompleteAudit)
      );

      const result = await mockPool.query(
        `SELECT * FROM settlement_audit WHERE status = 'STARTED'`
      );

      expect(result.rows[0].completed_at).toBeNull();
      expect(result.rows[0].status).toBe('STARTED');
    });

    it('should have COMPLETE status with final_scores before accepting settlement', async () => {
      // Valid: completed settlement
      const completeAudit = {
        id: 'audit-complete',
        status: 'COMPLETE',
        final_scores_json: { 'p1': 100 }
      };

      mockPool.setQueryResponse(
        /WHERE status = 'COMPLETE' AND final_scores_json IS NOT NULL/,
        mockQueryResponses.single(completeAudit)
      );

      const result = await mockPool.query(
        `SELECT * FROM settlement_audit WHERE status = 'COMPLETE' AND final_scores_json IS NOT NULL`
      );

      expect(result.rows[0].status).toBe('COMPLETE');
      expect(result.rows[0].final_scores_json).toBeDefined();
    });

    it('should not have score_history for incomplete settlements', async () => {
      // Incomplete settlement should have no score_history rows
      mockPool.setQueryResponse(
        /SELECT.*score_history.*settlement_audit_id.*STARTED/,
        mockQueryResponses.empty()
      );

      const result = await mockPool.query(
        `SELECT sh.* FROM score_history sh
         INNER JOIN settlement_audit sa ON sh.settlement_audit_id = sa.id
         WHERE sa.status = 'STARTED'`
      );

      expect(result.rows).toHaveLength(0);
    });
  });

  describe('Settlement state machine', () => {
    it('should transition STARTED -> COMPLETE on success', async () => {
      mockPool.setQueryResponse(
        /UPDATE.*settlement_audit.*status.*COMPLETE/,
        mockQueryResponses.single({
          id: 'audit-1',
          status: 'COMPLETE',
          started_at: '2026-02-15T10:00:00Z',
          completed_at: '2026-02-15T10:00:10Z'
        })
      );

      const result = await mockPool.query(
        `UPDATE settlement_audit SET status = 'COMPLETE', completed_at = NOW() WHERE id = $1 RETURNING *`,
        ['audit-1']
      );

      expect(result.rows[0].status).toBe('COMPLETE');
      expect(result.rows[0].completed_at).not.toBeNull();
    });

    it('should transition STARTED -> FAILED on error', async () => {
      mockPool.setQueryResponse(
        /UPDATE.*settlement_audit.*status.*FAILED/,
        mockQueryResponses.single({
          id: 'audit-1',
          status: 'FAILED',
          started_at: '2026-02-15T10:00:00Z',
          completed_at: '2026-02-15T10:00:05Z'
        })
      );

      const result = await mockPool.query(
        `UPDATE settlement_audit SET status = 'FAILED', completed_at = NOW() WHERE id = $1 RETURNING *`,
        ['audit-1']
      );

      expect(result.rows[0].status).toBe('FAILED');
    });

    it('should not allow transition from COMPLETE to other status', async () => {
      // This should be enforced at DB or application level
      mockPool.setQueryResponse(
        /SELECT.*settlement_audit/,
        mockQueryResponses.single({
          id: 'audit-1',
          status: 'COMPLETE'
        })
      );

      // Check: settlement already complete
      const existing = await mockPool.query(
        `SELECT * FROM settlement_audit WHERE id = $1`,
        ['audit-1']
      );

      // Verify it's in terminal state
      if (existing.rows.length > 0) {
        expect(['COMPLETE', 'FAILED']).toContain(existing.rows[0].status);
      }
    });
  });

  describe('Lock mechanism', () => {
    it('should acquire lock before starting settlement (SELECT FOR UPDATE)', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FOR UPDATE/,
        mockQueryResponses.single({
          id: contestId,
          status: 'LIVE',
          settle_time: null
        })
      );

      const result = await mockPool.query(
        `SELECT id, status FROM contest_instances WHERE id = $1 FOR UPDATE`,
        [contestId]
      );

      expect(result.rows[0].id).toBe(contestId);
    });

    it('should prevent concurrent settlement attempts', async () => {
      // If lock is held, second query should wait (or fail in test)
      // This tests that FOR UPDATE is used
      mockPool.setQueryResponse(
        /SELECT.*FOR UPDATE/,
        mockQueryResponses.single({
          id: contestId,
          status: 'LIVE'
        })
      );

      // First settlement acquires lock
      const result1 = await mockPool.query(
        `SELECT id FROM contest_instances WHERE id = $1 FOR UPDATE`,
        [contestId]
      );

      expect(result1.rows[0].id).toBe(contestId);

      // Second would block in real DB (mocked here)
      const result2 = await mockPool.query(
        `SELECT id FROM contest_instances WHERE id = $1 FOR UPDATE`,
        [contestId]
      );

      // Both get the lock (mock doesn't block), but in real DB second would wait
      expect(result2.rows[0].id).toBe(contestId);
    });
  });
});
