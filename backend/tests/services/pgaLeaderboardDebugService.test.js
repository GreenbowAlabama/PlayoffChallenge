/**
 * PGA Leaderboard Debug Service Tests
 *
 * Purpose: Verify that the service correctly extracts golfer IDs from
 * ESPN leaderboard payload structure and normalizes them to espn_<id> format.
 *
 * Critical test: payload.competitors[] extraction and ID normalization
 */

const pgaLeaderboardDebugService = require('../../services/pgaLeaderboardDebugService');
const { randomUUID } = require('crypto');

describe('pgaLeaderboardDebugService', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = {
      query: jest.fn()
    };
  });

  describe('getPgaLeaderboardWithScores', () => {
    it('should extract golfer IDs from payload.competitors[] and normalize to espn_<id> format', async () => {
      const contestId = randomUUID();
      const athleteId1 = '10030';
      const athleteId2 = '20045';

      // Mock Step 1: Active contest exists
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ contest_id: contestId }]
        })
        // Mock Step 2: Snapshot with competitors structure
        .mockResolvedValueOnce({
          rows: [{
            payload: {
              competitors: [
                {
                  id: 'irrelevant',
                  athlete: { id: athleteId1 },
                  position: 1,
                  linescores: [
                    { linescores: [{ value: 3 }, { value: 4 }] }
                  ]
                },
                {
                  id: 'irrelevant2',
                  athlete: { id: athleteId2 },
                  position: 2,
                  linescores: [
                    { linescores: [{ value: 5 }, { value: 3 }] }
                  ]
                }
              ]
            }
          }]
        })
        // Mock Step 4: Player names (query returns empty, will use 'Unknown')
        .mockResolvedValueOnce({ rows: [] })
        // Mock Step 5: golfer_event_scores join
        .mockResolvedValueOnce({
          rows: [
            { golfer_id: `espn_${athleteId1}`, event_total_points: 150, fantasy_score: 75 },
            { golfer_id: `espn_${athleteId2}`, event_total_points: 140, fantasy_score: 70 }
          ]
        });

      const result = await pgaLeaderboardDebugService.getPgaLeaderboardWithScores(mockPool);

      // Verify extraction and normalization
      expect(result).toHaveLength(2);

      expect(result[0]).toEqual({
        golfer_id: `espn_${athleteId1}`,
        player_name: 'Unknown',
        position: 1,
        total_strokes: 7,
        fantasy_score: 75
      });

      expect(result[1]).toEqual({
        golfer_id: `espn_${athleteId2}`,
        player_name: 'Unknown',
        position: 2,
        total_strokes: 8,
        fantasy_score: 70
      });

      // Verify that golfer_event_scores query was called with normalized espn_<id> format
      const scoresQueryCall = mockPool.query.mock.calls[3];
      const queryParams = scoresQueryCall[1];
      const golferIds = queryParams[1];
      expect(golferIds).toContain(`espn_${athleteId1}`);
      expect(golferIds).toContain(`espn_${athleteId2}`);
    });

    it('should handle competitor.id fallback when athlete.id is missing', async () => {
      const contestId = randomUUID();
      const fallbackId = '99999';

      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ contest_id: contestId }]
        })
        .mockResolvedValueOnce({
          rows: [{
            payload: {
              competitors: [
                {
                  id: fallbackId,
                  position: 1,
                  linescores: []
                }
              ]
            }
          }]
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            { golfer_id: `espn_${fallbackId}`, event_total_points: 100, fantasy_score: 50 }
          ]
        });

      const result = await pgaLeaderboardDebugService.getPgaLeaderboardWithScores(mockPool);

      expect(result).toHaveLength(1);
      expect(result[0].golfer_id).toBe(`espn_${fallbackId}`);
    });

    it('should return empty array when payload.competitors is missing', async () => {
      const contestId = randomUUID();

      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ contest_id: contestId }]
        })
        .mockResolvedValueOnce({
          rows: [{
            payload: {
              // No competitors key
              golfers: []
            }
          }]
        });

      const result = await pgaLeaderboardDebugService.getPgaLeaderboardWithScores(mockPool);

      expect(result).toEqual([]);
    });

    it('should return empty array when no active contest exists', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await pgaLeaderboardDebugService.getPgaLeaderboardWithScores(mockPool);

      expect(result).toEqual([]);
    });

    it('should return empty array when no snapshots exist for contest', async () => {
      const contestId = randomUUID();

      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ contest_id: contestId }]
        })
        .mockResolvedValueOnce({ rows: [] });

      const result = await pgaLeaderboardDebugService.getPgaLeaderboardWithScores(mockPool);

      expect(result).toEqual([]);
    });

    it('should skip competitors with missing ID entirely', async () => {
      const contestId = randomUUID();
      const validId = '12345';

      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ contest_id: contestId }]
        })
        .mockResolvedValueOnce({
          rows: [{
            payload: {
              competitors: [
                {
                  // No id, no athlete.id — should be skipped
                  position: 1,
                  linescores: []
                },
                {
                  athlete: { id: validId },
                  position: 2,
                  linescores: []
                }
              ]
            }
          }]
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            { golfer_id: `espn_${validId}`, event_total_points: 100, fantasy_score: 50 }
          ]
        });

      const result = await pgaLeaderboardDebugService.getPgaLeaderboardWithScores(mockPool);

      // Only one competitor should be in result (invalid one skipped)
      expect(result).toHaveLength(1);
      expect(result[0].golfer_id).toBe(`espn_${validId}`);
    });
  });
});
