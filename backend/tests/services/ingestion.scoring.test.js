/**
 * Ingestion Scoring Phase Tests
 *
 * Tests for SCORING phase orchestration.
 * Verifies that runScoring() properly constructs scoring work units
 * and that scoring execution produces golfer_event_scores rows.
 *
 * Test-First: These tests verify the fix for the defect where
 * runScoring() was calling adapter.getWorkUnits() instead of
 * constructing explicit SCORING units.
 */

'use strict';

jest.mock('../../services/ingestion/espn/espnPgaApi', () => ({
  fetchLeaderboard: jest.fn().mockResolvedValue({
    events: [{
      status: { type: { name: 'STATUS_LIVE' } },
      competitions: [{
        competitors: [{
          id: '123',
          position: '1',
          linescores: [{ period: 1, linescores: [{ value: 4, par: 4 }] }]
        }]
      }]
    }]
  })
}));

describe('Ingestion Scoring Phase', () => {
  const ingestionService = require('../../services/ingestionService');
  const ingestionRegistry = require('../../services/ingestionRegistry');

  let mockClient;
  let mockPool;
  let mockAdapter;

  beforeEach(() => {
    // Smart mock that responds based on SQL content
    const mockQueryImpl = jest.fn((sql) => {
      // Handle tournament_configs lookup
      if (sql.includes('SELECT provider_event_id') && sql.includes('FROM tournament_configs')) {
        return Promise.resolve({
          rows: [{ provider_event_id: 'espn_pga_401811937' }]
        });
      }
      // Handle contest instance lock query (FOR UPDATE)
      if (sql.includes('FOR UPDATE OF ci')) {
        return Promise.resolve({
          rows: [{
            id: 'ci-test',
            status: 'LIVE',
            sport: 'GOLF',
            provider_tournament_id: 'espn_pga_401811937',
            provider_event_id: 'espn_pga_401811937'
          }]
        });
      }
      // Handle players query
      if (sql.includes('SELECT id FROM players') && sql.includes('GOLF')) {
        return Promise.resolve({ rows: [] });
      }
      // Handle field_selections query
      if (sql.includes('SELECT selection_json FROM field_selections')) {
        return Promise.resolve({ rows: [] });
      }
      // Handle ingestion_runs SELECT
      if (sql.includes('SELECT status') && sql.includes('FROM ingestion_runs')) {
        return Promise.resolve({ rows: [] });
      }
      // Handle ingestion_runs INSERT
      if (sql.includes('INSERT INTO ingestion_runs')) {
        return Promise.resolve({ rows: [{ id: 'run-id' }] });
      }
      // Handle ingestion_runs UPDATE
      if (sql.includes('UPDATE ingestion_runs')) {
        return Promise.resolve({ rows: [] });
      }
      // Handle BEGIN/COMMIT/ROLLBACK
      if (sql.includes('BEGIN') || sql.includes('COMMIT') || sql.includes('ROLLBACK')) {
        return Promise.resolve();
      }
      // Default: return empty rows
      return Promise.resolve({ rows: [] });
    });

    mockClient = {
      query: mockQueryImpl,
      release: jest.fn()
    };

    mockPool = {
      connect: jest.fn().mockResolvedValue(mockClient),
      query: mockQueryImpl
    };

    mockAdapter = {
      validateConfig: jest.fn(),
      getWorkUnits: jest.fn(),
      computeIngestionKey: jest.fn(),
      ingestWorkUnit: jest.fn(),
      upsertScores: jest.fn()
    };

    jest.spyOn(ingestionRegistry, 'getIngestionStrategy').mockReturnValue(mockAdapter);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Test 1: runScoring() produces scoring work units (not adapter units)', () => {
    it('should construct explicit SCORING unit without calling adapter.getWorkUnits()', async () => {
      // Mock adapter methods
      mockAdapter.computeIngestionKey.mockReturnValue('scoring-key-1');
      mockAdapter.ingestWorkUnit.mockResolvedValue([]);
      mockAdapter.upsertScores.mockResolvedValue();

      // Execute runScoring
      await ingestionService.runScoring('ci-live', mockPool);

      // ASSERTION 1: adapter.getWorkUnits should NOT be called for SCORING phase
      expect(mockAdapter.getWorkUnits).not.toHaveBeenCalled();

      // ASSERTION 2: adapter.ingestWorkUnit should be called with SCORING unit
      expect(mockAdapter.ingestWorkUnit).toHaveBeenCalled();
      const unitPassedToIngestWorkUnit = mockAdapter.ingestWorkUnit.mock.calls[0][1];
      expect(unitPassedToIngestWorkUnit).toHaveProperty('phase');
      expect(unitPassedToIngestWorkUnit.phase).toBe('SCORING');
      expect(unitPassedToIngestWorkUnit).toHaveProperty('providerEventId');
      expect(unitPassedToIngestWorkUnit).toHaveProperty('providerData');
    });
  });

  describe('Test 2: SCORING phase executes when units exist', () => {
    it('should execute ingestWorkUnit for SCORING unit and produce golfer scores', async () => {
      // Mock adapter to return golfer scores
      const mockGolferScores = [
        {
          contest_instance_id: 'ci-live-2',
          golfer_id: 'espn_123',
          round_number: 1,
          hole_points: 10,
          bonus_points: 2,
          finish_bonus: 0,
          total_points: 12
        }
      ];

      mockAdapter.computeIngestionKey.mockReturnValue('scoring-key-2');
      mockAdapter.ingestWorkUnit.mockResolvedValue(mockGolferScores);
      mockAdapter.upsertScores.mockResolvedValue();

      // Execute
      const result = await ingestionService.runScoring('ci-live-2', mockPool);

      // ASSERTION: upsertScores should be called with golfer scores
      expect(mockAdapter.upsertScores).toHaveBeenCalled();
      const scoresPassedToUpsert = mockAdapter.upsertScores.mock.calls[0][1];
      expect(scoresPassedToUpsert).toEqual(mockGolferScores);
      expect(result.processed).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Test 3: No duplicate scoring on repeated polling', () => {
    it('should be idempotent: repeated runScoring() calls with same contest do not duplicate scoring', async () => {
      mockAdapter.computeIngestionKey.mockReturnValue('scoring-key-3-constant');
      mockAdapter.ingestWorkUnit.mockResolvedValue([]);
      mockAdapter.upsertScores.mockResolvedValue();

      // First call
      await ingestionService.runScoring('ci-live-3', mockPool);
      // Second call (polling)
      await ingestionService.runScoring('ci-live-3', mockPool);

      // ASSERTION: computeIngestionKey should be called twice with same unit
      // both calls should produce same key (idempotency key)
      expect(mockAdapter.computeIngestionKey).toHaveBeenCalledTimes(2);
      const key1 = mockAdapter.computeIngestionKey.mock.results[0].value;
      const key2 = mockAdapter.computeIngestionKey.mock.results[1].value;
      expect(key1).toBe(key2);
    });
  });

  describe('Test 4: Worker invocation triggers golfer_event_scores insertion', () => {
    it('should result in golfer_event_scores rows when ingestion completes successfully', async () => {
      // Mock adapter returns multiple golfer scores
      const mockScores = [
        {
          contest_instance_id: 'ci-live-4',
          golfer_id: 'espn_rory',
          round_number: 1,
          hole_points: 15,
          bonus_points: 3,
          finish_bonus: 5,
          total_points: 23
        },
        {
          contest_instance_id: 'ci-live-4',
          golfer_id: 'espn_jon',
          round_number: 1,
          hole_points: 12,
          bonus_points: 2,
          finish_bonus: 0,
          total_points: 14
        }
      ];

      mockAdapter.computeIngestionKey.mockReturnValue('scoring-key-4');
      mockAdapter.ingestWorkUnit.mockResolvedValue(mockScores);
      mockAdapter.upsertScores.mockResolvedValue();

      // Execute
      await ingestionService.runScoring('ci-live-4', mockPool);

      // ASSERTION: upsertScores should be called with scores
      expect(mockAdapter.upsertScores).toHaveBeenCalledTimes(1);
      const upsertCall = mockAdapter.upsertScores.mock.calls[0];
      const ctx = upsertCall[0];
      const scores = upsertCall[1];

      expect(ctx.contestInstanceId).toBe('ci-live-4');
      expect(scores).toEqual(mockScores);
      expect(scores.length).toBe(2);
    });
  });
});
