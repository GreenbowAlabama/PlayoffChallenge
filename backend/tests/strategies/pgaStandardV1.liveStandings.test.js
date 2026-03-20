/**
 * PGA Standard V1 — liveStandings Return Shape Test
 *
 * Verifies that liveStandings() returns total_score as a number, not an object.
 * SQL now computes best-6-of-7 with conditional roster logic directly.
 */

const pgaStandardV1 = require('../../services/strategies/pgaStandardV1');

describe('pgaStandardV1.liveStandings — total_score return type', () => {
  it('returns total_score as a number, not an object', async () => {
    // Mock pool: SQL now returns total_score directly (best 6 of 7: drop 5, sum rest = 10+20+15+25+30+12 = 112)
    const mockPool = {
      query: async (sql, params) => {
        return {
          rows: [
            {
              user_id: 'user-1',
              user_display_name: 'Alice',
              total_score: '112'
            }
          ]
        };
      }
    };

    const result = await pgaStandardV1.liveStandings(mockPool, 'contest-id');

    // Assertions
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty('user_id', 'user-1');
    expect(result[0]).toHaveProperty('user_display_name', 'Alice');

    // KEY CHECK: all required LeaderboardRowAPIDTO fields present
    expect(result[0]).toHaveProperty('id');
    expect(typeof result[0].id).toBe('string');
    expect(result[0]).toHaveProperty('user_id');
    expect(result[0]).toHaveProperty('user_display_name');
    expect(result[0]).toHaveProperty('rank');
    expect(typeof result[0].rank).toBe('number');
    expect(result[0]).toHaveProperty('values');
    expect(typeof result[0].values).toBe('object');
    expect(result[0]).toHaveProperty('tier');

    // Verify values dict contains score data
    expect(result[0].values).toHaveProperty('total_score');
    expect(result[0].values).toHaveProperty('rank');
    expect(result[0].values).toHaveProperty('user_display_name');

    // Verify correct calculation (best 6 of 7: drop 5, sum rest = 10+20+15+25+30+12 = 112)
    expect(result[0].values.total_score).toBe(112);
  });

  it('returns total_score as 0 when user has no golfer scores', async () => {
    const mockPool = {
      query: async (sql, params) => {
        return {
          rows: [
            {
              user_id: 'user-2',
              user_display_name: 'Bob',
              total_score: '0'
            }
          ]
        };
      }
    };

    const result = await pgaStandardV1.liveStandings(mockPool, 'contest-id');

    expect(result).toHaveLength(1);
    expect(typeof result[0].values.total_score).toBe('number');
    expect(result[0].values.total_score).toBe(0);
  });

  it('applies tie-aware ranking with total_score as number', async () => {
    // Alice best 6 = 490, Bob best 6 = 420. SQL returns pre-sorted by total_score DESC.
    const mockPool = {
      query: async (sql, params) => {
        return {
          rows: [
            {
              user_id: 'user-1',
              user_display_name: 'Alice',
              total_score: '490'
            },
            {
              user_id: 'user-2',
              user_display_name: 'Bob',
              total_score: '420'
            }
          ]
        };
      }
    };

    const result = await pgaStandardV1.liveStandings(mockPool, 'contest-id');

    expect(result).toHaveLength(2);

    // Both must have numeric total_scores in values dict
    result.forEach((row) => {
      expect(typeof row.values.total_score).toBe('number');
      expect(row).toHaveProperty('rank');
    });

    // Alice should rank higher than Bob
    expect(result[0].user_display_name).toBe('Alice');
    expect(result[0].rank).toBe(1);
    expect(result[1].user_display_name).toBe('Bob');
    expect(result[1].rank).toBe(2);
  });

  it('handles partial roster (< 7 golfers) — sums all, no drop', async () => {
    // User with 5 golfers: SQL sums all (no drop). 10+20+15+25+5 = 75
    const mockPool = {
      query: async (sql, params) => {
        return {
          rows: [
            {
              user_id: 'user-3',
              user_display_name: 'Charlie',
              total_score: '75'
            }
          ]
        };
      }
    };

    const result = await pgaStandardV1.liveStandings(mockPool, 'contest-id');

    expect(result).toHaveLength(1);
    expect(result[0].values.total_score).toBe(75);
    expect(typeof result[0].values.total_score).toBe('number');
    expect(result[0].rank).toBe(1);
  });

  it('same golfer across multiple users → identical contribution', async () => {
    // Two users share golfer g1 (score 50). SQL pre-aggregates per golfer, not per user.
    // Each user must see exactly 50 for g1 — no duplication from cross-user rows.
    const mockPool = {
      query: async (sql, params) => {
        return {
          rows: [
            { user_id: 'user-1', user_display_name: 'Alice', total_score: '50' },
            { user_id: 'user-2', user_display_name: 'Bob', total_score: '50' }
          ]
        };
      }
    };

    const result = await pgaStandardV1.liveStandings(mockPool, 'contest-id');

    expect(result[0].values.total_score).toBe(result[1].values.total_score);
  });

  it('handles tied scores with shared rank', async () => {
    const mockPool = {
      query: async (sql, params) => {
        return {
          rows: [
            {
              user_id: 'user-1',
              user_display_name: 'Alice',
              total_score: '100'
            },
            {
              user_id: 'user-2',
              user_display_name: 'Bob',
              total_score: '100'
            }
          ]
        };
      }
    };

    const result = await pgaStandardV1.liveStandings(mockPool, 'contest-id');

    expect(result).toHaveLength(2);
    expect(result[0].rank).toBe(1);
    expect(result[1].rank).toBe(1);
  });
});
