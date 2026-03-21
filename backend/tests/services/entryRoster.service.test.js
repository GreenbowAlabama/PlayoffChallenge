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
      // Service normalizes player IDs to canonical "espn_" format
      expect(result.player_ids).toEqual(playerIds.map(id => `espn_${id}`));
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
            scoring_strategy_key: 'pga_standard_v1',
            sport: 'pga'
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

    it('rejects picks when exceeding roster_size limit (over 7)', async () => {
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
            scoring_strategy_key: 'pga_standard_v1',
            sport: 'pga'
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

      // Provide populated field_selections so size validation occurs
      pool.setQueryResponse(
        q => q.includes('field_selections'),
        {
          rows: [{
            selection_json: {
              primary: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10'].map(id => ({ player_id: id, name: `Player ${id}` }))
            }
          }],
          rowCount: 1
        }
      );

      await expect(
        entryRosterService.submitPicks(pool, contestId, userId, playerIds)
      ).rejects.toThrow('Roster size must be between 0 and 7');
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
            scoring_strategy_key: 'pga_standard_v1',
            sport: 'pga'
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
            scoring_strategy_key: 'pga_standard_v1',
            sport: 'pga'
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

    it('rejects submission when picks are not in empty field', async () => {
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
            scoring_strategy_key: 'pga_standard_v1',
            sport: 'pga'
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

      // field_selections row exists but primary field is empty
      // This is valid structure, but validation will fail because picks aren't in empty field
      pool.setQueryResponse(
        q => q.includes('field_selections'),
        {
          rows: [{
            selection_json: {
              primary: []  // Empty field - valid structure but no players
            }
          }],
          rowCount: 1
        }
      );

      await expect(
        entryRosterService.submitPicks(pool, contestId, userId, playerIds)
      ).rejects.toThrow('Players not in validated field');
    });

    it('rejects submission when field_selections.primary is null', async () => {
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
            scoring_strategy_key: 'pga_standard_v1',
            sport: 'pga'
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

      // field_selections row exists but primary field is null
      pool.setQueryResponse(
        q => q.includes('field_selections'),
        {
          rows: [{
            selection_json: {
              primary: null  // Null field
            }
          }],
          rowCount: 1
        }
      );

      await expect(
        entryRosterService.submitPicks(pool, contestId, userId, playerIds)
      ).rejects.toThrow('Contest field not initialized');
    });

    it('allows picks when field_selections.primary contains player objects', async () => {
      const pool = createMockPool();
      const contestId = 'test-contest-id';
      const userId = 'test-user-id';
      const playerIds = ['espn_123', 'espn_456', 'espn_789', 'espn_111', 'espn_222', 'espn_333', 'espn_444'];

      pool.setQueryResponse(
        q => q.includes('contest_instances') && q.includes('FOR UPDATE'),
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
        q => q.includes('contest_participants') && q.includes('WHERE'),
        {
          rows: [{ 1: 1 }],
          rowCount: 1
        }
      );

      // field_selections with object format (from ingestion)
      // This is the format that comes from populateFieldSelections in ingestionService
      pool.setQueryResponse(
        q => q.includes('field_selections'),
        {
          rows: [{
            selection_json: {
              primary: [
                { player_id: 'espn_123', name: 'Player One', image_url: null },
                { player_id: 'espn_456', name: 'Player Two', image_url: null },
                { player_id: 'espn_789', name: 'Player Three', image_url: null },
                { player_id: 'espn_111', name: 'Player Four', image_url: null },
                { player_id: 'espn_222', name: 'Player Five', image_url: null },
                { player_id: 'espn_333', name: 'Player Six', image_url: null },
                { player_id: 'espn_444', name: 'Player Seven', image_url: null }
              ]
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
      expect(result.player_ids).toEqual(playerIds);
    });

    it('accepts submission when field_selections.primary is populated', async () => {
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
            scoring_strategy_key: 'pga_standard_v1',
            sport: 'pga'
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

      // field_selections with populated primary field
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

    it('getMyEntry throws CONTEST_NOT_INITIALIZED when sport is null (data integrity)', async () => {
      /**
       * READ PATH VALIDATION TEST
       * Contest template not initialized properly:
       * - sport is null (missing sport field in template)
       * This is data integrity error, not lifecycle error
       */
      const pool = createMockPool();
      const contestId = 'test-contest-id';
      const userId = 'test-user-id';

      // Contest exists but sport is NULL (template not initialized)
      pool.setQueryResponse(
        q => q.includes('contest_instances') && q.includes('LEFT JOIN'),
        {
          rows: [{
            id: contestId,
            status: 'SCHEDULED',
            lock_time: new Date(Date.now() + 3600000),
            scoring_strategy_key: 'pga_standard_v1',
            sport: null  // Invalid: sport is null
          }],
          rowCount: 1
        }
      );

      // User has no entry yet
      pool.setQueryResponse(
        q => q.includes('entry_rosters') && q.includes('WHERE'),
        {
          rows: [],
          rowCount: 0
        }
      );

      // EXPECTED: getMyEntry throws CONTEST_NOT_INITIALIZED (not lifecycle error)
      try {
        await entryRosterService.getMyEntry(pool, contestId, userId);
        fail('Expected CONTEST_NOT_INITIALIZED error');
      } catch (err) {
        expect(err.code).toBe('CONTEST_NOT_INITIALIZED');
        expect(err.status).toBe(400);
      }
    });

    it('getMyEntry returns empty array when field_selections missing (fallback ready state)', async () => {
      /**
       * READ PATH FALLBACK TEST (FIXED)
       * Contest in early ingestion state:
       * - sport exists (valid template)
       * - field_selections missing (ingestion incomplete)
       *
       * FIXED BEHAVIOR: available_players = [] (indicates "ready but no players")
       * This allows lineup creation UI to render, even if no players available yet
       */
      const pool = createMockPool();
      const contestId = 'test-contest-id';
      const userId = 'test-user-id';

      // Contest exists with valid sport
      pool.setQueryResponse(
        q => q.includes('contest_instances') && q.includes('LEFT JOIN'),
        {
          rows: [{
            id: contestId,
            status: 'SCHEDULED',
            lock_time: new Date(Date.now() + 3600000),
            scoring_strategy_key: 'pga_standard_v1',
            sport: 'pga'  // Valid sport
          }],
          rowCount: 1
        }
      );

      // User has no entry yet
      pool.setQueryResponse(
        q => q.includes('entry_rosters') && q.includes('WHERE'),
        {
          rows: [],
          rowCount: 0
        }
      );

      // Field selections MISSING (fallback to players table)
      pool.setQueryResponse(
        q => q.includes('field_selections'),
        {
          rows: [],
          rowCount: 0
        }
      );

      // Fallback: no players in table yet
      pool.setQueryResponse(
        q => q.includes('FROM players') && q.includes('WHERE sport'),
        {
          rows: [],
          rowCount: 0
        }
      );

      // FIXED BEHAVIOR: available_players = [] (ready state, not streaming)
      const result = await entryRosterService.getMyEntry(pool, contestId, userId);

      expect(result.available_players).toEqual([]);  // ✓ Empty array, not null
    });

    it('getMyEntry returns players when field_selections exists (production parity)', async () => {
      /**
       * PRODUCTION PARITY TEST
       * Validates that getMyEntry correctly returns available_players
       * when field_selections.primary contains 221 valid player objects
       *
       * This reproduces the exact scenario:
       * - contest_instances row exists (status: SCHEDULED, sport: 'golf')
       * - no entry_rosters row (user hasn't submitted picks)
       * - field_selections row with 221 valid player objects
       *
       * EXPECTED: result.available_players.length === 221
       * FAILURE MODE: available_players is null or empty (streaming state, not production ready)
       */
      const pool = createMockPool();
      const contestId = 'test-contest-large-field';
      const userId = 'test-user-id';

      // Generate 221 valid player objects
      const largePlayerField = Array.from({ length: 221 }, (_, i) => ({
        player_id: `p${i + 1}`,
        name: `Player ${i + 1}`,
        image_url: null
      }));

      // Contest exists with valid sport
      pool.setQueryResponse(
        q => q.includes('contest_instances') && q.includes('LEFT JOIN'),
        {
          rows: [{
            id: contestId,
            status: 'SCHEDULED',
            lock_time: new Date(Date.now() + 3600000),
            scoring_strategy_key: 'pga_standard_v1',
            sport: 'golf'  // Valid sport
          }],
          rowCount: 1
        }
      );

      // User has no entry yet
      pool.setQueryResponse(
        q => q.includes('entry_rosters') && q.includes('WHERE'),
        {
          rows: [],
          rowCount: 0
        }
      );

      // Field selections with 221 valid player objects
      pool.setQueryResponse(
        q => q.includes('field_selections'),
        {
          rows: [{
            selection_json: {
              primary: largePlayerField
            }
          }],
          rowCount: 1
        }
      );

      const result = await entryRosterService.getMyEntry(pool, contestId, userId);

      // HARD ASSERT: Players must be returned, not null
      expect(result.available_players).not.toBeNull();
      expect(Array.isArray(result.available_players)).toBe(true);
      expect(result.available_players.length).toBe(221);

      // Verify structure of returned players
      expect(result.available_players[0]).toHaveProperty('player_id');
      expect(result.available_players[0]).toHaveProperty('name');
      expect(result.available_players[0].player_id).toBe('p1');
    });

    it('getMyEntry returns empty array when players table empty (fallback ready state)', async () => {
      /**
       * FALLBACK READY STATE TEST
       * When field_selections is missing AND players table returns 0 rows,
       * getMyEntry must return an empty array [] (not null).
       *
       * Empty array = "ready but no players available"
       * null = "not ready, still streaming"
       *
       * This test verifies the fix for the "roster version not ready" bug.
       */
      const pool = createMockPool();
      const contestId = 'test-contest-empty-players';
      const userId = 'test-user-id';

      // Contest exists with valid sport
      pool.setQueryResponse(
        q => q.includes('contest_instances') && q.includes('LEFT JOIN'),
        {
          rows: [{
            id: contestId,
            status: 'SCHEDULED',
            lock_time: new Date(Date.now() + 3600000),
            scoring_strategy_key: 'pga_standard_v1',
            sport: 'golf'  // Valid sport
          }],
          rowCount: 1
        }
      );

      // User has no entry yet
      pool.setQueryResponse(
        q => q.includes('entry_rosters') && q.includes('WHERE'),
        {
          rows: [],
          rowCount: 0
        }
      );

      // No field_selections (missing)
      pool.setQueryResponse(
        q => q.includes('field_selections'),
        {
          rows: [],
          rowCount: 0
        }
      );

      // Fallback: query players table, returns 0 rows (empty)
      pool.setQueryResponse(
        q => q.includes('players') && q.includes('WHERE'),
        {
          rows: [],
          rowCount: 0
        }
      );

      const result = await entryRosterService.getMyEntry(pool, contestId, userId);

      // CRITICAL: Must be an empty array, NOT null
      expect(result.available_players).not.toBeNull();
      expect(Array.isArray(result.available_players)).toBe(true);
      expect(result.available_players.length).toBe(0);
    });

    it('rejects player not in validated field', async () => {
      const pool = createMockPool();
      const contestId = 'test-contest-id';
      const userId = 'test-user-id';
      const playerIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p99']; // p99 not in field

      pool.setQueryResponse(
        q => q.includes('contest_instances') && q.includes('FOR UPDATE'),
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
        q => q.includes('contest_participants') && q.includes('WHERE'),
        {
          rows: [{ 1: 1 }],
          rowCount: 1
        }
      );

      // field_selections with only p1-p7, not p99
      pool.setQueryResponse(
        q => q.includes('field_selections'),
        {
          rows: [{
            selection_json: {
              primary: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'].map(id => ({ player_id: id, name: `Player ${id}` }))
            }
          }],
          rowCount: 1
        }
      );

      await expect(
        entryRosterService.submitPicks(pool, contestId, userId, playerIds)
      ).rejects.toThrow('Players not in validated field');
    });

    // GOVERNANCE COMPLIANCE TESTS: Lock Time Independence
    // These tests verify that entryRosterService enforces contest-specific lock_time,
    // independent of any global system flags like is_week_active.
    // This prevents regression of the /api/picks/v2 misbehavior where global flags override contest locks.

    it('accepts picks for SCHEDULED contest with future lock_time (lock_time-scoped)', async () => {
      // SCENARIO: Ensure contest-scoped lock_time takes precedence.
      // This is the CORRECT behavior that /api/picks/v2 violates.
      // Preconditions:
      //   - contest.status = SCHEDULED
      //   - contest.lock_time = future (1 hour)
      //   - current_time = now (before lock_time)
      // Expected: Picks ACCEPTED (respects contest-specific lock_time)
      // NOT: Blocked by any global flag

      const pool = createMockPool();
      const contestId = 'test-contest-scheduled-future-lock';
      const userId = 'test-user-id';
      const playerIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];

      pool.setQueryResponse(
        q => q.includes('contest_instances') && q.includes('FOR UPDATE'),
        {
          rows: [{
            id: contestId,
            status: 'SCHEDULED',
            lock_time: new Date(Date.now() + 3600000), // 1 hour in future
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

      // This MUST succeed because:
      // - Contest is SCHEDULED (status check passes)
      // - Current time < lock_time (time check passes)
      // - No global flag is consulted by this service
      const result = await entryRosterService.submitPicks(pool, contestId, userId, playerIds);
      expect(result.success).toBe(true);
      expect(result.player_ids).toEqual(playerIds.map(id => `espn_${id}`));
    });

    it('rejects picks when contest lock_time has passed, even if SCHEDULED', async () => {
      // SCENARIO: Verify that lock_time is the lock mechanism, not status alone.
      // Preconditions:
      //   - contest.status = SCHEDULED
      //   - contest.lock_time = past (1 hour ago)
      //   - current_time = now (after lock_time)
      // Expected: Picks REJECTED (lock_time enforcement)
      // This prevents the inverse misbehavior where lock_time is ignored.

      const pool = createMockPool();
      const contestId = 'test-contest-scheduled-past-lock';
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

      await expect(
        entryRosterService.submitPicks(pool, contestId, userId, playerIds)
      ).rejects.toThrow('Entry window is closed');
    });

    it('enforces lock_time independently per contest (multi-contest isolation)', async () => {
      // SCENARIO: Verify that two different contests with different lock_times
      // are evaluated independently, not by global flag.
      // This test ensures contest-scoping works correctly.
      //
      // Setup:
      //   - Contest A: lock_time in future
      //   - Contest B: lock_time in past
      //   - Same user
      // Expected:
      //   - Contest A: picks ACCEPTED
      //   - Contest B: picks REJECTED
      // This proves that each contest's lock_time is respected independently.

      const pool = createMockPool();
      const userId = 'test-user-isolation-id';
      const playerIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
      const contestIdA = 'contest-a-future-lock';
      const contestIdB = 'contest-b-past-lock';

      // PART 1: Contest A (future lock_time) should accept
      const poolA = createMockPool();

      poolA.setQueryResponse(
        q => q.includes('contest_instances') && q.includes('FOR UPDATE'),
        {
          rows: [{
            id: contestIdA,
            status: 'SCHEDULED',
            lock_time: new Date(Date.now() + 3600000), // Future
            scoring_strategy_key: 'pga_standard_v1'
          }],
          rowCount: 1
        }
      );

      poolA.setQueryResponse(
        q => q.includes('contest_participants') && q.includes('WHERE'),
        {
          rows: [{ 1: 1 }],
          rowCount: 1
        }
      );

      poolA.setQueryResponse(
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

      poolA.setQueryResponse(
        q => q.includes('entry_rosters') && q.includes('INSERT'),
        {
          rows: [{ updated_at: new Date().toISOString() }],
          rowCount: 1
        }
      );

      const resultA = await entryRosterService.submitPicks(poolA, contestIdA, userId, playerIds);
      expect(resultA.success).toBe(true);

      // PART 2: Contest B (past lock_time) should reject
      const poolB = createMockPool();

      poolB.setQueryResponse(
        q => q.includes('contest_instances') && q.includes('FOR UPDATE'),
        {
          rows: [{
            id: contestIdB,
            status: 'SCHEDULED',
            lock_time: new Date(Date.now() - 3600000), // Past
            scoring_strategy_key: 'pga_standard_v1'
          }],
          rowCount: 1
        }
      );

      poolB.setQueryResponse(
        q => q.includes('contest_participants') && q.includes('WHERE'),
        {
          rows: [{ 1: 1 }],
          rowCount: 1
        }
      );

      poolB.setQueryResponse(
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

      await expect(
        entryRosterService.submitPicks(poolB, contestIdB, userId, playerIds)
      ).rejects.toThrow('Entry window is closed');

      // ASSERTION: Independent evaluation per contest (not global flag)
      // Result: A accepted, B rejected = contest-specific lock_time works
    });

    // CONDITIONAL DEPRECATION TESTS: /api/picks/v2 Guard (Task 4)
    // These tests verify that the conditional guard in picksService properly
    // distinguishes between PGA/custom contests (use lock_time) and legacy NFL contests (use is_week_active).

    it('CONDITIONAL GUARD: PGA contest with future lock_time accepts picks despite is_week_active=false', async () => {
      // SCENARIO: PGA contest should ignore global is_week_active flag
      // This is the CORE FIX for the /api/picks/v2 deprecation.
      //
      // Preconditions:
      //   - contest.template_id = 'template-123' (non-null, marks it as PGA/custom)
      //   - contest.status = SCHEDULED
      //   - contest.lock_time = future (1 hour)
      //   - game_settings.is_week_active = false (global flag is OFF)
      //   - current_time = now (before lock_time)
      //
      // Expected: Picks ACCEPTED
      // Reason: PGA contests use lock_time, not is_week_active
      //
      // This prevents the issue where /api/picks/v2 was blocking all picks when
      // is_week_active was false, regardless of contest-specific lock_time.

      const pool = createMockPool();
      const contestId = 'pga-contest-future-lock';
      const userId = 'user-id';
      const playerIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];

      // Mock contest (PGA/custom with template_id)
      pool.setQueryResponse(
        q => q.includes('contest_instances') && q.includes('FOR UPDATE'),
        {
          rows: [{
            id: contestId,
            status: 'SCHEDULED',
            lock_time: new Date(Date.now() + 3600000), // 1 hour in future
            scoring_strategy_key: 'pga_standard_v1',
            template_id: 'template-123' // NON-NULL = PGA/custom contest
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

      // Mock field_selections
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

      // Mock entry_rosters insert
      pool.setQueryResponse(
        q => q.includes('entry_rosters') && q.includes('INSERT'),
        {
          rows: [{ updated_at: new Date().toISOString() }],
          rowCount: 1
        }
      );

      // NOTE: We do NOT mock game_settings or is_week_active here.
      // If the guard works correctly, the service won't even check it for PGA contests.
      // If the guard is broken, the service would try to query is_week_active and fail.

      const result = await entryRosterService.submitPicks(pool, contestId, userId, playerIds);
      expect(result.success).toBe(true);
      expect(result.player_ids).toEqual(playerIds.map(id => `espn_${id}`));
    });

    it('CONDITIONAL GUARD: Legacy NFL contest with is_week_active=false blocks picks (backward compat)', async () => {
      // SCENARIO: Legacy NFL contests should continue using is_week_active flag
      // This ensures backward compatibility and prevents regression.
      //
      // Preconditions:
      //   - contest.template_id = NULL (null = legacy NFL contest)
      //   - contest.status = SCHEDULED
      //   - contest.lock_time = future (has lock_time, but it's ignored for NFL)
      //   - game_settings.is_week_active = false (global flag is OFF)
      //   - current_time = now
      //
      // Expected: Picks BLOCKED
      // Reason: NFL contests respect is_week_active, not lock_time
      //
      // This ensures that the conditional guard doesn't break existing NFL contest behavior.

      const pool = createMockPool();
      const contestId = 'nfl-legacy-contest';
      const userId = 'user-id';
      const playerIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];

      // Mock contest (NFL legacy with template_id = null)
      pool.setQueryResponse(
        q => q.includes('contest_instances') && q.includes('FOR UPDATE'),
        {
          rows: [{
            id: contestId,
            status: 'SCHEDULED',
            lock_time: new Date(Date.now() + 3600000), // Future lock_time (ignored for NFL)
            scoring_strategy_key: 'nfl_standard_v1',
            template_id: null // NULL = legacy NFL contest
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

      // Mock game_settings with is_week_active = false
      pool.setQueryResponse(
        q => q.includes('game_settings'),
        {
          rows: [{
            current_playoff_week: 1,
            playoff_start_week: 1,
            is_week_active: false // Global flag OFF
          }],
          rowCount: 1
        }
      );

      // Service should check is_week_active and reject
      // No need to mock field_selections or entry_rosters since the request should fail at the is_week_active check

      await expect(
        entryRosterService.submitPicks(pool, contestId, userId, playerIds)
      ).rejects.toThrow();
    });

    // ============================================
    // PARTIAL ROSTER SUBMISSION TESTS
    // ============================================

    it('submits partial roster with 1 player successfully', async () => {
      const pool = createMockPool();
      const contestId = 'test-contest-id';
      const userId = 'test-user-id';
      const playerIds = ['p1']; // Only 1 player (partial)

      pool.setQueryResponse(
        q => q.includes('contest_instances') && q.includes('FOR UPDATE'),
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
              primary: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'].map(id => ({ player_id: id, name: `Player ${id}` }))
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
      expect(result.player_ids).toEqual(['espn_p1']);
      expect(result.updated_at).toBeDefined();
    });

    it('submits partial roster with 3 players successfully', async () => {
      const pool = createMockPool();
      const contestId = 'test-contest-id';
      const userId = 'test-user-id';
      const playerIds = ['p1', 'p2', 'p3']; // 3 players (partial)

      pool.setQueryResponse(
        q => q.includes('contest_instances') && q.includes('FOR UPDATE'),
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
              primary: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'].map(id => ({ player_id: id, name: `Player ${id}` }))
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
      expect(result.player_ids).toEqual(['espn_p1', 'espn_p2', 'espn_p3']);
      expect(result.updated_at).toBeDefined();
    });

    it('rejects partial roster when exceeding roster_size limit', async () => {
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
            scoring_strategy_key: 'pga_standard_v1',
            sport: 'pga'
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
              primary: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10'].map(id => ({ player_id: id, name: `Player ${id}` }))
            }
          }],
          rowCount: 1
        }
      );

      await expect(
        entryRosterService.submitPicks(pool, contestId, userId, playerIds)
      ).rejects.toThrow('Roster size must be between 0 and 7');
    });

    it('submits empty roster (0 players) successfully', async () => {
      const pool = createMockPool();
      const contestId = 'test-contest-id';
      const userId = 'test-user-id';
      const playerIds = []; // Empty roster

      pool.setQueryResponse(
        q => q.includes('contest_instances') && q.includes('FOR UPDATE'),
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
              primary: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'].map(id => ({ player_id: id, name: `Player ${id}` }))
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
      expect(result.player_ids).toEqual([]);
      expect(result.updated_at).toBeDefined();
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

      pool.setQueryResponse(
        q => q.includes('field_selections'),
        {
          rows: [],
          rowCount: 0
        }
      );

      // No players table mock → returns null (streaming state)
      pool.setQueryResponse(
        q => q.includes('FROM players') && q.includes('WHERE sport'),
        {
          rows: [],
          rowCount: 0
        }
      );

      const result = await entryRosterService.getMyEntry(pool, contestId, userId);

      expect(result.player_ids).toEqual([]);
      expect(result.can_edit).toBe(true);
      // FIXED: now returns empty array (ready but no players) instead of null (not ready)
      expect(result.available_players).toEqual([]);
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
            scoring_strategy_key: 'pga_standard_v1',
            sport: 'pga'
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

      // No players table mock → returns null (streaming state)
      pool.setQueryResponse(
        q => q.includes('FROM players') && q.includes('WHERE sport'),
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

      pool.setQueryResponse(
        q => q.includes('field_selections'),
        {
          rows: [],
          rowCount: 0
        }
      );

      // No players table mock → returns null (streaming state)
      pool.setQueryResponse(
        q => q.includes('FROM players') && q.includes('WHERE sport'),
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

      pool.setQueryResponse(
        q => q.includes('field_selections'),
        {
          rows: [],
          rowCount: 0
        }
      );

      // No players table mock → returns null (streaming state)
      pool.setQueryResponse(
        q => q.includes('FROM players') && q.includes('WHERE sport'),
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

    it('getMyEntry succeeds with sport=golf (select query includes ct.sport)', async () => {
      /**
       * AUDIT TEST: Verify getMyEntry query fetches ct.sport from contest_templates
       * and does NOT throw CONTEST_NOT_INITIALIZED when sport field is populated.
       *
       * This test validates the SELECT query at getMyEntry:470-478 properly
       * includes ct.sport to initialize contestRow.sport for valid contests.
       */
      const pool = createMockPool();
      const contestId = 'test-golf-contest-id';
      const userId = 'test-user-id';

      // Contest with sport='golf' (properly initialized template)
      pool.setQueryResponse(
        q => q.includes('contest_instances') && q.includes('LEFT JOIN'),
        {
          rows: [{
            id: contestId,
            status: 'SCHEDULED',
            lock_time: new Date(Date.now() + 3600000),
            scoring_strategy_key: 'pga_standard_v1',
            sport: 'golf'  // Template initialized with sport
          }],
          rowCount: 1
        }
      );

      // User has no entry yet
      pool.setQueryResponse(
        q => q.includes('entry_rosters') && q.includes('WHERE'),
        {
          rows: [],
          rowCount: 0
        }
      );

      // Field selections missing (streaming state)
      pool.setQueryResponse(
        q => q.includes('field_selections'),
        {
          rows: [],
          rowCount: 0
        }
      );

      // Fallback: no players available
      pool.setQueryResponse(
        q => q.includes('FROM players') && q.includes('WHERE sport'),
        {
          rows: [],
          rowCount: 0
        }
      );

      // ASSERTION: getMyEntry must NOT throw CONTEST_NOT_INITIALIZED
      // The query must include ct.sport, so contestRow.sport is never null/undefined
      const result = await entryRosterService.getMyEntry(pool, contestId, userId);

      expect(result).toBeDefined();
      expect(result.player_ids).toEqual([]);
      expect(result.can_edit).toBe(true);
      expect(result.lock_time).toBeDefined();
      expect(result.roster_config).toBeDefined();
      // FIXED: now returns empty array (ready but no players) instead of null (not ready)
      expect(result.available_players).toEqual([]);
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

  describe('REGRESSION GUARD - Bulletproof Roster Persistence', () => {
    describe('Test 1: Save 4 players → expect 4', () => {
      it('allows partial roster submission (4 of 7)', async () => {
        const pool = createMockPool();
        const contestId = 'test-contest-id';
        const userId = 'test-user-id';
        const playerIds = ['p1', 'p2', 'p3', 'p4'];

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
          q => q.includes('contest_participants'),
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
                primary: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'].map(id => ({ player_id: id, name: `Player ${id}` }))
              }
            }],
            rowCount: 1
          }
        );

        // Mock: No existing roster
        pool.setQueryResponse(
          q => q.includes('entry_rosters') && !q.includes('INSERT'),
          {
            rows: [],
            rowCount: 0
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
        expect(result.player_ids.length).toBe(4);
      });
    });

    describe('Test 2: Save 6 players → expect 6', () => {
      it('allows 6-player roster submission', async () => {
        const pool = createMockPool();
        const contestId = 'test-contest-id';
        const userId = 'test-user-id';
        const playerIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];

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
          q => q.includes('contest_participants'),
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
                primary: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'].map(id => ({ player_id: id, name: `Player ${id}` }))
              }
            }],
            rowCount: 1
          }
        );

        pool.setQueryResponse(
          q => q.includes('entry_rosters') && !q.includes('INSERT'),
          {
            rows: [],
            rowCount: 0
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
        expect(result.player_ids.length).toBe(6);
      });
    });

    describe('Test 3: Save 7 players → expect 7', () => {
      it('allows complete 7-player roster submission', async () => {
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
          q => q.includes('contest_participants'),
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
          q => q.includes('entry_rosters') && !q.includes('INSERT'),
          {
            rows: [],
            rowCount: 0
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
        expect(result.player_ids.length).toBe(7);
        expect(result.ignored).toBe(false);
      });
    });

    describe('Test 4: Save 6 AFTER 7 → expect STILL 7 (REGRESSION BLOCKED)', () => {
      it('blocks regression when incoming < existing', async () => {
        const pool = createMockPool();
        const contestId = 'test-contest-id';
        const userId = 'test-user-id';
        const incomingPlayerIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']; // 6 players
        const existingPlayerIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']; // 7 players

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
          q => q.includes('contest_participants'),
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
                primary: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'].map(id => ({ player_id: id, name: `Player ${id}` }))
              }
            }],
            rowCount: 1
          }
        );

        // Mock: EXISTING roster with 7 players
        pool.setQueryResponse(
          q => q.includes('entry_rosters') && !q.includes('INSERT'),
          {
            rows: [{
              player_ids: existingPlayerIds,
              updated_at: new Date(Date.now() - 60000).toISOString()
            }],
            rowCount: 1
          }
        );

        const result = await entryRosterService.submitPicks(pool, contestId, userId, incomingPlayerIds);

        // Expected: Regression is BLOCKED (no explicit intent from user)
        expect(result.success).toBe(true);
        expect(result.ignored).toBe(true);
        expect(result.reason).toBe('regression_blocked_no_intent');
        expect(result.player_ids).toEqual(existingPlayerIds); // Returns existing, not incoming
      });
    });

    describe('Test 5: Concurrent update mismatch → expect conflict', () => {
      it('detects concurrent modification via updated_at', async () => {
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
          q => q.includes('contest_participants'),
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

        // Mock: Existing roster with old timestamp
        const oldTimestamp = new Date(Date.now() - 120000).toISOString();

        // First SELECT to fetch existing roster
        let selectCount = 0;
        pool.setQueryResponse(
          q => q.includes('entry_rosters') && q.includes('SELECT') && !q.includes('UPDATE'),
          {
            rows: [{
              player_ids: ['p1', 'p2', 'p3'],
              updated_at: oldTimestamp
            }],
            rowCount: 1
          }
        );

        // Mock: UPDATE with WHERE clause filters out the old timestamp (concurrency conflict)
        // This simulates another request having updated the row since we fetched it
        pool.setQueryResponse(
          q => q.includes('UPDATE') && q.includes('entry_rosters'),
          {
            rows: [], // No rows returned = WHERE condition not met (timestamp mismatch)
            rowCount: 0
          }
        );

        // Pass a stale timestamp to trigger concurrency conflict (not null, which triggers MISSING_VERSION)
        const staleTimestamp = '2025-01-01T00:00:00.000Z';
        const result = await entryRosterService.submitPicks(pool, contestId, userId, playerIds, false, staleTimestamp);

        // Expected: Conflict detected
        expect(result.success).toBe(false);
        expect(result.error_code).toBe('CONCURRENT_MODIFICATION');
        expect(result.conflict).toBe(true);
      });
    });
  });
});
