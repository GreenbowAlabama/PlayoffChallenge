/**
 * Entry Roster Service Unit Tests
 *
 * Tests the core entry roster business logic with mocked database.
 * Validates pick submission, entry retrieval, and rules derivation.
 */

const entryRosterService = require('../../services/entryRosterService');
const { createMockPool } = require('../mocks/mockPool');

describe('Entry Roster Service', () => {
  describe('submitPicks', () => {
    it('submits valid picks successfully', async () => {
      const pool = createMockPool();
      const contestId = 'test-contest-id';
      const userId = 'test-user-id';
      const playerIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];

      // Mock contest row
      pool.setQueryResponse(
        q => q.includes('contest_instances') && q.includes('FOR UPDATE'),
        {
          rows: [{
            id: contestId,
            status: 'SCHEDULED',
            lock_time: new Date(Date.now() + 3600000), // 1 hour from now
            scoring_strategy_key: 'pga_standard_v1'
          }],
          rowCount: 1
        }
      );

      // Mock participant check
      pool.setQueryResponse(
        q => q.includes('contest_participants') && q.includes('WHERE'),
        {
          rows: [{ 1: 1 }],
          rowCount: 1
        }
      );

      // Mock field_selections with valid players
      pool.setQueryResponse(
        q => q.includes('field_selections'),
        {
          rows: [{
            selection_json: {
              primary: playerIds.map(id => ({ player_id: id, name: `Player ${id}` }))
            }
          }],
          rowCount: 1
        }
      );

      // Mock upsert result
      pool.setQueryResponse(
        q => q.includes('entry_rosters') && q.includes('INSERT'),
        {
          rows: [{ updated_at: new Date().toISOString() }],
          rowCount: 1
        }
      );

      const result = await entryRosterService.submitPicks(pool, contestId, userId, playerIds);

      expect(result.success).toBe(true);
      expect(result.player_ids).toEqual(playerIds);
      expect(result.updated_at).toBeDefined();
    });

    it('rejects picks when contest is not SCHEDULED', async () => {
      const pool = createMockPool();
      const contestId = 'test-contest-id';
      const userId = 'test-user-id';
      const playerIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];

      pool.setQueryResponse(
        q => q.includes('contest_instances') && q.includes('FOR UPDATE'),
        {
          rows: [{
            id: contestId,
            status: 'LOCKED',
            lock_time: new Date(Date.now() + 3600000),
            scoring_strategy_key: 'pga_standard_v1'
          }],
          rowCount: 1
        }
      );

      await expect(
        entryRosterService.submitPicks(pool, contestId, userId, playerIds)
      ).rejects.toThrow('Contest is LOCKED');
    });

    it('rejects picks when past lock_time', async () => {
      const pool = createMockPool();
      const contestId = 'test-contest-id';
      const userId = 'test-user-id';
      const playerIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];

      pool.setQueryResponse(
        q => q.includes('contest_instances') && q.includes('FOR UPDATE'),
        {
          rows: [{
            id: contestId,
            status: 'SCHEDULED',
            lock_time: new Date(Date.now() - 3600000), // 1 hour ago
            scoring_strategy_key: 'pga_standard_v1'
          }],
          rowCount: 1
        }
      );

      await expect(
        entryRosterService.submitPicks(pool, contestId, userId, playerIds)
      ).rejects.toThrow('Entry window is closed');
    });

    it('rejects picks when user is not a participant', async () => {
      const pool = createMockPool();
      const contestId = 'test-contest-id';
      const userId = 'test-user-id';
      const playerIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];

      pool.setQueryResponse(
        q => q.includes('contest_instances') && q.includes('FOR UPDATE'),
        {
          rows: [{
            id: contestId,
            status: 'SCHEDULED',
            lock_time: new Date(Date.now() + 3600000),
            scoring_strategy_key: 'pga_standard_v1'
          }],
          rowCount: 1
        }
      );

      pool.setQueryResponse(
        q => q.includes('contest_participants') && q.includes('WHERE'),
        {
          rows: [],
          rowCount: 0
        }
      );

      await expect(
        entryRosterService.submitPicks(pool, contestId, userId, playerIds)
      ).rejects.toThrow('not a participant');
    });

    it('rejects picks with wrong roster size', async () => {
      const pool = createMockPool();
      const contestId = 'test-contest-id';
      const userId = 'test-user-id';
      const playerIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']; // 8 players, exceeds max of 7

      pool.setQueryResponse(
        q => q.includes('contest_instances') && q.includes('FOR UPDATE'),
        {
          rows: [{
            id: contestId,
            status: 'SCHEDULED',
            lock_time: new Date(Date.now() + 3600000),
            scoring_strategy_key: 'pga_standard_v1'
          }],
          rowCount: 1
        }
      );

      pool.setQueryResponse(
        q => q.includes('contest_participants') && q.includes('WHERE'),
        {
          rows: [{ 1: 1 }],
          rowCount: 1
        }
      );

      pool.setQueryResponse(
        q => q.includes('field_selections'),
        {
          rows: [],
          rowCount: 0
        }
      );

      await expect(
        entryRosterService.submitPicks(pool, contestId, userId, playerIds)
      ).rejects.toThrow('Roster size must be exactly 7');
    });

    it('rejects picks with duplicates', async () => {
      const pool = createMockPool();
      const contestId = 'test-contest-id';
      const userId = 'test-user-id';
      const playerIds = ['p1', 'p2', 'p3', 'p1', 'p5', 'p6', 'p7']; // p1 duplicated

      pool.setQueryResponse(
        q => q.includes('contest_instances') && q.includes('FOR UPDATE'),
        {
          rows: [{
            id: contestId,
            status: 'SCHEDULED',
            lock_time: new Date(Date.now() + 3600000),
            scoring_strategy_key: 'pga_standard_v1'
          }],
          rowCount: 1
        }
      );

      pool.setQueryResponse(
        q => q.includes('contest_participants') && q.includes('WHERE'),
        {
          rows: [{ 1: 1 }],
          rowCount: 1
        }
      );

      pool.setQueryResponse(
        q => q.includes('field_selections'),
        {
          rows: [{
            selection_json: {
              // Include all unique players from playerIds (to avoid "not in validated field" error)
              primary: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'].map(id => ({ player_id: id, name: `Player ${id}` }))
            }
          }],
          rowCount: 1
        }
      );

      await expect(
        entryRosterService.submitPicks(pool, contestId, userId, playerIds)
      ).rejects.toThrow('Duplicate players');
    });

    it('updates existing picks on second submission', async () => {
      const pool = createMockPool();
      const contestId = 'test-contest-id';
      const userId = 'test-user-id';
      const playerIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];

      pool.setQueryResponse(
        q => q.includes('contest_instances') && q.includes('FOR UPDATE'),
        {
          rows: [{
            id: contestId,
            status: 'SCHEDULED',
            lock_time: new Date(Date.now() + 3600000),
            scoring_strategy_key: 'pga_standard_v1'
          }],
          rowCount: 1
        }
      );

      pool.setQueryResponse(
        q => q.includes('contest_participants') && q.includes('WHERE'),
        {
          rows: [{ 1: 1 }],
          rowCount: 1
        }
      );

      pool.setQueryResponse(
        q => q.includes('field_selections'),
        {
          rows: [{
            selection_json: {
              primary: playerIds.map(id => ({ player_id: id, name: `Player ${id}` }))
            }
          }],
          rowCount: 1
        }
      );

      // Mock upsert (simulates UPDATE due to conflict)
      pool.setQueryResponse(
        q => q.includes('entry_rosters') && q.includes('INSERT'),
        {
          rows: [{ updated_at: new Date().toISOString() }],
          rowCount: 1
        }
      );

      const result = await entryRosterService.submitPicks(pool, contestId, userId, playerIds);
      expect(result.success).toBe(true);
    });

    it('allows submission when lock_time is null', async () => {
      const pool = createMockPool();
      const contestId = 'test-contest-id';
      const userId = 'test-user-id';
      const playerIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];

      pool.setQueryResponse(
        q => q.includes('contest_instances') && q.includes('FOR UPDATE'),
        {
          rows: [{
            id: contestId,
            status: 'SCHEDULED',
            lock_time: null, // No time-based lock
            scoring_strategy_key: 'pga_standard_v1'
          }],
          rowCount: 1
        }
      );

      pool.setQueryResponse(
        q => q.includes('contest_participants') && q.includes('WHERE'),
        {
          rows: [{ 1: 1 }],
          rowCount: 1
        }
      );

      pool.setQueryResponse(
        q => q.includes('field_selections'),
        {
          rows: [{
            selection_json: {
              primary: playerIds.map(id => ({ player_id: id, name: `Player ${id}` }))
            }
          }],
          rowCount: 1
        }
      );

      pool.setQueryResponse(
        q => q.includes('entry_rosters') && q.includes('INSERT'),
        {
          rows: [{ updated_at: new Date().toISOString() }],
          rowCount: 1
        }
      );

      const result = await entryRosterService.submitPicks(pool, contestId, userId, playerIds);
      expect(result.success).toBe(true);
    });
  });

  describe('getMyEntry', () => {
    it('returns empty picks for user with no entry', async () => {
      const pool = createMockPool();
      const contestId = 'test-contest-id';
      const userId = 'test-user-id';

      pool.setQueryResponse(
        q => q.includes('contest_instances') && !q.includes('player_ids'),
        {
          rows: [{
            id: contestId,
            status: 'SCHEDULED',
            lock_time: new Date(Date.now() + 3600000),
            scoring_strategy_key: 'pga_standard_v1'
          }],
          rowCount: 1
        }
      );

      pool.setQueryResponse(
        q => q.includes('entry_rosters'),
        {
          rows: [],
          rowCount: 0
        }
      );

      pool.setQueryResponse(
        q => q.includes('field_selections'),
        {
          rows: [],
          rowCount: 0
        }
      );

      const result = await entryRosterService.getMyEntry(pool, contestId, userId);

      expect(result.player_ids).toEqual([]);
      expect(result.can_edit).toBe(true);
      expect(result.available_players).toBeNull();
    });

    it('returns existing picks for user with entry', async () => {
      const pool = createMockPool();
      const contestId = 'test-contest-id';
      const userId = 'test-user-id';
      const playerIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];

      pool.setQueryResponse(
        q => q.includes('contest_instances') && !q.includes('player_ids'),
        {
          rows: [{
            id: contestId,
            status: 'SCHEDULED',
            lock_time: new Date(Date.now() + 3600000),
            scoring_strategy_key: 'pga_standard_v1'
          }],
          rowCount: 1
        }
      );

      pool.setQueryResponse(
        q => q.includes('entry_rosters'),
        {
          rows: [{ player_ids: playerIds }],
          rowCount: 1
        }
      );

      pool.setQueryResponse(
        q => q.includes('field_selections'),
        {
          rows: [],
          rowCount: 0
        }
      );

      const result = await entryRosterService.getMyEntry(pool, contestId, userId);

      expect(result.player_ids).toEqual(playerIds);
      expect(result.can_edit).toBe(true);
    });

    it('sets can_edit to false when past lock_time', async () => {
      const pool = createMockPool();
      const contestId = 'test-contest-id';
      const userId = 'test-user-id';

      pool.setQueryResponse(
        q => q.includes('contest_instances') && !q.includes('player_ids'),
        {
          rows: [{
            id: contestId,
            status: 'SCHEDULED',
            lock_time: new Date(Date.now() - 3600000), // Past
            scoring_strategy_key: 'pga_standard_v1'
          }],
          rowCount: 1
        }
      );

      pool.setQueryResponse(
        q => q.includes('entry_rosters'),
        {
          rows: [],
          rowCount: 0
        }
      );

      pool.setQueryResponse(
        q => q.includes('field_selections'),
        {
          rows: [],
          rowCount: 0
        }
      );

      const result = await entryRosterService.getMyEntry(pool, contestId, userId);

      expect(result.can_edit).toBe(false);
    });

    it('sets can_edit to true when lock_time is null', async () => {
      const pool = createMockPool();
      const contestId = 'test-contest-id';
      const userId = 'test-user-id';

      pool.setQueryResponse(
        q => q.includes('contest_instances') && !q.includes('player_ids'),
        {
          rows: [{
            id: contestId,
            status: 'SCHEDULED',
            lock_time: null, // No lock
            scoring_strategy_key: 'pga_standard_v1'
          }],
          rowCount: 1
        }
      );

      pool.setQueryResponse(
        q => q.includes('entry_rosters'),
        {
          rows: [],
          rowCount: 0
        }
      );

      pool.setQueryResponse(
        q => q.includes('field_selections'),
        {
          rows: [],
          rowCount: 0
        }
      );

      const result = await entryRosterService.getMyEntry(pool, contestId, userId);

      expect(result.can_edit).toBe(true);
    });

    it('returns available players from players table when field_selections is empty (PGA fallback)', async () => {
      const pool = createMockPool();
      const contestId = 'test-contest-id';
      const userId = 'test-user-id';

      // Mock contest row with template info (sport needed for mapping)
      pool.setQueryResponse(
        q => q.includes('contest_instances') && !q.includes('player_ids'),
        {
          rows: [{
            id: contestId,
            status: 'SCHEDULED',
            lock_time: new Date(Date.now() + 3600000),
            scoring_strategy_key: 'pga_standard_v1',
            sport: 'pga'
          }],
          rowCount: 1
        }
      );

      pool.setQueryResponse(
        q => q.includes('entry_rosters'),
        {
          rows: [],
          rowCount: 0
        }
      );

      // field_selections is empty, should fall back to players table
      pool.setQueryResponse(
        q => q.includes('field_selections'),
        {
          rows: [],
          rowCount: 0
        }
      );

      // Mock players table query (fallback)
      // Use a function predicate to match the SELECT id, full_name, image_url FROM players query
      pool.setQueryResponse(
        q => q.includes('players') && q.includes('sport') && q.includes('is_active'),
        {
          rows: [
            { id: 'golfer-1', full_name: 'Tiger Woods', image_url: 'https://example.com/tiger.jpg' },
            { id: 'golfer-2', full_name: 'Rory McIlroy', image_url: 'https://example.com/rory.jpg' },
            { id: 'golfer-3', full_name: 'Jon Rahm', image_url: null }
          ],
          rowCount: 3
        }
      );

      const result = await entryRosterService.getMyEntry(pool, contestId, userId);

      expect(result.available_players).not.toBeNull();
      expect(result.available_players).toHaveLength(3);
      expect(result.available_players[0]).toEqual({
        player_id: 'golfer-1',
        name: 'Tiger Woods',
        image_url: 'https://example.com/tiger.jpg'
      });
      expect(result.available_players[2]).toEqual({
        player_id: 'golfer-3',
        name: 'Jon Rahm',
        image_url: null
      });
    });
  });

  describe('getContestRules', () => {
    it('returns PGA scoring rules for pga_standard_v1', async () => {
      const pool = createMockPool();
      const contestId = 'test-contest-id';

      pool.setQueryResponse(
        q => q.includes('payout_structure'),
        {
          rows: [{
            payout_structure: { type: 'winner_take_all' },
            scoring_strategy_key: 'pga_standard_v1'
          }],
          rowCount: 1
        }
      );

      const result = await entryRosterService.getContestRules(pool, contestId);

      expect(result.scoring_strategy).toBe('pga_standard_v1');
      expect(result.hole_scoring).toBeDefined();
      expect(result.hole_scoring.birdie).toBe(3);
      expect(result.hole_scoring.bogey).toBe(-1);
      expect(result.roster.roster_size).toBe(7);
      expect(result.tie_handling).toBe('shared_rank');
    });
  });

  describe('deriveRosterConfigFromStrategy', () => {
    it('returns real config for pga_standard_v1', () => {
      const config = entryRosterService.deriveRosterConfigFromStrategy('pga_standard_v1');

      expect(config.roster_size).toBe(7);
      expect(config.entry_fields).toContain('player_ids');
      expect(config.validation_rules.no_duplicates).toBe(true);
      expect(config.validation_rules.must_be_in_field).toBe(true);
    });

    it('handles unknown strategy via registry fallback', () => {
      // When strategy not found, registry falls back to nfl_standard_v1
      // (getStrategy logs warning and returns NFL, doesn't throw)
      const config = entryRosterService.deriveRosterConfigFromStrategy('unknown_strategy');

      // Expects NFL fallback config (incomplete, but matches registry behavior)
      // NOTE: This is why PGA contests must have scoring_strategy_key set correctly
      expect(config.entry_fields).toBeDefined();
      expect(config.validation_rules).toBeDefined();
    });
  });
});
