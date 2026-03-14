/**
 * Player Pool Fallback Tests (Lazy field_selections Creation)
 *
 * Verify that getMyEntry() returns players even when field_selections
 * is missing, by lazily creating it only when tournament_configs exists.
 *
 * Root cause: publishContestInstance() calls ensureFieldSelectionsForGolf()
 * before discovery creates tournament_configs. This test verifies the fix:
 * lazy creation of field_selections when it's needed.
 */

const entryRosterService = require('../../services/entryRosterService');
const { createMockPool, mockQueryResponses } = require('../mocks/mockPool');

describe('Player Pool Fallback (Lazy field_selections Creation)', () => {
  let mockPool;
  const contestInstanceId = '11111111-1111-1111-1111-111111111111';
  const userId = '22222222-2222-2222-2222-222222222222';
  const tournamentConfigId = '33333333-3333-3333-3333-333333333333';

  const mockPlayers = [
    { id: 'espn_1', full_name: 'Tiger Woods', image_url: 'https://example.com/tiger.jpg' },
    { id: 'espn_2', full_name: 'Rory McIlroy', image_url: 'https://example.com/rory.jpg' },
    { id: 'espn_3', full_name: 'Jon Rahm', image_url: 'https://example.com/jon.jpg' }
  ];

  const mockContestRow = {
    id: contestInstanceId,
    status: 'SCHEDULED',
    lock_time: null,
    sport: 'pga',
    scoring_strategy_key: 'pga_standard_v1'
  };

  beforeEach(() => {
    mockPool = createMockPool();

    // Setup base responses for getMyEntry query
    mockPool.setQueryResponse(
      q =>
        q.includes('SELECT ci.id, ci.status, ci.lock_time') &&
        q.includes('FROM contest_instances') &&
        q.includes('LEFT JOIN contest_templates'),
      mockQueryResponses.single(mockContestRow)
    );

    // Setup player_ids entry lookup (empty - user has no picks yet)
    mockPool.setQueryResponse(
      q =>
        q.includes('SELECT player_ids') &&
        q.includes('FROM entry_rosters'),
      mockQueryResponses.empty()
    );
  });

  describe('Case 1: tournament_configs missing → fallback returns players', () => {
    beforeEach(() => {
      // field_selections missing
      mockPool.setQueryResponse(
        q =>
          q.includes('SELECT selection_json') &&
          q.includes('FROM field_selections'),
        mockQueryResponses.empty()
      );

      // tournament_configs missing (key for lazy creation check)
      mockPool.setQueryResponse(
        q =>
          q.includes('SELECT id') &&
          q.includes('FROM tournament_configs'),
        mockQueryResponses.empty()
      );

      // Players table has active GOLF players
      mockPool.setQueryResponse(
        q =>
          q.includes('SELECT id, full_name, image_url') &&
          q.includes('FROM players') &&
          q.includes('WHERE sport'),
        mockQueryResponses.multiple(mockPlayers)
      );
    });

    it('should return players from fallback without creating field_selections', async () => {
      const result = await entryRosterService.getMyEntry(mockPool, contestInstanceId, userId);

      // Assertions
      expect(result.available_players).toHaveLength(3);
      expect(result.available_players[0]).toEqual({
        player_id: 'espn_1',
        name: 'Tiger Woods',
        image_url: 'https://example.com/tiger.jpg'
      });

      // Verify INSERT INTO field_selections was NOT called (no tournament_configs to FK)
      const queryHistory = mockPool.getQueryHistory();
      const insertFieldSelectionsQuery = queryHistory.find(q =>
        q.sql.includes('INSERT INTO field_selections')
      );
      expect(insertFieldSelectionsQuery).toBeUndefined();
    });
  });

  describe('Case 2: tournament_configs exists → lazy insert creates field_selections', () => {
    beforeEach(() => {
      // field_selections missing
      mockPool.setQueryResponse(
        q =>
          q.includes('SELECT selection_json') &&
          q.includes('FROM field_selections'),
        mockQueryResponses.empty()
      );

      // tournament_configs EXISTS (enables lazy creation)
      mockPool.setQueryResponse(
        q =>
          q.includes('SELECT id') &&
          q.includes('FROM tournament_configs'),
        mockQueryResponses.single({ id: tournamentConfigId })
      );

      // Players table has active GOLF players
      mockPool.setQueryResponse(
        q =>
          q.includes('SELECT id, full_name, image_url') &&
          q.includes('FROM players') &&
          q.includes('WHERE sport'),
        mockQueryResponses.multiple(mockPlayers)
      );

      // INSERT INTO field_selections succeeds (idempotent)
      mockPool.setQueryResponse(
        q =>
          q.includes('INSERT INTO field_selections') &&
          q.includes('ON CONFLICT'),
        mockQueryResponses.single({ id: 'generated-uuid' })
      );
    });

    it('should create field_selections lazily with populated primary array', async () => {
      const result = await entryRosterService.getMyEntry(mockPool, contestInstanceId, userId);

      // Assertions
      expect(result.available_players).toHaveLength(3);

      // Verify INSERT INTO field_selections WAS called
      const queryHistory = mockPool.getQueryHistory();
      const insertFieldSelectionsQuery = queryHistory.find(q =>
        q.sql.includes('INSERT INTO field_selections')
      );

      expect(insertFieldSelectionsQuery).toBeDefined();
      expect(insertFieldSelectionsQuery.sql).toContain('ON CONFLICT DO NOTHING');

      // Verify parameters include correct contest_instance_id and tournament_config_id
      expect(insertFieldSelectionsQuery.params).toContain(contestInstanceId);
      expect(insertFieldSelectionsQuery.params).toContain(tournamentConfigId);

      // Verify the selection_json was passed (contains populated primary array)
      const selectionJsonParam = insertFieldSelectionsQuery.params.find(p =>
        typeof p === 'string' && p.includes('primary')
      );
      expect(selectionJsonParam).toBeDefined();
      const selectionJson = JSON.parse(selectionJsonParam);
      expect(selectionJson.primary).toHaveLength(3);
      expect(selectionJson.primary[0]).toHaveProperty('player_id');
    });

    it('should be idempotent: ON CONFLICT DO NOTHING prevents duplicates', async () => {
      // First call
      await entryRosterService.getMyEntry(mockPool, contestInstanceId, userId);

      // Verify first call inserted field_selections
      const firstCallHistory = mockPool.getQueryHistory();
      const firstInsertCount = firstCallHistory.filter(q =>
        q.sql.includes('INSERT INTO field_selections')
      ).length;
      expect(firstInsertCount).toBe(1);

      // Reset query history for second call
      mockPool.reset();
      mockPool.setQueryResponse(
        q =>
          q.includes('SELECT ci.id, ci.status, ci.lock_time') &&
          q.includes('FROM contest_instances'),
        mockQueryResponses.single(mockContestRow)
      );
      mockPool.setQueryResponse(
        q =>
          q.includes('SELECT player_ids FROM entry_rosters'),
        mockQueryResponses.empty()
      );
      mockPool.setQueryResponse(
        q =>
          q.includes('SELECT selection_json FROM field_selections'),
        mockQueryResponses.empty() // Still missing on second call (simulating race condition)
      );
      mockPool.setQueryResponse(
        q =>
          q.includes('SELECT id FROM tournament_configs'),
        mockQueryResponses.single({ id: tournamentConfigId })
      );
      mockPool.setQueryResponse(
        q =>
          q.includes('SELECT id, full_name, image_url') &&
          q.includes('FROM players') &&
          q.includes('WHERE sport'),
        mockQueryResponses.multiple(mockPlayers)
      );
      mockPool.setQueryResponse(
        q =>
          q.includes('INSERT INTO field_selections'),
        mockQueryResponses.empty() // ON CONFLICT DO NOTHING - returns 0 rows
      );

      // Second call
      const result = await entryRosterService.getMyEntry(mockPool, contestInstanceId, userId);
      expect(result.available_players).toHaveLength(3);

      // Verify INSERT was attempted on second call (idempotent via ON CONFLICT)
      const secondCallHistory = mockPool.getQueryHistory();
      const secondInsertCount = secondCallHistory.filter(q =>
        q.sql.includes('INSERT INTO field_selections')
      ).length;
      expect(secondInsertCount).toBe(1); // One attempt per call
    });
  });

  describe('Case 3: field_selections exists with valid primary → no mutation', () => {
    const existingSelectionJson = {
      primary: [
        { player_id: 'espn_1', name: 'Tiger Woods', image_url: null },
        { player_id: 'espn_2', name: 'Rory McIlroy', image_url: null }
      ],
      alternates: []
    };

    beforeEach(() => {
      // field_selections EXISTS with valid primary
      mockPool.setQueryResponse(
        q =>
          q.includes('SELECT selection_json FROM field_selections'),
        mockQueryResponses.single({ selection_json: existingSelectionJson })
      );

      // Don't need players table query or tournament_configs check
      // getMyEntry should use field_selections and not call fallback
    });

    it('should use existing field_selections without triggering lazy creation', async () => {
      const result = await entryRosterService.getMyEntry(mockPool, contestInstanceId, userId);

      // Should use the pre-configured 2 players from field_selections
      expect(result.available_players).toHaveLength(2);
      expect(result.available_players[0]).toEqual({
        player_id: 'espn_1',
        name: 'Tiger Woods',
        image_url: null
      });

      // Verify no INSERT INTO field_selections was called
      const queryHistory = mockPool.getQueryHistory();
      const insertFieldSelectionsQuery = queryHistory.find(q =>
        q.sql.includes('INSERT INTO field_selections')
      );
      expect(insertFieldSelectionsQuery).toBeUndefined();

      // Verify no SELECT FROM tournament_configs was called (lazy creation not triggered)
      const tcQuery = queryHistory.find(q =>
        q.sql.includes('SELECT id') && q.sql.includes('FROM tournament_configs')
      );
      expect(tcQuery).toBeUndefined();

      // Verify no SELECT FROM players was called (fallback not triggered)
      const playersQuery = queryHistory.find(q =>
        q.sql.includes('SELECT id, full_name, image_url') &&
        q.sql.includes('FROM players')
      );
      expect(playersQuery).toBeUndefined();
    });
  });
});
