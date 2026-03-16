/**
 * Unit tests for PGA Standard Scoring finishing position computation
 * Verifies that the scoring strategy correctly computes finishing positions
 * from cumulative tournament strokes in the final round
 */

'use strict';

const { scoreRound } = require('../../services/scoring/strategies/pgaStandardScoring');

describe('PGA Standard Scoring - Finishing Positions', () => {
  describe('finish bonus table verification', () => {
    it('applies correct finish bonuses for positions 1-15 and ranges', () => {
      // Create golfers with distinct tournament strokes so they get positions 1-20
      const golfers = [];
      for (let i = 0; i < 20; i++) {
        golfers.push({
          golfer_id: `g${i + 1}`,
          holes: [{ par: 4, strokes: 68 }],
          tournament_strokes: 270 + i,  // 270, 271, 272, ..., 289
          position: 0
        });
      }

      const normalizedRoundPayload = {
        event_id: 'test_event',
        round_number: 4,
        golfers: golfers,
        is_final_round: true
      };

      const result = scoreRound({
        normalizedRoundPayload,
        templateRules: {}
      });

      // Expected finish bonuses by position
      const expectedByPosition = {
        1: 25, 2: 18, 3: 16, 4: 14, 5: 12, 6: 10, 7: 8, 8: 7, 9: 6, 10: 5,
        11: 4, 12: 4, 13: 4, 14: 4, 15: 4,
        16: 3, 17: 3, 18: 3, 19: 3, 20: 3
      };

      result.golfer_scores.forEach((score, idx) => {
        const position = idx + 1;  // Position = index + 1 (1-based)
        const expectedBonus = expectedByPosition[position];
        expect(score.finish_bonus).toBe(expectedBonus,
          `Position ${position} should have finish_bonus ${expectedBonus}, got ${score.finish_bonus}`);
      });
    });
  });

  describe('scoreRound with finishing positions', () => {
    it('ranks golfers by tournament_strokes (not current round holes) with ties [270,271,271,273]→[1,2,2,4]', () => {
      // CRITICAL BUG FIX: Tournament ranking must use cumulative tournament strokes,
      // not just current round holes. This test verifies the fix.
      const golfers = [
        {
          golfer_id: 'g1',
          holes: [{ par: 4, strokes: 68 }],  // Round 4 only: 68 strokes
          tournament_strokes: 270,             // Tournament total: 270
          position: 0
        },
        {
          golfer_id: 'g2',
          holes: [{ par: 4, strokes: 69 }],  // Round 4 only: 69 strokes
          tournament_strokes: 271,             // Tournament total: 271
          position: 0
        },
        {
          golfer_id: 'g3',
          holes: [{ par: 4, strokes: 69 }],  // Round 4 only: 69 strokes
          tournament_strokes: 271,             // Tournament total: 271 (tied)
          position: 0
        },
        {
          golfer_id: 'g4',
          holes: [{ par: 4, strokes: 71 }],  // Round 4 only: 71 strokes
          tournament_strokes: 273,             // Tournament total: 273
          position: 0
        }
      ];

      const normalizedRoundPayload = {
        event_id: 'test_event',
        round_number: 4,
        golfers: golfers,
        is_final_round: true
      };

      const result = scoreRound({
        normalizedRoundPayload,
        templateRules: {}
      });

      const scoresByGolferId = {};
      result.golfer_scores.forEach(score => {
        scoresByGolferId[score.golfer_id] = score;
      });

      // Verify correct positions based on tournament strokes, not round 4 strokes
      expect(scoresByGolferId['g1'].finish_bonus).toBe(25); // position 1 (270 strokes)
      expect(scoresByGolferId['g2'].finish_bonus).toBe(18); // position 2 (271 strokes)
      expect(scoresByGolferId['g3'].finish_bonus).toBe(18); // position 2 (271 strokes, tied)
      expect(scoresByGolferId['g4'].finish_bonus).toBe(14); // position 4 (273 strokes)
    });

    it('computes and applies positions correctly based on cumulative strokes with ties', () => {
      const golfers = [
        { golfer_id: 'espn_1001', holes: [
          { par: 4, strokes: 71 },
          { par: 4, strokes: 67 },
          { par: 4, strokes: 68 },
          { par: 4, strokes: 62 }
        ], tournament_strokes: 268, position: 0 },
        { golfer_id: 'espn_1002', holes: [
          { par: 4, strokes: 71 },
          { par: 4, strokes: 68 },
          { par: 4, strokes: 69 },
          { par: 4, strokes: 61 }
        ], tournament_strokes: 269, position: 0 },
        { golfer_id: 'espn_1003', holes: [
          { par: 4, strokes: 71 },
          { par: 4, strokes: 68 },
          { par: 4, strokes: 69 },
          { par: 4, strokes: 61 }
        ], tournament_strokes: 269, position: 0 },
        { golfer_id: 'espn_1004', holes: [
          { par: 4, strokes: 71 },
          { par: 4, strokes: 70 },
          { par: 4, strokes: 70 },
          { par: 4, strokes: 60 }
        ], tournament_strokes: 271, position: 0 }
      ];

      const normalizedRoundPayload = {
        event_id: 'test_event',
        round_number: 4,
        golfers: golfers,
        is_final_round: true
      };

      const result = scoreRound({
        normalizedRoundPayload,
        templateRules: {}
      });

      // Verify positions were computed: 268, 269, 269, 271 strokes
      const scoresByGolferId = {};
      result.golfer_scores.forEach(score => {
        scoresByGolferId[score.golfer_id] = score;
      });

      expect(scoresByGolferId['espn_1001'].finish_bonus).toBe(25); // position 1
      expect(scoresByGolferId['espn_1002'].finish_bonus).toBe(18); // position 2
      expect(scoresByGolferId['espn_1003'].finish_bonus).toBe(18); // position 2 (tied)
      expect(scoresByGolferId['espn_1004'].finish_bonus).toBe(14); // position 4
    });

    it('skips position computation when isFinalRound is false', () => {
      const golfers = [
        { golfer_id: 'g1', holes: [{ par: 4, strokes: 70 }], position: 0 }
      ];

      const normalizedRoundPayload = {
        event_id: 'test_event',
        round_number: 1,
        golfers: golfers,
        is_final_round: false
      };

      const result = scoreRound({
        normalizedRoundPayload,
        templateRules: {}
      });

      expect(result.golfer_scores[0].finish_bonus).toBe(0);
    });

    it('handles golfers with no holes data', () => {
      const golfers = [
        { golfer_id: 'g1', holes: [], tournament_strokes: 268, position: 0 },
        { golfer_id: 'g2', holes: [{ par: 4, strokes: 70 }], tournament_strokes: 270, position: 0 }
      ];

      const normalizedRoundPayload = {
        event_id: 'test_event',
        round_number: 4,
        golfers: golfers,
        is_final_round: true
      };

      const result = scoreRound({
        normalizedRoundPayload,
        templateRules: {}
      });

      const scoresByGolferId = {};
      result.golfer_scores.forEach(score => {
        scoresByGolferId[score.golfer_id] = score;
      });

      // g1 has 268 strokes (lower) -> position 1
      // g2 has 270 strokes -> position 2
      expect(scoresByGolferId['g1'].finish_bonus).toBe(25);
      expect(scoresByGolferId['g2'].finish_bonus).toBe(18);
    });

  });
});
