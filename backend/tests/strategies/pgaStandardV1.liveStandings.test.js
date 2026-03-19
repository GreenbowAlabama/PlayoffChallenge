/**
 * PGA Standard V1 — liveStandings Return Shape Test
 *
 * Verifies that liveStandings() returns total_score as a number, not an object.
 * This test guards against the regression where aggregateEntryScore() was returned
 * as a whole object instead of extracting entry_total.
 */

const pgaStandardV1 = require('../../services/strategies/pgaStandardV1');
const { aggregateEntryScore } = require('../../services/scoring/pgaEntryAggregation');

describe('pgaStandardV1.liveStandings — total_score return type', () => {
  it('returns total_score as a number, not an object', async () => {
    // Mock pool that simulates contest_participants with golfer_scores
    const mockPool = {
      query: async (sql, params) => {
        // Simulate the liveStandings query result
        return {
          rows: [
            {
              user_id: 'user-1',
              user_display_name: 'Alice',
              golfer_scores_array: [
                { golfer_id: 'g1', total_points: 10 },
                { golfer_id: 'g2', total_points: 20 },
                { golfer_id: 'g3', total_points: 15 },
                { golfer_id: 'g4', total_points: 25 },
                { golfer_id: 'g5', total_points: 5 },
                { golfer_id: 'g6', total_points: 30 },
                { golfer_id: 'g7', total_points: 12 }
              ]
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
              golfer_scores_array: null
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
    const mockPool = {
      query: async (sql, params) => {
        return {
          rows: [
            {
              user_id: 'user-1',
              user_display_name: 'Alice',
              golfer_scores_array: [
                { golfer_id: 'g1', total_points: 100 },
                { golfer_id: 'g2', total_points: 90 },
                { golfer_id: 'g3', total_points: 80 },
                { golfer_id: 'g4', total_points: 70 },
                { golfer_id: 'g5', total_points: 60 },
                { golfer_id: 'g6', total_points: 50 },
                { golfer_id: 'g7', total_points: 40 }
              ]
            },
            {
              user_id: 'user-2',
              user_display_name: 'Bob',
              golfer_scores_array: [
                { golfer_id: 'g1', total_points: 95 },
                { golfer_id: 'g2', total_points: 85 },
                { golfer_id: 'g3', total_points: 75 },
                { golfer_id: 'g4', total_points: 65 },
                { golfer_id: 'g5', total_points: 55 },
                { golfer_id: 'g6', total_points: 45 },
                { golfer_id: 'g7', total_points: 35 }
              ]
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

    // Alice (sum of 490) should rank higher than Bob (sum of 450)
    expect(result[0].user_display_name).toBe('Alice');
    expect(result[0].rank).toBe(1);
    expect(result[1].user_display_name).toBe('Bob');
    expect(result[1].rank).toBe(2);
  });
});
