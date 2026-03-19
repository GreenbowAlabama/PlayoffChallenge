/**
 * NFL Standard V1 — liveStandings Schema Test
 *
 * Verifies that liveStandings() returns correct LeaderboardRowAPIDTO shape.
 * Required fields: id, user_id, user_display_name, rank, values, tier
 */

const nflStandardV1 = require('../../services/strategies/nflStandardV1');

describe('nflStandardV1.liveStandings — LeaderboardRowAPIDTO schema', () => {
  it('returns rows with required schema: id, rank, values', async () => {
    const mockPool = {
      query: async (sql, params) => {
        return {
          rows: [
            {
              user_id: 'user-1',
              user_display_name: 'Alice',
              total_score: '250'
            },
            {
              user_id: 'user-2',
              user_display_name: 'Bob',
              total_score: '200'
            }
          ]
        };
      }
    };

    const result = await nflStandardV1.liveStandings(mockPool, 'contest-id');

    expect(result).toHaveLength(2);

    // Verify Alice (rank 1)
    expect(result[0].user_display_name).toBe('Alice');
    expect(result[0]).toHaveProperty('id');
    expect(typeof result[0].id).toBe('string');
    expect(result[0]).toHaveProperty('rank');
    expect(typeof result[0].rank).toBe('number');
    expect(result[0].rank).toBe(1);
    expect(result[0]).toHaveProperty('values');
    expect(typeof result[0].values).toBe('object');
    expect(result[0].values).toHaveProperty('total_score');
    expect(typeof result[0].values.total_score).toBe('number');
    expect(result[0].values.total_score).toBe(250);

    // Verify Bob (rank 2)
    expect(result[1].user_display_name).toBe('Bob');
    expect(result[1]).toHaveProperty('id');
    expect(result[1]).toHaveProperty('rank');
    expect(typeof result[1].rank).toBe('number');
    expect(result[1].rank).toBe(2);
    expect(result[1]).toHaveProperty('values');
    expect(result[1].values).toHaveProperty('total_score');
    expect(result[1].values.total_score).toBe(200);
  });
});
