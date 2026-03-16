/**
 * Unit tests for PGA Standard Scoring finishing position computation
 * Verifies that the scoring strategy correctly computes finishing positions
 * from cumulative tournament strokes in the final round
 */

'use strict';

const { scoreRound } = require('../../services/scoring/strategies/pgaStandardScoring');

describe('PGA Standard Scoring - Finishing Positions', () => {
  describe('scoreRound with finishing positions', () => {
    it('computes and applies positions correctly based on cumulative strokes with ties', () => {
      const golfers = [
        { golfer_id: 'espn_1001', holes: [
          { par: 4, strokes: 71 },
          { par: 4, strokes: 67 },
          { par: 4, strokes: 68 },
          { par: 4, strokes: 62 }
        ], position: 0 },
        { golfer_id: 'espn_1002', holes: [
          { par: 4, strokes: 71 },
          { par: 4, strokes: 68 },
          { par: 4, strokes: 69 },
          { par: 4, strokes: 61 }
        ], position: 0 },
        { golfer_id: 'espn_1003', holes: [
          { par: 4, strokes: 71 },
          { par: 4, strokes: 68 },
          { par: 4, strokes: 69 },
          { par: 4, strokes: 61 }
        ], position: 0 },
        { golfer_id: 'espn_1004', holes: [
          { par: 4, strokes: 71 },
          { par: 4, strokes: 70 },
          { par: 4, strokes: 70 },
          { par: 4, strokes: 60 }
        ], position: 0 }
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
        { golfer_id: 'g1', holes: [], position: 0 },
        { golfer_id: 'g2', holes: [{ par: 4, strokes: 70 }], position: 0 }
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

      // g1 has 0 strokes (lower) -> position 1
      // g2 has 70 strokes -> position 2
      expect(scoresByGolferId['g1'].finish_bonus).toBe(25);
      expect(scoresByGolferId['g2'].finish_bonus).toBe(18);
    });

  });
});
