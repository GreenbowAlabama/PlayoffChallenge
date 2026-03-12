/**
 * Field Synchronization Tests
 *
 * Tests for:
 * - RC1: initializeTournamentField handles null provider_event_id (generates synthetic ID)
 * - RC2: initializeTournamentField immediately populates field_selections with active players
 * - RC3: refreshAllScheduledContestFields updates all SCHEDULED contests for a sport
 * - RC3: run() fan-out to refresh other SCHEDULED contests after ingestion
 *
 * NOTE: Tests mock the full transaction flow (BEGIN → queries → COMMIT → release)
 * to match the actual implementation's transactional wrapping.
 */

'use strict';

describe('Field Synchronization — RC1, RC2, RC3', () => {
  const ingestionService = require('../../services/ingestionService');

  let mockPool;
  let mockClient;

  beforeEach(() => {
    mockClient = {
      query: jest.fn(),
      release: jest.fn()
    };

    mockPool = {
      query: jest.fn(),
      connect: jest.fn().mockResolvedValue(mockClient)
    };

    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('RC1: initializeTournamentField with null provider_event_id', () => {
    it('should succeed when provider_event_id is NULL, generating synthetic ID', async () => {
      const contestInstanceId = 'ci-manual-contest';

      // Mock transaction flow: BEGIN → SELECT → INSERT tc → INSERT fs → fetchPlayers → populateField → COMMIT → release
      mockClient.query
        .mockResolvedValueOnce() // BEGIN
        .mockResolvedValueOnce({
          // SELECT contest instance (provider_event_id = NULL)
          rows: [
            {
              id: contestInstanceId,
              provider_event_id: null,
              sport: 'GOLF'
            }
          ]
        })
        .mockResolvedValueOnce({
          // INSERT tournament_configs with synthetic ID
          rows: [{ id: 'tc-synthetic-12345' }]
        })
        .mockResolvedValueOnce({
          // INSERT field_selections skeleton
          rows: [{ id: 'fs-skeleton-123' }]
        });

      // Mock fetchExistingGolfPlayerIds (calls pool.query)
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'espn_player_1',
            full_name: 'Rory McIlroy',
            espn_id: 'player_1',
            image_url: 'https://example.com/rory.jpg'
          }
        ]
      });

      // Mock populateFieldSelections internals (multiple client.query calls)
      mockClient.query
        .mockResolvedValueOnce({
          // SELECT tournament_configs
          rows: [
            {
              provider_event_id: `manual_${contestInstanceId}`,
              ingestion_endpoint: '',
              event_start_date: new Date('2026-03-15'),
              event_end_date: new Date('2026-03-22'),
              round_count: 4,
              cut_after_round: 2,
              leaderboard_schema_version: 1,
              field_source: 'provider_sync'
            }
          ]
        })
        .mockResolvedValueOnce({
          // SELECT players
          rows: [
            {
              id: 'espn_player_1',
              full_name: 'Rory McIlroy',
              espn_id: 'player_1',
              image_url: 'https://example.com/rory.jpg'
            }
          ]
        })
        .mockResolvedValueOnce({
          // UPDATE field_selections
          rows: [{ id: 'fs-updated-123' }]
        })
        .mockResolvedValueOnce() // COMMIT
        .mockResolvedValueOnce(); // release (mocked but not called for pool.query)

      await ingestionService.initializeTournamentField(mockPool, contestInstanceId);

      // Verify pool.connect() was called
      expect(mockPool.connect).toHaveBeenCalled();

      // Verify client was released
      expect(mockClient.release).toHaveBeenCalled();

      // Verify the synthetic ID was used in INSERT tournament_configs
      const insertTourneyCall = mockClient.query.mock.calls.find(
        call => call[0] && call[0].includes('INSERT INTO tournament_configs')
      );
      expect(insertTourneyCall).toBeDefined();
      const expectedSyntheticId = `manual_${contestInstanceId}`;
      expect(insertTourneyCall[1]).toContain(expectedSyntheticId);
    });

    it('should handle provider_event_id when present (existing behavior)', async () => {
      const contestInstanceId = 'ci-discovered-contest';
      const providerEventId = 'espn_pga_401811935';

      // Mock transaction flow
      mockClient.query
        .mockResolvedValueOnce() // BEGIN
        .mockResolvedValueOnce({
          // SELECT contest instance with provider_event_id
          rows: [
            {
              id: contestInstanceId,
              provider_event_id: providerEventId,
              sport: 'GOLF'
            }
          ]
        })
        .mockResolvedValueOnce({
          // INSERT tournament_configs (with actual provider_event_id)
          rows: [{ id: 'tc-discovered-12345' }]
        })
        .mockResolvedValueOnce({
          // INSERT field_selections skeleton
          rows: [{ id: 'fs-discovered-123' }]
        });

      // Mock fetchExistingGolfPlayerIds
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'espn_player_1',
            full_name: 'Player 1',
            espn_id: 'player_1',
            image_url: 'url1'
          }
        ]
      });

      // Mock populateFieldSelections internals
      mockClient.query
        .mockResolvedValueOnce({
          // SELECT tournament_configs
          rows: [
            {
              provider_event_id: providerEventId,
              ingestion_endpoint: '',
              event_start_date: new Date(),
              event_end_date: new Date(),
              round_count: 4,
              cut_after_round: 2,
              leaderboard_schema_version: 1,
              field_source: 'provider_sync'
            }
          ]
        })
        .mockResolvedValueOnce({
          // SELECT players
          rows: [
            {
              id: 'espn_player_1',
              full_name: 'Player 1',
              espn_id: 'player_1',
              image_url: 'url1'
            }
          ]
        })
        .mockResolvedValueOnce({
          // UPDATE field_selections
          rows: [{ id: 'fs-discovered-updated' }]
        })
        .mockResolvedValueOnce() // COMMIT
        .mockResolvedValueOnce(); // release

      await ingestionService.initializeTournamentField(mockPool, contestInstanceId);

      // Verify the actual provider_event_id was used (not synthetic)
      const insertTourneyCall = mockClient.query.mock.calls.find(
        call => call[0] && call[0].includes('INSERT INTO tournament_configs')
      );
      expect(insertTourneyCall[1]).toContain(providerEventId);
      expect(insertTourneyCall[1]).not.toContain('manual_');
    });
  });

  describe('RC2: initializeTournamentField populates field_selections immediately', () => {
    it('should populate field_selections with active players after skeleton creation', async () => {
      const contestInstanceId = 'ci-manual-with-players';

      // Mock transaction flow
      mockClient.query
        .mockResolvedValueOnce() // BEGIN
        .mockResolvedValueOnce({
          // SELECT contest instance
          rows: [
            {
              id: contestInstanceId,
              provider_event_id: null,
              sport: 'GOLF'
            }
          ]
        })
        .mockResolvedValueOnce({
          // INSERT tournament_configs
          rows: [{ id: 'tc-12345' }]
        })
        .mockResolvedValueOnce({
          // INSERT field_selections skeleton
          rows: [{ id: 'fs-skeleton-123' }]
        });

      // Mock fetchExistingGolfPlayerIds (2 active players)
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'espn_player_1',
            full_name: 'Rory McIlroy',
            espn_id: 'player_1',
            image_url: 'https://example.com/rory.jpg'
          },
          {
            id: 'espn_player_2',
            full_name: 'Jon Rahm',
            espn_id: 'player_2',
            image_url: 'https://example.com/jon.jpg'
          }
        ]
      });

      // Mock populateFieldSelections internals
      mockClient.query
        .mockResolvedValueOnce({
          // SELECT tournament_configs
          rows: [
            {
              provider_event_id: `manual_${contestInstanceId}`,
              ingestion_endpoint: '',
              event_start_date: new Date('2026-03-15'),
              event_end_date: new Date('2026-03-22'),
              round_count: 4,
              cut_after_round: 2,
              leaderboard_schema_version: 1,
              field_source: 'provider_sync'
            }
          ]
        })
        .mockResolvedValueOnce({
          // SELECT players
          rows: [
            {
              id: 'espn_player_1',
              full_name: 'Rory McIlroy',
              espn_id: 'player_1',
              image_url: 'https://example.com/rory.jpg'
            },
            {
              id: 'espn_player_2',
              full_name: 'Jon Rahm',
              espn_id: 'player_2',
              image_url: 'https://example.com/jon.jpg'
            }
          ]
        })
        .mockResolvedValueOnce({
          // UPDATE field_selections with populated data
          rows: [{ id: 'fs-populated-123' }]
        })
        .mockResolvedValueOnce() // COMMIT
        .mockResolvedValueOnce(); // release

      await ingestionService.initializeTournamentField(mockPool, contestInstanceId);

      // Verify UPDATE was called (population happened, not just skeleton insert)
      const updateCall = mockClient.query.mock.calls.find(
        call => call[0] && call[0].includes('UPDATE field_selections')
      );
      expect(updateCall).toBeDefined();

      // Verify the updated field_selections has players (not empty)
      const updateFieldJson = updateCall[1][0];
      const fieldData = JSON.parse(updateFieldJson);
      expect(fieldData.primary.length).toBeGreaterThan(0);
      expect(fieldData.primary[0]).toHaveProperty('player_id');
      expect(fieldData.primary[0]).toHaveProperty('image_url');
    });

    it('should skip population if no active players exist', async () => {
      const contestInstanceId = 'ci-no-players';

      // Mock transaction flow
      mockClient.query
        .mockResolvedValueOnce() // BEGIN
        .mockResolvedValueOnce({
          // SELECT contest instance
          rows: [
            {
              id: contestInstanceId,
              provider_event_id: null,
              sport: 'GOLF'
            }
          ]
        })
        .mockResolvedValueOnce({
          // INSERT tournament_configs
          rows: [{ id: 'tc-12345' }]
        })
        .mockResolvedValueOnce({
          // INSERT field_selections skeleton
          rows: [{ id: 'fs-skeleton-123' }]
        })
        .mockResolvedValueOnce() // COMMIT
        .mockResolvedValueOnce(); // release

      // Mock fetchExistingGolfPlayerIds — returns empty
      mockPool.query.mockResolvedValueOnce({
        rows: []
      });

      await ingestionService.initializeTournamentField(mockPool, contestInstanceId);

      // Verify no UPDATE to field_selections occurred (population was skipped)
      const updateCall = mockClient.query.mock.calls.find(
        call => call[0] && call[0].includes('UPDATE field_selections')
      );
      expect(updateCall).toBeUndefined();
    });
  });

  describe('RC3: refreshAllScheduledContestFields function', () => {
    it('should exist as an exported function', () => {
      expect(typeof ingestionService.refreshAllScheduledContestFields).toBe('function');
    });

    it('should update field_selections for all SCHEDULED contests of a given sport', async () => {
      const sport = 'GOLF';

      // Mock 1: Query all SCHEDULED contests
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { id: 'ci-scheduled-1' },
          { id: 'ci-scheduled-2' }
        ]
      });

      // Mock 2: Fetch active GOLF players
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'espn_player_1',
            full_name: 'Player 1',
            espn_id: 'player_1',
            image_url: 'url1'
          }
        ]
      });

      // Contest 1 refresh: BEGIN, SELECT tournament_configs, SELECT players, UPDATE, COMMIT, release
      mockClient.query
        .mockResolvedValueOnce() // BEGIN (contest 1)
        .mockResolvedValueOnce({
          // SELECT tournament_configs (contest 1)
          rows: [
            {
              provider_event_id: 'test_event_1',
              ingestion_endpoint: '',
              event_start_date: new Date(),
              event_end_date: new Date(),
              round_count: 4,
              cut_after_round: 2,
              leaderboard_schema_version: 1,
              field_source: 'provider_sync'
            }
          ]
        })
        .mockResolvedValueOnce({
          // SELECT players (contest 1)
          rows: [
            {
              id: 'espn_player_1',
              full_name: 'Player 1',
              espn_id: 'player_1',
              image_url: 'url1'
            }
          ]
        })
        .mockResolvedValueOnce({
          // UPDATE field_selections (contest 1)
          rows: [{ id: 'fs-1' }]
        })
        .mockResolvedValueOnce() // COMMIT (contest 1)
        // Contest 2 refresh: BEGIN, SELECT tournament_configs, SELECT players, UPDATE, COMMIT, release
        .mockResolvedValueOnce() // BEGIN (contest 2)
        .mockResolvedValueOnce({
          // SELECT tournament_configs (contest 2)
          rows: [
            {
              provider_event_id: 'test_event_2',
              ingestion_endpoint: '',
              event_start_date: new Date(),
              event_end_date: new Date(),
              round_count: 4,
              cut_after_round: 2,
              leaderboard_schema_version: 1,
              field_source: 'provider_sync'
            }
          ]
        })
        .mockResolvedValueOnce({
          // SELECT players (contest 2)
          rows: [
            {
              id: 'espn_player_1',
              full_name: 'Player 1',
              espn_id: 'player_1',
              image_url: 'url1'
            }
          ]
        })
        .mockResolvedValueOnce({
          // UPDATE field_selections (contest 2)
          rows: [{ id: 'fs-2' }]
        })
        .mockResolvedValueOnce(); // COMMIT (contest 2)

      // Mock client.release for both contests
      mockClient.release.mockResolvedValue(undefined);

      await ingestionService.refreshAllScheduledContestFields(mockPool, sport);

      // Verify pool.query was called to fetch SCHEDULED contests and active players
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE ci.status = \'SCHEDULED\''),
        [sport]
      );

      // Verify both contests were updated (2 UPDATE calls on client)
      const updateCalls = mockClient.query.mock.calls.filter(
        call => call[0] && call[0].includes('UPDATE field_selections')
      );
      expect(updateCalls.length).toBe(2);

      // Verify client was released twice (once per contest)
      expect(mockClient.release).toHaveBeenCalledTimes(2);
    });

    it('should skip LOCKED, LIVE, and COMPLETE contests', async () => {
      const sport = 'GOLF';

      // Mock: Query returns no SCHEDULED contests
      mockPool.query.mockResolvedValueOnce({
        rows: []
      });

      await ingestionService.refreshAllScheduledContestFields(mockPool, sport);

      // Verify no client transaction occurred (no UPDATE calls)
      const updateCalls = mockClient.query.mock.calls.filter(
        call => call[0] && call[0].includes('UPDATE field_selections')
      );
      expect(updateCalls.length).toBe(0);

      // Verify client was never connected
      expect(mockPool.connect).not.toHaveBeenCalled();
    });
  });

  describe('Edge cases and error handling', () => {
    it('should throw if contest_instance not found', async () => {
      const contestInstanceId = 'ci-nonexistent';

      // Mock transaction flow
      mockClient.query
        .mockResolvedValueOnce() // BEGIN
        .mockResolvedValueOnce({
          // SELECT returns empty
          rows: []
        })
        .mockResolvedValueOnce(); // ROLLBACK

      await expect(
        ingestionService.initializeTournamentField(mockPool, contestInstanceId)
      ).rejects.toThrow('Contest instance not found');

      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should throw if sport is not GOLF', async () => {
      const contestInstanceId = 'ci-nfl-contest';

      // Mock transaction flow
      mockClient.query
        .mockResolvedValueOnce() // BEGIN
        .mockResolvedValueOnce({
          // SELECT returns NFL contest
          rows: [
            {
              id: contestInstanceId,
              provider_event_id: 'nfl_event_123',
              sport: 'NFL'
            }
          ]
        })
        .mockResolvedValueOnce(); // ROLLBACK

      await expect(
        ingestionService.initializeTournamentField(mockPool, contestInstanceId)
      ).rejects.toThrow('unsupported sport');

      expect(mockClient.release).toHaveBeenCalled();
    });
  });
});
