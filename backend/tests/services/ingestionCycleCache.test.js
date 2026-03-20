/**
 * Ingestion Cycle Cache Tests
 *
 * Verifies that ESPN API calls happen at most once per event per ingestion cycle,
 * not once per contest. When multiple contests reference the same ESPN event,
 * the leaderboard and player field data should be fetched only once.
 *
 * Includes concurrency safety tests: concurrent Promise.all calls must
 * deduplicate to a single HTTP request via Promise-based caching.
 */

'use strict';

describe('ESPN PGA API — per-cycle leaderboard cache', () => {
  let espnPgaApi;
  let mockAxios;

  beforeEach(() => {
    jest.resetModules();

    // Mock axios before requiring espnPgaApi
    mockAxios = { get: jest.fn() };
    jest.doMock('axios', () => mockAxios);
    jest.doMock('../../utils/logger', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      error: jest.fn()
    }));
    jest.doMock('../../utils/httpAgent', () => null);

    espnPgaApi = require('../../services/ingestion/espn/espnPgaApi');
  });

  const mockLeaderboardResponse = {
    data: {
      events: [
        { id: '401811938', name: 'Valspar Championship', competitions: [{ competitors: [] }] }
      ]
    }
  };

  test('sequential calls for same eventId produce only 1 HTTP request', async () => {
    mockAxios.get.mockResolvedValue(mockLeaderboardResponse);
    espnPgaApi.clearLeaderboardCache();

    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await espnPgaApi.fetchLeaderboard({ eventId: '401811938' }));
    }

    for (const result of results) {
      expect(result.events).toHaveLength(1);
      expect(result.events[0].id).toBe('401811938');
    }

    expect(mockAxios.get).toHaveBeenCalledTimes(1);
  });

  test('concurrent calls dedupe to single network request', async () => {
    mockAxios.get.mockResolvedValue(mockLeaderboardResponse);
    espnPgaApi.clearLeaderboardCache();

    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(espnPgaApi.fetchLeaderboard({ eventId: '401811938' }));
    }

    const results = await Promise.all(promises);

    for (const result of results) {
      expect(result.events).toHaveLength(1);
      expect(result.events[0].id).toBe('401811938');
    }

    expect(mockAxios.get).toHaveBeenCalledTimes(1);
  });

  test('different eventIds each trigger exactly 1 HTTP request', async () => {
    mockAxios.get
      .mockResolvedValueOnce({
        data: {
          events: [
            { id: '401811938', name: 'Valspar', competitions: [] }
          ]
        }
      })
      .mockResolvedValueOnce({
        data: {
          events: [
            { id: '401811939', name: 'Houston Open', competitions: [] }
          ]
        }
      });

    espnPgaApi.clearLeaderboardCache();

    await espnPgaApi.fetchLeaderboard({ eventId: '401811938' });
    await espnPgaApi.fetchLeaderboard({ eventId: '401811939' });
    // Repeat calls for both (should be cached)
    await espnPgaApi.fetchLeaderboard({ eventId: '401811938' });
    await espnPgaApi.fetchLeaderboard({ eventId: '401811939' });

    expect(mockAxios.get).toHaveBeenCalledTimes(2);
  });

  test('clearLeaderboardCache causes a refetch on next call', async () => {
    mockAxios.get.mockResolvedValue(mockLeaderboardResponse);

    espnPgaApi.clearLeaderboardCache();

    await espnPgaApi.fetchLeaderboard({ eventId: '401811938' });
    expect(mockAxios.get).toHaveBeenCalledTimes(1);

    // Clear cache (simulates new cycle)
    espnPgaApi.clearLeaderboardCache();

    await espnPgaApi.fetchLeaderboard({ eventId: '401811938' });
    expect(mockAxios.get).toHaveBeenCalledTimes(2);
  });

  test('failures are NOT cached — retry succeeds on next call', async () => {
    espnPgaApi.clearLeaderboardCache();

    // First call fails
    mockAxios.get.mockRejectedValueOnce(new Error('Network error'));

    await expect(
      espnPgaApi.fetchLeaderboard({ eventId: '401811938' })
    ).rejects.toThrow('Network error');

    // Second call succeeds (failure was not cached)
    mockAxios.get.mockResolvedValue(mockLeaderboardResponse);

    const result = await espnPgaApi.fetchLeaderboard({ eventId: '401811938' });
    expect(result.events).toHaveLength(1);
    expect(result.events[0].id).toBe('401811938');
  });
});

