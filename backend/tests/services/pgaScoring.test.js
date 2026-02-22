/**
 * PGA Standard Scoring Strategy Tests
 *
 * Covers:
 * 1) Basic hole scoring mapping (all delta buckets)
 * 2) Bogey-free bonus applied correctly
 * 3) Streak bonus applied correctly
 * 4) No streak bonus when below threshold
 * 5) Finish bonus applied only in final round
 * 6) Deterministic output for identical input
 * 7) No mutation of input objects
 * 8) Drop-lowest logic NOT present — 7 golfers return 7 results
 */

const {
  scoreRound,
  computeFinishBonus,
  computeStreakBonus,
  scoring_strategy_key
} = require('../../services/scoring/strategies/pgaStandardScoring');

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const BASE_RULES = {
  scoring: {
    double_eagle_or_better: 15,
    eagle: 8,
    birdie: 3,
    par: 1,
    bogey: -1,
    double_bogey_or_worse: -3,
    bogey_free_round_bonus: 5,
    streak_bonus: { length: 3, points: 4 }
  },
  finish_bonus: {
    '1': 20,
    '2': 15,
    '3': 10
  }
};

function makeHole(number, par, strokes) {
  return { hole_number: number, par, strokes };
}

function makeGolfer(id, holes, position = 10) {
  return {
    golfer_id: id,
    holes,
    position,
    round_total: holes.reduce((s, h) => s + h.strokes, 0),
    cumulative_total: 0
  };
}

function makePayload(golfers, roundNumber = 1, isFinalRound = false) {
  return {
    event_id: 'evt-001',
    round_number: roundNumber,
    golfers,
    is_final_round: isFinalRound
  };
}

// ---------------------------------------------------------------------------
// 1. Basic hole scoring mapping
// ---------------------------------------------------------------------------

describe('pgaStandardScoring — hole scoring mapping', () => {
  it('scores a double eagle or better (delta <= -3)', () => {
    const holes = [makeHole(1, 5, 2)]; // delta = -3
    const golfer = makeGolfer('g1', holes);
    const result = scoreRound({ normalizedRoundPayload: makePayload([golfer]), templateRules: BASE_RULES });
    expect(result.golfer_scores[0].hole_points).toBe(15);
  });

  it('scores a condor (delta = -4) as double_eagle_or_better', () => {
    const holes = [makeHole(1, 5, 1)]; // delta = -4
    const golfer = makeGolfer('g1', holes);
    const result = scoreRound({ normalizedRoundPayload: makePayload([golfer]), templateRules: BASE_RULES });
    expect(result.golfer_scores[0].hole_points).toBe(15);
  });

  it('scores an eagle (delta = -2)', () => {
    const holes = [makeHole(1, 4, 2)]; // delta = -2
    const golfer = makeGolfer('g1', holes);
    const result = scoreRound({ normalizedRoundPayload: makePayload([golfer]), templateRules: BASE_RULES });
    expect(result.golfer_scores[0].hole_points).toBe(8);
  });

  it('scores a birdie (delta = -1)', () => {
    const holes = [makeHole(1, 4, 3)]; // delta = -1
    const golfer = makeGolfer('g1', holes);
    const result = scoreRound({ normalizedRoundPayload: makePayload([golfer]), templateRules: BASE_RULES });
    expect(result.golfer_scores[0].hole_points).toBe(3);
  });

  it('scores a par (delta = 0)', () => {
    const holes = [makeHole(1, 4, 4)]; // delta = 0
    const golfer = makeGolfer('g1', holes);
    const result = scoreRound({ normalizedRoundPayload: makePayload([golfer]), templateRules: BASE_RULES });
    expect(result.golfer_scores[0].hole_points).toBe(1);
  });

  it('scores a bogey (delta = 1)', () => {
    const holes = [makeHole(1, 4, 5)]; // delta = 1
    const golfer = makeGolfer('g1', holes);
    const result = scoreRound({ normalizedRoundPayload: makePayload([golfer]), templateRules: BASE_RULES });
    expect(result.golfer_scores[0].hole_points).toBe(-1);
  });

  it('scores a double bogey (delta = 2) as double_bogey_or_worse', () => {
    const holes = [makeHole(1, 4, 6)]; // delta = 2
    const golfer = makeGolfer('g1', holes);
    const result = scoreRound({ normalizedRoundPayload: makePayload([golfer]), templateRules: BASE_RULES });
    expect(result.golfer_scores[0].hole_points).toBe(-3);
  });

  it('scores a triple bogey (delta = 3) as double_bogey_or_worse', () => {
    const holes = [makeHole(1, 4, 7)]; // delta = 3
    const golfer = makeGolfer('g1', holes);
    const result = scoreRound({ normalizedRoundPayload: makePayload([golfer]), templateRules: BASE_RULES });
    expect(result.golfer_scores[0].hole_points).toBe(-3);
  });

  it('accumulates points across multiple holes', () => {
    const holes = [
      makeHole(1, 4, 3), // birdie  = 3
      makeHole(2, 4, 4), // par     = 1
      makeHole(3, 4, 5)  // bogey   = -1
    ];
    const golfer = makeGolfer('g1', holes);
    const rules = { ...BASE_RULES, scoring: { ...BASE_RULES.scoring, bogey_free_round_bonus: 0, streak_bonus: undefined } };
    const result = scoreRound({ normalizedRoundPayload: makePayload([golfer]), templateRules: rules });
    expect(result.golfer_scores[0].hole_points).toBe(3); // 3 + 1 - 1
  });
});

