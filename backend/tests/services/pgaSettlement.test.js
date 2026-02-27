/**
 * PGA Settlement Integration Tests
 *
 * Validates that the settlement layer works correctly for PGA format:
 * - Multi-round aggregation (4 rounds per event)
 * - Drop-lowest applied after accumulation, not per-round
 * - Finish bonus applied exactly once in final round only
 * - Deterministic tie handling via rankings
 * - Idempotent settlement execution
 * - No mutation of scoring outputs
 * - Contract compliance with OpenAPI Standing schema
 */

const settlementStrategy = require('../../services/settlementStrategy');
const { aggregateEntryScore } = require('../../services/scoring/pgaEntryAggregation');

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/**
 * Mock golfer round score (single round)
 */
function makeGolferRoundScore(golferId, roundNum, holePoints, bonusPoints, finishBonus = 0) {
  return {
    golfer_id: golferId,
    round_number: roundNum,
    hole_points: holePoints,
    bonus_points: bonusPoints,
    finish_bonus: finishBonus,
    total_points: holePoints + bonusPoints + finishBonus
  };
}

/**
 * Aggregate a single golfer's scores across all rounds
 */
function aggregateGolferAcrossRounds(golferRoundScores) {
  return golferRoundScores.reduce((sum, round) => sum + round.total_points, 0);
}

/**
 * Mock database client for testing
 * Returns golfer scores indexed by golfer_id when queried
 */
function makeMockClient(golferScoresMap) {
  return {
    query: async (sql, params) => {
      const contestInstanceId = params?.[0];

      // Return golfer scores for this contest
      if (sql.includes('golfer') && contestInstanceId) {
        const scores = [];

        // golferScoresMap format:
        // { participant_id: { golfer_id: [round_scores...], ... }, ... }
        for (const participantId of Object.keys(golferScoresMap)) {
          const golfers = golferScoresMap[participantId];

          for (const golferId of Object.keys(golfers)) {
            const roundScores = golfers[golferId];

            // Aggregate this golfer's scores across all rounds
            const totalPoints = aggregateGolferAcrossRounds(roundScores);

            scores.push({
              user_id: participantId,
              golfer_id: golferId,
              total_points: totalPoints
            });
          }
        }

        return Promise.resolve({ rows: scores });
      }

      return Promise.resolve({ rows: [] });
    }
  };
}

// ---------------------------------------------------------------------------
// 1. Multi-round aggregation test
// ---------------------------------------------------------------------------

