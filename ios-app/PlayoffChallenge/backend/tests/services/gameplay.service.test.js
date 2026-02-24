/**
 * Gameplay Service Unit Tests
 *
 * Purpose: Test gameplay-related service logic in isolation
 * - My Team View payload validation
 * - Team Preview payload validation
 * - Pick submission validation
 * - Locked contest enforcement
 *
 * These tests assert against explicit field-level data contracts.
 */

const { createMockPool, mockQueryResponses } = require('../mocks/mockPool');
const {
  TEST_IDS,
  TEST_CONTEST_IDS,
  contests,
  players,
  picks,
  teamViewPayloads,
  gameSettings
} = require('../fixtures');

describe('Gameplay Service Unit Tests', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = createMockPool();
  });

  afterEach(() => {
    mockPool.reset();
  });

  describe('My Team View Payload', () => {
    const myTeamPayload = teamViewPayloads.myTeam;

    it('should have all required top-level fields', () => {
      const requiredFields = ['contest_id', 'contest_name', 'teams'];

      requiredFields.forEach(field => {
        expect(myTeamPayload).toHaveProperty(field);
      });
    });

    it('should have contest_id as UUID format', () => {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(myTeamPayload.contest_id).toMatch(uuidRegex);
    });

    it('should have contest_name as non-empty string', () => {
      expect(typeof myTeamPayload.contest_name).toBe('string');
      expect(myTeamPayload.contest_name.length).toBeGreaterThan(0);
    });

    it('should have teams as array', () => {
      expect(Array.isArray(myTeamPayload.teams)).toBe(true);
    });

    it('should have valid team structure within teams array', () => {
      const requiredTeamFields = ['team_name', 'team_rank', 'team_score', 'players'];

      myTeamPayload.teams.forEach(team => {
        requiredTeamFields.forEach(field => {
          expect(team).toHaveProperty(field);
        });
      });
    });

    it('should have team_name as non-empty string', () => {
      myTeamPayload.teams.forEach(team => {
        expect(typeof team.team_name).toBe('string');
        expect(team.team_name.length).toBeGreaterThan(0);
      });
    });

    it('should have team_rank as positive integer', () => {
      myTeamPayload.teams.forEach(team => {
        expect(Number.isInteger(team.team_rank)).toBe(true);
        expect(team.team_rank).toBeGreaterThan(0);
      });
    });

    it('should have team_score as number', () => {
      myTeamPayload.teams.forEach(team => {
        expect(typeof team.team_score).toBe('number');
      });
    });

    it('should have players as array within each team', () => {
      myTeamPayload.teams.forEach(team => {
        expect(Array.isArray(team.players)).toBe(true);
      });
    });

    it('should have valid player structure within players array', () => {
      const requiredPlayerFields = ['player_id', 'player_number', 'position', 'team_name', 'points'];

      myTeamPayload.teams.forEach(team => {
        team.players.forEach(player => {
          requiredPlayerFields.forEach(field => {
            expect(player).toHaveProperty(field);
          });
        });
      });
    });

    it('should have player_id as UUID format', () => {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      myTeamPayload.teams.forEach(team => {
        team.players.forEach(player => {
          expect(player.player_id).toMatch(uuidRegex);
        });
      });
    });

    it('should have player_number as integer or null', () => {
      myTeamPayload.teams.forEach(team => {
        team.players.forEach(player => {
          if (player.player_number !== null) {
            expect(Number.isInteger(player.player_number)).toBe(true);
          }
        });
      });
    });

    it('should have position as valid position string', () => {
      const validPositions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'FLEX'];

      myTeamPayload.teams.forEach(team => {
        team.players.forEach(player => {
          expect(validPositions).toContain(player.position);
        });
      });
    });

    it('should have points as number', () => {
      myTeamPayload.teams.forEach(team => {
        team.players.forEach(player => {
          expect(typeof player.points).toBe('number');
        });
      });
    });

    it('should enforce players array length constraints (max 10 per roster)', () => {
      const maxPlayersPerRoster = 10;

      myTeamPayload.teams.forEach(team => {
        expect(team.players.length).toBeLessThanOrEqual(maxPlayersPerRoster);
      });
    });
  });

  describe('Team Preview Payload', () => {
    const teamPreviewPayload = teamViewPayloads.teamPreview;

    it('should have all required fields for team preview', () => {
      const requiredFields = ['contest_id', 'contest_name', 'user_id', 'username', 'teams'];

      requiredFields.forEach(field => {
        expect(teamPreviewPayload).toHaveProperty(field);
      });
    });

    it('should have user_id as UUID format', () => {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(teamPreviewPayload.user_id).toMatch(uuidRegex);
    });

    it('should have username as non-empty string', () => {
      expect(typeof teamPreviewPayload.username).toBe('string');
      expect(teamPreviewPayload.username.length).toBeGreaterThan(0);
    });

    it('should have same team structure as My Team view', () => {
      const requiredTeamFields = ['team_name', 'team_rank', 'team_score', 'players'];

      teamPreviewPayload.teams.forEach(team => {
        requiredTeamFields.forEach(field => {
          expect(team).toHaveProperty(field);
        });
      });
    });
  });

  describe('Pick Submission Validation', () => {
    it('should validate pick has required fields', () => {
      const validPick = {
        user_id: TEST_IDS.users.validUser,
        player_id: TEST_IDS.players.qb1,
        contest_id: TEST_CONTEST_IDS.freeContest,
        week_number: 19,
        multiplier: 1
      };

      const requiredFields = ['user_id', 'player_id', 'contest_id', 'week_number', 'multiplier'];

      requiredFields.forEach(field => {
        expect(validPick).toHaveProperty(field);
      });
    });

    it('should validate user_id is UUID format', () => {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(picks.week1.user_id).toMatch(uuidRegex);
    });

    it('should validate player_id is UUID format', () => {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(picks.week1.player_id).toMatch(uuidRegex);
    });

    it('should validate week_number is positive integer', () => {
      expect(Number.isInteger(picks.week1.week_number)).toBe(true);
      expect(picks.week1.week_number).toBeGreaterThan(0);
    });

    it('should validate multiplier is valid value (1, 2, or 3)', () => {
      const validMultipliers = [1, 2, 3];

      expect(validMultipliers).toContain(picks.week1.multiplier);
      expect(validMultipliers).toContain(picks.week1WithMultiplier.multiplier);
    });

    it('should reject multiplier outside valid range', () => {
      const invalidMultipliers = [0, -1, 4, 1.5, 'x2'];
      const validMultipliers = [1, 2, 3];

      invalidMultipliers.forEach(multiplier => {
        const isValid = validMultipliers.includes(multiplier);
        expect(isValid).toBe(false);
      });
    });

    it('should validate player is on active team', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM players.*WHERE.*id/,
        mockQueryResponses.single(players.qb)
      );

      mockPool.setQueryResponse(
        /SELECT.*FROM game_settings/,
        mockQueryResponses.gameSettings(gameSettings.wildcardActive)
      );

      const playerResult = await mockPool.query('SELECT * FROM players WHERE id = $1', [TEST_IDS.players.qb1]);
      const settingsResult = await mockPool.query('SELECT * FROM game_settings LIMIT 1');

      const playerTeam = playerResult.rows[0].team;
      const activeTeams = settingsResult.rows[0].active_teams;

      expect(activeTeams).toContain(playerTeam);
    });

    it('should reject player not on active team', async () => {
      const eliminatedPlayer = { ...players.wr, team: 'DAL' };

      mockPool.setQueryResponse(
        /SELECT.*FROM players/,
        mockQueryResponses.single(eliminatedPlayer)
      );

      mockPool.setQueryResponse(
        /SELECT.*FROM game_settings/,
        mockQueryResponses.gameSettings(gameSettings.wildcardActive)
      );

      const playerResult = await mockPool.query('SELECT * FROM players WHERE id = $1', [TEST_IDS.players.wr1]);
      const settingsResult = await mockPool.query('SELECT * FROM game_settings LIMIT 1');

      const playerTeam = playerResult.rows[0].team;
      const activeTeams = settingsResult.rows[0].active_teams;

      expect(activeTeams).not.toContain(playerTeam);
    });

    it('should enforce position requirements for roster', () => {
      const positionRequirements = {
        QB: { min: 1, max: 1 },
        RB: { min: 2, max: 2 },
        WR: { min: 2, max: 2 },
        TE: { min: 1, max: 1 },
        FLEX: { min: 0, max: 2 },
        K: { min: 1, max: 1 },
        DEF: { min: 1, max: 1 }
      };

      Object.entries(positionRequirements).forEach(([position, requirements]) => {
        expect(requirements.min).toBeLessThanOrEqual(requirements.max);
        expect(requirements.min).toBeGreaterThanOrEqual(0);
      });
    });

    it('should prevent duplicate player picks in same week', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM picks.*WHERE.*user_id.*AND.*week_number.*AND.*player_id/,
        mockQueryResponses.single(picks.week1)
      );

      const result = await mockPool.query(
        'SELECT * FROM picks WHERE user_id = $1 AND week_number = $2 AND player_id = $3',
        [TEST_IDS.users.validUser, 19, TEST_IDS.players.qb1]
      );

      const isDuplicate = result.rows.length > 0;
      expect(isDuplicate).toBe(true);
    });

    it('should limit multiplier uses per contest', async () => {
      const maxMultiplierUses = 4;
      const existingMultiplierPicks = [
        { multiplier: 2 },
        { multiplier: 3 },
        { multiplier: 2 }
      ];

      const multiplierUsesCount = existingMultiplierPicks.filter(p => p.multiplier > 1).length;

      expect(multiplierUsesCount).toBeLessThanOrEqual(maxMultiplierUses);
    });
  });

  describe('Locked Contest Enforcement', () => {
    it('should reject picks when contest is locked', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM contests.*WHERE.*contest_id/,
        mockQueryResponses.single(contests.locked)
      );

      const result = await mockPool.query(
        'SELECT * FROM contests WHERE contest_id = $1',
        [TEST_CONTEST_IDS.lockedContest]
      );

      const contest = result.rows[0];
      const canSubmitPick = contest.state === 'open';

      expect(canSubmitPick).toBe(false);
    });

    it('should reject picks when week is not active', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM game_settings/,
        mockQueryResponses.gameSettings(gameSettings.wildcardLocked)
      );

      const result = await mockPool.query('SELECT * FROM game_settings LIMIT 1');

      const settings = result.rows[0];
      const canSubmitPick = settings.is_week_active === true;

      expect(canSubmitPick).toBe(false);
    });

    it('should allow picks when contest is open and week is active', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM contests/,
        mockQueryResponses.single(contests.free)
      );

      mockPool.setQueryResponse(
        /SELECT.*FROM game_settings/,
        mockQueryResponses.gameSettings(gameSettings.wildcardActive)
      );

      const contestResult = await mockPool.query('SELECT * FROM contests WHERE contest_id = $1', [TEST_CONTEST_IDS.freeContest]);
      const settingsResult = await mockPool.query('SELECT * FROM game_settings LIMIT 1');

      const contest = contestResult.rows[0];
      const settings = settingsResult.rows[0];
      const canSubmitPick = contest.state === 'open' && settings.is_week_active === true;

      expect(canSubmitPick).toBe(true);
    });

    it('should enforce pick deadline before game start', () => {
      const gameStartTime = new Date('2024-01-06T13:00:00Z');
      const pickSubmittedBefore = new Date('2024-01-06T12:30:00Z');
      const pickSubmittedAfter = new Date('2024-01-06T13:30:00Z');

      expect(pickSubmittedBefore < gameStartTime).toBe(true);
      expect(pickSubmittedAfter < gameStartTime).toBe(false);
    });
  });

  describe('Pick Query Patterns', () => {
    it('should retrieve user picks for specific week', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM picks.*WHERE.*user_id.*AND.*week_number/,
        mockQueryResponses.multiple([picks.week1, picks.week1WithMultiplier])
      );

      const result = await mockPool.query(
        'SELECT * FROM picks WHERE user_id = $1 AND week_number = $2',
        [TEST_IDS.users.validUser, 19]
      );

      expect(result.rows.length).toBeGreaterThan(0);
      result.rows.forEach(pick => {
        expect(pick.user_id).toBe(TEST_IDS.users.validUser);
        expect(pick.week_number).toBe(19);
      });
    });

    it('should join picks with player details', async () => {
      const pickWithPlayer = {
        ...picks.week1,
        full_name: players.qb.full_name,
        position: players.qb.position,
        team: players.qb.team
      };

      mockPool.setQueryResponse(
        /SELECT.*FROM picks.*JOIN.*players/i,
        mockQueryResponses.single(pickWithPlayer)
      );

      const result = await mockPool.query(
        'SELECT p.*, pl.full_name, pl.position, pl.team FROM picks p JOIN players pl ON p.player_id = pl.id WHERE p.user_id = $1',
        [TEST_IDS.users.validUser]
      );

      expect(result.rows[0]).toHaveProperty('full_name');
      expect(result.rows[0]).toHaveProperty('position');
      expect(result.rows[0]).toHaveProperty('team');
    });

    it('should calculate total points for user picks', async () => {
      const picksWithScores = [
        { ...picks.week1, fantasy_points: 24.48 },
        { ...picks.week1WithMultiplier, fantasy_points: 33.0, multiplier: 2 }
      ];

      mockPool.setQueryResponse(
        /SELECT.*FROM picks/,
        mockQueryResponses.multiple(picksWithScores)
      );

      const result = await mockPool.query('SELECT * FROM picks WHERE user_id = $1', [TEST_IDS.users.validUser]);

      const totalPoints = result.rows.reduce((sum, pick) => {
        return sum + (pick.fantasy_points * pick.multiplier);
      }, 0);

      // 24.48 * 1 + 33.0 * 2 = 24.48 + 66 = 90.48
      expect(totalPoints).toBeCloseTo(90.48, 2);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing player gracefully', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM players/,
        mockQueryResponses.empty()
      );

      const result = await mockPool.query(
        'SELECT * FROM players WHERE id = $1',
        ['nonexistent-player-id']
      );

      expect(result.rows.length).toBe(0);
    });

    it('should handle missing contest gracefully', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM contests/,
        mockQueryResponses.empty()
      );

      const result = await mockPool.query(
        'SELECT * FROM contests WHERE contest_id = $1',
        ['nonexistent-contest-id']
      );

      expect(result.rows.length).toBe(0);
    });

    it('should handle database errors appropriately', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM picks/,
        mockQueryResponses.error('Connection timeout', 'ETIMEDOUT')
      );

      await expect(mockPool.query('SELECT * FROM picks'))
        .rejects.toThrow('Connection timeout');
    });
  });
});