// ---------------------------------------------------------------------------
// 2. Bogey-free round bonus
// ---------------------------------------------------------------------------

describe('pgaStandardScoring — bogey-free round bonus', () => {
  it('applies bogey_free_round_bonus when no holes have delta > 0', () => {
    const holes = [
      makeHole(1, 4, 3), // birdie
      makeHole(2, 4, 4), // par
      makeHole(3, 5, 4)  // birdie on par-5
    ];
    const golfer = makeGolfer('g1', holes);
    const rules = { ...BASE_RULES, scoring: { ...BASE_RULES.scoring, streak_bonus: undefined } };
    const result = scoreRound({ normalizedRoundPayload: makePayload([golfer]), templateRules: rules });
    expect(result.golfer_scores[0].bonus_points).toBe(5);
  });

  it('does NOT apply bogey_free_round_bonus when any hole has delta > 0', () => {
    const holes = [
      makeHole(1, 4, 3), // birdie
      makeHole(2, 4, 5)  // bogey — breaks bogey-free
    ];
    const golfer = makeGolfer('g1', holes);
    const rules = { ...BASE_RULES, scoring: { ...BASE_RULES.scoring, streak_bonus: undefined } };
    const result = scoreRound({ normalizedRoundPayload: makePayload([golfer]), templateRules: rules });
    expect(result.golfer_scores[0].bonus_points).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Streak bonus
// ---------------------------------------------------------------------------

describe('pgaStandardScoring — streak bonus', () => {
  it('awards streak bonus for exactly threshold consecutive birdies', () => {
    // threshold = 3, so 3 consecutive birdies = one bonus of 4
    const holes = [
      makeHole(1, 4, 3), // birdie
      makeHole(2, 4, 3), // birdie
      makeHole(3, 4, 3)  // birdie
    ];
    const result = computeStreakBonus(holes, { length: 3, points: 4 });
    expect(result).toBe(4);
  });

  it('awards streak bonus for eagles within a streak (delta <= -1)', () => {
    const holes = [
      makeHole(1, 4, 2), // eagle  (delta -2)
      makeHole(2, 4, 3), // birdie (delta -1)
      makeHole(3, 4, 3)  // birdie (delta -1)
    ];
    const result = computeStreakBonus(holes, { length: 3, points: 4 });
    expect(result).toBe(4);
  });

  it('awards one bonus for a single run exceeding threshold (no double-count)', () => {
    // 5 consecutive birdies, threshold 3 → still one bonus
    const holes = Array.from({ length: 5 }, (_, i) => makeHole(i + 1, 4, 3));
    const result = computeStreakBonus(holes, { length: 3, points: 4 });
    expect(result).toBe(4);
  });

  it('awards bonuses for multiple separate streaks in a round', () => {
    const holes = [
      makeHole(1, 4, 3),  // birdie
      makeHole(2, 4, 3),  // birdie
      makeHole(3, 4, 3),  // birdie — streak 1 (ends here if next is bogey)
      makeHole(4, 4, 5),  // bogey  — breaks streak
      makeHole(5, 4, 3),  // birdie
      makeHole(6, 4, 3),  // birdie
      makeHole(7, 4, 3)   // birdie — streak 2
    ];
    const result = computeStreakBonus(holes, { length: 3, points: 4 });
    expect(result).toBe(8); // two streaks × 4 points each
  });

  it('integrates streak bonus into scoreRound bonus_points', () => {
    const holes = Array.from({ length: 3 }, (_, i) => makeHole(i + 1, 4, 3)); // 3 birdies
    const golfer = makeGolfer('g1', holes);
    // disable bogey_free_round_bonus to isolate streak contribution
    const rules = {
      ...BASE_RULES,
      scoring: { ...BASE_RULES.scoring, bogey_free_round_bonus: 0 }
    };
    const result = scoreRound({ normalizedRoundPayload: makePayload([golfer]), templateRules: rules });
    expect(result.golfer_scores[0].bonus_points).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// 4. No streak bonus below threshold
// ---------------------------------------------------------------------------

describe('pgaStandardScoring — no streak bonus below threshold', () => {
  it('returns 0 when consecutive run is shorter than threshold', () => {
    const holes = [
      makeHole(1, 4, 3), // birdie
      makeHole(2, 4, 3)  // birdie — only 2, threshold is 3
    ];
    const result = computeStreakBonus(holes, { length: 3, points: 4 });
    expect(result).toBe(0);
  });

  it('returns 0 when no birdies-or-better exist', () => {
    const holes = [
      makeHole(1, 4, 4), // par
      makeHole(2, 4, 5)  // bogey
    ];
    const result = computeStreakBonus(holes, { length: 3, points: 4 });
    expect(result).toBe(0);
  });

  it('returns 0 when streak_bonus is absent from template', () => {
    const holes = Array.from({ length: 5 }, (_, i) => makeHole(i + 1, 4, 3)); // 5 birdies
    const golfer = makeGolfer('g1', holes);
    const rules = { ...BASE_RULES, scoring: { ...BASE_RULES.scoring, streak_bonus: undefined } };
    const result = scoreRound({ normalizedRoundPayload: makePayload([golfer]), templateRules: rules });
    expect(result.golfer_scores[0].bonus_points).toBe(5); // only bogey_free_round_bonus
  });
});

// ---------------------------------------------------------------------------
// 5. Finish bonus — only in final round
// ---------------------------------------------------------------------------

describe('pgaStandardScoring — finish bonus', () => {
  it('applies finish_bonus in the final round for a known position', () => {
    const holes = [makeHole(1, 4, 4)]; // par, 1 point
    const golfer = makeGolfer('g1', holes, 1); // position 1
    const rules = { ...BASE_RULES, scoring: { ...BASE_RULES.scoring, streak_bonus: undefined, bogey_free_round_bonus: 0 } };
    const result = scoreRound({
      normalizedRoundPayload: makePayload([golfer], 4, true), // is_final_round = true
      templateRules: rules
    });
    expect(result.golfer_scores[0].finish_bonus).toBe(20);
  });

  it('does NOT apply finish_bonus in a non-final round', () => {
    const holes = [makeHole(1, 4, 4)];
    const golfer = makeGolfer('g1', holes, 1);
    const rules = { ...BASE_RULES, scoring: { ...BASE_RULES.scoring, streak_bonus: undefined, bogey_free_round_bonus: 0 } };
    const result = scoreRound({
      normalizedRoundPayload: makePayload([golfer], 2, false), // is_final_round = false
      templateRules: rules
    });
    expect(result.golfer_scores[0].finish_bonus).toBe(0);
  });

  it('returns 0 finish_bonus for a position not in the table', () => {
    expect(computeFinishBonus(50, BASE_RULES.finish_bonus)).toBe(0);
  });

  it('returns 0 finish_bonus when table is null', () => {
    expect(computeFinishBonus(1, null)).toBe(0);
  });

  it('returns 0 finish_bonus when table is undefined', () => {
    expect(computeFinishBonus(1, undefined)).toBe(0);
  });

  it('resolves position 2 and 3 correctly from the table', () => {
    expect(computeFinishBonus(2, BASE_RULES.finish_bonus)).toBe(15);
    expect(computeFinishBonus(3, BASE_RULES.finish_bonus)).toBe(10);
  });

  it('total_points includes finish_bonus in final round', () => {
    const holes = [makeHole(1, 4, 4)]; // par = 1 point
    const golfer = makeGolfer('g1', holes, 1);
    const rules = { ...BASE_RULES, scoring: { ...BASE_RULES.scoring, streak_bonus: undefined, bogey_free_round_bonus: 0 } };
    const result = scoreRound({
      normalizedRoundPayload: makePayload([golfer], 4, true),
      templateRules: rules
    });
    const score = result.golfer_scores[0];
    expect(score.total_points).toBe(score.hole_points + score.bonus_points + score.finish_bonus);
    expect(score.total_points).toBe(21); // 1 (par) + 0 + 20 (position 1)
  });
});

// ---------------------------------------------------------------------------
// 6. Determinism
// ---------------------------------------------------------------------------

describe('pgaStandardScoring — determinism', () => {
  it('returns identical output for identical input across multiple calls', () => {
    const holes = [
      makeHole(1, 4, 3),
      makeHole(2, 4, 4),
      makeHole(3, 5, 4),
      makeHole(4, 3, 3)
    ];
    const golfer = makeGolfer('g1', holes, 2);
    const payload = makePayload([golfer], 4, true);

    const r1 = scoreRound({ normalizedRoundPayload: payload, templateRules: BASE_RULES });
    const r2 = scoreRound({ normalizedRoundPayload: payload, templateRules: BASE_RULES });
    const r3 = scoreRound({ normalizedRoundPayload: payload, templateRules: BASE_RULES });

    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
  });
});

// ---------------------------------------------------------------------------
// 7. No mutation of input objects
// ---------------------------------------------------------------------------

describe('pgaStandardScoring — no mutation', () => {
  it('does not mutate the normalizedRoundPayload', () => {
    const holes = [makeHole(1, 4, 3)];
    const golfer = makeGolfer('g1', holes);
    const payload = makePayload([golfer]);
    const payloadCopy = JSON.parse(JSON.stringify(payload));

    scoreRound({ normalizedRoundPayload: payload, templateRules: BASE_RULES });

    expect(payload).toEqual(payloadCopy);
  });

  it('does not mutate the templateRules', () => {
    const holes = [makeHole(1, 4, 3)];
    const golfer = makeGolfer('g1', holes);
    const rulesCopy = JSON.parse(JSON.stringify(BASE_RULES));

    scoreRound({ normalizedRoundPayload: makePayload([golfer]), templateRules: BASE_RULES });

    expect(BASE_RULES).toEqual(rulesCopy);
  });

  it('computeFinishBonus does not mutate its table argument', () => {
    const table = { '1': 20 };
    const copy = { ...table };
    computeFinishBonus(1, table);
    expect(table).toEqual(copy);
  });
});

// ---------------------------------------------------------------------------
// 8. Drop-lowest logic NOT present — 7 golfers return 7 results
// ---------------------------------------------------------------------------

describe('pgaStandardScoring — no aggregation', () => {
  it('returns exactly 7 golfer_scores for 7 golfers (no drop-lowest)', () => {
    const golfers = Array.from({ length: 7 }, (_, i) => {
      const holes = [makeHole(1, 4, 4 + i)]; // varying scores
      return makeGolfer(`g${i + 1}`, holes, i + 1);
    });
    const payload = makePayload(golfers);
    const result = scoreRound({ normalizedRoundPayload: payload, templateRules: BASE_RULES });
    expect(result.golfer_scores).toHaveLength(7);
  });

  it('each golfer_score preserves its golfer_id', () => {
    const golfers = Array.from({ length: 7 }, (_, i) => {
      const holes = [makeHole(1, 4, 4)];
      return makeGolfer(`golfer-${i}`, holes);
    });
    const payload = makePayload(golfers);
    const result = scoreRound({ normalizedRoundPayload: payload, templateRules: BASE_RULES });

    const ids = result.golfer_scores.map((s) => s.golfer_id);
    expect(ids).toEqual(['golfer-0', 'golfer-1', 'golfer-2', 'golfer-3', 'golfer-4', 'golfer-5', 'golfer-6']);
  });
});

// ---------------------------------------------------------------------------
// 9. Registry integration
// ---------------------------------------------------------------------------

describe('pgaStandardScoring — registry integration', () => {
  it('is registered under pga_standard_v1 in scoringRegistry', () => {
    const { getScoringStrategy, listScoringStrategies } = require('../../services/scoringRegistry');
    expect(listScoringStrategies()).toContain('pga_standard_v1');
    expect(typeof getScoringStrategy('pga_standard_v1')).toBe('function');
  });

  it('exports scoring_strategy_key matching the registry key', () => {
    expect(scoring_strategy_key).toBe('pga_standard_v1');
  });
});

// ---------------------------------------------------------------------------
// 10. Dispatch integration (Part 1)
// ---------------------------------------------------------------------------

describe('pgaStandardScoring — dispatch integration', () => {
  it('invokes PGA strategy through registry when strategy_key = "pga_standard_v1"', () => {
    const { getScoringStrategy } = require('../../services/scoringRegistry');

    const holes = [
      makeHole(1, 4, 3), // birdie = 3
      makeHole(2, 4, 4)  // par = 1
    ];
    const golfer = makeGolfer('g-123', holes, 2);
    const normalizedRoundPayload = makePayload([golfer], 1, false);
    const templateRules = {
      scoring_strategy_key: 'pga_standard_v1',
      ...BASE_RULES
    };

    const scoreRoundFn = getScoringStrategy(templateRules.scoring_strategy_key);
    const result = scoreRoundFn({ normalizedRoundPayload, templateRules });

    // Assert PGA strategy was invoked
    expect(result).toBeDefined();
    expect(result.event_id).toBe('evt-001');
    expect(result.round_number).toBe(1);
    expect(result.golfer_scores).toBeDefined();
  });

  it('returns correct output shape through dispatch', () => {
    const { getScoringStrategy } = require('../../services/scoringRegistry');

    const holes = [makeHole(1, 4, 4)];
    const golfer = makeGolfer('g-456', holes);
    const normalizedRoundPayload = makePayload([golfer]);
    const templateRules = {
      scoring_strategy_key: 'pga_standard_v1',
      ...BASE_RULES
    };

    const scoreRoundFn = getScoringStrategy(templateRules.scoring_strategy_key);
    const result = scoreRoundFn({ normalizedRoundPayload, templateRules });

    // Contract: result contains event_id, round_number, golfer_scores
    expect(result).toHaveProperty('event_id');
    expect(result).toHaveProperty('round_number');
    expect(result).toHaveProperty('golfer_scores');
    expect(Array.isArray(result.golfer_scores)).toBe(true);

    // Each golfer_score has required fields
    const score = result.golfer_scores[0];
    expect(score).toHaveProperty('golfer_id');
    expect(score).toHaveProperty('hole_points');
    expect(score).toHaveProperty('bonus_points');
    expect(score).toHaveProperty('finish_bonus');
    expect(score).toHaveProperty('total_points');
  });

  it('dispatches without errors for 7 golfers with varying scores', () => {
    const { getScoringStrategy } = require('../../services/scoringRegistry');

    const golfers = Array.from({ length: 7 }, (_, i) => {
      const holes = [
        makeHole(1, 4, 3 + i),      // vary strokes per golfer
        makeHole(2, 4, 4 + i)
      ];
      return makeGolfer(`golfer-${i}`, holes, i + 1);
    });

    const normalizedRoundPayload = makePayload(golfers, 2, false);
    const templateRules = {
      scoring_strategy_key: 'pga_standard_v1',
      ...BASE_RULES
    };

    const scoreRoundFn = getScoringStrategy(templateRules.scoring_strategy_key);

    expect(() => {
      scoreRoundFn({ normalizedRoundPayload, templateRules });
    }).not.toThrow();

    const result = scoreRoundFn({ normalizedRoundPayload, templateRules });
    expect(result.golfer_scores).toHaveLength(7);
  });
});

// ---------------------------------------------------------------------------
// 10. Defensive guards
// ---------------------------------------------------------------------------

describe('pgaStandardScoring — defensive guards', () => {
  it('handles missing golfers array gracefully (defaults to empty)', () => {
    const payload = { event_id: 'e1', round_number: 1, is_final_round: false };
    const result = scoreRound({ normalizedRoundPayload: payload, templateRules: BASE_RULES });
    expect(result.golfer_scores).toEqual([]);
  });

  it('handles missing holes array gracefully (defaults to empty)', () => {
    const golfer = { golfer_id: 'g1', position: 5 };
    const payload = makePayload([golfer]);
    const result = scoreRound({ normalizedRoundPayload: payload, templateRules: BASE_RULES });
    expect(result.golfer_scores[0].hole_points).toBe(0);
  });

  it('skips holes with non-numeric par', () => {
    const holes = [
      { hole_number: 1, par: 'four', strokes: 4 },
      makeHole(2, 4, 3)  // valid birdie
    ];
    const golfer = makeGolfer('g1', holes);
    const rules = { ...BASE_RULES, scoring: { ...BASE_RULES.scoring, streak_bonus: undefined, bogey_free_round_bonus: 0 } };
    const result = scoreRound({ normalizedRoundPayload: makePayload([golfer]), templateRules: rules });
    expect(result.golfer_scores[0].hole_points).toBe(3); // only the valid birdie counted
  });

  it('skips holes with non-numeric strokes', () => {
    const holes = [
      { hole_number: 1, par: 4, strokes: null },
      makeHole(2, 4, 4) // valid par
    ];
    const golfer = makeGolfer('g1', holes);
    const rules = { ...BASE_RULES, scoring: { ...BASE_RULES.scoring, streak_bonus: undefined, bogey_free_round_bonus: 0 } };
    const result = scoreRound({ normalizedRoundPayload: makePayload([golfer]), templateRules: rules });
    expect(result.golfer_scores[0].hole_points).toBe(1); // only the valid par counted
  });

  it('defaults missing scoring rule values to 0', () => {
    const holes = [makeHole(1, 4, 3)]; // birdie
    const golfer = makeGolfer('g1', holes);
    const emptyRules = { scoring: {}, finish_bonus: null };
    const result = scoreRound({ normalizedRoundPayload: makePayload([golfer]), templateRules: emptyRules });
    expect(result.golfer_scores[0].hole_points).toBe(0);
    expect(result.golfer_scores[0].bonus_points).toBe(0);
    expect(result.golfer_scores[0].total_points).toBe(0);
  });

  it('output shape matches contract for every golfer_score', () => {
    const holes = [makeHole(1, 4, 4)];
    const golfer = makeGolfer('g1', holes);
    const result = scoreRound({ normalizedRoundPayload: makePayload([golfer]), templateRules: BASE_RULES });
    const score = result.golfer_scores[0];

    expect(score).toHaveProperty('golfer_id');
    expect(score).toHaveProperty('hole_points');
    expect(score).toHaveProperty('bonus_points');
    expect(score).toHaveProperty('finish_bonus');
    expect(score).toHaveProperty('total_points');
    expect(typeof score.hole_points).toBe('number');
    expect(typeof score.bonus_points).toBe('number');
    expect(typeof score.finish_bonus).toBe('number');
    expect(typeof score.total_points).toBe('number');
  });
});