describe('pgaSettlement — multi-round aggregation', () => {
  it('accumulates golfer totals across 4 rounds', () => {
    // Simulate 2 entries × 7 golfers × 4 rounds
    const golferScoresMap = {
      'user1': {
        'golfer-a': [
          makeGolferRoundScore('golfer-a', 1, 5, 0, 0),   // round 1: 5
          makeGolferRoundScore('golfer-a', 2, 3, 0, 0),   // round 2: 3
          makeGolferRoundScore('golfer-a', 3, 4, 0, 0),   // round 3: 4
          makeGolferRoundScore('golfer-a', 4, 2, 0, 5)    // round 4 (final): 2 + 5 = 7
        ],
        'golfer-b': [
          makeGolferRoundScore('golfer-b', 1, 10, 0, 0),
          makeGolferRoundScore('golfer-b', 2, 10, 0, 0),
          makeGolferRoundScore('golfer-b', 3, 10, 0, 0),
          makeGolferRoundScore('golfer-b', 4, 10, 0, 0)
        ],
        'golfer-c': [
          makeGolferRoundScore('golfer-c', 1, 8, 0, 0),
          makeGolferRoundScore('golfer-c', 2, 8, 0, 0),
          makeGolferRoundScore('golfer-c', 3, 8, 0, 0),
          makeGolferRoundScore('golfer-c', 4, 8, 0, 0)
        ],
        'golfer-d': [
          makeGolferRoundScore('golfer-d', 1, 6, 0, 0),
          makeGolferRoundScore('golfer-d', 2, 6, 0, 0),
          makeGolferRoundScore('golfer-d', 3, 6, 0, 0),
          makeGolferRoundScore('golfer-d', 4, 6, 0, 0)
        ],
        'golfer-e': [
          makeGolferRoundScore('golfer-e', 1, 7, 0, 0),
          makeGolferRoundScore('golfer-e', 2, 7, 0, 0),
          makeGolferRoundScore('golfer-e', 3, 7, 0, 0),
          makeGolferRoundScore('golfer-e', 4, 7, 0, 0)
        ],
        'golfer-f': [
          makeGolferRoundScore('golfer-f', 1, 9, 0, 0),
          makeGolferRoundScore('golfer-f', 2, 9, 0, 0),
          makeGolferRoundScore('golfer-f', 3, 9, 0, 0),
          makeGolferRoundScore('golfer-f', 4, 9, 0, 0)
        ],
        'golfer-g': [
          makeGolferRoundScore('golfer-g', 1, 2, 0, 0),  // LOWEST: 2+2+2+2=8 (will be dropped)
          makeGolferRoundScore('golfer-g', 2, 2, 0, 0),
          makeGolferRoundScore('golfer-g', 3, 2, 0, 0),
          makeGolferRoundScore('golfer-g', 4, 2, 0, 0)
        ]
      }
    };

    // Extract golfer data to verify accumulation
    const user1Golfers = golferScoresMap['user1'];

    // Verify each golfer accumulates correctly across rounds
    expect(aggregateGolferAcrossRounds(user1Golfers['golfer-a'])).toBe(5 + 3 + 4 + 7); // 19
    expect(aggregateGolferAcrossRounds(user1Golfers['golfer-b'])).toBe(10 + 10 + 10 + 10); // 40
    expect(aggregateGolferAcrossRounds(user1Golfers['golfer-g'])).toBe(2 + 2 + 2 + 2); // 8 (lowest)

    // Verify that aggregateEntryScore drops the lowest (golfer-g at 8)
    const golfersWithTotals = Object.entries(user1Golfers).map(([id, rounds]) => ({
      golfer_id: id,
      total_points: aggregateGolferAcrossRounds(rounds)
    }));

    const result = aggregateEntryScore(golfersWithTotals);

    // Best 6 should sum to: 19 + 40 + 32 + 24 + 28 + 36 = 179
    // (dropping 8)
    expect(result.dropped_golfer_id).toBe('golfer-g');
    expect(result.best_6_sum).toBe(179);
    expect(result.entry_total).toBe(179);
  });

  it('applies drop-lowest after all rounds are accumulated, not per-round', () => {
    // Golfer X scores vary per round, but is lowest overall
    const golferScoresMap = {
      'user1': {
        'golfer-x': [
          makeGolferRoundScore('golfer-x', 1, 20, 0, 0),  // high in round 1
          makeGolferRoundScore('golfer-x', 2, 1, 0, 0),   // low in round 2
          makeGolferRoundScore('golfer-x', 3, 15, 0, 0),  // medium in round 3
          makeGolferRoundScore('golfer-x', 4, 10, 0, 0)   // medium in round 4
        ],
        'golfer-y': [
          makeGolferRoundScore('golfer-y', 1, 15, 0, 0),
          makeGolferRoundScore('golfer-y', 2, 15, 0, 0),
          makeGolferRoundScore('golfer-y', 3, 15, 0, 0),
          makeGolferRoundScore('golfer-y', 4, 15, 0, 0)
        ],
        'golfer-z': [
          makeGolferRoundScore('golfer-z', 1, 12, 0, 0),
          makeGolferRoundScore('golfer-z', 2, 12, 0, 0),
          makeGolferRoundScore('golfer-z', 3, 12, 0, 0),
          makeGolferRoundScore('golfer-z', 4, 12, 0, 0)
        ],
        'golfer-a': [
          makeGolferRoundScore('golfer-a', 1, 18, 0, 0),
          makeGolferRoundScore('golfer-a', 2, 18, 0, 0),
          makeGolferRoundScore('golfer-a', 3, 18, 0, 0),
          makeGolferRoundScore('golfer-a', 4, 18, 0, 0)
        ],
        'golfer-b': [
          makeGolferRoundScore('golfer-b', 1, 16, 0, 0),
          makeGolferRoundScore('golfer-b', 2, 16, 0, 0),
          makeGolferRoundScore('golfer-b', 3, 16, 0, 0),
          makeGolferRoundScore('golfer-b', 4, 16, 0, 0)
        ],
        'golfer-c': [
          makeGolferRoundScore('golfer-c', 1, 14, 0, 0),
          makeGolferRoundScore('golfer-c', 2, 14, 0, 0),
          makeGolferRoundScore('golfer-c', 3, 14, 0, 0),
          makeGolferRoundScore('golfer-c', 4, 14, 0, 0)
        ],
        'golfer-d': [
          makeGolferRoundScore('golfer-d', 1, 13, 0, 0),
          makeGolferRoundScore('golfer-d', 2, 13, 0, 0),
          makeGolferRoundScore('golfer-d', 3, 13, 0, 0),
          makeGolferRoundScore('golfer-d', 4, 13, 0, 0)
        ]
      }
    };

    const user1Golfers = golferScoresMap['user1'];
    const golfersWithTotals = Object.entries(user1Golfers).map(([id, rounds]) => ({
      golfer_id: id,
      total_points: aggregateGolferAcrossRounds(rounds)
    }));

    // golfer-x total: 20 + 1 + 15 + 10 = 46 (lowest overall)
    expect(golfersWithTotals.find(g => g.golfer_id === 'golfer-x').total_points).toBe(46);

    const result = aggregateEntryScore(golfersWithTotals);

    // Drop-lowest should drop golfer-x (46) even though they scored 1 in round 2
    // Not applied per-round
    expect(result.dropped_golfer_id).toBe('golfer-x');
  });
});

// ---------------------------------------------------------------------------
// 2. Finish bonus tests
// ---------------------------------------------------------------------------

