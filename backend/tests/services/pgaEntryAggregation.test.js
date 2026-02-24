/**
 * PGA Entry Aggregation Tests (Part 2)
 *
 * Covers:
 * 1) Aggregates 7 golfers by dropping lowest and summing best 6
 * 2) Correct golfer is dropped (lowest total_points)
 * 3) Sum equals total of best 6 golfers
 * 4) No mutation of input array
 * 5) Deterministic across multiple runs
 * 6) Handles edge cases (fewer than 7 golfers, empty array)
 */

const { aggregateEntryScore } = require('../../services/scoring/pgaEntryAggregation');

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function makeGolferScore(id, totalPoints) {
  return {
    golfer_id: id,
    hole_points: Math.floor(totalPoints * 0.7),
    bonus_points: Math.floor(totalPoints * 0.2),
    finish_bonus: Math.floor(totalPoints * 0.1),
    total_points: totalPoints
  };
}

// ---------------------------------------------------------------------------
// 1. Aggregates 7 golfers by dropping lowest and summing best 6
// ---------------------------------------------------------------------------

describe('pgaEntryAggregation — 7 golfer drop-lowest', () => {
  it('drops lowest and sums best 6 from exactly 7 golfers', () => {
    const golferScores = [
      makeGolferScore('g1', 10),
      makeGolferScore('g2', 25),
      makeGolferScore('g3', 15),
      makeGolferScore('g4', 20),
      makeGolferScore('g5', 5),  // LOWEST
      makeGolferScore('g6', 30),
      makeGolferScore('g7', 12)
    ];

    const result = aggregateEntryScore(golferScores);

    // Sum of best 6: 10 + 25 + 15 + 20 + 30 + 12 = 112
    expect(result.best_6_sum).toBe(112);
    expect(result.entry_total).toBe(112);
    expect(result.dropped_golfer_id).toBe('g5');
  });

  it('identifies and drops the truly lowest score among 7', () => {
    const golferScores = [
      makeGolferScore('g1', 50),
      makeGolferScore('g2', 40),
      makeGolferScore('g3', 30),
      makeGolferScore('g4', -10), // LOWEST
      makeGolferScore('g5', 20),
      makeGolferScore('g6', 35),
      makeGolferScore('g7', 45)
    ];

    const result = aggregateEntryScore(golferScores);

    expect(result.dropped_golfer_id).toBe('g4');
    const expectedSum = 50 + 40 + 30 + 20 + 35 + 45; // 220
    expect(result.best_6_sum).toBe(expectedSum);
  });

  it('handles 7 golfers with all positive scores', () => {
    const golferScores = [
      makeGolferScore('a', 100),
      makeGolferScore('b', 90),
      makeGolferScore('c', 80),
      makeGolferScore('d', 70),
      makeGolferScore('e', 60),
      makeGolferScore('f', 50),
      makeGolferScore('g', 40)  // LOWEST
    ];

    const result = aggregateEntryScore(golferScores);

    expect(result.dropped_golfer_id).toBe('g');
    expect(result.best_6_sum).toBe(100 + 90 + 80 + 70 + 60 + 50); // 450
  });

  it('handles 7 golfers with mixed positive and negative scores', () => {
    const golferScores = [
      makeGolferScore('g1', 100),
      makeGolferScore('g2', 50),
      makeGolferScore('g3', 0),
      makeGolferScore('g4', -50),
      makeGolferScore('g5', -100), // LOWEST
      makeGolferScore('g6', 75),
      makeGolferScore('g7', 25)
    ];

    const result = aggregateEntryScore(golferScores);

    expect(result.dropped_golfer_id).toBe('g5');
    expect(result.best_6_sum).toBe(100 + 50 + 0 + (-50) + 75 + 25); // 200
  });
});

// ---------------------------------------------------------------------------
// 2. Correct golfer is dropped (lowest total_points)
// ---------------------------------------------------------------------------

