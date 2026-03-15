/**
 * Regression test: pgaEspnIngestion.getWorkUnits() must generate SCORING unit
 *
 * Verifies that getWorkUnits() returns:
 * 1. PLAYER_POOL units (N)
 * 2. FIELD_BUILD unit (1)
 * 3. SCORING unit (1) ← THE FIX
 *
 * Without the SCORING unit, handleScoringIngestion() is never executed
 * and scores never populate golfer_event_scores.
 */

'use strict';

const pgaEspnIngestion = require('../../services/ingestion/strategies/pgaEspnIngestion');

// Mock espnPgaApi
jest.mock('../../services/ingestion/espn/espnPgaApi');
jest.mock('../../services/ingestion/espn/espnPgaPlayerService');

const espnPgaApi = require('../../services/ingestion/espn/espnPgaApi');
const espnPgaPlayerService = require('../../services/ingestion/espn/espnPgaPlayerService');

describe('pgaEspnIngestion.getWorkUnits()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('generates SCORING unit with leaderboard data', async () => {
    const contestInstanceId = 'test-contest-id';
    const providerEventId = 'espn_pga_401811935';
    const espnEventId = '401811935';

    // Mock player field fetch
    const mockGolfers = [
      {
        external_id: '12345',
        name: 'Test Golfer 1',
        sport: 'GOLF',
        position: 'G',
        image_url: 'https://example.com/image1.jpg'
      },
      {
        external_id: '12346',
        name: 'Test Golfer 2',
        sport: 'GOLF',
        position: 'G',
        image_url: 'https://example.com/image2.jpg'
      },
      // Add more to exceed minimum threshold of 10
      {
        external_id: '12347',
        name: 'Test Golfer 3',
        sport: 'GOLF',
        position: 'G'
      },
      {
        external_id: '12348',
        name: 'Test Golfer 4',
        sport: 'GOLF',
        position: 'G'
      },
      {
        external_id: '12349',
        name: 'Test Golfer 5',
        sport: 'GOLF',
        position: 'G'
      },
      {
        external_id: '12350',
        name: 'Test Golfer 6',
        sport: 'GOLF',
        position: 'G'
      },
      {
        external_id: '12351',
        name: 'Test Golfer 7',
        sport: 'GOLF',
        position: 'G'
      },
      {
        external_id: '12352',
        name: 'Test Golfer 8',
        sport: 'GOLF',
        position: 'G'
      },
      {
        external_id: '12353',
        name: 'Test Golfer 9',
        sport: 'GOLF',
        position: 'G'
      },
      {
        external_id: '12354',
        name: 'Test Golfer 10',
        sport: 'GOLF',
        position: 'G'
      }
    ];

    espnPgaPlayerService.fetchTournamentField.mockResolvedValue(mockGolfers);

    // Mock leaderboard fetch with realistic ESPN structure
    const mockLeaderboard = {
      events: [
        {
          id: espnEventId,
          status: { type: { name: 'STATUS_IN_PROGRESS' } },
          competitions: [
            {
              competitors: [
                {
                  id: '12345',
                  position: 1,
                  linescores: [
                    {
                      period: 1,
                      linescores: [
                        { period: 1, value: 4, par: 4 },
                        { period: 2, value: 5, par: 4 },
                        { period: 3, value: 3, par: 4 },
                        { period: 4, value: 4, par: 4 },
                        { period: 5, value: 4, par: 4 },
                        { period: 6, value: 4, par: 4 },
                        { period: 7, value: 4, par: 4 },
                        { period: 8, value: 4, par: 4 },
                        { period: 9, value: 4, par: 4 },
                        { period: 10, value: 4, par: 4 },
                        { period: 11, value: 4, par: 4 },
                        { period: 12, value: 4, par: 4 },
                        { period: 13, value: 4, par: 4 },
                        { period: 14, value: 4, par: 4 },
                        { period: 15, value: 4, par: 4 },
                        { period: 16, value: 4, par: 4 },
                        { period: 17, value: 4, par: 4 },
                        { period: 18, value: 4, par: 4 }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };

    espnPgaApi.fetchLeaderboard.mockResolvedValue(mockLeaderboard);

    // Call getWorkUnits
    const ctx = {
      contestInstanceId,
      providerEventId
    };

    const units = await pgaEspnIngestion.getWorkUnits(ctx);

    // ASSERTION 1: Units array is not empty
    expect(units).toBeDefined();
    expect(Array.isArray(units)).toBe(true);
    expect(units.length).toBeGreaterThan(0);

    // ASSERTION 2: At least one unit has phase === 'SCORING'
    const scoringUnits = units.filter(u => u.phase === 'SCORING');
    expect(scoringUnits.length).toBeGreaterThanOrEqual(1);

    // ASSERTION 3: SCORING unit has required fields
    const scoringUnit = scoringUnits[0];
    expect(scoringUnit).toBeDefined();
    expect(scoringUnit.phase).toBe('SCORING');
    expect(scoringUnit.providerEventId).toBe(providerEventId);
    expect(scoringUnit.providerData).toBeDefined();
    expect(typeof scoringUnit.providerData).toBe('object');

    // ASSERTION 4: SCORING unit providerData has ESPN structure
    expect(scoringUnit.providerData.events).toBeDefined();
    expect(Array.isArray(scoringUnit.providerData.events)).toBe(true);

    // ASSERTION 5: Verify expected unit structure
    // PLAYER_POOL units + FIELD_BUILD unit + SCORING unit
    const playerPoolUnits = units.filter(u => !u.phase); // PLAYER_POOL units don't have phase
    const fieldBuildUnits = units.filter(u => u.phase === 'FIELD_BUILD');

    expect(playerPoolUnits.length).toBe(mockGolfers.length);
    expect(fieldBuildUnits.length).toBe(1);
    expect(scoringUnits.length).toBe(1);
  });

  test('returns empty array if contestInstanceId is missing', async () => {
    const ctx = {
      providerEventId: 'espn_pga_401811935'
    };

    const units = await pgaEspnIngestion.getWorkUnits(ctx);

    expect(Array.isArray(units)).toBe(true);
    expect(units.length).toBe(0);
  });

  test('returns empty array if providerEventId is missing', async () => {
    const ctx = {
      contestInstanceId: 'test-contest-id'
    };

    const units = await pgaEspnIngestion.getWorkUnits(ctx);

    expect(Array.isArray(units)).toBe(true);
    expect(units.length).toBe(0);
  });

  test('throws when ESPN leaderboard fetch fails (SCORING is critical)', async () => {
    const contestInstanceId = 'test-contest-id';
    const providerEventId = 'espn_pga_401811935';

    // Mock player field fetch success
    const mockGolfers = Array.from({ length: 10 }, (_, i) => ({
      external_id: String(12345 + i),
      name: `Test Golfer ${i + 1}`,
      sport: 'GOLF',
      position: 'G'
    }));

    espnPgaPlayerService.fetchTournamentField.mockResolvedValue(mockGolfers);

    // Mock leaderboard fetch failure
    espnPgaApi.fetchLeaderboard.mockRejectedValue(
      new Error('ESPN API unavailable')
    );

    const ctx = {
      contestInstanceId,
      providerEventId
    };

    // Should throw because fetchLeaderboard fails (SCORING unit is critical)
    // Without SCORING unit, scores never populate and contests cannot progress
    await expect(pgaEspnIngestion.getWorkUnits(ctx)).rejects.toThrow('ESPN API unavailable');
  });

  test('multiple contests sharing provider_event_id trigger only one ESPN leaderboard fetch', async () => {
    const providerEventId = 'espn_pga_401811937';
    const espnEventId = '401811937';

    // Mock golfers
    const mockGolfers = Array.from({ length: 10 }, (_, i) => ({
      external_id: String(20000 + i),
      name: `Golfer ${i + 1}`,
      sport: 'GOLF',
      position: 'G'
    }));

    espnPgaPlayerService.fetchTournamentField.mockResolvedValue(mockGolfers);

    // Mock leaderboard (ESPN response structure)
    const mockLeaderboard = {
      events: [
        {
          id: espnEventId,
          status: { type: { name: 'STATUS_IN_PROGRESS' } },
          competitions: [
            {
              competitors: [
                {
                  id: '20000',
                  position: 1,
                  linescores: [{ period: 1, linescores: Array(18).fill({ value: 4, par: 4 }) }]
                }
              ]
            }
          ]
        }
      ]
    };

    espnPgaApi.fetchLeaderboard.mockResolvedValue(mockLeaderboard);

    // Use SAME ctx object to simulate a single ingestion cycle
    // Cache is stored in ctx.__eventCache and reused across calls
    const ctx = { contestInstanceId: 'contest-1', providerEventId };

    // Reset mock call count
    espnPgaApi.fetchLeaderboard.mockClear();

    // Call getWorkUnits first time (should fetch from ESPN)
    const units1 = await pgaEspnIngestion.getWorkUnits(ctx);
    expect(units1.length).toBeGreaterThan(0);
    expect(espnPgaApi.fetchLeaderboard).toHaveBeenCalledTimes(1);

    // Call getWorkUnits second time with SAME ctx (should hit cache, no additional fetch)
    // This simulates a second contest in the same cycle sharing the event
    const units2 = await pgaEspnIngestion.getWorkUnits(ctx);
    expect(units2.length).toBeGreaterThan(0);
    expect(espnPgaApi.fetchLeaderboard).toHaveBeenCalledTimes(1); // Still 1, cache was hit
  });
});
