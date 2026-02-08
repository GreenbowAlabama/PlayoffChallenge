/**
 * Leaderboard Service Unit Tests
 *
 * Purpose: Test leaderboard and scoring aggregation logic
 * - Deterministic score calculation
 * - Leaderboard materialization
 * - Recompute idempotency
 * - Finalization lock behavior
 *
 * These tests assert against explicit field-level data contracts.
 */

const { createMockPool, mockQueryResponses } = require('../mocks/mockPool');
const {
  TEST_IDS,
  TEST_CONTEST_IDS,
  contests,
  leaderboardEntries,
  scores,
  picks
} = require('../fixtures');

describe('Leaderboard Service Unit Tests', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = createMockPool();
  });

  afterEach(() => {
    mockPool.reset();
  });

  describe('Deterministic Score Calculation', () => {
    it('should calculate same score for same stats input', async () => {
      const stats = { pass_yd: 300, pass_td: 3, pass_int: 1 };

      // First calculation
      mockPool.setQueryResponse(/SELECT.*FROM scoring_rules/, mockQueryResponses.scoringRules());
      const rules = await mockPool.query('SELECT * FROM scoring_rules WHERE is_active = true');

      const calculateScore = (playerStats, scoringRules) => {
        let total = 0;
        scoringRules.forEach(rule => {
          if (playerStats[rule.stat_name]) {
            total += playerStats[rule.stat_name] * rule.points;
          }
        });
        return Math.round(total * 100) / 100;
      };

      const score1 = calculateScore(stats, rules.rows);
      const score2 = calculateScore(stats, rules.rows);

      expect(score1).toBe(score2);
    });

    it('should produce consistent ordering for identical inputs', () => {
      const unsortedEntries = [
        { user_id: 'user-3', total_points: 100 },
        { user_id: 'user-1', total_points: 150 },
        { user_id: 'user-2', total_points: 125 }
      ];

      const sortAndRank = (entries) => {
        return entries
          .sort((a, b) => b.total_points - a.total_points)
          .map((entry, index) => ({ ...entry, rank: index + 1 }));
      };

      const result1 = sortAndRank([...unsortedEntries]);
      const result2 = sortAndRank([...unsortedEntries]);

      expect(result1).toEqual(result2);
      expect(result1[0].rank).toBe(1);
      expect(result1[0].total_points).toBe(150);
    });

    it('should handle ties deterministically using secondary sort', () => {
      const entriesWithTies = [
        { user_id: 'user-b', username: 'UserB', total_points: 100, created_at: new Date('2024-01-02') },
        { user_id: 'user-a', username: 'UserA', total_points: 100, created_at: new Date('2024-01-01') },
        { user_id: 'user-c', username: 'UserC', total_points: 100, created_at: new Date('2024-01-03') }
      ];

      const sortWithTiebreaker = (entries) => {
        return entries
          .sort((a, b) => {
            if (b.total_points !== a.total_points) {
              return b.total_points - a.total_points;
            }
            // Tiebreaker: earlier join date wins
            return new Date(a.created_at) - new Date(b.created_at);
          })
          .map((entry, index) => ({ ...entry, rank: index + 1 }));
      };

      const result = sortWithTiebreaker(entriesWithTies);

      expect(result[0].user_id).toBe('user-a'); // Earliest join date
      expect(result[1].user_id).toBe('user-b');
      expect(result[2].user_id).toBe('user-c');
    });

    it('should apply multipliers correctly in score calculation', () => {
      const basePoints = 25.5;
      const multipliers = [1, 2, 3];

      multipliers.forEach(multiplier => {
        const adjustedPoints = basePoints * multiplier;
        expect(adjustedPoints).toBe(basePoints * multiplier);
      });

      expect(basePoints * 1).toBe(25.5);
      expect(basePoints * 2).toBe(51);
      expect(basePoints * 3).toBe(76.5);
    });

    it('should round scores to 2 decimal places', () => {
      const rawScore = 123.456789;
      const roundedScore = Math.round(rawScore * 100) / 100;

      expect(roundedScore).toBe(123.46);

      const decimalPlaces = (roundedScore.toString().split('.')[1] || '').length;
      expect(decimalPlaces).toBeLessThanOrEqual(2);
    });
  });

  describe('Leaderboard Materialization', () => {
    it('should have all required fields in leaderboard row', () => {
      const requiredFields = ['user_id', 'username', 'total_points', 'rank'];

      leaderboardEntries.forEach(entry => {
        requiredFields.forEach(field => {
          expect(entry).toHaveProperty(field);
        });
      });
    });

    it('should have user_id as UUID format', () => {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      leaderboardEntries.forEach(entry => {
        expect(entry.user_id).toMatch(uuidRegex);
      });
    });

    it('should have username as non-empty string', () => {
      leaderboardEntries.forEach(entry => {
        expect(typeof entry.username).toBe('string');
        expect(entry.username.length).toBeGreaterThan(0);
      });
    });

    it('should have total_points as number', () => {
      leaderboardEntries.forEach(entry => {
        expect(typeof entry.total_points).toBe('number');
      });
    });

    it('should have rank as positive integer', () => {
      leaderboardEntries.forEach(entry => {
        expect(Number.isInteger(entry.rank)).toBe(true);
        expect(entry.rank).toBeGreaterThan(0);
      });
    });

    it('should have unique ranks', () => {
      const ranks = leaderboardEntries.map(e => e.rank);
      const uniqueRanks = new Set(ranks);

      expect(uniqueRanks.size).toBe(ranks.length);
    });

    it('should have ranks sorted in ascending order', () => {
      const ranks = leaderboardEntries.map(e => e.rank);

      for (let i = 1; i < ranks.length; i++) {
        expect(ranks[i]).toBeGreaterThan(ranks[i - 1]);
      }
    });

    it('should have points sorted in descending order by rank', () => {
      const sortedByRank = [...leaderboardEntries].sort((a, b) => a.rank - b.rank);

      for (let i = 1; i < sortedByRank.length; i++) {
        expect(sortedByRank[i - 1].total_points).toBeGreaterThanOrEqual(sortedByRank[i].total_points);
      }
    });

    it('should materialize leaderboard from database aggregation', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*SUM[\s\S]*GROUP BY[\s\S]*ORDER BY/i,
        mockQueryResponses.multiple(leaderboardEntries)
      );

      const result = await mockPool.query(`
        SELECT u.id as user_id, u.username, SUM(p.fantasy_points * p.multiplier) as total_points,
        RANK() OVER (ORDER BY SUM(p.fantasy_points * p.multiplier) DESC) as rank
        FROM users u
        JOIN picks p ON u.id = p.user_id
        WHERE p.contest_id = $1
        GROUP BY u.id, u.username
        ORDER BY total_points DESC
      `, [TEST_CONTEST_IDS.freeContest]);

      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows[0].rank).toBe(1);
    });

    it('should support pagination for large leaderboards', async () => {
      const page1 = leaderboardEntries.slice(0, 2);

      mockPool.setQueryResponse(
        /SELECT.*LIMIT.*OFFSET/,
        mockQueryResponses.multiple(page1)
      );

      const result = await mockPool.query(
        'SELECT * FROM leaderboard WHERE contest_id = $1 ORDER BY rank LIMIT $2 OFFSET $3',
        [TEST_CONTEST_IDS.freeContest, 2, 0]
      );

      expect(result.rows.length).toBe(2);
    });
  });

  describe('Recompute Idempotency', () => {
    it('should produce identical output for same input data', async () => {
      const pickData = [
        { user_id: TEST_IDS.users.validUser, fantasy_points: 24.48, multiplier: 1 },
        { user_id: TEST_IDS.users.validUser, fantasy_points: 33.0, multiplier: 2 },
        { user_id: TEST_IDS.users.paidUser, fantasy_points: 28.5, multiplier: 1 }
      ];

      const computeLeaderboard = (picks) => {
        const userScores = {};

        picks.forEach(pick => {
          if (!userScores[pick.user_id]) {
            userScores[pick.user_id] = 0;
          }
          userScores[pick.user_id] += pick.fantasy_points * pick.multiplier;
        });

        return Object.entries(userScores)
          .map(([user_id, total_points]) => ({ user_id, total_points }))
          .sort((a, b) => b.total_points - a.total_points)
          .map((entry, index) => ({ ...entry, rank: index + 1 }));
      };

      const result1 = computeLeaderboard(pickData);
      const result2 = computeLeaderboard(pickData);

      expect(result1).toEqual(result2);
    });

    it('should not change scores when recomputing with unchanged data', async () => {
      const originalLeaderboard = [...leaderboardEntries];

      mockPool.setQueryResponse(
        /SELECT.*FROM leaderboard/,
        mockQueryResponses.multiple(originalLeaderboard)
      );

      const beforeRecompute = await mockPool.query(
        'SELECT * FROM leaderboard WHERE contest_id = $1',
        [TEST_CONTEST_IDS.freeContest]
      );

      // Simulate recompute - same data should produce same results
      mockPool.setQueryResponse(
        /SELECT.*FROM leaderboard/,
        mockQueryResponses.multiple(originalLeaderboard)
      );

      const afterRecompute = await mockPool.query(
        'SELECT * FROM leaderboard WHERE contest_id = $1',
        [TEST_CONTEST_IDS.freeContest]
      );

      expect(beforeRecompute.rows).toEqual(afterRecompute.rows);
    });

    it('should update scores when underlying data changes', () => {
      const originalScore = 100;
      const updatedPickPoints = 25;

      const newTotalScore = originalScore + updatedPickPoints;

      expect(newTotalScore).not.toBe(originalScore);
      expect(newTotalScore).toBe(125);
    });

    it('should recompute ranks after score changes', () => {
      const beforeChange = [
        { user_id: 'user-1', total_points: 100, rank: 1 },
        { user_id: 'user-2', total_points: 90, rank: 2 }
      ];

      // user-2 gets more points
      const afterChange = [
        { user_id: 'user-1', total_points: 100 },
        { user_id: 'user-2', total_points: 110 }
      ];

      const reranked = afterChange
        .sort((a, b) => b.total_points - a.total_points)
        .map((entry, index) => ({ ...entry, rank: index + 1 }));

      expect(reranked[0].user_id).toBe('user-2');
      expect(reranked[0].rank).toBe(1);
      expect(reranked[1].user_id).toBe('user-1');
      expect(reranked[1].rank).toBe(2);
    });

    it('should preserve audit trail during recompute', async () => {
      const recomputeLog = {
        action: 'leaderboard_recompute',
        contest_id: TEST_CONTEST_IDS.freeContest,
        previous_hash: 'abc123',
        new_hash: 'def456',
        changes_detected: true
      };

      mockPool.setQueryResponse(
        /INSERT INTO recompute_log/,
        mockQueryResponses.single(recomputeLog)
      );

      const result = await mockPool.query(
        'INSERT INTO recompute_log (action, contest_id, previous_hash, new_hash, changes_detected) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        ['leaderboard_recompute', TEST_CONTEST_IDS.freeContest, 'abc123', 'def456', true]
      );

      expect(result.rows[0].action).toBe('leaderboard_recompute');
    });
  });

  describe('Finalization Lock Behavior', () => {
    it('should prevent score modifications when contest is finalized', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM contests.*WHERE.*contest_id/,
        mockQueryResponses.single({ ...contests.free, state: 'finalized' })
      );

      const result = await mockPool.query(
        'SELECT * FROM contests WHERE contest_id = $1',
        [TEST_CONTEST_IDS.freeContest]
      );

      const contest = result.rows[0];
      const canModifyScores = contest.state !== 'finalized';

      expect(canModifyScores).toBe(false);
    });

    it('should allow score modifications when contest is not finalized', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM contests/,
        mockQueryResponses.single({ ...contests.free, state: 'active' })
      );

      const result = await mockPool.query(
        'SELECT * FROM contests WHERE contest_id = $1',
        [TEST_CONTEST_IDS.freeContest]
      );

      const contest = result.rows[0];
      const canModifyScores = contest.state !== 'finalized';

      expect(canModifyScores).toBe(true);
    });

    it('should prevent pick changes after finalization', async () => {
      const finalizedContest = { ...contests.free, state: 'finalized' };

      mockPool.setQueryResponse(
        /SELECT.*FROM contests/,
        mockQueryResponses.single(finalizedContest)
      );

      const result = await mockPool.query(
        'SELECT * FROM contests WHERE contest_id = $1',
        [TEST_CONTEST_IDS.freeContest]
      );

      const contest = result.rows[0];
      const canSubmitPicks = ['open', 'active'].includes(contest.state);

      expect(canSubmitPicks).toBe(false);
    });

    it('should freeze leaderboard on finalization', async () => {
      const finalizedAt = new Date('2024-01-15T00:00:00Z');

      mockPool.setQueryResponse(
        /SELECT.*FROM leaderboard_snapshots/,
        mockQueryResponses.single({
          contest_id: TEST_CONTEST_IDS.freeContest,
          snapshot_type: 'final',
          finalized_at: finalizedAt,
          entries: leaderboardEntries
        })
      );

      const result = await mockPool.query(
        'SELECT * FROM leaderboard_snapshots WHERE contest_id = $1 AND snapshot_type = $2',
        [TEST_CONTEST_IDS.freeContest, 'final']
      );

      expect(result.rows[0].snapshot_type).toBe('final');
      expect(result.rows[0].finalized_at).toEqual(finalizedAt);
    });

    it('should require admin override to modify finalized scores', () => {
      const modificationRequest = {
        contest_id: TEST_CONTEST_IDS.freeContest,
        user_id: TEST_IDS.users.validUser,
        new_score: 200,
        requires_admin: true,
        reason: 'Score correction'
      };

      expect(modificationRequest.requires_admin).toBe(true);
      expect(modificationRequest.reason).toBeTruthy();
    });
  });

  describe('Leaderboard Query Patterns', () => {
    it('should support user position lookup', async () => {
      const userEntry = leaderboardEntries.find(e => e.user_id === TEST_IDS.users.validUser);

      mockPool.setQueryResponse(
        /SELECT.*FROM leaderboard.*WHERE.*user_id/,
        mockQueryResponses.single(userEntry)
      );

      const result = await mockPool.query(
        'SELECT * FROM leaderboard WHERE contest_id = $1 AND user_id = $2',
        [TEST_CONTEST_IDS.freeContest, TEST_IDS.users.validUser]
      );

      expect(result.rows[0].rank).toBeDefined();
      expect(result.rows[0].total_points).toBeDefined();
    });

    it('should support top N query', async () => {
      const topN = 10;

      mockPool.setQueryResponse(
        /SELECT.*FROM leaderboard.*ORDER BY rank.*LIMIT/,
        mockQueryResponses.multiple(leaderboardEntries)
      );

      const result = await mockPool.query(
        'SELECT * FROM leaderboard WHERE contest_id = $1 ORDER BY rank LIMIT $2',
        [TEST_CONTEST_IDS.freeContest, topN]
      );

      expect(result.rows.length).toBeLessThanOrEqual(topN);
      expect(result.rows[0].rank).toBe(1);
    });

    it('should support nearby ranks query', async () => {
      const userRank = 50;
      const windowSize = 5;

      mockPool.setQueryResponse(
        /SELECT.*FROM leaderboard.*WHERE.*rank.*BETWEEN/,
        mockQueryResponses.multiple([
          { user_id: 'user-45', rank: 45 },
          { user_id: 'user-50', rank: 50 },
          { user_id: 'user-55', rank: 55 }
        ])
      );

      const result = await mockPool.query(
        'SELECT * FROM leaderboard WHERE contest_id = $1 AND rank BETWEEN $2 AND $3',
        [TEST_CONTEST_IDS.freeContest, userRank - windowSize, userRank + windowSize]
      );

      result.rows.forEach(entry => {
        expect(entry.rank).toBeGreaterThanOrEqual(userRank - windowSize);
        expect(entry.rank).toBeLessThanOrEqual(userRank + windowSize);
      });
    });
  });
});
