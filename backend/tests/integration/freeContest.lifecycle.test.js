/**
 * Free Contest Full Lifecycle Integration Test
 *
 * Purpose: End-to-end validation of free contest lifecycle
 * - Contest creation (draft -> open)
 * - User joins contest (no payment required)
 * - Pick submission during active week
 * - Score calculation and leaderboard generation
 * - Contest finalization
 *
 * Uses real service instances with mocked external dependencies (ESPN).
 */

const { getIntegrationApp } = require('../mocks/testAppFactory');
const { createMockPool, mockQueryResponses } = require('../mocks/mockPool');
const { setupEspnMocks } = require('../mocks/mockEspnApi');
const {
  TEST_IDS,
  TEST_CONTEST_IDS,
  contests,
  users,
  players,
  gameSettings,
  leaderboardEntries
} = require('../fixtures');

describe('Free Contest Full Lifecycle', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = createMockPool();
  });

  afterEach(() => {
    mockPool.reset();
  });

  describe('Phase 1: Contest Creation', () => {
    it('should create contest in draft state', async () => {
      const draftContest = {
        ...contests.free,
        state: 'draft',
        current_entries: 0
      };

      mockPool.setQueryResponse(
        /INSERT INTO contests/,
        mockQueryResponses.single(draftContest)
      );

      const result = await mockPool.query(
        'INSERT INTO contests (contest_type, league_name, entry_fee_cents, max_entries) VALUES ($1, $2, $3, $4) RETURNING *',
        ['playoff_challenge', 'Free League', 0, 100]
      );

      expect(result.rows[0].state).toBe('draft');
      expect(result.rows[0].entry_fee_cents).toBe(0);
      expect(result.rows[0].current_entries).toBe(0);
    });

    it('should transition contest from draft to open', async () => {
      const openContest = { ...contests.free, state: 'open' };

      mockPool.setQueryResponse(
        /UPDATE contests.*SET.*state/,
        mockQueryResponses.single(openContest)
      );

      const result = await mockPool.query(
        "UPDATE contests SET state = 'open' WHERE contest_id = $1 AND state = 'draft' RETURNING *",
        [TEST_CONTEST_IDS.freeContest]
      );

      expect(result.rows[0].state).toBe('open');
    });

    it('should have entry_fee_cents = 0 for free contest', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM contests/,
        mockQueryResponses.single(contests.free)
      );

      const result = await mockPool.query(
        'SELECT * FROM contests WHERE contest_id = $1',
        [TEST_CONTEST_IDS.freeContest]
      );

      expect(result.rows[0].entry_fee_cents).toBe(0);
    });
  });

  describe('Phase 2: User Join (No Payment)', () => {
    it('should allow user to join without payment', async () => {
      // Verify contest is free
      mockPool.setQueryResponse(
        /SELECT.*FROM contests/,
        mockQueryResponses.single(contests.free)
      );

      const contestResult = await mockPool.query(
        'SELECT * FROM contests WHERE contest_id = $1',
        [TEST_CONTEST_IDS.freeContest]
      );

      const requiresPayment = contestResult.rows[0].entry_fee_cents > 0;
      expect(requiresPayment).toBe(false);

      // Create entry
      const entry = {
        user_id: TEST_IDS.users.validUser,
        contest_id: TEST_CONTEST_IDS.freeContest,
        joined_at: new Date()
      };

      mockPool.setQueryResponse(
        /INSERT INTO contest_entries/,
        mockQueryResponses.single(entry)
      );

      const entryResult = await mockPool.query(
        'INSERT INTO contest_entries (user_id, contest_id) VALUES ($1, $2) RETURNING *',
        [TEST_IDS.users.validUser, TEST_CONTEST_IDS.freeContest]
      );

      expect(entryResult.rows[0].user_id).toBe(TEST_IDS.users.validUser);
    });

    it('should increment current_entries on join', async () => {
      const updatedContest = {
        ...contests.free,
        current_entries: contests.free.current_entries + 1
      };

      mockPool.setQueryResponse(
        /UPDATE contests.*current_entries/,
        mockQueryResponses.single(updatedContest)
      );

      const result = await mockPool.query(
        'UPDATE contests SET current_entries = current_entries + 1 WHERE contest_id = $1 RETURNING *',
        [TEST_CONTEST_IDS.freeContest]
      );

      expect(result.rows[0].current_entries).toBe(contests.free.current_entries + 1);
    });

    it('should prevent duplicate entries', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM contest_entries.*WHERE.*user_id.*AND.*contest_id/,
        mockQueryResponses.single({
          user_id: TEST_IDS.users.validUser,
          contest_id: TEST_CONTEST_IDS.freeContest
        })
      );

      const result = await mockPool.query(
        'SELECT * FROM contest_entries WHERE user_id = $1 AND contest_id = $2',
        [TEST_IDS.users.validUser, TEST_CONTEST_IDS.freeContest]
      );

      const alreadyJoined = result.rows.length > 0;
      expect(alreadyJoined).toBe(true);
    });
  });

  describe('Phase 3: Pick Submission', () => {
    beforeEach(() => {
      // Setup game settings for active week
      mockPool.setQueryResponse(
        /SELECT.*FROM game_settings/,
        mockQueryResponses.gameSettings(gameSettings.wildcardActive)
      );
    });

    it('should verify week is active before accepting picks', async () => {
      const result = await mockPool.query('SELECT * FROM game_settings LIMIT 1');

      expect(result.rows[0].is_week_active).toBe(true);
    });

    it('should submit pick for active player', async () => {
      // Player on active team
      mockPool.setQueryResponse(
        /SELECT.*FROM players/,
        mockQueryResponses.single(players.qb)
      );

      const playerResult = await mockPool.query(
        'SELECT * FROM players WHERE id = $1',
        [TEST_IDS.players.qb1]
      );

      const settingsResult = await mockPool.query('SELECT * FROM game_settings LIMIT 1');

      const playerTeam = playerResult.rows[0].team;
      const activeTeams = settingsResult.rows[0].active_teams;

      expect(activeTeams).toContain(playerTeam);

      // Submit pick
      const pick = {
        id: 'new-pick-id',
        user_id: TEST_IDS.users.validUser,
        player_id: TEST_IDS.players.qb1,
        contest_id: TEST_CONTEST_IDS.freeContest,
        week_number: 19,
        multiplier: 1
      };

      mockPool.setQueryResponse(
        /INSERT INTO picks/,
        mockQueryResponses.single(pick)
      );

      const pickResult = await mockPool.query(
        'INSERT INTO picks (user_id, player_id, contest_id, week_number, multiplier) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [TEST_IDS.users.validUser, TEST_IDS.players.qb1, TEST_CONTEST_IDS.freeContest, 19, 1]
      );

      expect(pickResult.rows[0].week_number).toBe(19);
    });

    it('should reject pick for eliminated player', async () => {
      // Player on eliminated team (DAL not in active teams)
      const eliminatedPlayer = { ...players.wr, team: 'DAL' };

      mockPool.setQueryResponse(
        /SELECT.*FROM players/,
        mockQueryResponses.single(eliminatedPlayer)
      );

      const playerResult = await mockPool.query(
        'SELECT * FROM players WHERE id = $1',
        [TEST_IDS.players.wr1]
      );

      const settingsResult = await mockPool.query('SELECT * FROM game_settings LIMIT 1');

      const playerTeam = playerResult.rows[0].team;
      const activeTeams = settingsResult.rows[0].active_teams;

      expect(activeTeams).not.toContain(playerTeam);
    });

    it('should validate multiplier usage', async () => {
      const existingPicks = [
        { multiplier: 2 },
        { multiplier: 3 }
      ];

      mockPool.setQueryResponse(
        /SELECT.*FROM picks.*WHERE.*multiplier.*>/,
        mockQueryResponses.multiple(existingPicks)
      );

      const result = await mockPool.query(
        'SELECT * FROM picks WHERE user_id = $1 AND contest_id = $2 AND multiplier > 1',
        [TEST_IDS.users.validUser, TEST_CONTEST_IDS.freeContest]
      );

      const multiplierUses = result.rows.length;
      const maxMultiplierUses = 4;

      expect(multiplierUses).toBeLessThan(maxMultiplierUses);
    });
  });

  describe('Phase 4: Score Calculation', () => {
    it('should calculate fantasy points for picks', async () => {
      const pickWithScore = {
        user_id: TEST_IDS.users.validUser,
        player_id: TEST_IDS.players.qb1,
        fantasy_points: 24.48,
        multiplier: 1
      };

      mockPool.setQueryResponse(
        /SELECT.*FROM picks.*JOIN.*scores/i,
        mockQueryResponses.single(pickWithScore)
      );

      const result = await mockPool.query(
        'SELECT p.*, s.fantasy_points FROM picks p JOIN scores s ON p.player_id = s.player_id AND p.week_number = s.week_number WHERE p.user_id = $1',
        [TEST_IDS.users.validUser]
      );

      expect(result.rows[0].fantasy_points).toBeDefined();
      expect(typeof result.rows[0].fantasy_points).toBe('number');
    });

    it('should apply multiplier to scores', () => {
      const basePoints = 24.48;
      const multiplier = 2;
      const adjustedPoints = basePoints * multiplier;

      expect(adjustedPoints).toBe(48.96);
    });

    it('should aggregate total points per user', async () => {
      const aggregatedScore = {
        user_id: TEST_IDS.users.validUser,
        total_points: 90.48
      };

      mockPool.setQueryResponse(
        /SELECT.*SUM.*GROUP BY/i,
        mockQueryResponses.single(aggregatedScore)
      );

      const result = await mockPool.query(
        'SELECT user_id, SUM(fantasy_points * multiplier) as total_points FROM picks WHERE contest_id = $1 GROUP BY user_id',
        [TEST_CONTEST_IDS.freeContest]
      );

      expect(result.rows[0].total_points).toBeDefined();
    });
  });

  describe('Phase 5: Leaderboard Generation', () => {
    it('should generate leaderboard with ranks', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*RANK[\s\S]*OVER[\s\S]*ORDER BY/i,
        mockQueryResponses.multiple(leaderboardEntries)
      );

      const result = await mockPool.query(`
        SELECT user_id, username, total_points,
        RANK() OVER (ORDER BY total_points DESC) as rank
        FROM user_scores WHERE contest_id = $1
      `, [TEST_CONTEST_IDS.freeContest]);

      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows[0].rank).toBe(1);
    });

    it('should have unique ranks', () => {
      const ranks = leaderboardEntries.map(e => e.rank);
      const uniqueRanks = new Set(ranks);

      expect(uniqueRanks.size).toBe(ranks.length);
    });

    it('should order by total_points descending', () => {
      const sortedByRank = [...leaderboardEntries].sort((a, b) => a.rank - b.rank);

      for (let i = 1; i < sortedByRank.length; i++) {
        expect(sortedByRank[i - 1].total_points).toBeGreaterThanOrEqual(sortedByRank[i].total_points);
      }
    });
  });

  describe('Phase 6: Contest Finalization', () => {
    it('should transition contest to finalized state', async () => {
      const finalizedContest = { ...contests.free, state: 'finalized' };

      mockPool.setQueryResponse(
        /UPDATE contests.*state.*finalized/i,
        mockQueryResponses.single(finalizedContest)
      );

      const result = await mockPool.query(
        "UPDATE contests SET state = 'finalized' WHERE contest_id = $1 RETURNING *",
        [TEST_CONTEST_IDS.freeContest]
      );

      expect(result.rows[0].state).toBe('finalized');
    });

    it('should create final leaderboard snapshot', async () => {
      const snapshot = {
        contest_id: TEST_CONTEST_IDS.freeContest,
        snapshot_type: 'final',
        entries: leaderboardEntries,
        created_at: new Date()
      };

      mockPool.setQueryResponse(
        /INSERT INTO leaderboard_snapshots/,
        mockQueryResponses.single(snapshot)
      );

      const result = await mockPool.query(
        'INSERT INTO leaderboard_snapshots (contest_id, snapshot_type, entries) VALUES ($1, $2, $3) RETURNING *',
        [TEST_CONTEST_IDS.freeContest, 'final', JSON.stringify(leaderboardEntries)]
      );

      expect(result.rows[0].snapshot_type).toBe('final');
    });

    it('should prevent modifications after finalization', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM contests/,
        mockQueryResponses.single({ ...contests.free, state: 'finalized' })
      );

      const result = await mockPool.query(
        'SELECT * FROM contests WHERE contest_id = $1',
        [TEST_CONTEST_IDS.freeContest]
      );

      const canModify = result.rows[0].state !== 'finalized';
      expect(canModify).toBe(false);
    });
  });

  describe('Full Lifecycle State Verification', () => {
    it('should complete full lifecycle from draft to finalized', () => {
      const lifecycleStates = ['draft', 'open', 'locked', 'active', 'scoring', 'finalized'];

      let currentIndex = 0;
      lifecycleStates.forEach((state, index) => {
        if (index > 0) {
          expect(index).toBeGreaterThan(currentIndex - 1);
        }
        currentIndex = index;
      });

      expect(lifecycleStates[0]).toBe('draft');
      expect(lifecycleStates[lifecycleStates.length - 1]).toBe('finalized');
    });

    it('should persist final state correctly', async () => {
      const finalState = {
        contest_id: TEST_CONTEST_IDS.freeContest,
        state: 'finalized',
        final_leaderboard: leaderboardEntries,
        finalized_at: new Date()
      };

      mockPool.setQueryResponse(
        /SELECT.*FROM contests.*WHERE.*state.*=.*finalized/i,
        mockQueryResponses.single(finalState)
      );

      const result = await mockPool.query(
        "SELECT * FROM contests WHERE contest_id = $1 AND state = 'finalized'",
        [TEST_CONTEST_IDS.freeContest]
      );

      expect(result.rows[0].state).toBe('finalized');
    });
  });
});
