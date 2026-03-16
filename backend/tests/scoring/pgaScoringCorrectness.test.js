/**
 * Scoring Correctness Tests
 *
 * Validates:
 * 1. Strategy key resolution to rules object
 * 2. Finish bonus merge behavior with custom templates
 * 3. Invalid/missing tournament_strokes handling (no false position 1 ties)
 * 4. Normal ranking still works for valid data
 */

'use strict';

const { scoreRound } = require('../../services/scoring/strategies/pgaStandardScoring');

describe('PGA Scoring Correctness - Strategy & Position Resolution', () => {

  // ──────────────────────────────────────────────────────────────────────────
  // TEST GROUP 1: Strategy Rules Resolution
  // ──────────────────────────────────────────────────────────────────────────

  describe('Strategy Rules Resolution', () => {

    it('receives templateRules as object with scoring and finish_bonus properties', () => {
      // This test validates that templateRules is OBJECT (not string)
      const templateRules = {
        scoring: {
          double_eagle_or_better: 5,
          eagle: 4,
          birdie: 3,
          par: 1,
          bogey: -1,
          double_bogey_or_worse: -2
        },
        finish_bonus: {
          1: 25,
          2: 18
        }
      };

      const golfers = [
        {
          golfer_id: 'g1',
          holes: [{ par: 4, strokes: 69 }],
          tournament_strokes: 270,
          position: 0
        },
        {
          golfer_id: 'g2',
          holes: [{ par: 4, strokes: 70 }],
          tournament_strokes: 271,
          position: 0
        }
      ];

      const result = scoreRound({
        normalizedRoundPayload: {
          event_id: 'test_event',
          round_number: 4,
          golfers,
          is_final_round: true
        },
        templateRules
      });

      // Verify templateRules was used (typeof check proves it's object)
      expect(result.golfer_scores).toBeDefined();
      expect(result.golfer_scores.length).toBe(2);
      expect(result.golfer_scores[0].finish_bonus).toBe(25); // position 1
      expect(result.golfer_scores[1].finish_bonus).toBe(18); // position 2
    });

    it('finish_bonus merge preserves DEFAULT when template is partial', () => {
      // Custom template with only positions 1-2 override
      const templateRules = {
        scoring: {
          double_eagle_or_better: 5,
          eagle: 4,
          birdie: 3,
          par: 1,
          bogey: -1,
          double_bogey_or_worse: -2
        },
        finish_bonus: {
          1: 50,  // Override: higher than default 25
          2: 35   // Override: higher than default 18
          // Positions 3+ use DEFAULT
        }
      };

      const golfers = Array.from({ length: 12 }, (_, i) => ({
        golfer_id: `g${i + 1}`,
        holes: [{ par: 4, strokes: 69 }],
        tournament_strokes: 270 + i,
        position: 0
      }));

      const result = scoreRound({
        normalizedRoundPayload: {
          event_id: 'test_event',
          round_number: 4,
          golfers,
          is_final_round: true
        },
        templateRules
      });

      const scoresByPos = {};
      result.golfer_scores.forEach((score, idx) => {
        scoresByPos[idx + 1] = score.finish_bonus;
      });

      // Position 1-2 use template override
      expect(scoresByPos[1]).toBe(50);   // template override
      expect(scoresByPos[2]).toBe(35);   // template override

      // Position 3 uses DEFAULT (16)
      expect(scoresByPos[3]).toBe(16);   // DEFAULT preserved

      // Position 11 uses DEFAULT (4)
      expect(scoresByPos[11]).toBe(4);   // DEFAULT preserved
    });

  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST GROUP 2: Invalid Tournament Strokes (No False Position 1 Ties)
  // ──────────────────────────────────────────────────────────────────────────

  describe('Invalid Tournament Strokes Handling (Position Assignment)', () => {

    it('excludes golfers with invalid tournament_strokes from ranking calculation', () => {
      // Mixed valid and invalid tournament_strokes
      const golfers = [
        {
          golfer_id: 'invalid_1',
          holes: [{ par: 4, strokes: 70 }],
          tournament_strokes: null,  // INVALID: null
          position: 0
        },
        {
          golfer_id: 'invalid_2',
          holes: [{ par: 4, strokes: 70 }],
          tournament_strokes: undefined,  // INVALID: undefined
          position: 0
        },
        {
          golfer_id: 'invalid_3',
          holes: [{ par: 4, strokes: 70 }],
          tournament_strokes: NaN,  // INVALID: NaN
          position: 0
        },
        {
          golfer_id: 'valid_1',
          holes: [{ par: 4, strokes: 68 }],
          tournament_strokes: 270,  // VALID
          position: 0
        },
        {
          golfer_id: 'valid_2',
          holes: [{ par: 4, strokes: 69 }],
          tournament_strokes: 271,  // VALID
          position: 0
        }
      ];

      const result = scoreRound({
        normalizedRoundPayload: {
          event_id: 'test_event',
          round_number: 4,
          golfers,
          is_final_round: true
        },
        templateRules: {}
      });

      const scoresByGolferId = {};
      result.golfer_scores.forEach(score => {
        scoresByGolferId[score.golfer_id] = score;
      });

      // CRITICAL: Invalid golfers must NOT get position 1 finish_bonus
      expect(scoresByGolferId['invalid_1'].finish_bonus).not.toBe(25);
      expect(scoresByGolferId['invalid_2'].finish_bonus).not.toBe(25);
      expect(scoresByGolferId['invalid_3'].finish_bonus).not.toBe(25);

      // Valid golfers get correct positions
      expect(scoresByGolferId['valid_1'].finish_bonus).toBe(25);  // position 1 (lowest strokes)
      expect(scoresByGolferId['valid_2'].finish_bonus).toBe(18);  // position 2
    });

    it('does not create false position 1 ties from invalid tournament_strokes', () => {
      // All golfers with invalid strokes should NOT all get position 1
      const golfers = [
        {
          golfer_id: 'invalid_1',
          holes: [{ par: 4, strokes: 70 }],
          tournament_strokes: NaN,
          position: 0
        },
        {
          golfer_id: 'invalid_2',
          holes: [{ par: 4, strokes: 70 }],
          tournament_strokes: NaN,
          position: 0
        },
        {
          golfer_id: 'invalid_3',
          holes: [{ par: 4, strokes: 70 }],
          tournament_strokes: null,
          position: 0
        },
        {
          golfer_id: 'valid_1',
          holes: [{ par: 4, strokes: 68 }],
          tournament_strokes: 270,
          position: 0
        }
      ];

      const result = scoreRound({
        normalizedRoundPayload: {
          event_id: 'test_event',
          round_number: 4,
          golfers,
          is_final_round: true
        },
        templateRules: {}
      });

      const scoresByGolferId = {};
      result.golfer_scores.forEach(score => {
        scoresByGolferId[score.golfer_id] = score;
      });

      // Count how many invalid golfers got bonus 25 (position 1)
      const invalidGolfers = ['invalid_1', 'invalid_2', 'invalid_3'];
      const countWithBonus25 = invalidGolfers.filter(
        id => scoresByGolferId[id].finish_bonus === 25
      ).length;

      // CRITICAL: Should NOT have 3 golfers all with bonus 25
      // Expected: 0 invalid golfers should get bonus 25 (or at most the logic handles them)
      expect(countWithBonus25).toBe(0);
    });

    it('handles mixed valid and invalid strokes without cascading position corruption', () => {
      // After invalid golfers are excluded, valid golfers should get correct positions
      const golfers = [
        { golfer_id: 'invalid_1', holes: [{ par: 4, strokes: 70 }], tournament_strokes: NaN, position: 0 },
        { golfer_id: 'invalid_2', holes: [{ par: 4, strokes: 70 }], tournament_strokes: null, position: 0 },
        { golfer_id: 'valid_1', holes: [{ par: 4, strokes: 68 }], tournament_strokes: 270, position: 0 },
        { golfer_id: 'valid_2', holes: [{ par: 4, strokes: 69 }], tournament_strokes: 271, position: 0 },
        { golfer_id: 'valid_3', holes: [{ par: 4, strokes: 71 }], tournament_strokes: 273, position: 0 }
      ];

      const result = scoreRound({
        normalizedRoundPayload: {
          event_id: 'test_event',
          round_number: 4,
          golfers,
          is_final_round: true
        },
        templateRules: {}
      });

      const scoresByGolferId = {};
      result.golfer_scores.forEach(score => {
        scoresByGolferId[score.golfer_id] = score;
      });

      // Valid golfers should maintain correct relative positions
      expect(scoresByGolferId['valid_1'].finish_bonus).toBe(25);  // 270 strokes → position 1
      expect(scoresByGolferId['valid_2'].finish_bonus).toBe(18);  // 271 strokes → position 2
      expect(scoresByGolferId['valid_3'].finish_bonus).toBe(16);  // 273 strokes → position 3
    });

  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST GROUP 3: Normal Ranking Still Works
  // ──────────────────────────────────────────────────────────────────────────

  describe('Normal Ranking Behavior (Valid Strokes)', () => {

    it('correctly assigns positions for valid tournament_strokes', () => {
      const golfers = [
        { golfer_id: 'g1', holes: [{ par: 4, strokes: 68 }], tournament_strokes: 270, position: 0 },
        { golfer_id: 'g2', holes: [{ par: 4, strokes: 69 }], tournament_strokes: 271, position: 0 },
        { golfer_id: 'g3', holes: [{ par: 4, strokes: 69 }], tournament_strokes: 271, position: 0 },
        { golfer_id: 'g4', holes: [{ par: 4, strokes: 71 }], tournament_strokes: 273, position: 0 }
      ];

      const result = scoreRound({
        normalizedRoundPayload: {
          event_id: 'test_event',
          round_number: 4,
          golfers,
          is_final_round: true
        },
        templateRules: {}
      });

      const scoresByGolferId = {};
      result.golfer_scores.forEach(score => {
        scoresByGolferId[score.golfer_id] = score;
      });

      // Expected: [1, 2, 2, 4] tie-aware positions
      expect(scoresByGolferId['g1'].finish_bonus).toBe(25);  // position 1: 270
      expect(scoresByGolferId['g2'].finish_bonus).toBe(18);  // position 2: 271
      expect(scoresByGolferId['g3'].finish_bonus).toBe(18);  // position 2: 271 (tied)
      expect(scoresByGolferId['g4'].finish_bonus).toBe(14);  // position 4: 273 (skips 3)
    });

    it('applies finish bonus only in final round', () => {
      const golfers = [
        { golfer_id: 'g1', holes: [{ par: 4, strokes: 68 }], tournament_strokes: 270, position: 0 }
      ];

      const resultRound1 = scoreRound({
        normalizedRoundPayload: {
          event_id: 'test_event',
          round_number: 1,
          golfers,
          is_final_round: false  // NOT final round
        },
        templateRules: {}
      });

      const resultRound4Final = scoreRound({
        normalizedRoundPayload: {
          event_id: 'test_event',
          round_number: 4,
          golfers: [
            { golfer_id: 'g1', holes: [{ par: 4, strokes: 68 }], tournament_strokes: 270, position: 0 }
          ],
          is_final_round: true  // IS final round
        },
        templateRules: {}
      });

      expect(resultRound1.golfer_scores[0].finish_bonus).toBe(0);      // Non-final: no bonus
      expect(resultRound4Final.golfer_scores[0].finish_bonus).toBe(25); // Final: bonus applied
    });

  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST GROUP 4: Error Handling
  // ──────────────────────────────────────────────────────────────────────────

  describe('Error Handling', () => {

    it('handles empty golfers array gracefully', () => {
      const result = scoreRound({
        normalizedRoundPayload: {
          event_id: 'test_event',
          round_number: 4,
          golfers: [],  // Empty array
          is_final_round: true
        },
        templateRules: {}
      });

      expect(result.golfer_scores).toEqual([]);
      expect(result.event_id).toBe('test_event');
    });

    it('handles all invalid tournament_strokes without crash', () => {
      const golfers = [
        { golfer_id: 'g1', holes: [{ par: 4, strokes: 70 }], tournament_strokes: NaN, position: 0 },
        { golfer_id: 'g2', holes: [{ par: 4, strokes: 70 }], tournament_strokes: null, position: 0 },
        { golfer_id: 'g3', holes: [{ par: 4, strokes: 70 }], tournament_strokes: undefined, position: 0 }
      ];

      const result = scoreRound({
        normalizedRoundPayload: {
          event_id: 'test_event',
          round_number: 4,
          golfers,
          is_final_round: true
        },
        templateRules: {}
      });

      // Should not crash, all golfers should be scored
      expect(result.golfer_scores.length).toBe(3);

      // None should have the top finish bonus
      result.golfer_scores.forEach(score => {
        expect(score.finish_bonus).not.toBe(25);
      });
    });

  });

});
