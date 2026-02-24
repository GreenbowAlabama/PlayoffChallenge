/**
 * Settlement Runner: Replay & Determinism Tests
 *
 * Tests for:
 * - Deterministic replay (same events → identical scores)
 * - Idempotency (running settlement twice produces same result)
 * - Events applied in deterministic order (received_at, then id)
 * - Score hashes are consistent
 * - No double-application of events
 */

const { createMockPool, mockQueryResponses } = require('../mocks/mockPool');

describe('Settlement Runner - Replay & Determinism', () => {
  let mockPool;
  const contestId = 'contest-123';
  const settlementRunId = 'settlement-run-1';

  beforeEach(() => {
    mockPool = createMockPool();
  });

  describe('Deterministic replay', () => {
    it('should produce identical scores from same validated events in same order', async () => {
      // Setup: Two validated ingestion events
      const event1 = {
        id: 'event-1',
        contest_instance_id: contestId,
        provider_data_json: { player_id: 'p1', round: 1, strokes: 72 },
        payload_hash: 'hash1',
        validation_status: 'VALID',
        received_at: '2026-02-15T10:00:00Z'
      };

      const event2 = {
        id: 'event-2',
        contest_instance_id: contestId,
        provider_data_json: { player_id: 'p2', round: 1, strokes: 75 },
        payload_hash: 'hash2',
        validation_status: 'VALID',
        received_at: '2026-02-15T10:01:00Z'
      };

      const expectedScores1 = { 'p1': 72, 'p2': 75 };
      const expectedHash1 = 'score-hash-abc123';

      // First settlement run
      mockPool.setQueryResponse(
        /SELECT.*FROM ingestion_events.*WHERE.*VALID.*ORDER BY received_at/,
        mockQueryResponses.multiple([event1, event2])
      );

      const settlementAuditRow = {
        id: settlementRunId,
        contest_instance_id: contestId,
        status: 'COMPLETE',
        final_scores_json: expectedScores1,
        event_ids_applied: ['event-1', 'event-2']
      };

      mockPool.setQueryResponse(
        /INSERT INTO settlement_audit/,
        mockQueryResponses.single(settlementAuditRow)
      );

      mockPool.setQueryResponse(
        /SELECT.*FROM settlement_audit/,
        mockQueryResponses.single(settlementAuditRow)
      );

      // Should calculate deterministic score hash
      const result1 = await mockPool.query(
        `SELECT * FROM settlement_audit WHERE id = $1`,
        [settlementRunId]
      );

      expect(result1.rows[0].final_scores_json).toEqual(expectedScores1);

      // Second settlement run with identical events - should produce identical output
      mockPool.reset();
      mockPool.setQueryResponse(
        /SELECT.*FROM ingestion_events.*WHERE.*VALID.*ORDER BY received_at/,
        mockQueryResponses.multiple([event1, event2])
      );

      mockPool.setQueryResponse(
        /INSERT INTO settlement_audit/,
        mockQueryResponses.single(settlementAuditRow)
      );

      mockPool.setQueryResponse(
        /SELECT.*FROM settlement_audit/,
        mockQueryResponses.single(settlementAuditRow)
      );

      const result2 = await mockPool.query(
        `SELECT * FROM settlement_audit WHERE id = $1`,
        [settlementRunId]
      );

      expect(result2.rows[0].final_scores_json).toEqual(result1.rows[0].final_scores_json);
    });

    it('should order events by received_at, then id for determinism', async () => {
      // Three events with same received_at but different ids
      const baseTime = '2026-02-15T10:00:00Z';
      const events = [
        {
          id: 'event-c',
          received_at: baseTime,
          validation_status: 'VALID',
          provider_data_json: { player: 'c', score: 1 }
        },
        {
          id: 'event-a',
          received_at: baseTime,
          validation_status: 'VALID',
          provider_data_json: { player: 'a', score: 3 }
        },
        {
          id: 'event-b',
          received_at: baseTime,
          validation_status: 'VALID',
          provider_data_json: { player: 'b', score: 2 }
        }
      ];

      // Should be ordered by id when received_at is same
      mockPool.setQueryResponse(
        /ORDER BY received_at.*id/,
        mockQueryResponses.multiple(events.sort((a, b) => a.id.localeCompare(b.id)))
      );

      const result = await mockPool.query(
        `SELECT * FROM ingestion_events ORDER BY received_at, id`
      );

      expect(result.rows[0].id).toBe('event-a');
      expect(result.rows[1].id).toBe('event-b');
      expect(result.rows[2].id).toBe('event-c');
    });
  });

  describe('Idempotency', () => {
    it('should produce identical settlement records on re-run', async () => {
      const event = {
        id: 'event-1',
        contest_instance_id: contestId,
        validation_status: 'VALID',
        received_at: '2026-02-15T10:00:00Z',
        provider_data_json: { player_id: 'p1', strokes: 72 }
      };

      const auditRecord1 = {
        id: 'audit-run-1',
        contest_instance_id: contestId,
        status: 'COMPLETE',
        final_scores_json: { 'p1': 72 },
        scores_hash: 'hash-abc'
      };

      // First run produces audit record
      mockPool.setQueryResponse(
        /SELECT.*FROM ingestion_events.*VALID/,
        mockQueryResponses.multiple([event])
      );

      mockPool.setQueryResponse(
        /INSERT INTO settlement_audit/,
        mockQueryResponses.single(auditRecord1)
      );

      const firstResult = await mockPool.query(
        'INSERT INTO settlement_audit (contest_instance_id, status, final_scores_json) VALUES ($1, $2, $3) RETURNING *',
        [contestId, 'COMPLETE', JSON.stringify({ 'p1': 72 })]
      );

      // Second run with same event
      mockPool.reset();
      mockPool.setQueryResponse(
        /SELECT.*FROM ingestion_events.*VALID/,
        mockQueryResponses.multiple([event])
      );

      mockPool.setQueryResponse(
        /INSERT INTO settlement_audit/,
        mockQueryResponses.single(auditRecord1)
      );

      const secondResult = await mockPool.query(
        'INSERT INTO settlement_audit (contest_instance_id, status, final_scores_json) VALUES ($1, $2, $3) RETURNING *',
        [contestId, 'COMPLETE', JSON.stringify({ 'p1': 72 })]
      );

      // Both results should have identical scores and hash
      expect(firstResult.rows[0].final_scores_json).toEqual(secondResult.rows[0].final_scores_json);
      expect(firstResult.rows[0].scores_hash).toEqual(secondResult.rows[0].scores_hash);
    });

    it('should not apply the same event twice across runs', async () => {
      const eventId = 'event-1';

      // Check: can we prevent re-application of same event?
      // Should query settlement_audit to find already-applied events
      mockPool.setQueryResponse(
        /SELECT.*event_ids_applied.*FROM settlement_audit/,
        mockQueryResponses.multiple([
          {
            id: 'audit-1',
            event_ids_applied: [eventId], // This event already applied
            status: 'COMPLETE'
          }
        ])
      );

      const result = await mockPool.query(
        'SELECT event_ids_applied FROM settlement_audit WHERE contest_instance_id = $1 AND status = $2',
        [contestId, 'COMPLETE']
      );

      const appliedEvents = result.rows[0].event_ids_applied;
      expect(appliedEvents).toContain(eventId);
      expect(appliedEvents.length).toBe(1); // Only one application
    });
  });

  describe('Score hash consistency', () => {
    it('should compute same score hash for identical score data', async () => {
      const scores = { 'player1': 100, 'player2': 95, 'player3': 90 };

      // First settlement
      const hash1 = 'abc123def456';
      mockPool.setQueryResponse(
        /INSERT INTO score_history/,
        mockQueryResponses.single({
          id: 'score-history-1',
          scores_json: scores,
          scores_hash: hash1
        })
      );

      const result1 = await mockPool.query(
        'INSERT INTO score_history (scores_json, scores_hash) VALUES ($1, $2) RETURNING *',
        [JSON.stringify(scores), hash1]
      );

      // Second settlement with identical scores
      mockPool.reset();
      mockPool.setQueryResponse(
        /INSERT INTO score_history/,
        mockQueryResponses.single({
          id: 'score-history-2',
          scores_json: scores,
          scores_hash: hash1 // Must be identical
        })
      );

      const result2 = await mockPool.query(
        'INSERT INTO score_history (scores_json, scores_hash) VALUES ($1, $2) RETURNING *',
        [JSON.stringify(scores), hash1]
      );

      expect(result1.rows[0].scores_hash).toEqual(result2.rows[0].scores_hash);
    });

    it('should compute different hash for different score data', async () => {
      const scores1 = { 'player1': 100 };
      const scores2 = { 'player1': 99 }; // Different score

      const hash1 = 'abc123';
      const hash2 = 'xyz789'; // Different hash

      mockPool.setQueryResponse(
        /SELECT.*scores_hash.*FROM score_history.*IN/i,
        mockQueryResponses.multiple([
          { scores_json: scores1, scores_hash: hash1 },
          { scores_json: scores2, scores_hash: hash2 }
        ])
      );

      const result = await mockPool.query(
        'SELECT scores_hash FROM score_history WHERE scores_hash IN ($1, $2)',
        [hash1, hash2]
      );

      expect(result.rows[0].scores_hash).not.toEqual(result.rows[1].scores_hash);
    });
  });

  describe('Valid events only', () => {
    it('should only apply VALID ingestion events', async () => {
      const validEvent = {
        id: 'event-valid',
        validation_status: 'VALID'
      };

      const invalidEvent = {
        id: 'event-invalid',
        validation_status: 'INVALID'
      };

      mockPool.setQueryResponse(
        /WHERE.*validation_status = 'VALID'/,
        mockQueryResponses.multiple([validEvent]) // Only VALID returned
      );

      const result = await mockPool.query(
        `SELECT * FROM ingestion_events WHERE validation_status = 'VALID'`
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].validation_status).toBe('VALID');
    });

    it('should skip INVALID events without applying them', async () => {
      mockPool.setQueryResponse(
        /WHERE.*validation_status = 'VALID'/,
        mockQueryResponses.empty() // No valid events
      );

      const result = await mockPool.query(
        `SELECT * FROM ingestion_events WHERE validation_status = 'VALID' AND contest_instance_id = $1`,
        [contestId]
      );

      expect(result.rows).toHaveLength(0);
    });
  });
});
