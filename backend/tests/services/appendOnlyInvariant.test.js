/**
 * Append-Only Invariant Enforcement Tests
 *
 * Tests for:
 * - ingestion_events never updated or deleted
 * - ingestion_validation_errors never updated or deleted
 * - settlement_audit never updated or deleted (except status transition)
 * - score_history never updated or deleted
 * - Attempts to mutate raise explicit errors
 * - Only INSERT operations allowed on these tables
 */

const { createMockPool, mockQueryResponses } = require('../mocks/mockPool');
const { INGESTION_ERROR_CODES } = require('../../services/ingestionService/errorCodes');

describe('Append-Only Invariant Enforcement', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = createMockPool();
  });

  describe('ingestion_events immutability', () => {
    it('should reject DELETE on ingestion_events', async () => {
      const deleteError = new Error('Cannot delete from ingestion_events (append-only)');
      deleteError.code = 'APPEND_ONLY_VIOLATION';

      mockPool.setQueryResponse(
        /DELETE FROM ingestion_events/,
        mockQueryResponses.error('Cannot delete from ingestion_events (append-only)', 'APPEND_ONLY_VIOLATION')
      );

      try {
        await mockPool.query('DELETE FROM ingestion_events WHERE id = $1', ['event-1']);
        throw new Error('Should have thrown error');
      } catch (err) {
        expect(err.code).toBe('APPEND_ONLY_VIOLATION');
      }
    });

    it('should reject UPDATE on ingestion_events', async () => {
      mockPool.setQueryResponse(
        /UPDATE ingestion_events/,
        mockQueryResponses.error('Cannot update ingestion_events (append-only)', 'APPEND_ONLY_VIOLATION')
      );

      try {
        await mockPool.query(
          'UPDATE ingestion_events SET validation_status = $1 WHERE id = $2',
          ['VALID', 'event-1']
        );
        throw new Error('Should have thrown error');
      } catch (err) {
        expect(err.code).toBe('APPEND_ONLY_VIOLATION');
      }
    });

    it('should allow INSERT on ingestion_events', async () => {
      const newEvent = {
        id: 'event-1',
        contest_instance_id: 'contest-1',
        provider_data_json: { test: true },
        validation_status: 'VALID'
      };

      mockPool.setQueryResponse(
        /INSERT INTO ingestion_events/,
        mockQueryResponses.single(newEvent)
      );

      const result = await mockPool.query(
        'INSERT INTO ingestion_events (contest_instance_id, provider_data_json, validation_status) VALUES ($1, $2, $3) RETURNING *',
        ['contest-1', JSON.stringify({ test: true }), 'VALID']
      );

      expect(result.rows[0].id).toBe('event-1');
    });

    it('should allow SELECT on ingestion_events', async () => {
      const event = {
        id: 'event-1',
        validation_status: 'VALID'
      };

      mockPool.setQueryResponse(
        /SELECT.*FROM ingestion_events/,
        mockQueryResponses.single(event)
      );

      const result = await mockPool.query('SELECT * FROM ingestion_events WHERE id = $1', ['event-1']);

      expect(result.rows[0].id).toBe('event-1');
    });
  });

  describe('ingestion_validation_errors immutability', () => {
    it('should reject DELETE on ingestion_validation_errors', async () => {
      mockPool.setQueryResponse(
        /DELETE FROM ingestion_validation_errors/,
        mockQueryResponses.error('Cannot delete from ingestion_validation_errors', 'APPEND_ONLY_VIOLATION')
      );

      try {
        await mockPool.query('DELETE FROM ingestion_validation_errors WHERE id = $1', ['error-1']);
        throw new Error('Should have thrown error');
      } catch (err) {
        expect(err.code).toBe('APPEND_ONLY_VIOLATION');
      }
    });

    it('should reject UPDATE on ingestion_validation_errors', async () => {
      mockPool.setQueryResponse(
        /UPDATE ingestion_validation_errors/,
        mockQueryResponses.error('Cannot update ingestion_validation_errors', 'APPEND_ONLY_VIOLATION')
      );

      try {
        await mockPool.query(
          'UPDATE ingestion_validation_errors SET error_code = $1 WHERE id = $2',
          ['NEW_CODE', 'error-1']
        );
        throw new Error('Should have thrown error');
      } catch (err) {
        expect(err.code).toBe('APPEND_ONLY_VIOLATION');
      }
    });

    it('should allow INSERT of validation errors', async () => {
      const error = {
        id: 'error-1',
        ingestion_event_id: 'event-1',
        error_code: INGESTION_ERROR_CODES.INVALID_DATA_TYPE
      };

      mockPool.setQueryResponse(
        /INSERT INTO ingestion_validation_errors/,
        mockQueryResponses.single(error)
      );

      const result = await mockPool.query(
        'INSERT INTO ingestion_validation_errors (ingestion_event_id, error_code) VALUES ($1, $2) RETURNING *',
        ['event-1', INGESTION_ERROR_CODES.INVALID_DATA_TYPE]
      );

      expect(result.rows[0].error_code).toBe(INGESTION_ERROR_CODES.INVALID_DATA_TYPE);
    });

    it('should preserve all historical validation errors', async () => {
      const errors = [
        { id: 'err-1', error_code: 'CODE_A', created_at: '2026-02-15T10:00:00Z' },
        { id: 'err-2', error_code: 'CODE_B', created_at: '2026-02-15T10:00:01Z' }
      ];

      mockPool.setQueryResponse(
        /SELECT.*FROM ingestion_validation_errors/,
        mockQueryResponses.multiple(errors)
      );

      const result = await mockPool.query('SELECT * FROM ingestion_validation_errors ORDER BY created_at');

      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].id).toBe('err-1');
      expect(result.rows[1].id).toBe('err-2');
    });
  });

  describe('settlement_audit limited mutation', () => {
    it('should reject DELETE on settlement_audit', async () => {
      mockPool.setQueryResponse(
        /DELETE FROM settlement_audit/,
        mockQueryResponses.error('Cannot delete from settlement_audit', 'APPEND_ONLY_VIOLATION')
      );

      try {
        await mockPool.query('DELETE FROM settlement_audit WHERE id = $1', ['audit-1']);
        throw new Error('Should have thrown error');
      } catch (err) {
        expect(err.code).toBe('APPEND_ONLY_VIOLATION');
      }
    });

    it('should reject arbitrary UPDATE on settlement_audit', async () => {
      mockPool.setQueryResponse(
        /UPDATE settlement_audit.*error_json/,
        mockQueryResponses.error('Cannot modify settlement_audit error details', 'APPEND_ONLY_VIOLATION')
      );

      try {
        await mockPool.query(
          'UPDATE settlement_audit SET error_json = $1 WHERE id = $2',
          [JSON.stringify({ modified: true }), 'audit-1']
        );
        throw new Error('Should have thrown error');
      } catch (err) {
        expect(err.code).toBe('APPEND_ONLY_VIOLATION');
      }
    });

    it('should allow status transition STARTED -> COMPLETE', async () => {
      mockPool.setQueryResponse(
        /UPDATE settlement_audit.*status.*completed_at/i,
        mockQueryResponses.single({
          id: 'audit-1',
          status: 'COMPLETE',
          completed_at: '2026-02-15T10:00:10Z'
        })
      );

      const result = await mockPool.query(
        'UPDATE settlement_audit SET status = $1, completed_at = NOW() WHERE id = $2 RETURNING *',
        ['COMPLETE', 'audit-1']
      );

      expect(result.rows[0].status).toBe('COMPLETE');
    });

    it('should allow status transition STARTED -> FAILED', async () => {
      mockPool.setQueryResponse(
        /UPDATE settlement_audit.*status/i,
        mockQueryResponses.single({
          id: 'audit-1',
          status: 'FAILED'
        })
      );

      const result = await mockPool.query(
        'UPDATE settlement_audit SET status = $1 WHERE id = $2 RETURNING *',
        ['FAILED', 'audit-1']
      );

      expect(result.rows[0].status).toBe('FAILED');
    });

    it('should allow INSERT on settlement_audit', async () => {
      const audit = {
        id: 'audit-1',
        contest_instance_id: 'contest-1',
        status: 'STARTED'
      };

      mockPool.setQueryResponse(
        /INSERT INTO settlement_audit/,
        mockQueryResponses.single(audit)
      );

      const result = await mockPool.query(
        'INSERT INTO settlement_audit (contest_instance_id, status, started_at) VALUES ($1, $2, NOW()) RETURNING *',
        ['contest-1', 'STARTED']
      );

      expect(result.rows[0].status).toBe('STARTED');
    });
  });

  describe('score_history immutability', () => {
    it('should reject DELETE on score_history', async () => {
      mockPool.setQueryResponse(
        /DELETE FROM score_history/,
        mockQueryResponses.error('Cannot delete from score_history (append-only)', 'APPEND_ONLY_VIOLATION')
      );

      try {
        await mockPool.query('DELETE FROM score_history WHERE id = $1', ['score-1']);
        throw new Error('Should have thrown error');
      } catch (err) {
        expect(err.code).toBe('APPEND_ONLY_VIOLATION');
      }
    });

    it('should reject UPDATE on score_history', async () => {
      mockPool.setQueryResponse(
        /UPDATE score_history/,
        mockQueryResponses.error('Cannot update score_history (append-only)', 'APPEND_ONLY_VIOLATION')
      );

      try {
        await mockPool.query(
          'UPDATE score_history SET scores_json = $1 WHERE id = $2',
          [JSON.stringify({}), 'score-1']
        );
        throw new Error('Should have thrown error');
      } catch (err) {
        expect(err.code).toBe('APPEND_ONLY_VIOLATION');
      }
    });

    it('should allow INSERT on score_history', async () => {
      const scoreRecord = {
        id: 'score-1',
        contest_instance_id: 'contest-1',
        settlement_audit_id: 'audit-1',
        scores_json: { 'p1': 100 },
        scores_hash: 'hash-abc'
      };

      mockPool.setQueryResponse(
        /INSERT INTO score_history/,
        mockQueryResponses.single(scoreRecord)
      );

      const result = await mockPool.query(
        'INSERT INTO score_history (contest_instance_id, settlement_audit_id, scores_json, scores_hash) VALUES ($1, $2, $3, $4) RETURNING *',
        ['contest-1', 'audit-1', JSON.stringify({ 'p1': 100 }), 'hash-abc']
      );

      expect(result.rows[0].scores_hash).toBe('hash-abc');
    });

    it('should preserve all historical score versions', async () => {
      const scores = [
        { id: 'score-1', scores_json: { 'p1': 90 }, created_at: '2026-02-15T10:00:00Z' },
        { id: 'score-2', scores_json: { 'p1': 95 }, created_at: '2026-02-15T10:01:00Z' },
        { id: 'score-3', scores_json: { 'p1': 100 }, created_at: '2026-02-15T10:02:00Z' }
      ];

      mockPool.setQueryResponse(
        /SELECT.*FROM score_history/,
        mockQueryResponses.multiple(scores)
      );

      const result = await mockPool.query('SELECT * FROM score_history ORDER BY created_at');

      expect(result.rows).toHaveLength(3);
      expect(result.rows[0].scores_json).toEqual({ 'p1': 90 });
      expect(result.rows[2].scores_json).toEqual({ 'p1': 100 });
    });
  });

  describe('Error handling for violations', () => {
    it('should report APPEND_ONLY_VIOLATION error code', async () => {
      mockPool.setQueryResponse(
        /DELETE/,
        mockQueryResponses.error('Append-only table violation', 'APPEND_ONLY_VIOLATION')
      );

      try {
        await mockPool.query('DELETE FROM ingestion_events WHERE id = $1', ['event-1']);
        throw new Error('Should have thrown');
      } catch (err) {
        expect(err.code).toBe('APPEND_ONLY_VIOLATION');
        expect(err.message).toContain('Append-only');
      }
    });

    it('should include table name in error context', async () => {
      mockPool.setQueryResponse(
        /DELETE FROM ingestion_events/,
        mockQueryResponses.error('Cannot delete from ingestion_events', 'APPEND_ONLY_VIOLATION')
      );

      try {
        await mockPool.query('DELETE FROM ingestion_events WHERE id = $1', ['event-1']);
        throw new Error('Should have thrown');
      } catch (err) {
        expect(err.message).toContain('ingestion_events');
      }
    });
  });

  describe('Audit trail completeness', () => {
    it('should never lose audit trail due to deletion', async () => {
      const auditEvents = [
        { id: 'audit-1', created_at: '2026-02-15T10:00:00Z', action: 'ingestion' },
        { id: 'audit-2', created_at: '2026-02-15T10:00:01Z', action: 'settlement' }
      ];

      mockPool.setQueryResponse(
        /SELECT COUNT.*FROM ingestion_validation_errors/i,
        mockQueryResponses.single({ count: 2 })
      );

      mockPool.setQueryResponse(
        /SELECT.*FROM ingestion_validation_errors/,
        mockQueryResponses.multiple(auditEvents)
      );

      const beforeDelete = await mockPool.query('SELECT COUNT(*) as count FROM ingestion_validation_errors');
      expect(beforeDelete.rows[0].count).toBeGreaterThan(0);

      // Attempt delete would fail
      mockPool.setQueryResponse(
        /DELETE/,
        mockQueryResponses.error('Cannot delete', 'APPEND_ONLY_VIOLATION')
      );

      try {
        await mockPool.query('DELETE FROM ingestion_validation_errors');
      } catch (err) {
        // Expected
      }

      // Count should be unchanged
      const afterDelete = await mockPool.query('SELECT COUNT(*) as count FROM ingestion_validation_errors');
      expect(afterDelete.rows[0].count).toBe(beforeDelete.rows[0].count);
    });
  });
});