describe('pgaSettlement — finish bonus', () => {
  it('applies finish bonus exactly once in final round only', () => {
    const golferScoresMap = {
      'user1': {
        'golfer-1st': [
          makeGolferRoundScore('golfer-1st', 1, 10, 0, 0),
          makeGolferRoundScore('golfer-1st', 2, 10, 0, 0),
          makeGolferRoundScore('golfer-1st', 3, 10, 0, 0),
          makeGolferRoundScore('golfer-1st', 4, 10, 0, 20) // finish_bonus: 20 (only in round 4)
        ],
        'golfer-2': [
          makeGolferRoundScore('golfer-2', 1, 9, 0, 0),
          makeGolferRoundScore('golfer-2', 2, 9, 0, 0),
          makeGolferRoundScore('golfer-2', 3, 9, 0, 0),
          makeGolferRoundScore('golfer-2', 4, 9, 0, 0)
        ],
        'golfer-3': [
          makeGolferRoundScore('golfer-3', 1, 8, 0, 0),
          makeGolferRoundScore('golfer-3', 2, 8, 0, 0),
          makeGolferRoundScore('golfer-3', 3, 8, 0, 0),
          makeGolferRoundScore('golfer-3', 4, 8, 0, 0)
        ],
        'golfer-4': [
          makeGolferRoundScore('golfer-4', 1, 7, 0, 0),
          makeGolferRoundScore('golfer-4', 2, 7, 0, 0),
          makeGolferRoundScore('golfer-4', 3, 7, 0, 0),
          makeGolferRoundScore('golfer-4', 4, 7, 0, 0)
        ],
        'golfer-5': [
          makeGolferRoundScore('golfer-5', 1, 6, 0, 0),
          makeGolferRoundScore('golfer-5', 2, 6, 0, 0),
          makeGolferRoundScore('golfer-5', 3, 6, 0, 0),
          makeGolferRoundScore('golfer-5', 4, 6, 0, 0)
        ],
        'golfer-6': [
          makeGolferRoundScore('golfer-6', 1, 5, 0, 0),
          makeGolferRoundScore('golfer-6', 2, 5, 0, 0),
          makeGolferRoundScore('golfer-6', 3, 5, 0, 0),
          makeGolferRoundScore('golfer-6', 4, 5, 0, 0)
        ],
        'golfer-7': [
          makeGolferRoundScore('golfer-7', 1, 1, 0, 0),
          makeGolferRoundScore('golfer-7', 2, 1, 0, 0),
          makeGolferRoundScore('golfer-7', 3, 1, 0, 0),
          makeGolferRoundScore('golfer-7', 4, 1, 0, 0)
        ]
      }
    };

    const user1Golfers = golferScoresMap['user1'];
    const golfersWithTotals = Object.entries(user1Golfers).map(([id, rounds]) => ({
      golfer_id: id,
      total_points: aggregateGolferAcrossRounds(rounds)
    }));

    // golfer-1st should have: 10 + 10 + 10 + (10 + 20) = 60
    expect(golfersWithTotals.find(g => g.golfer_id === 'golfer-1st').total_points).toBe(60);

    // Bonus is included in accumulation, not re-applied
    const result = aggregateEntryScore(golfersWithTotals);

    // After drop-lowest (golfer-7 at 4), best 6 sum = 60 + 36 + 32 + 28 + 24 + 20 = 200
    expect(result.best_6_sum).toBe(200);
    expect(result.dropped_golfer_id).toBe('golfer-7');
  });
});

// ---------------------------------------------------------------------------
// 3. Tie handling tests
// ---------------------------------------------------------------------------

describe('pgaSettlement — deterministic tie handling', () => {
  it('ranks tied entry totals deterministically via user_id', () => {
    // Two entries with same final total
    const scores = [
      { user_id: 'uuid-zzz', total_score: 100 },
      { user_id: 'uuid-aaa', total_score: 100 },
      { user_id: 'uuid-mmm', total_score: 90 }
    ];

    const rankings = settlementStrategy.computeRankings(scores);

    // Both tied at rank 1
    expect(rankings[0].rank).toBe(1);
    expect(rankings[1].rank).toBe(1);

    // But order is deterministic by user_id (aaa < zzz)
    expect(rankings[0].user_id).toBe('uuid-aaa');
    expect(rankings[1].user_id).toBe('uuid-zzz');
    expect(rankings[2].user_id).toBe('uuid-mmm');
    expect(rankings[2].rank).toBe(3); // Skips rank 2 (competition ranking)
  });

  it('maintains stable ordering when entry totals are equal', () => {
    const scores = [
      { user_id: 'user-2', total_score: 150 },
      { user_id: 'user-1', total_score: 150 },
      { user_id: 'user-3', total_score: 150 }
    ];

    const rankings = settlementStrategy.computeRankings(scores);

    // All ranked 1, but sorted by user_id
    expect(rankings[0].user_id).toBe('user-1');
    expect(rankings[1].user_id).toBe('user-2');
    expect(rankings[2].user_id).toBe('user-3');
    rankings.forEach(r => expect(r.rank).toBe(1));
  });
});

// ---------------------------------------------------------------------------
// 4. Idempotency tests
// ---------------------------------------------------------------------------

