/**
 * Integration tests for pgaEspnPollingOrchestrator.pollAndIngest
 *
 * Tests the full polling flow: load contest → fetch calendar → select event →
 * fetch leaderboard → validate → build units → call ingestionService.run()
 *
 * Uses mocked ESPN API to avoid external calls.
 */

'use strict';

const pgaEspnPollingOrchestrator = require('../../services/ingestion/orchestrators/pgaEspnPollingOrchestrator');

// Mock ESPN API module
jest.mock('../../services/ingestion/espn/espnPgaApi');
const espnPgaApi = require('../../services/ingestion/espn/espnPgaApi');

// Mock ingestionService
jest.mock('../../services/ingestionService');
const ingestionService = require('../../services/ingestionService');

// Fixtures
const calendarFixture = require('../fixtures/espn-pga-calendar-2026.json');
const leaderboardFixture = require('../fixtures/espn-pga-leaderboard-complete.json');
const malformedLeaderboardFixture = require('../fixtures/espn-pga-leaderboard-malformed.json');

describe('pgaEspnPollingOrchestrator.pollAndIngest', () => {
  // ─── Setup ─────────────────────────────────────────────────────────────

  let mockPool;

  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock behavior
    espnPgaApi.fetchCalendar.mockResolvedValue(calendarFixture);
    espnPgaApi.fetchLeaderboard.mockResolvedValue(leaderboardFixture);
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
    it('successfully polls calendar, selects event, fetches leaderboard, and calls ingestionService', async () => {
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

      mockPool.query.mockResolvedValueOnce({ rows: [contestRow] });

      const result = await pgaEspnPollingOrchestrator.pollAndIngest(
        contestId,
        mockPool
      );

      // Verify ESPN API calls
      expect(espnPgaApi.fetchCalendar).toHaveBeenCalledWith({
        leagueId: 1106,
        seasonYear: 2026,
        timeout: 5000
      });

      expect(espnPgaApi.fetchLeaderboard).toHaveBeenCalledWith({
        eventId: '401811941',
        timeout: 5000
      });

      // Verify ingestionService was called with workUnits
      expect(ingestionService.run).toHaveBeenCalledWith(
        contestId,
        mockPool,
        expect.arrayContaining([
          expect.objectContaining({
            providerEventId: '401811941',
            providerData: expect.any(Object)
          })
        ])
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

      const result = await pgaEspnPollingOrchestrator.pollAndIngest(
        'nonexistent-contest',
        mockPool
      );

      expect(result.success).toBe(false);
      expect(result.eventId).toBeNull();
      expect(result.summary.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('not found')
        ])
      );
      expect(espnPgaApi.fetchCalendar).not.toHaveBeenCalled();
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

      const result = await pgaEspnPollingOrchestrator.pollAndIngest(
        'test-contest',
        mockPool
      );

      expect(result.success).toBe(false);
      expect(result.summary.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('provider_league_id or season_year')
        ])
      );
      expect(espnPgaApi.fetchCalendar).not.toHaveBeenCalled();
    });

    it('returns error when ESPN calendar fetch fails', async () => {
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
      espnPgaApi.fetchCalendar.mockRejectedValueOnce(
        new Error('Network timeout')
      );

      const result = await pgaEspnPollingOrchestrator.pollAndIngest(
        'test-contest',
        mockPool
      );

      expect(result.success).toBe(false);
      expect(result.summary.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('calendar fetch failed')
        ])
      );
      expect(espnPgaApi.fetchLeaderboard).not.toHaveBeenCalled();
    });

    it('returns error when event selection fails (no match)', async () => {
      const contestRow = {
        id: 'test-contest',
        template_config: {
          provider_league_id: 1106,
          season_year: 2026,
          event_name: 'Nonexistent Event',
          config: {}
        }
      };

      mockPool.query.mockResolvedValueOnce({ rows: [contestRow] });

      const result = await pgaEspnPollingOrchestrator.pollAndIngest(
        'test-contest',
        mockPool
      );

      expect(result.success).toBe(false);
      expect(result.eventId).toBeNull();
      expect(result.summary.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('No event selected')
        ])
      );
      expect(espnPgaApi.fetchLeaderboard).not.toHaveBeenCalled();
    });

    it('returns error when ESPN leaderboard fetch fails', async () => {
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
      espnPgaApi.fetchLeaderboard.mockRejectedValueOnce(
        new Error('Event not found')
      );

      const result = await pgaEspnPollingOrchestrator.pollAndIngest(
        'test-contest',
        mockPool
      );

      expect(result.success).toBe(false);
      expect(result.eventId).toBe('401811941');
      expect(result.summary.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('leaderboard fetch failed')
        ])
      );
      expect(ingestionService.run).not.toHaveBeenCalled();
    });

    it('returns error when leaderboard payload is malformed', async () => {
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
      espnPgaApi.fetchLeaderboard.mockResolvedValueOnce(
        malformedLeaderboardFixture
      );

      const result = await pgaEspnPollingOrchestrator.pollAndIngest(
        'test-contest',
        mockPool
      );

      expect(result.success).toBe(false);
      expect(result.summary.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Malformed ESPN payload')
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

      const result = await pgaEspnPollingOrchestrator.pollAndIngest(
        'test-contest',
        mockPool
      );

      expect(result.success).toBe(false);
      expect(result.summary.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Ingestion failed')
        ])
      );
    });
  });

  // ─── Edge Cases ────────────────────────────────────────────────────────

  describe('Edge Cases', () => {
    it('passes opaque workUnits to ingestionService (no parsing)', async () => {
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

      await pgaEspnPollingOrchestrator.pollAndIngest(
        'test-contest',
        mockPool
      );

      // Verify workUnits are passed as-is (opaque)
      const callArgs = ingestionService.run.mock.calls[0];
      const passedUnits = callArgs[2];

      expect(passedUnits).toEqual([
        {
          providerEventId: '401811941',
          providerData: leaderboardFixture
        }
      ]);

      // Verify service doesn't receive ESPN-specific data beyond workUnits
      expect(callArgs.length).toBe(3); // contestId, pool, workUnits only
    });

    it('uses config.event_id override if provided', async () => {
      const contestRow = {
        id: 'test-contest',
        template_config: {
          provider_league_id: 1106,
          season_year: 2026,
          event_name: 'Masters',
          config: {
            event_id: '401823456' // Override: PGA Championship
          }
        }
      };

      mockPool.query.mockResolvedValueOnce({ rows: [contestRow] });

      await pgaEspnPollingOrchestrator.pollAndIngest(
        'test-contest',
        mockPool
      );

      // Verify leaderboard was fetched for override event
      expect(espnPgaApi.fetchLeaderboard).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: '401823456'
        })
      );
    });

    it('throws if contestInstanceId is missing', async () => {
      await expect(
        pgaEspnPollingOrchestrator.pollAndIngest(null, mockPool)
      ).rejects.toThrow('contestInstanceId and pool are required');
    });

    it('throws if pool is missing', async () => {
      await expect(
        pgaEspnPollingOrchestrator.pollAndIngest('test-contest', null)
      ).rejects.toThrow('contestInstanceId and pool are required');
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

      const result = await pgaEspnPollingOrchestrator.pollAndIngest(
        'test-contest',
        mockPool
      );

      expect(result.success).toBe(false);
      expect(result.summary.errors).toHaveLength(1);
    });
  });
});