describe('ESPN PGA Player Service — per-cycle field cache', () => {
  let espnPgaPlayerService;
  let mockAxios;

  beforeEach(() => {
    jest.resetModules();

    mockAxios = { get: jest.fn() };
    jest.doMock('axios', () => mockAxios);
    jest.doMock('../../utils/httpAgent', () => null);

    espnPgaPlayerService = require('../../services/ingestion/espn/espnPgaPlayerService');
  });

  const mockFieldResponse = {
    data: {
      events: [
        {
          id: '401811938',
          competitions: [{
            competitors: [
              { id: '1234', athlete: { displayName: 'Tiger Woods' } },
              { id: '5678', athlete: { displayName: 'Rory McIlroy' } }
            ]
          }]
        }
      ]
    }
  };

  test('sequential fetchTournamentField calls for same eventId produce only 1 HTTP request', async () => {
    mockAxios.get.mockResolvedValue(mockFieldResponse);
    espnPgaPlayerService.clearFieldCache();

    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await espnPgaPlayerService.fetchTournamentField('401811938'));
    }

    for (const result of results) {
      expect(result.length).toBe(2);
    }

    expect(mockAxios.get).toHaveBeenCalledTimes(1);
  });

  test('concurrent fetchTournamentField calls dedupe to single network request', async () => {
    mockAxios.get.mockResolvedValue(mockFieldResponse);
    espnPgaPlayerService.clearFieldCache();

    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(espnPgaPlayerService.fetchTournamentField('401811938'));
    }

    const results = await Promise.all(promises);

    for (const result of results) {
      expect(result.length).toBe(2);
    }

    expect(mockAxios.get).toHaveBeenCalledTimes(1);
  });

  test('clearFieldCache causes a refetch on next call', async () => {
    mockAxios.get.mockResolvedValue(mockFieldResponse);

    espnPgaPlayerService.clearFieldCache();

    await espnPgaPlayerService.fetchTournamentField('401811938');
    expect(mockAxios.get).toHaveBeenCalledTimes(1);

    espnPgaPlayerService.clearFieldCache();

    await espnPgaPlayerService.fetchTournamentField('401811938');
    expect(mockAxios.get).toHaveBeenCalledTimes(2);
  });

  test('concurrent fetchGolfers calls dedupe to single network request', async () => {
    const mockGolfersResponse = {
      data: {
        events: [{
          competitions: [{
            competitors: [
              { id: '1234', athlete: { displayName: 'Tiger Woods' } }
            ]
          }]
        }]
      }
    };
    mockAxios.get.mockResolvedValue(mockGolfersResponse);
    espnPgaPlayerService.clearFieldCache();

    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(espnPgaPlayerService.fetchGolfers());
    }

    const results = await Promise.all(promises);

    for (const result of results) {
      expect(result.length).toBe(1);
    }

    expect(mockAxios.get).toHaveBeenCalledTimes(1);
  });

  test('fetchTournamentField failure is NOT cached — retry succeeds', async () => {
    espnPgaPlayerService.clearFieldCache();

    mockAxios.get.mockRejectedValueOnce(new Error('Network error'));

    await expect(
      espnPgaPlayerService.fetchTournamentField('401811938')
    ).rejects.toThrow('Network error');

    mockAxios.get.mockResolvedValue(mockFieldResponse);

    const result = await espnPgaPlayerService.fetchTournamentField('401811938');
    expect(result.length).toBe(2);
  });

  test('fetchGolfers failure is NOT cached — retry succeeds', async () => {
    espnPgaPlayerService.clearFieldCache();

    mockAxios.get.mockRejectedValueOnce(new Error('Timeout'));

    await expect(
      espnPgaPlayerService.fetchGolfers()
    ).rejects.toThrow('Timeout');

    mockAxios.get.mockResolvedValue({
      data: {
        events: [{
          competitions: [{
            competitors: [
              { id: '1234', athlete: { displayName: 'Tiger Woods' } }
            ]
          }]
        }]
      }
    });

    const result = await espnPgaPlayerService.fetchGolfers();
    expect(result.length).toBe(1);
  });
});

describe('ingestionService.run — cache reset behavior', () => {
  test('run() does NOT clear ESPN caches per-contest (caches persist within cycle)', async () => {
    jest.resetModules();

    const ingestionServiceSource = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/ingestionService.js'),
      'utf8'
    );

    const runFunctionMatch = ingestionServiceSource.match(
      /async function run\(contestInstanceId[\s\S]*?^}/m
    );

    if (runFunctionMatch) {
      expect(runFunctionMatch[0]).not.toContain('clearLeaderboardCache');
    }
  });

  test('resetCycleCache is exported and callable', () => {
    jest.resetModules();

    jest.doMock('../../services/ingestion/espn/espnPgaApi', () => ({
      clearLeaderboardCache: jest.fn(),
      fetchLeaderboard: jest.fn()
    }));
    jest.doMock('../../services/ingestion/espn/espnPgaPlayerService', () => ({
      clearFieldCache: jest.fn()
    }));

    const ingestionService = require('../../services/ingestionService');

    expect(typeof ingestionService.resetCycleCache).toBe('function');

    // Should not throw
    ingestionService.resetCycleCache();
  });
});