describe('pgaEntryAggregation — lowest identification', () => {
  it('drops first occurrence when multiple golfers tie for lowest', () => {
    const golferScores = [
      makeGolferScore('g1', 20),
      makeGolferScore('g2', 10), // LOWEST (first)
      makeGolferScore('g3', 10), // Also lowest, but first occurrence is dropped
      makeGolferScore('g4', 30),
      makeGolferScore('g5', 15),
      makeGolferScore('g6', 25),
      makeGolferScore('g7', 35)
    ];

    const result = aggregateEntryScore(golferScores);

    expect(result.dropped_golfer_id).toBe('g2');
  });

  it('preserves all best-6 golfer_ids in result context', () => {
    const golferScores = [
      makeGolferScore('keep1', 100),
      makeGolferScore('drop-me', 5),
      makeGolferScore('keep2', 90),
      makeGolferScore('keep3', 80),
      makeGolferScore('keep4', 70),
      makeGolferScore('keep5', 60),
      makeGolferScore('keep6', 50)
    ];

    const result = aggregateEntryScore(golferScores);

    expect(result.dropped_golfer_id).toBe('drop-me');
    const bestSix = [100, 90, 80, 70, 60, 50];
    expect(result.best_6_sum).toBe(bestSix.reduce((a, b) => a + b, 0));
  });
});

// ---------------------------------------------------------------------------
// 3. Sum equals total of best 6 golfers
// ---------------------------------------------------------------------------

describe('pgaEntryAggregation — arithmetic correctness', () => {
  it('best_6_sum equals actual sum of 6 highest scores', () => {
    const scores = [100, 90, 80, 70, 60, 50, 40];
    const golferScores = scores.map((s, i) => makeGolferScore(`g${i}`, s));

    const result = aggregateEntryScore(golferScores);

    // Expected: sum of [100, 90, 80, 70, 60, 50] = 450
    expect(result.best_6_sum).toBe(450);
    expect(result.entry_total).toBe(450);
  });

  it('manual verification of arithmetic for 7 golfers', () => {
    const golferScores = [
      makeGolferScore('g1', 25),
      makeGolferScore('g2', 33),
      makeGolferScore('g3', 11), // LOWEST
      makeGolferScore('g4', 44),
      makeGolferScore('g5', 22),
      makeGolferScore('g6', 55),
      makeGolferScore('g7', 19)
    ];

    const result = aggregateEntryScore(golferScores);

    const bestSix = [25, 33, 44, 22, 55, 19];
    const manualSum = bestSix.reduce((a, b) => a + b, 0);
    expect(result.best_6_sum).toBe(manualSum);
    expect(result.best_6_sum).toBe(198);
  });
});

// ---------------------------------------------------------------------------
// 4. No mutation of input array
// ---------------------------------------------------------------------------

describe('pgaEntryAggregation — immutability', () => {
  it('does not mutate the input golferScores array', () => {
    const golferScores = [
      makeGolferScore('g1', 30),
      makeGolferScore('g2', 10),
      makeGolferScore('g3', 20),
      makeGolferScore('g4', 40),
      makeGolferScore('g5', 15),
      makeGolferScore('g6', 35),
      makeGolferScore('g7', 25)
    ];

    const originalCopy = JSON.parse(JSON.stringify(golferScores));

    aggregateEntryScore(golferScores);

    expect(golferScores).toEqual(originalCopy);
    expect(golferScores.length).toBe(7);
  });

  it('does not mutate individual golfer score objects', () => {
    const golferScores = [
      makeGolferScore('g1', 10),
      makeGolferScore('g2', 20),
      makeGolferScore('g3', 30),
      makeGolferScore('g4', 40),
      makeGolferScore('g5', 50),
      makeGolferScore('g6', 60),
      makeGolferScore('g7', 70)
    ];

    const scoresCopy = golferScores.map((s) => JSON.parse(JSON.stringify(s)));

    aggregateEntryScore(golferScores);

    golferScores.forEach((score, i) => {
      expect(score).toEqual(scoresCopy[i]);
    });
  });
});

// ---------------------------------------------------------------------------
// 5. Deterministic across multiple runs
// ---------------------------------------------------------------------------

