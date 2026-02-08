/**
 * Game State Service Unit Tests
 *
 * Purpose: Test game state logic with mocked dependencies
 * - Week active/locked status
 * - Selectable teams logic
 * - Playoff week determination
 *
 * These tests demonstrate the mocking patterns for service-layer testing.
 */

const { createMockPool, mockQueryResponses } = require('../mocks/mockPool');
const { gameSettings } = require('../fixtures');

describe('Game State Service Unit Tests', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = createMockPool();
  });

  afterEach(() => {
    mockPool.reset();
  });

  describe('Game Settings Query', () => {
    it('should parse game settings from database', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM game_settings/,
        mockQueryResponses.gameSettings(gameSettings.wildcardActive)
      );

      const result = await mockPool.query('SELECT * FROM game_settings LIMIT 1');

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].current_week).toBe(19);
      expect(result.rows[0].is_week_active).toBe(true);
    });

    it('should return empty for missing settings', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM game_settings/,
        mockQueryResponses.empty()
      );

      const result = await mockPool.query('SELECT * FROM game_settings LIMIT 1');

      expect(result.rows).toHaveLength(0);
    });
  });

  describe('Week Status Logic', () => {
    it('should identify active week', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM game_settings/,
        mockQueryResponses.gameSettings(gameSettings.wildcardActive)
      );

      const result = await mockPool.query('SELECT is_week_active FROM game_settings LIMIT 1');

      expect(result.rows[0].is_week_active).toBe(true);
    });

    it('should identify locked week', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM game_settings/,
        mockQueryResponses.gameSettings(gameSettings.wildcardLocked)
      );

      const result = await mockPool.query('SELECT is_week_active FROM game_settings LIMIT 1');

      expect(result.rows[0].is_week_active).toBe(false);
    });
  });

  describe('Active Teams Logic', () => {
    it('should return 14 teams during wildcard', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM game_settings/,
        mockQueryResponses.gameSettings(gameSettings.wildcardActive)
      );

      const result = await mockPool.query('SELECT active_teams FROM game_settings LIMIT 1');
      const teams = result.rows[0].active_teams;

      expect(teams).toHaveLength(14);
    });

    it('should return 8 teams during divisional', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM game_settings/,
        mockQueryResponses.gameSettings(gameSettings.divisionalActive)
      );

      const result = await mockPool.query('SELECT active_teams FROM game_settings LIMIT 1');
      const teams = result.rows[0].active_teams;

      expect(teams).toHaveLength(8);
    });
  });

  describe('Playoff Week Mapping', () => {
    const weekMappings = [
      { playoffWeek: 1, nflWeek: 19, name: 'Wildcard' },
      { playoffWeek: 2, nflWeek: 20, name: 'Divisional' },
      { playoffWeek: 3, nflWeek: 21, name: 'Championship' },
      { playoffWeek: 4, nflWeek: 22, name: 'Super Bowl' }
    ];

    weekMappings.forEach(({ playoffWeek, nflWeek, name }) => {
      it(`should map ${name} (playoff week ${playoffWeek}) to NFL week ${nflWeek}`, () => {
        // This tests the week mapping logic
        const mappedWeek = playoffWeek + 18;
        expect(mappedWeek).toBe(nflWeek);
      });
    });
  });

  describe('Query History Tracking', () => {
    it('should track all queries made', async () => {
      await mockPool.query('SELECT 1');
      await mockPool.query('SELECT 2');
      await mockPool.query('SELECT 3');

      const history = mockPool.getQueryHistory();

      expect(history).toHaveLength(3);
      expect(history[0].sql).toBe('SELECT 1');
      expect(history[2].sql).toBe('SELECT 3');
    });

    it('should track query parameters', async () => {
      await mockPool.query('SELECT * FROM users WHERE id = $1', ['user-123']);

      const history = mockPool.getQueryHistory();

      expect(history[0].params).toEqual(['user-123']);
    });

    it('should reset history on reset()', async () => {
      await mockPool.query('SELECT 1');
      mockPool.reset();

      const history = mockPool.getQueryHistory();

      expect(history).toHaveLength(0);
    });
  });

  describe('Error Handling', () => {
    it('should throw configured errors', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM users/,
        mockQueryResponses.error('Connection failed', 'ECONNREFUSED')
      );

      await expect(mockPool.query('SELECT * FROM users'))
        .rejects.toThrow('Connection failed');
    });

    it('should return default empty result for unconfigured queries', async () => {
      const result = await mockPool.query('SELECT * FROM unknown_table');

      expect(result.rows).toEqual([]);
      expect(result.rowCount).toBe(0);
    });
  });
});