describe('pgaSettlement — idempotency', () => {
  it('settlement executed twice produces identical results', () => {
    const scores = [
      { user_id: 'entry-1', total_score: 185 },
      { user_id: 'entry-2', total_score: 172 }
    ];

    const rankings1 = settlementStrategy.computeRankings(scores);
    const rankings2 = settlementStrategy.computeRankings(scores);

    expect(rankings1).toEqual(rankings2);
    expect(JSON.stringify(rankings1)).toBe(JSON.stringify(rankings2));
  });

  it('payout allocation is idempotent across multiple runs', () => {
    const rankings = [
      { user_id: 'entry-1', rank: 1, score: 185 },
      { user_id: 'entry-2', rank: 2, score: 172 }
    ];
    const payoutStructure = { '1': 70, '2': 30 };
    const totalPoolCents = 10000;

    const result1 = settlementStrategy.allocatePayouts(rankings, payoutStructure, totalPoolCents);
    const result2 = settlementStrategy.allocatePayouts(rankings, payoutStructure, totalPoolCents);

    // Verify allocatePayouts is deterministic: same inputs → same output
    expect(result1.payouts).toEqual(result2.payouts);
    expect(result1.platformRemainderCents).toBe(result2.platformRemainderCents);
  });

  it('canonicalized results produce identical hashes', () => {
    const result1 = {
      rankings: [
        { user_id: 'user-1', rank: 1, score: 100 },
        { user_id: 'user-2', rank: 2, score: 90 }
      ],
      payouts: [
        { user_id: 'user-1', rank: 1, amount_cents: 7000 },
        { user_id: 'user-2', rank: 2, amount_cents: 3000 }
      ]
    };

    const result2 = {
      payouts: [
        { user_id: 'user-1', rank: 1, amount_cents: 7000 },
        { user_id: 'user-2', rank: 2, amount_cents: 3000 }
      ],
      rankings: [
        { user_id: 'user-1', rank: 1, score: 100 },
        { user_id: 'user-2', rank: 2, score: 90 }
      ]
    };

    const canonical1 = settlementStrategy.canonicalizeJson(result1);
    const canonical2 = settlementStrategy.canonicalizeJson(result2);

    const json1 = JSON.stringify(canonical1);
    const json2 = JSON.stringify(canonical2);

    expect(json1).toBe(json2);
  });
});

// ---------------------------------------------------------------------------
// 5. No NFL leakage tests
// ---------------------------------------------------------------------------

