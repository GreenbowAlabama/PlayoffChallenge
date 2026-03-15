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
        // Mock Steps 4-5 (Combined): golfer_event_scores + player names in one query
        .mockResolvedValueOnce({
          rows: [
            { golfer_id: `espn_${athleteId1}`, fantasy_score: 75, player_name: null },
            { golfer_id: `espn_${athleteId2}`, fantasy_score: 70, player_name: null }
          ]
        });

      const result = await pgaLeaderboardDebugService.getPgaLeaderboardWithScores(mockPool);

      // Verify extraction and normalization
      expect(result).toHaveLength(2);

      // Verify results are sorted by score (ascending, lower is better) and ranked
      expect(result[0]).toEqual({
        golfer_id: `espn_${athleteId1}`,
        player_name: 'Unknown',
        position: 1,
        score: 0,
        fantasy_score: 75
      });

      expect(result[1]).toEqual({
        golfer_id: `espn_${athleteId2}`,
        player_name: 'Unknown',
        position: 2,
        score: 0,
        fantasy_score: 70
      });

      // Verify that combined scores + names query was called with normalized espn_<id> format
      // Query calls: [0] contest, [1] snapshot, [2] scores+names
      const scoresQueryCall = mockPool.query.mock.calls[2];
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
        .mockResolvedValueOnce({
          rows: [
            { golfer_id: `espn_${fallbackId}`, fantasy_score: 50, player_name: null }
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

    it('should sort golfers by total strokes and assign positions correctly', async () => {
      const contestId = randomUUID();
      const athleteId1 = '10030';  // 280 strokes
      const athleteId2 = '20045';  // 275 strokes (should be position 1)
      const athleteId3 = '30050';  // 0 strokes (not started, should be last)

      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ contest_id: contestId }]
        })
        .mockResolvedValueOnce({
          rows: [{
            payload: {
              competitors: [
                {
                  id: 'id1',
                  athlete: { id: athleteId1 },
                  linescores: [
                    { linescores: [{ value: 4 }, { value: 4 }, { value: 4 }, { value: 4 },
                                  { value: 4 }, { value: 4 }, { value: 4 }, { value: 4 },
                                  { value: 4 }, { value: 4 }, { value: 4 }, { value: 4 },
                                  { value: 4 }, { value: 4 }, { value: 4 }, { value: 4 },
                                  { value: 4 }, { value: 4 }] }
                  ]
                },
                {
                  id: 'id2',
                  athlete: { id: athleteId2 },
                  linescores: [
                    { linescores: [{ value: 3 }, { value: 3 }, { value: 3 }, { value: 3 },
                                  { value: 3 }, { value: 3 }, { value: 3 }, { value: 3 },
                                  { value: 3 }, { value: 4 }, { value: 4 }, { value: 3 },
                                  { value: 3 }, { value: 3 }, { value: 3 }, { value: 3 },
                                  { value: 3 }, { value: 3 }] }
                  ]
                },
                {
                  id: 'id3',
                  athlete: { id: athleteId3 },
                  linescores: []  // 0 strokes
                }
              ]
            }
          }]
        })
        .mockResolvedValueOnce({
          rows: [
            { golfer_id: `espn_${athleteId1}`, player_name: null, score_to_par: 0, fantasy_score: 0 },
            { golfer_id: `espn_${athleteId2}`, player_name: null, score_to_par: -16, fantasy_score: 0 },
            { golfer_id: `espn_${athleteId3}`, player_name: null, score_to_par: 0, fantasy_score: 0 }
          ]
        });

      const result = await pgaLeaderboardDebugService.getPgaLeaderboardWithScores(mockPool);

      expect(result).toHaveLength(3);

      // Verify sorting by score (lowest/most negative first)
      // athleteId2: -16 (16 under par) = position 1
      // athleteId1: 0 (even par) = position 2
      // athleteId3: 0 (not started) = position 3 (last)
      expect(result[0].golfer_id).toBe(`espn_${athleteId2}`);
      expect(result[0].score).toBe(-16);
      expect(result[0].position).toBe(1);

      expect(result[1].golfer_id).toBe(`espn_${athleteId1}`);
      expect(result[1].score).toBe(0);
      expect(result[1].position).toBe(2);

      expect(result[2].golfer_id).toBe(`espn_${athleteId3}`);
      expect(result[2].score).toBe(0);
      expect(result[2].position).toBe(3);  // Not started, last position
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
        .mockResolvedValueOnce({
          rows: [
            { golfer_id: `espn_${validId}`, fantasy_score: 50, player_name: null }
          ]
        });

      const result = await pgaLeaderboardDebugService.getPgaLeaderboardWithScores(mockPool);

      // Only one competitor should be in result (invalid one skipped)
      expect(result).toHaveLength(1);
      expect(result[0].golfer_id).toBe(`espn_${validId}`);
    });
  });
});
