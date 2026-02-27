/**
 * Integration tests for pgaEspnPollingOrchestrator.pollAndIngest
 *
 * Tests the orchestrator with pre-fetched ESPN work units.
 * External worker fetches ESPN calendar and leaderboard, backend receives workUnits.
 * Backend does NOT call ESPN directly (403 constraint).
 *
 * Tests validate:
 * - DB/template config loading
 * - WorkUnits input validation
 * - ingestionService.run integration
 */

'use strict';

const pgaEspnPollingOrchestrator = require('../../services/ingestion/orchestrators/pgaEspnPollingOrchestrator');

// Mock ingestionService (external worker provides espn data, not backend)
jest.mock('../../services/ingestionService');
const ingestionService = require('../../services/ingestionService');

// Fixtures (used as providerData in workUnits)
const leaderboardFixture = require('../fixtures/espn-pga-leaderboard-complete.json');

describe('pgaEspnPollingOrchestrator.pollAndIngest', () => {
  // ─── Setup ─────────────────────────────────────────────────────────────

  let mockPool;

  beforeEach(() => {
    jest.clearAllMocks();

    // Default ingestionService behavior
    ingestionService.run.mockResolvedValue({
      processed: 1,
      skipped: 0,
      errors: []
    });

    // Default pool behavior
    mockPool = {
      query: jest.fn()
    };
  });

  // ─── Happy Path ────────────────────────────────────────────────────────

  describe('Happy Path', () => {
    it('successfully ingests with pre-fetched workUnits', async () => {
      const contestId = 'test-contest-123';
      const contestRow = {
        id: contestId,
        template_id: 'template-1',
        ingestion_strategy_key: 'pga_espn',
        template_config: {
          provider_league_id: 1106,
          season_year: 2026,
          event_name: 'Masters',
          config: {}
        }
      };

      const workUnits = [
        {
          providerEventId: '401811941',
          providerData: leaderboardFixture
        }
      ];

      mockPool.query.mockResolvedValueOnce({ rows: [contestRow] });

      const result = await pgaEspnPollingOrchestrator.pollAndIngest(
        contestId,
        mockPool,
        workUnits
      );

      // Verify ingestionService was called with workUnits
      expect(ingestionService.run).toHaveBeenCalledWith(
        contestId,
        mockPool,
        workUnits
      );

      // Verify result
      expect(result.success).toBe(true);
      expect(result.eventId).toBe('401811941');
      expect(result.summary.processed).toBe(1);
      expect(result.summary.errors).toHaveLength(0);
    });
  });

  // ─── Error Cases ───────────────────────────────────────────────────────

  describe('Error Handling', () => {
    it('returns error when contest not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const workUnits = [
        {
          providerEventId: '401811941',
          providerData: leaderboardFixture
        }
      ];

      const result = await pgaEspnPollingOrchestrator.pollAndIngest(
        'nonexistent-contest',
        mockPool,
        workUnits
      );

      expect(result.success).toBe(false);
      expect(result.eventId).toBeNull();
      expect(result.summary.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('not found')
        ])
      );
      expect(ingestionService.run).not.toHaveBeenCalled();
    });

    it('returns error when template config missing provider_league_id', async () => {
      const contestRow = {
        id: 'test-contest',
        template_config: {
          season_year: 2026
          // Missing provider_league_id
        }
      };

      mockPool.query.mockResolvedValueOnce({ rows: [contestRow] });

      const workUnits = [
        {
          providerEventId: '401811941',
          providerData: leaderboardFixture
        }
      ];

      const result = await pgaEspnPollingOrchestrator.pollAndIngest(
        'test-contest',
        mockPool,
        workUnits
      );

      expect(result.success).toBe(false);
      expect(result.summary.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('provider_league_id or season_year')
        ])
      );
      expect(ingestionService.run).not.toHaveBeenCalled();
    });

    it('returns error when workUnits is missing', async () => {
      const contestRow = {
        id: 'test-contest',
        template_config: {
          provider_league_id: 1106,
          season_year: 2026,
          event_name: 'Masters',
          config: {}
        }
      };

      mockPool.query.mockResolvedValueOnce({ rows: [contestRow] });

      const result = await pgaEspnPollingOrchestrator.pollAndIngest(
        'test-contest',
        mockPool,
        undefined
      );

      expect(result.success).toBe(false);
      expect(result.eventId).toBeNull();
      expect(result.summary.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Missing or invalid workUnits')
        ])
      );
      expect(ingestionService.run).not.toHaveBeenCalled();
    });

    it('returns error when workUnits is empty array', async () => {
      const contestRow = {
        id: 'test-contest',
        template_config: {
          provider_league_id: 1106,
          season_year: 2026,
          event_name: 'Masters',
          config: {}
        }
      };

      mockPool.query.mockResolvedValueOnce({ rows: [contestRow] });

      const result = await pgaEspnPollingOrchestrator.pollAndIngest(
        'test-contest',
        mockPool,
        []
      );

      expect(result.success).toBe(false);
      expect(result.eventId).toBeNull();
      expect(result.summary.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Missing or invalid workUnits')
        ])
      );
      expect(ingestionService.run).not.toHaveBeenCalled();
    });

    it('returns error when workUnit is missing providerEventId', async () => {
      const contestRow = {
        id: 'test-contest',
        template_config: {
          provider_league_id: 1106,
          season_year: 2026,
          event_name: 'Masters',
          config: {}
        }
      };

      mockPool.query.mockResolvedValueOnce({ rows: [contestRow] });

      const workUnits = [
        {
          // Missing providerEventId
          providerData: leaderboardFixture
        }
      ];

      const result = await pgaEspnPollingOrchestrator.pollAndIngest(
        'test-contest',
        mockPool,
        workUnits
      );

      expect(result.success).toBe(false);
      expect(result.eventId).toBeNull();
      expect(result.summary.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('providerEventId')
        ])
      );
      expect(ingestionService.run).not.toHaveBeenCalled();
    });

    it('returns error when workUnit providerEventId is not a string', async () => {
      const contestRow = {
        id: 'test-contest',
        template_config: {
          provider_league_id: 1106,
          season_year: 2026,
          event_name: 'Masters',
          config: {}
        }
      };

      mockPool.query.mockResolvedValueOnce({ rows: [contestRow] });

      const workUnits = [
        {
          providerEventId: 12345,  // Not a string
          providerData: leaderboardFixture
        }
      ];

      const result = await pgaEspnPollingOrchestrator.pollAndIngest(
        'test-contest',
        mockPool,
        workUnits
      );

      expect(result.success).toBe(false);
      expect(result.eventId).toBeNull();
      expect(result.summary.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('providerEventId')
        ])
      );
      expect(ingestionService.run).not.toHaveBeenCalled();
    });

    it('returns error when workUnit is missing providerData', async () => {
      const contestRow = {
        id: 'test-contest',
        template_config: {
          provider_league_id: 1106,
          season_year: 2026,
          event_name: 'Masters',
          config: {}
        }
      };

      mockPool.query.mockResolvedValueOnce({ rows: [contestRow] });

      const workUnits = [
        {
          providerEventId: '401811941'
          // Missing providerData
        }
      ];

      const result = await pgaEspnPollingOrchestrator.pollAndIngest(
        'test-contest',
        mockPool,
        workUnits
      );

      expect(result.success).toBe(false);
      expect(result.eventId).toBeNull();
      expect(result.summary.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('providerData')
        ])
      );
      expect(ingestionService.run).not.toHaveBeenCalled();
    });

    it('returns error when workUnit providerData is not an object', async () => {
      const contestRow = {
        id: 'test-contest',
        template_config: {
          provider_league_id: 1106,
          season_year: 2026,
          event_name: 'Masters',
          config: {}
        }
      };

      mockPool.query.mockResolvedValueOnce({ rows: [contestRow] });

      const workUnits = [
        {
          providerEventId: '401811941',
          providerData: 'not an object'  // Not an object
        }
      ];

      const result = await pgaEspnPollingOrchestrator.pollAndIngest(
        'test-contest',
        mockPool,
        workUnits
      );

      expect(result.success).toBe(false);
      expect(result.eventId).toBeNull();
      expect(result.summary.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('providerData')
        ])
      );
      expect(ingestionService.run).not.toHaveBeenCalled();
    });

    it('returns error when ingestionService.run fails', async () => {
      const contestRow = {
        id: 'test-contest',
        template_config: {
          provider_league_id: 1106,
          season_year: 2026,
          event_name: 'Masters',
          config: {}
        }
      };

      mockPool.query.mockResolvedValueOnce({ rows: [contestRow] });
      ingestionService.run.mockRejectedValueOnce(
        new Error('Ingestion pipeline error')
      );

      const workUnits = [
        {
          providerEventId: '401811941',
          providerData: leaderboardFixture
        }
      ];

      const result = await pgaEspnPollingOrchestrator.pollAndIngest(
        'test-contest',
        mockPool,
        workUnits
      );

      expect(result.success).toBe(false);
      expect(result.eventId).toBe('401811941');
      expect(result.summary.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Ingestion failed')
        ])
      );
    });

    it('returns success=false when ingestionService reports errors', async () => {
      const contestRow = {
        id: 'test-contest',
        template_config: {
          provider_league_id: 1106,
          season_year: 2026,
          event_name: 'Masters',
          config: {}
        }
      };

      mockPool.query.mockResolvedValueOnce({ rows: [contestRow] });
      ingestionService.run.mockResolvedValueOnce({
        processed: 0,
        skipped: 0,
        errors: [{ workUnitKey: 'key1', error: 'Some error' }]
      });

      const workUnits = [
        {
          providerEventId: '401811941',
          providerData: leaderboardFixture
        }
      ];

      const result = await pgaEspnPollingOrchestrator.pollAndIngest(
        'test-contest',
        mockPool,
        workUnits
      );

      expect(result.success).toBe(false);
      expect(result.summary.errors).toHaveLength(1);
    });
  });

  // ─── Edge Cases ────────────────────────────────────────────────────────

  describe('Edge Cases', () => {
    it('throws if contestInstanceId is missing', async () => {
      const workUnits = [
        {
          providerEventId: '401811941',
          providerData: leaderboardFixture
        }
      ];

      await expect(
        pgaEspnPollingOrchestrator.pollAndIngest(null, mockPool, workUnits)
      ).rejects.toThrow('contestInstanceId and pool are required');
    });

    it('throws if pool is missing', async () => {
      const workUnits = [
        {
          providerEventId: '401811941',
          providerData: leaderboardFixture
        }
      ];

      await expect(
        pgaEspnPollingOrchestrator.pollAndIngest('test-contest', null, workUnits)
      ).rejects.toThrow('contestInstanceId and pool are required');
    });

    it('passes workUnits opaquely to ingestionService', async () => {
      const contestRow = {
        id: 'test-contest',
        template_config: {
          provider_league_id: 1106,
          season_year: 2026,
          event_name: 'Masters',
          config: {}
        }
      };

      mockPool.query.mockResolvedValueOnce({ rows: [contestRow] });

      const workUnits = [
        {
          providerEventId: '401811941',
          providerData: leaderboardFixture
        }
      ];

      await pgaEspnPollingOrchestrator.pollAndIngest(
        'test-contest',
        mockPool,
        workUnits
      );

      // Verify workUnits passed as-is
      const callArgs = ingestionService.run.mock.calls[0];
      expect(callArgs[0]).toBe('test-contest');
      expect(callArgs[1]).toBe(mockPool);
      expect(callArgs[2]).toEqual(workUnits);
    });

    it('extracts eventId from first workUnit', async () => {
      const contestRow = {
        id: 'test-contest',
        template_config: {
          provider_league_id: 1106,
          season_year: 2026,
          event_name: 'Masters',
          config: {}
        }
      };

      mockPool.query.mockResolvedValueOnce({ rows: [contestRow] });

      const workUnits = [
        {
          providerEventId: '401811941',
          providerData: leaderboardFixture
        },
        {
          providerEventId: '401823456',  // Second unit (ignored)
          providerData: {}
        }
      ];

      const result = await pgaEspnPollingOrchestrator.pollAndIngest(
        'test-contest',
        mockPool,
        workUnits
      );

      expect(result.eventId).toBe('401811941');  // First unit's eventId
    });
  });
});