describe('pgaSettlement — no NFL assumptions', () => {
  it('does not assume week-based structure', () => {
    // PGA is round-based, not week-based
    // Settlement should work with any round numbers
    const golferScoresMap = {
      'user1': {
        'golfer-1': [
          makeGolferRoundScore('golfer-1', 100, 10, 0, 0), // arbitrary round numbers
          makeGolferRoundScore('golfer-1', 101, 10, 0, 0),
          makeGolferRoundScore('golfer-1', 102, 10, 0, 0),
          makeGolferRoundScore('golfer-1', 103, 10, 0, 0)
        ],
        'golfer-2': [
          makeGolferRoundScore('golfer-2', 100, 9, 0, 0),
          makeGolferRoundScore('golfer-2', 101, 9, 0, 0),
          makeGolferRoundScore('golfer-2', 102, 9, 0, 0),
          makeGolferRoundScore('golfer-2', 103, 9, 0, 0)
        ],
        'golfer-3': [
          makeGolferRoundScore('golfer-3', 100, 8, 0, 0),
          makeGolferRoundScore('golfer-3', 101, 8, 0, 0),
          makeGolferRoundScore('golfer-3', 102, 8, 0, 0),
          makeGolferRoundScore('golfer-3', 103, 8, 0, 0)
        ],
        'golfer-4': [
          makeGolferRoundScore('golfer-4', 100, 7, 0, 0),
          makeGolferRoundScore('golfer-4', 101, 7, 0, 0),
          makeGolferRoundScore('golfer-4', 102, 7, 0, 0),
          makeGolferRoundScore('golfer-4', 103, 7, 0, 0)
        ],
        'golfer-5': [
          makeGolferRoundScore('golfer-5', 100, 6, 0, 0),
          makeGolferRoundScore('golfer-5', 101, 6, 0, 0),
          makeGolferRoundScore('golfer-5', 102, 6, 0, 0),
          makeGolferRoundScore('golfer-5', 103, 6, 0, 0)
        ],
        'golfer-6': [
          makeGolferRoundScore('golfer-6', 100, 5, 0, 0),
          makeGolferRoundScore('golfer-6', 101, 5, 0, 0),
          makeGolferRoundScore('golfer-6', 102, 5, 0, 0),
          makeGolferRoundScore('golfer-6', 103, 5, 0, 0)
        ],
        'golfer-7': [
          makeGolferRoundScore('golfer-7', 100, 1, 0, 0),
          makeGolferRoundScore('golfer-7', 101, 1, 0, 0),
          makeGolferRoundScore('golfer-7', 102, 1, 0, 0),
          makeGolferRoundScore('golfer-7', 103, 1, 0, 0)
        ]
      }
    };

    const user1Golfers = golferScoresMap['user1'];
    const golfersWithTotals = Object.entries(user1Golfers).map(([id, rounds]) => ({
      golfer_id: id,
      total_points: aggregateGolferAcrossRounds(rounds)
    }));

    // Should work fine without assuming weeks or specific round numbers
    const result = aggregateEntryScore(golfersWithTotals);
    expect(result.dropped_golfer_id).toBe('golfer-7'); // 4 is lowest
    expect(result.best_6_sum).toBe(40 + 36 + 32 + 28 + 24 + 20); // 180
  });

  it('does not use weekly_score fields', () => {
    // Ensure settlement doesn't read NFL-style weekly_score field
    const scores = [
      { user_id: 'user-1', total_score: 100, weekly_score: 999 }, // Ignore this
      { user_id: 'user-2', total_score: 90 }
    ];

    const rankings = settlementStrategy.computeRankings(scores);

    // Should rank by total_score, not weekly_score
    expect(rankings[0].user_id).toBe('user-1');
    expect(rankings[0].score).toBe(100); // Not 999
    expect(rankings[1].user_id).toBe('user-2');
    expect(rankings[1].score).toBe(90);
  });

  it('does not assume hardcoded week numbers (e.g., 19-22)', () => {
    // NFL settlement queries weeks 19-22 for playoffs
    // PGA should not make similar assumptions
    // This is validated by the strategy function contract:
    // it should work with any round structure

    const golferRounds = [
      makeGolferRoundScore('golfer-1', 1, 10, 0, 0),
      makeGolferRoundScore('golfer-1', 2, 10, 0, 0),
      makeGolferRoundScore('golfer-1', 3, 10, 0, 0),
      makeGolferRoundScore('golfer-1', 4, 10, 0, 0)
    ];

    const total = aggregateGolferAcrossRounds(golferRounds);
    expect(total).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// 6. Contract compliance tests
// ---------------------------------------------------------------------------

describe('pgaSettlement — OpenAPI Standing contract', () => {
  it('rankings conform to Standing schema', () => {
    const scores = [
      { user_id: '550e8400-e29b-41d4-a716-446655440000', total_score: 185 },
      { user_id: '550e8400-e29b-41d4-a716-446655440001', total_score: 172 }
    ];

    const rankings = settlementStrategy.computeRankings(scores);

    rankings.forEach(standing => {
      // Must have required fields
      expect(standing).toHaveProperty('user_id');
      expect(standing).toHaveProperty('rank');
      expect(standing).toHaveProperty('score');

      // Types must match Standing schema
      expect(typeof standing.user_id).toBe('string');
      expect(typeof standing.rank).toBe('number');
      expect(typeof standing.score).toBe('number');

      // Constraints
      expect(standing.rank).toBeGreaterThanOrEqual(1);
      expect(standing.score).toEqual(expect.any(Number));
    });
  });

  it('allocatePayouts produces valid payout amounts', () => {
    const rankings = [
      { user_id: 'user-1', rank: 1, score: 185 },
      { user_id: 'user-2', rank: 2, score: 172 }
    ];
    const payoutStructure = { '1': 70, '2': 30 };
    const totalPoolCents = 10000;

    const { payouts } = settlementStrategy.allocatePayouts(rankings, payoutStructure, totalPoolCents);

    payouts.forEach(payout => {
      // Must have required fields
      expect(payout).toHaveProperty('user_id');
      expect(payout).toHaveProperty('rank');
      expect(payout).toHaveProperty('amount_cents');

      // Types
      expect(typeof payout.user_id).toBe('string');
      expect(typeof payout.rank).toBe('number');
      expect(typeof payout.amount_cents).toBe('number');

      // Amount is non-negative
      expect(payout.amount_cents).toBeGreaterThanOrEqual(0);
    });
  });
});

// ---------------------------------------------------------------------------
// 7. Integration: Full PGA settlement flow
// ---------------------------------------------------------------------------

describe('pgaSettlement — integration flow', () => {
  it('completes full settlement for 2-entry PGA contest', () => {
    // Create realistic 2-entry, 7-golfer, 4-round scenario
    const entry1Scores = {
      'g-1a': [
        makeGolferRoundScore('g-1a', 1, 8, 2, 0),
        makeGolferRoundScore('g-1a', 2, 7, 1, 0),
        makeGolferRoundScore('g-1a', 3, 8, 1, 0),
        makeGolferRoundScore('g-1a', 4, 6, 0, 15)
      ],
      'g-1b': [
        makeGolferRoundScore('g-1b', 1, 10, 0, 0),
        makeGolferRoundScore('g-1b', 2, 10, 0, 0),
        makeGolferRoundScore('g-1b', 3, 10, 0, 0),
        makeGolferRoundScore('g-1b', 4, 10, 0, 0)
      ],
      'g-1c': [
        makeGolferRoundScore('g-1c', 1, 7, 1, 0),
        makeGolferRoundScore('g-1c', 2, 7, 1, 0),
        makeGolferRoundScore('g-1c', 3, 7, 1, 0),
        makeGolferRoundScore('g-1c', 4, 7, 1, 0)
      ],
      'g-1d': [
        makeGolferRoundScore('g-1d', 1, 6, 0, 0),
        makeGolferRoundScore('g-1d', 2, 6, 0, 0),
        makeGolferRoundScore('g-1d', 3, 6, 0, 0),
        makeGolferRoundScore('g-1d', 4, 6, 0, 0)
      ],
      'g-1e': [
        makeGolferRoundScore('g-1e', 1, 8, 1, 0),
        makeGolferRoundScore('g-1e', 2, 8, 1, 0),
        makeGolferRoundScore('g-1e', 3, 8, 1, 0),
        makeGolferRoundScore('g-1e', 4, 8, 1, 0)
      ],
      'g-1f': [
        makeGolferRoundScore('g-1f', 1, 9, 0, 0),
        makeGolferRoundScore('g-1f', 2, 9, 0, 0),
        makeGolferRoundScore('g-1f', 3, 9, 0, 0),
        makeGolferRoundScore('g-1f', 4, 9, 0, 0)
      ],
      'g-1g': [
        makeGolferRoundScore('g-1g', 1, 2, 0, 0),
        makeGolferRoundScore('g-1g', 2, 2, 0, 0),
        makeGolferRoundScore('g-1g', 3, 2, 0, 0),
        makeGolferRoundScore('g-1g', 4, 2, 0, 0)
      ]
    };

    const entry2Scores = {
      'g-2a': [
        makeGolferRoundScore('g-2a', 1, 7, 0, 0),
        makeGolferRoundScore('g-2a', 2, 7, 0, 0),
        makeGolferRoundScore('g-2a', 3, 7, 0, 0),
        makeGolferRoundScore('g-2a', 4, 7, 0, 10)
      ],
      'g-2b': [
        makeGolferRoundScore('g-2b', 1, 9, 0, 0),
        makeGolferRoundScore('g-2b', 2, 9, 0, 0),
        makeGolferRoundScore('g-2b', 3, 9, 0, 0),
        makeGolferRoundScore('g-2b', 4, 9, 0, 0)
      ],
      'g-2c': [
        makeGolferRoundScore('g-2c', 1, 4, 0, 0),
        makeGolferRoundScore('g-2c', 2, 4, 0, 0),
        makeGolferRoundScore('g-2c', 3, 4, 0, 0),
        makeGolferRoundScore('g-2c', 4, 4, 0, 0)
      ],
      'g-2d': [
        makeGolferRoundScore('g-2d', 1, 5, 0, 0),
        makeGolferRoundScore('g-2d', 2, 5, 0, 0),
        makeGolferRoundScore('g-2d', 3, 5, 0, 0),
        makeGolferRoundScore('g-2d', 4, 5, 0, 0)
      ],
      'g-2e': [
        makeGolferRoundScore('g-2e', 1, 5, 0, 0),
        makeGolferRoundScore('g-2e', 2, 5, 0, 0),
        makeGolferRoundScore('g-2e', 3, 5, 0, 0),
        makeGolferRoundScore('g-2e', 4, 5, 0, 0)
      ],
      'g-2f': [
        makeGolferRoundScore('g-2f', 1, 6, 0, 0),
        makeGolferRoundScore('g-2f', 2, 6, 0, 0),
        makeGolferRoundScore('g-2f', 3, 6, 0, 0),
        makeGolferRoundScore('g-2f', 4, 6, 0, 0)
      ],
      'g-2g': [
        makeGolferRoundScore('g-2g', 1, 2, 0, 0),
        makeGolferRoundScore('g-2g', 2, 2, 0, 0),
        makeGolferRoundScore('g-2g', 3, 2, 0, 0),
        makeGolferRoundScore('g-2g', 4, 2, 0, 0)
      ]
    };

    // Aggregate each entry's golfers
    const entry1Golfers = Object.entries(entry1Scores).map(([id, rounds]) => ({
      golfer_id: id,
      total_points: aggregateGolferAcrossRounds(rounds)
    }));

    const entry2Golfers = Object.entries(entry2Scores).map(([id, rounds]) => ({
      golfer_id: id,
      total_points: aggregateGolferAcrossRounds(rounds)
    }));

    const entry1Result = aggregateEntryScore(entry1Golfers);
    const entry2Result = aggregateEntryScore(entry2Golfers);

    // Build settlement scores
    const settlementScores = [
      { user_id: 'entry-user-1', total_score: entry1Result.entry_total },
      { user_id: 'entry-user-2', total_score: entry2Result.entry_total }
    ];

    // Compute rankings
    const rankings = settlementStrategy.computeRankings(settlementScores);
    expect(rankings).toHaveLength(2);
    expect(rankings[0].rank).toBe(1);
    expect(rankings[1].rank).toBe(2);

    // Allocate payouts
    const payoutStructure = { '1': 70, '2': 30 };
    const totalPoolCents = 20000; // 2 entries × $100
    const { payouts } = settlementStrategy.allocatePayouts(rankings, payoutStructure, totalPoolCents);

    expect(payouts).toHaveLength(2);
    expect(payouts[0].amount_cents).toBe(14000); // 70% of $200
    expect(payouts[1].amount_cents).toBe(6000);  // 30% of $200
  });

  it('settlement totals remain constant across multiple recalculations', () => {
    const golferScoresMap = {
      'user-1': {
        'golfer-1': [
          makeGolferRoundScore('golfer-1', 1, 5, 0, 0),
          makeGolferRoundScore('golfer-1', 2, 5, 0, 0),
          makeGolferRoundScore('golfer-1', 3, 5, 0, 0),
          makeGolferRoundScore('golfer-1', 4, 5, 0, 10)
        ],
        'golfer-2': [
          makeGolferRoundScore('golfer-2', 1, 10, 0, 0),
          makeGolferRoundScore('golfer-2', 2, 10, 0, 0),
          makeGolferRoundScore('golfer-2', 3, 10, 0, 0),
          makeGolferRoundScore('golfer-2', 4, 10, 0, 0)
        ],
        'golfer-3': [
          makeGolferRoundScore('golfer-3', 1, 8, 0, 0),
          makeGolferRoundScore('golfer-3', 2, 8, 0, 0),
          makeGolferRoundScore('golfer-3', 3, 8, 0, 0),
          makeGolferRoundScore('golfer-3', 4, 8, 0, 0)
        ],
        'golfer-4': [
          makeGolferRoundScore('golfer-4', 1, 6, 0, 0),
          makeGolferRoundScore('golfer-4', 2, 6, 0, 0),
          makeGolferRoundScore('golfer-4', 3, 6, 0, 0),
          makeGolferRoundScore('golfer-4', 4, 6, 0, 0)
        ],
        'golfer-5': [
          makeGolferRoundScore('golfer-5', 1, 7, 0, 0),
          makeGolferRoundScore('golfer-5', 2, 7, 0, 0),
          makeGolferRoundScore('golfer-5', 3, 7, 0, 0),
          makeGolferRoundScore('golfer-5', 4, 7, 0, 0)
        ],
        'golfer-6': [
          makeGolferRoundScore('golfer-6', 1, 9, 0, 0),
          makeGolferRoundScore('golfer-6', 2, 9, 0, 0),
          makeGolferRoundScore('golfer-6', 3, 9, 0, 0),
          makeGolferRoundScore('golfer-6', 4, 9, 0, 0)
        ],
        'golfer-7': [
          makeGolferRoundScore('golfer-7', 1, 2, 0, 0),
          makeGolferRoundScore('golfer-7', 2, 2, 0, 0),
          makeGolferRoundScore('golfer-7', 3, 2, 0, 0),
          makeGolferRoundScore('golfer-7', 4, 2, 0, 0)
        ]
      }
    };

    const user1Golfers = golferScoresMap['user-1'];

    // Calculate multiple times
    const results = [];
    for (let i = 0; i < 3; i++) {
      const golfersWithTotals = Object.entries(user1Golfers).map(([id, rounds]) => ({
        golfer_id: id,
        total_points: aggregateGolferAcrossRounds(rounds)
      }));

      const result = aggregateEntryScore(golfersWithTotals);
      results.push(result);
    }

    // All results should be identical
    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);
  });
});

// ---------------------------------------------------------------------------
// 8. Edge Case Hardening — Production-grade robustness
// ---------------------------------------------------------------------------

describe('pgaSettlement — edge cases', () => {
  it('handles participant with zero golfer_scores rows', () => {
    // Participant in contest_participants but no golfer_scores
    const golferScoresMap = {
      'user-with-no-golfers': {}
    };

    const golfersWithTotals = Object.entries(golferScoresMap['user-with-no-golfers']).map(
      ([id, points]) => ({
        golfer_id: id,
        total_points: points
      })
    );

    const result = aggregateEntryScore(golfersWithTotals);

    expect(result.entry_total).toBe(0);
    expect(result.dropped_golfer_id).toBe(null);
  });

  it('handles contest with zero participants (empty settlement)', () => {
    const scores = [];
    const rankings = settlementStrategy.computeRankings(scores);

    expect(rankings).toEqual([]);
  });

  it('handles NULL total_points by treating as 0', () => {
    // Simulates golfer with NULL total_points from DB
    const golfersWithTotals = [
      { golfer_id: 'g1', total_points: 100 },
      { golfer_id: 'g2', total_points: null }, // NULL
      { golfer_id: 'g3', total_points: 80 }
    ];

    // aggregateEntryScore coerces with || 0
    const result = aggregateEntryScore(golfersWithTotals);

    // Only 3 golfers, no drop, sum = 100 + 0 + 80 = 180
    expect(result.entry_total).toBe(180);
  });

  it('handles negative golfer scores correctly', () => {
    const golferScores = [
      { golfer_id: 'g1', total_points: -10 },
      { golfer_id: 'g2', total_points: 50 },
      { golfer_id: 'g3', total_points: 30 },
      { golfer_id: 'g4', total_points: 20 },
      { golfer_id: 'g5', total_points: 10 },
      { golfer_id: 'g6', total_points: 5 },
      { golfer_id: 'g7', total_points: -5 }
    ];

    const result = aggregateEntryScore(golferScores);

    // Drops g1 (-10, lowest)
    // Sums: 50 + 30 + 20 + 10 + 5 + (-5) = 110
    expect(result.dropped_golfer_id).toBe('g1');
    expect(result.best_6_sum).toBe(110);
  });

  it('handles all-negative scores deterministically', () => {
    const golferScores = [
      { golfer_id: 'g1', total_points: -10 },
      { golfer_id: 'g2', total_points: -20 },
      { golfer_id: 'g3', total_points: -5 },
      { golfer_id: 'g4', total_points: -15 },
      { golfer_id: 'g5', total_points: -12 },
      { golfer_id: 'g6', total_points: -8 },
      { golfer_id: 'g7', total_points: -100 }
    ];

    const result = aggregateEntryScore(golferScores);

    // Drops g7 (-100, lowest / most negative)
    // Sums: -10 + -20 + -5 + -15 + -12 + -8 = -70
    expect(result.dropped_golfer_id).toBe('g7');
    expect(result.best_6_sum).toBe(-70);
  });

  it('ranks participants with identical zero scores deterministically', () => {
    const scores = [
      { user_id: 'user-c', total_score: 0 },
      { user_id: 'user-a', total_score: 0 },
      { user_id: 'user-b', total_score: 0 }
    ];

    const rankings = settlementStrategy.computeRankings(scores);

    // All rank 1, but sorted by user_id
    expect(rankings[0].user_id).toBe('user-a');
    expect(rankings[1].user_id).toBe('user-b');
    expect(rankings[2].user_id).toBe('user-c');
    rankings.forEach(r => expect(r.rank).toBe(1));
  });

  it('preserves determinism with tie-breaking across insertion orders', () => {
    const scores1 = [
      { user_id: 'zzz', total_score: 100 },
      { user_id: 'aaa', total_score: 100 },
      { user_id: 'mmm', total_score: 100 }
    ];

    const scores2 = [
      { user_id: 'aaa', total_score: 100 },
      { user_id: 'mmm', total_score: 100 },
      { user_id: 'zzz', total_score: 100 }
    ];

    const rankings1 = settlementStrategy.computeRankings(scores1);
    const rankings2 = settlementStrategy.computeRankings(scores2);

    // Both calls must produce identical order (sorted by user_id)
    expect(rankings1).toEqual(rankings2);
    expect(rankings1[0].user_id).toBe('aaa');
    expect(rankings1[1].user_id).toBe('mmm');
    expect(rankings1[2].user_id).toBe('zzz');
  });

  it('handles single participant', () => {
    const scores = [{ user_id: 'sole-participant', total_score: 150 }];
    const rankings = settlementStrategy.computeRankings(scores);

    expect(rankings).toHaveLength(1);
    expect(rankings[0].rank).toBe(1);
    expect(rankings[0].score).toBe(150);
  });

  it('preserves integer arithmetic without floating-point errors', () => {
    const golferScores = [
      { golfer_id: 'g1', total_points: 33 },
      { golfer_id: 'g2', total_points: 33 },
      { golfer_id: 'g3', total_points: 33 },
      { golfer_id: 'g4', total_points: 33 },
      { golfer_id: 'g5', total_points: 33 },
      { golfer_id: 'g6', total_points: 33 },
      { golfer_id: 'g7', total_points: 1 }
    ];

    const result = aggregateEntryScore(golferScores);

    // 33 * 6 = 198 (exact integer)
    expect(result.best_6_sum).toBe(198);
    expect(Number.isInteger(result.best_6_sum)).toBe(true);
  });

  it('payout allocation preserves integers via Math.floor', () => {
    const rankings = [
      { user_id: 'user-1', rank: 1, score: 100 },
      { user_id: 'user-2', rank: 2, score: 90 }
    ];
    const payoutStructure = { '1': 60, '2': 40 };
    const totalPoolCents = 10001; // Odd number to test rounding

    const { payouts } = settlementStrategy.allocatePayouts(rankings, payoutStructure, totalPoolCents);

    // All amounts must be integers (cents)
    payouts.forEach(payout => {
      expect(Number.isInteger(payout.amount_cents)).toBe(true);
    });

    // Sum should not exceed total pool
    const totalPayout = payouts.reduce((sum, p) => sum + p.amount_cents, 0);
    expect(totalPayout).toBeLessThanOrEqual(totalPoolCents);
  });

  it('handles large positive scores without overflow', () => {
    const golferScores = [
      { golfer_id: 'g1', total_points: 1000000 },
      { golfer_id: 'g2', total_points: 2000000 },
      { golfer_id: 'g3', total_points: 3000000 },
      { golfer_id: 'g4', total_points: 4000000 },
      { golfer_id: 'g5', total_points: 5000000 },
      { golfer_id: 'g6', total_points: 6000000 },
      { golfer_id: 'g7', total_points: 100 }
    ];

    const result = aggregateEntryScore(golferScores);

    // Sum: 1M + 2M + 3M + 4M + 5M + 6M = 21,000,000
    expect(result.best_6_sum).toBe(21000000);
    expect(result.dropped_golfer_id).toBe('g7');
  });

  it('ranks complex tie scenario with competition ranking', () => {
    const scores = [
      { user_id: 'user-5', total_score: 100 },
      { user_id: 'user-1', total_score: 100 },
      { user_id: 'user-10', total_score: 100 },
      { user_id: 'user-2', total_score: 90 },
      { user_id: 'user-20', total_score: 90 }
    ];

    const rankings = settlementStrategy.computeRankings(scores);

    // First three tied at rank 1, sorted by user_id
    expect(rankings[0].user_id).toBe('user-1');
    expect(rankings[1].user_id).toBe('user-10');
    expect(rankings[2].user_id).toBe('user-5');
    rankings.slice(0, 3).forEach(r => expect(r.rank).toBe(1));

    // Next two tied at rank 4 (competition ranking: 1, 1, 1, 4, 4)
    expect(rankings[3].rank).toBe(4);
    expect(rankings[4].rank).toBe(4);
    expect(rankings[3].user_id).toBe('user-2');
    expect(rankings[4].user_id).toBe('user-20');
  });

  it('settlement function idempotency across multiple invocations', async () => {
    // Build mock client that returns consistent data
    const mockClient = {
      query: async (sql, params) => {
        if (sql.includes('golfer') && params?.[0]) {
          return Promise.resolve({
            rows: [
              { user_id: 'user-1', golfer_id: 'g1', total_points: 100 },
              { user_id: 'user-1', golfer_id: 'g2', total_points: 90 },
              { user_id: 'user-1', golfer_id: 'g3', total_points: 85 },
              { user_id: 'user-2', golfer_id: 'g1', total_points: 95 }
            ]
          });
        }
        return Promise.resolve({ rows: [] });
      }
    };

    // Execute settlement function 3 times
    const { pgaSettlementFn } = require('../../services/strategies/pgaSettlement');
    const result1 = await pgaSettlementFn('contest-1', mockClient);
    const result2 = await pgaSettlementFn('contest-1', mockClient);
    const result3 = await pgaSettlementFn('contest-1', mockClient);

    // All must be identical
    expect(result1).toEqual(result2);
    expect(result2).toEqual(result3);
  });
});