describe('pgaEntryAggregation — determinism', () => {
  it('returns identical result across multiple runs with same input', () => {
    const golferScores = [
      makeGolferScore('g1', 100),
      makeGolferScore('g2', 50),
      makeGolferScore('g3', 75),
      makeGolferScore('g4', 25),
      makeGolferScore('g5', 90),
      makeGolferScore('g6', 60),
      makeGolferScore('g7', 40)
    ];

    const r1 = aggregateEntryScore(golferScores);
    const r2 = aggregateEntryScore(golferScores);
    const r3 = aggregateEntryScore(golferScores);

    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
  });

  it('deterministic with negative scores', () => {
    const golferScores = [
      makeGolferScore('g1', -5),
      makeGolferScore('g2', -15),
      makeGolferScore('g3', 5),
      makeGolferScore('g4', -10),
      makeGolferScore('g5', 10),
      makeGolferScore('g6', 0),
      makeGolferScore('g7', 3)
    ];

    const r1 = aggregateEntryScore(golferScores);
    const r2 = aggregateEntryScore(golferScores);

    expect(r1).toEqual(r2);
    expect(r1.dropped_golfer_id).toBe('g2'); // -15 is lowest
  });
});

// ---------------------------------------------------------------------------
// 6. Edge cases
// ---------------------------------------------------------------------------

describe('pgaEntryAggregation — edge cases', () => {
  it('handles empty golferScores array', () => {
    const result = aggregateEntryScore([]);

    expect(result.best_6_sum).toBe(0);
    expect(result.entry_total).toBe(0);
    expect(result.dropped_golfer_id).toBeNull();
  });

  it('handles fewer than 7 golfers (no drop)', () => {
    const golferScores = [
      makeGolferScore('g1', 100),
      makeGolferScore('g2', 50),
      makeGolferScore('g3', 75)
    ];

    const result = aggregateEntryScore(golferScores);

    // No drop: sum all 3
    expect(result.best_6_sum).toBe(225);
    expect(result.entry_total).toBe(225);
    expect(result.dropped_golfer_id).toBeNull();
  });

  it('handles exactly 6 golfers (no drop)', () => {
    const golferScores = [
      makeGolferScore('g1', 100),
      makeGolferScore('g2', 90),
      makeGolferScore('g3', 80),
      makeGolferScore('g4', 70),
      makeGolferScore('g5', 60),
      makeGolferScore('g6', 50)
    ];

    const result = aggregateEntryScore(golferScores);

    expect(result.best_6_sum).toBe(450);
    expect(result.entry_total).toBe(450);
    expect(result.dropped_golfer_id).toBeNull();
  });

  it('handles scores with missing or zero total_points', () => {
    const golferScores = [
      makeGolferScore('g1', 50),
      { golfer_id: 'g2', hole_points: 0, bonus_points: 0, finish_bonus: 0 }, // missing total_points (treated as 0)
      makeGolferScore('g3', 40),
      makeGolferScore('g4', 30),
      makeGolferScore('g5', 20),
      makeGolferScore('g6', 10),
      makeGolferScore('g7', 5)
    ];

    const result = aggregateEntryScore(golferScores);

    // g2 has undefined total_points, which is coerced to 0 (lowest)
    expect(result.dropped_golfer_id).toBe('g2');
    // Best 6 sum: 50 + 40 + 30 + 20 + 10 + 5 = 155
    expect(result.best_6_sum).toBe(155);
  });

  it('returns output shape with all required fields', () => {
    const golferScores = [
      makeGolferScore('g1', 10),
      makeGolferScore('g2', 20),
      makeGolferScore('g3', 30),
      makeGolferScore('g4', 40),
      makeGolferScore('g5', 50),
      makeGolferScore('g6', 60),
      makeGolferScore('g7', 70)
    ];

    const result = aggregateEntryScore(golferScores);

    expect(result).toHaveProperty('best_6_sum');
    expect(result).toHaveProperty('dropped_golfer_id');
    expect(result).toHaveProperty('entry_total');
    expect(typeof result.best_6_sum).toBe('number');
    expect(typeof result.entry_total).toBe('number');
  });
});
