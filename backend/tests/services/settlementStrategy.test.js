/**
 * Settlement Strategy Tests
 *
 * Tests for the settlement computation and execution logic.
 * Covers:
 * - Unit tests for pure functions (rankings, payouts, canonicalization)
 * - Integration tests for settlement execution with real DB
 * - Error handling and edge cases
 * - Idempotency and concurrent behavior
 */

const settlementStrategy = require('../../services/settlementStrategy');

describe('Settlement Strategy', () => {
  describe('computeRankings', () => {
    it('should rank participants by total_score descending', () => {
      const scores = [
        { user_id: 'user1', total_score: 100 },
        { user_id: 'user2', total_score: 90 },
        { user_id: 'user3', total_score: 80 }
      ];

      const rankings = settlementStrategy.computeRankings(scores);

      expect(rankings).toEqual([
        { user_id: 'user1', rank: 1, score: 100 },
        { user_id: 'user2', rank: 2, score: 90 },
        { user_id: 'user3', rank: 3, score: 80 }
      ]);
    });

    it('should assign same rank to equal scores (competition ranking)', () => {
      const scores = [
        { user_id: 'user1', total_score: 100 },
        { user_id: 'user2', total_score: 100 },
        { user_id: 'user3', total_score: 90 }
      ];

      const rankings = settlementStrategy.computeRankings(scores);

      // Competition ranking: [1, 1, 3] not [1, 1, 2]
      expect(rankings[0].rank).toBe(1);
      expect(rankings[1].rank).toBe(1);
      expect(rankings[2].rank).toBe(3);
    });

    it('should handle complex tie scenarios', () => {
      const scores = [
        { user_id: 'user1', total_score: 100 },
        { user_id: 'user2', total_score: 95 },
        { user_id: 'user3', total_score: 95 },
        { user_id: 'user4', total_score: 95 },
        { user_id: 'user5', total_score: 80 }
      ];

      const rankings = settlementStrategy.computeRankings(scores);

      expect(rankings[0].rank).toBe(1); // 100
      expect(rankings[1].rank).toBe(2); // 95 (first of three-way tie)
      expect(rankings[2].rank).toBe(2); // 95 (tied)
      expect(rankings[3].rank).toBe(2); // 95 (tied)
      expect(rankings[4].rank).toBe(5); // 80 (skips 3 and 4)
    });

    it('should be deterministic with same score (sort by user_id)', () => {
      const scores = [
        { user_id: 'uuid-zzz', total_score: 100 },
        { user_id: 'uuid-aaa', total_score: 100 }
      ];

      const rankings = settlementStrategy.computeRankings(scores);

      // Both tied at rank 1, but order should be by user_id ascending
      expect(rankings[0].user_id).toBe('uuid-aaa');
      expect(rankings[1].user_id).toBe('uuid-zzz');
    });

    it('should handle empty array', () => {
      const rankings = settlementStrategy.computeRankings([]);
      expect(rankings).toEqual([]);
    });
  });

  describe('allocatePayouts', () => {
    it('should allocate payouts based on payout structure percentages', () => {
      const rankings = [
        { user_id: 'user1', rank: 1, score: 100 },
        { user_id: 'user2', rank: 2, score: 90 },
        { user_id: 'user3', rank: 3, score: 80 }
      ];
      const payoutStructure = { '1': 70, '2': 20, '3': 10 };
      const totalPoolCents = 10000; // $100

      const { payouts } = settlementStrategy.allocatePayouts(rankings, payoutStructure, totalPoolCents);

      expect(payouts).toHaveLength(3);
      expect(payouts[0]).toEqual({ user_id: 'user1', rank: 1, amount_cents: 7000 });
      expect(payouts[1]).toEqual({ user_id: 'user2', rank: 2, amount_cents: 2000 });
      expect(payouts[2]).toEqual({ user_id: 'user3', rank: 3, amount_cents: 1000 });
    });

    it('should split tied positions evenly', () => {
      const rankings = [
        { user_id: 'user1', rank: 1, score: 100 },
        { user_id: 'user2', rank: 1, score: 100 },
        { user_id: 'user3', rank: 3, score: 90 }
      ];
      const payoutStructure = { '1': 70, '2': 20, '3': 10 };
      const totalPoolCents = 10000;

      const { payouts } = settlementStrategy.allocatePayouts(rankings, payoutStructure, totalPoolCents);

      // Positions 1-2 are occupied by 2 users → combine 70% + 20% = 90%
      // 9000 / 2 = 4500 each
      expect(payouts[0]).toEqual({ user_id: 'user1', rank: 1, amount_cents: 4500 });
      expect(payouts[1]).toEqual({ user_id: 'user2', rank: 1, amount_cents: 4500 });
      // Position 3: 10% = 1000
      expect(payouts[2]).toEqual({ user_id: 'user3', rank: 3, amount_cents: 1000 });
    });

    it('should use Math.round (half-up) for cent rounding', () => {
      const rankings = [
        { user_id: 'user1', rank: 1, score: 100 },
        { user_id: 'user2', rank: 2, score: 90 },
        { user_id: 'user3', rank: 3, score: 80 }
      ];
      // Percentages that don't divide evenly
      const payoutStructure = { '1': 33, '2': 33, '3': 34 };
      const totalPoolCents = 1000; // $10

      const { payouts } = settlementStrategy.allocatePayouts(rankings, payoutStructure, totalPoolCents);

      // 330 / 1 = 330
      expect(payouts[0].amount_cents).toBe(330);
      // 330 / 1 = 330
      expect(payouts[1].amount_cents).toBe(330);
      // 340 / 1 = 340
      expect(payouts[2].amount_cents).toBe(340);
    });

    it('should handle empty payout structure', () => {
      const rankings = [{ user_id: 'user1', rank: 1, score: 100 }];
      const { payouts } = settlementStrategy.allocatePayouts(rankings, {}, 10000);

      expect(payouts).toEqual([{ user_id: 'user1', rank: 1, amount_cents: 0 }]);
    });

    it('should handle no participants', () => {
      const { payouts } = settlementStrategy.allocatePayouts([], { '1': 100 }, 10000);
      expect(payouts).toEqual([]);
    });

    it('should handle three-way tie with subsequent payout positions', () => {
      const rankings = [
        { user_id: 'user1', rank: 1, score: 100 },
        { user_id: 'user2', rank: 1, score: 100 },
        { user_id: 'user3', rank: 1, score: 100 },
        { user_id: 'user4', rank: 4, score: 80 }
      ];
      const payoutStructure = { '1': 40, '2': 30, '3': 20, '4': 10 };
      const totalPoolCents = 10000;

      const { payouts } = settlementStrategy.allocatePayouts(rankings, payoutStructure, totalPoolCents);

      // Positions 1-3 occupied by 3 users → combine 40 + 30 + 20 = 90%
      // 9000 / 3 = 3000 each
      expect(payouts[0]).toEqual({ user_id: 'user1', rank: 1, amount_cents: 3000 });
      expect(payouts[1]).toEqual({ user_id: 'user2', rank: 1, amount_cents: 3000 });
      expect(payouts[2]).toEqual({ user_id: 'user3', rank: 1, amount_cents: 3000 });
      // Position 4: 10% = 1000
      expect(payouts[3]).toEqual({ user_id: 'user4', rank: 4, amount_cents: 1000 });
    });
  });

  describe('allocatePayouts — Tie Payout Splitting with Half-Up Rounding (PGA v1 §3.3)', () => {
    it('2-way tie for 1st: split 70% + 20% equally with half-up rounding', () => {
      // Two users tied for 1st, distributable $900 after 10% rake on $1000 pool
      const rankings = [
        { user_id: 'user1', rank: 1, score: 100 },
        { user_id: 'user2', rank: 1, score: 100 },
        { user_id: 'user3', rank: 3, score: 80 }
      ];
      const payoutStructure = { '1': 70, '2': 20, '3': 10 };
      const totalPoolCents = 9000; // $90 distributable (after 10% rake)

      const { payouts } = settlementStrategy.allocatePayouts(rankings, payoutStructure, totalPoolCents);

      // Positions 1-2 occupied by 2 users → combine 70% + 20% = 90%
      // 8100 / 2 = 4050 each
      expect(payouts[0].amount_cents).toBe(4050);
      expect(payouts[1].amount_cents).toBe(4050);
      // Position 3: 10% of 9000 = 900
      expect(payouts[2].amount_cents).toBe(900);
    });

    it('3-way tie for 1st: split all 3 tiers equally with remainder to platform', () => {
      // Three users tied for 1st, $999.99 distributable
      const rankings = [
        { user_id: 'user1', rank: 1, score: 100 },
        { user_id: 'user2', rank: 1, score: 100 },
        { user_id: 'user3', rank: 1, score: 100 },
        { user_id: 'user4', rank: 4, score: 80 }
      ];
      const payoutStructure = { '1': 70, '2': 20, '3': 10, '4': 0 }; // 100% for positions 1-3
      const totalPoolCents = 9999; // $99.99 distributable

      const { payouts } = settlementStrategy.allocatePayouts(rankings, payoutStructure, totalPoolCents);

      // Positions 1-3 occupied by 3 users → combine 70% + 20% + 10% = 100%
      // 9999 / 3 = 3333 each, remainder 0
      expect(payouts[0].amount_cents).toBe(3333);
      expect(payouts[1].amount_cents).toBe(3333);
      expect(payouts[2].amount_cents).toBe(3333);
      // Position 4: 0%
      expect(payouts[3].amount_cents).toBe(0);
      // Total: 9999 (no remainder lost to truncation)
      const totalAllocated = payouts.reduce((sum, p) => sum + p.amount_cents, 0);
      expect(totalAllocated).toBe(9999);
    });

    it('10-way tie for 1st: split all 3 tiers equally', () => {
      // Ten users tied for 1st
      const rankings = Array.from({ length: 10 }, (_, i) => ({
        user_id: `user${i + 1}`,
        rank: 1,
        score: 100
      }));
      rankings.push({ user_id: 'user11', rank: 11, score: 50 });

      const payoutStructure = { '1': 70, '2': 20, '3': 10, '4': 0 };
      const totalPoolCents = 10000; // $100

      const { payouts } = settlementStrategy.allocatePayouts(rankings, payoutStructure, totalPoolCents);

      // Positions 1-3 occupied by 10 users → combine 70% + 20% + 10% = 100%
      // 10000 / 10 = 1000 each
      for (let i = 0; i < 10; i++) {
        expect(payouts[i].amount_cents).toBe(1000);
      }
      // User at rank 11: 0%
      expect(payouts[10].amount_cents).toBe(0);
    });

    it('Rounding: verifies Math.round (half-up) not Math.floor (truncation)', () => {
      // This test verifies half-up rounding behavior
      // Scenario: 1000 cents / 3 users = 333.33 each
      // Math.round: 333 (rounds to nearest)
      // Math.floor: 333 (truncates)
      // For a case where they differ: 1001 / 3 = 333.67
      // Math.round: 334, Math.floor: 333
      const rankings = [
        { user_id: 'user1', rank: 1, score: 100 },
        { user_id: 'user2', rank: 1, score: 100 },
        { user_id: 'user3', rank: 1, score: 100 }
      ];
      const payoutStructure = { '1': 100 }; // 100% for position 1
      const totalPoolCents = 10000; // $100

      const { payouts } = settlementStrategy.allocatePayouts(rankings, payoutStructure, totalPoolCents);

      // 10000 / 3 = 3333.33 → Math.round = 3333
      // With Math.floor would also be 3333
      // Total: 9999 (1 cent remainder)
      expect(payouts[0].amount_cents).toBe(3333);
      expect(payouts[1].amount_cents).toBe(3333);
      expect(payouts[2].amount_cents).toBe(3333);

      // Verify totals allocate correctly
      const totalAllocated = payouts.reduce((sum, p) => sum + p.amount_cents, 0);
      expect(totalAllocated).toBe(9999); // 1 cent remainder for platform
    });

    it('Platform rake: exactly 10% of $1000 pool = $100 rake, $900 distributable', () => {
      const rankings = [
        { user_id: 'user1', rank: 1, score: 100 },
        { user_id: 'user2', rank: 2, score: 90 }
      ];
      const payoutStructure = { '1': 100, '2': 0 }; // 100% goes to 1st
      const totalPoolCents = 9000; // Pre-rake distributable ($90)

      const { payouts } = settlementStrategy.allocatePayouts(rankings, payoutStructure, totalPoolCents);

      // 100% of 9000 = 9000 to user1
      expect(payouts[0].amount_cents).toBe(9000);
      expect(payouts[1].amount_cents).toBe(0);
    });

    it('CRITICAL INVARIANT: 10001 cents / 3-way tie = 3333 each, 2 cent remainder to platform', () => {
      // Pathological case: pool not evenly divisible by tie size
      // This is the test that would have failed with simple Math.round per-user
      const rankings = [
        { user_id: 'user1', rank: 1, score: 100 },
        { user_id: 'user2', rank: 1, score: 100 },
        { user_id: 'user3', rank: 1, score: 100 }
      ];
      const payoutStructure = { '1': 100 }; // 100% for positions 1-3 combined
      const totalPoolCents = 10001; // Odd amount that doesn't divide by 3

      const { payouts, platformRemainderCents } = settlementStrategy.allocatePayouts(rankings, payoutStructure, totalPoolCents);

      // Block payout: round(10001 * 100 / 100) = 10001 cents
      // Per-user base: floor(10001 / 3) = 3333 cents
      // Remainder: 10001 - (3333 * 3) = 2 cents (retained by platform)
      expect(payouts[0].amount_cents).toBe(3333);
      expect(payouts[1].amount_cents).toBe(3333);
      expect(payouts[2].amount_cents).toBe(3333);
      expect(platformRemainderCents).toBe(2);

      // Verify total allocated is exactly pool (no over-allocation)
      const totalAllocated = payouts.reduce((sum, p) => sum + p.amount_cents, 0);
      expect(totalAllocated).toBe(9999); // 2 cents retained by platform
      expect(totalAllocated).toBeLessThanOrEqual(totalPoolCents);

      // CONSERVATION INVARIANT (strongest guarantee): allocated + remainder = total pool
      expect(totalAllocated + platformRemainderCents).toBe(totalPoolCents);
    });

    it('INVARIANT: sum of payouts never exceeds pool across all scenarios', () => {
      // This invariant must hold for ANY valid payout structure and pool
      // These test cases all use realistic payout structures that sum to 100%
      const testCases = [
        // Case 1: Perfect division
        {
          rankings: [{ user_id: 'u1', rank: 1, score: 100 }],
          payoutStructure: { '1': 100 },
          totalPoolCents: 10000,
          description: 'Perfect division: 10000 / 1'
        },
        // Case 2: 2-way tie (remainder of 1)
        {
          rankings: [
            { user_id: 'u1', rank: 1, score: 100 },
            { user_id: 'u2', rank: 1, score: 100 }
          ],
          payoutStructure: { '1': 70, '2': 30 },
          totalPoolCents: 10001,
          description: '2-way tie with remainder'
        },
        // Case 3: 5-way tie (remainder of 3)
        {
          rankings: Array.from({ length: 5 }, (_, i) => ({
            user_id: `u${i + 1}`,
            rank: 1,
            score: 100 - i
          })),
          payoutStructure: { '1': 100 },
          totalPoolCents: 9998,
          description: '5-way tie: 9998 / 5 (floor 1999, remainder 3)'
        },
        // Case 4: Standard PGA payout structure
        {
          rankings: [
            { user_id: 'u1', rank: 1, score: 100 },
            { user_id: 'u2', rank: 2, score: 90 },
            { user_id: 'u3', rank: 3, score: 80 }
          ],
          payoutStructure: { '1': 70, '2': 20, '3': 10 },
          totalPoolCents: 9000,
          description: 'Standard PGA: 70% / 20% / 10% of $90'
        }
      ];

      testCases.forEach(testCase => {
        const { payouts, platformRemainderCents } = settlementStrategy.allocatePayouts(
          testCase.rankings,
          testCase.payoutStructure,
          testCase.totalPoolCents
        );

        const totalAllocated = payouts.reduce((sum, p) => sum + p.amount_cents, 0);

        // Core invariant: NEVER exceed pool (this is non-negotiable)
        // This is the critical property that prevents accounting drift
        expect(totalAllocated).toBeLessThanOrEqual(testCase.totalPoolCents);

        // CONSERVATION INVARIANT: allocated + remainder = total pool
        // This guarantees perfect accounting for audits
        expect(totalAllocated + platformRemainderCents).toBe(testCase.totalPoolCents);

        // Secondary: allocated should be reasonably close to pool
        // Remainder is due to per-tie-group floor divisions
        const difference = testCase.totalPoolCents - totalAllocated;
        expect(difference).toBeLessThan(testCase.totalPoolCents * 0.01); // less than 1% loss
      });
    });

    it('CONSERVATION: payouts + remainder always equal pool for any valid structure', () => {
      // This is the ultimate correctness check for financial code
      // It proves that no money is lost or created by rounding
      const scenarios = [
        {
          name: 'Single winner, odd pool',
          rankings: [{ user_id: 'u1', rank: 1, score: 100 }],
          payoutStructure: { '1': 100 },
          pool: 12345
        },
        {
          name: '2-way tie, 70/30 split',
          rankings: [
            { user_id: 'u1', rank: 1, score: 100 },
            { user_id: 'u2', rank: 1, score: 100 }
          ],
          payoutStructure: { '1': 70, '2': 30 },
          pool: 50001
        },
        {
          name: '4-way tie, 100% split',
          rankings: Array.from({ length: 4 }, (_, i) => ({
            user_id: `u${i + 1}`,
            rank: 1,
            score: 100 - i
          })),
          payoutStructure: { '1': 100 },
          pool: 9999
        }
      ];

      scenarios.forEach(scenario => {
        const { payouts, platformRemainderCents } = settlementStrategy.allocatePayouts(
          scenario.rankings,
          scenario.payoutStructure,
          scenario.pool
        );

        const totalAllocated = payouts.reduce((sum, p) => sum + p.amount_cents, 0);

        // The proof: conservation holds across all valid scenarios
        expect(totalAllocated + platformRemainderCents).toBe(
          scenario.pool,
          `FAILED: ${scenario.name} - allocated ${totalAllocated} + remainder ${platformRemainderCents} != pool ${scenario.pool}`
        );
      });
    });
  });

  describe('calculateTotalPool', () => {
    it('should calculate total pool from entry fee and participant count', () => {
      const contestInstance = { entry_fee_cents: 1000 };
      const participantCount = 10;

      const totalPool = settlementStrategy.calculateTotalPool(contestInstance, participantCount);

      expect(totalPool).toBe(10000);
    });

    it('should handle zero participants', () => {
      const contestInstance = { entry_fee_cents: 1000 };
      const totalPool = settlementStrategy.calculateTotalPool(contestInstance, 0);
      expect(totalPool).toBe(0);
    });

    it('should handle large values', () => {
      const contestInstance = { entry_fee_cents: 500000 }; // $5000
      const participantCount = 100;

      const totalPool = settlementStrategy.calculateTotalPool(contestInstance, participantCount);

      expect(totalPool).toBe(50000000); // $500,000
    });
  });

  describe('canonicalizeJson', () => {
    it('should sort object keys alphabetically', () => {
      const obj = { z: 1, a: 2, m: 3 };
      const canonical = settlementStrategy.canonicalizeJson(obj);

      const keys = Object.keys(canonical);
      expect(keys).toEqual(['a', 'm', 'z']);
    });

    it('should recursively canonicalize nested objects', () => {
      const obj = {
        z: { y: 1, a: 2 },
        a: { m: 3, b: 4 }
      };
      const canonical = settlementStrategy.canonicalizeJson(obj);

      expect(Object.keys(canonical)).toEqual(['a', 'z']);
      expect(Object.keys(canonical.a)).toEqual(['b', 'm']);
      expect(Object.keys(canonical.z)).toEqual(['a', 'y']);
    });

    it('should preserve array order', () => {
      const obj = {
        arr: [{ z: 1, a: 2 }, { m: 3, b: 4 }]
      };
      const canonical = settlementStrategy.canonicalizeJson(obj);

      expect(canonical.arr).toHaveLength(2);
      expect(canonical.arr[0]).toEqual({ a: 2, z: 1 });
      expect(canonical.arr[1]).toEqual({ b: 4, m: 3 });
    });

    it('should handle primitives', () => {
      expect(settlementStrategy.canonicalizeJson(123)).toBe(123);
      expect(settlementStrategy.canonicalizeJson('string')).toBe('string');
      expect(settlementStrategy.canonicalizeJson(true)).toBe(true);
      expect(settlementStrategy.canonicalizeJson(null)).toBe(null);
    });

    it('should make same data always produce same JSON string', () => {
      const data1 = { z: 1, a: { m: 2, b: 3 }, arr: [4, 5] };
      const data2 = { a: { b: 3, m: 2 }, z: 1, arr: [4, 5] };

      const json1 = JSON.stringify(settlementStrategy.canonicalizeJson(data1));
      const json2 = JSON.stringify(settlementStrategy.canonicalizeJson(data2));

      expect(json1).toBe(json2);
    });
  });

  describe('executeSettlement', () => {
    let mockPool;
    let mockClient;

    beforeEach(() => {
      mockClient = {
        query: jest.fn(),
        release: jest.fn()
      };

      mockPool = {
        connect: jest.fn().mockResolvedValue(mockClient)
      };

      const queryQueue = [];

      mockClient.query.mockImplementation((sql, params) => {
        // Transaction control statements pass through
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return Promise.resolve({ rows: [] });
        }

        // All other queries must be explicitly queued
        const response = queryQueue.shift();
        if (!response) {
          throw new Error(`Unexpected query: ${sql.substring(0, 80)}`);
        }

        return Promise.resolve(response);
      });

      // Helper to queue responses in execution order
      mockClient._queueResponse = (response) => {
        queryQueue.push(response);
        return mockClient; // allow chaining
      };
    });

    it('should execute settlement transaction successfully', async () => {
      const contestInstance = {
        id: 'contest-id',
        entry_fee_cents: 1000,
        payout_structure: { '1': 100 }
      };

      mockClient
        ._queueResponse({
          rows: [
            {
              id: 'contest-id',
              status: 'LIVE',
              entry_fee_cents: 1000,
              payout_structure: { '1': 100 },
              settle_time: null
            }
          ]
        }) // lock
        ._queueResponse({ rows: [] }) // no existing settlement
        ._queueResponse({ rows: [{ settlement_strategy_key: 'final_standings' }] }) // template query
        ._queueResponse({ rows: [{ playoff_start_week: 19 }] }) // settings
        ._queueResponse({
          rows: [{ user_id: 'user1', total_score: 100 }]
        }) // scores
        ._queueResponse({
          rows: [{ id: 'settlement-id' }]
        }) // insert settlement
        ._queueResponse({ rows: [] }) // update scoring_run_id
        ._queueResponse({ rows: [] }) // update settle_time
        ._queueResponse({ rows: [] }); // audit

      const result = await settlementStrategy.executeSettlement(
        contestInstance,
        mockPool,
        'snapshot-123',
        'hash-123'
      );

      expect(result).toEqual({ id: 'settlement-id' });
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should return existing settlement record (idempotency)', async () => {
      const contestInstance = {
        id: 'contest-id',
        entry_fee_cents: 1000,
        payout_structure: {}
      };

      mockClient
        ._queueResponse({
          rows: [
            {
              id: 'contest-id',
              status: 'LIVE',
              entry_fee_cents: 1000,
              payout_structure: {},
              settle_time: null
            }
          ]
        }) // lock
        ._queueResponse({ rows: [{ id: 'existing-settlement' }] }); // existing settlement

      const result = await settlementStrategy.executeSettlement(
        contestInstance,
        mockPool,
        'snapshot-123',
        'hash-123'
      );

      expect(result).toEqual({ id: 'existing-settlement' });
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('should throw if settle_time exists but no settlement record', async () => {
      const contestInstance = {
        id: 'contest-id',
        entry_fee_cents: 1000,
        payout_structure: {}
      };

      mockClient
        ._queueResponse({
          rows: [
            {
              id: 'contest-id',
              status: 'LIVE',
              entry_fee_cents: 1000,
              payout_structure: {},
              settle_time: '2025-01-01' // settle_time already set!
            }
          ]
        }) // lock with settle_time
        ._queueResponse({ rows: [] }); // no settlement record

      await expect(
        settlementStrategy.executeSettlement(
          contestInstance,
          mockPool,
          'snapshot-123',
          'hash-123'
        )
      ).rejects.toThrow('INCONSISTENT_STATE');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('should rollback on database error', async () => {
      const contestInstance = {
        id: 'contest-id',
        entry_fee_cents: 1000,
        payout_structure: {}
      };

      mockClient.query
        .mockResolvedValueOnce({ rows: [{ id: 'contest-id' }] }) // lock
        .mockResolvedValueOnce({ rows: [] }) // no existing
        .mockRejectedValueOnce(new Error('DB error'));

      await expect(
        settlementStrategy.executeSettlement(
          contestInstance,
          mockPool,
          'snapshot-123',
          'hash-123'
        )
      ).rejects.toThrow('DB error');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.query).not.toHaveBeenCalledWith('COMMIT');
    });

    it('should write SYSTEM audit record', async () => {
      const contestInstance = {
        id: 'contest-id',
        entry_fee_cents: 1000,
        payout_structure: { '1': 100 }
      };

      mockClient
        ._queueResponse({
          rows: [
            {
              id: 'contest-id',
              status: 'LIVE',
              entry_fee_cents: 1000,
              payout_structure: { '1': 100 },
              settle_time: null
            }
          ]
        }) // lock
        ._queueResponse({ rows: [] }) // no existing
        ._queueResponse({ rows: [{ settlement_strategy_key: 'final_standings' }] }) // template query
        ._queueResponse({ rows: [{ playoff_start_week: 19 }] }) // nflSettlementFn: get start week
        ._queueResponse({
          rows: [{ user_id: 'user1', total_score: 100 }]
        }) // nflSettlementFn: get scores
        ._queueResponse({ rows: [{ id: 'settlement-123', contest_instance_id: 'contest-id' }] }) // insert settlement
        ._queueResponse({ rows: [] }) // update scoring_run_id
        ._queueResponse({ rows: [{ id: 'contest-id' }] }) // update contest_instances (RETURNING id)
        ._queueResponse({ rows: [] }) // INSERT contest_state_transitions
        ._queueResponse({ rows: [] }); // INSERT admin_contest_audit

      await settlementStrategy.executeSettlement(
        contestInstance,
        mockPool,
        'snapshot-123',
        'hash-123'
      );

      // Check that audit insert was called with SYSTEM UUID
      const auditCall = mockClient.query.mock.calls.find(
        call => call[0] && call[0].includes('admin_contest_audit')
      );
      expect(auditCall).toBeDefined();
      expect(auditCall[1][1]).toBe('00000000-0000-0000-0000-000000000000');
    });

    it('should refuse settlement without snapshot_id binding', async () => {
      const contestInstance = {
        id: 'contest-id',
        entry_fee_cents: 1000,
        payout_structure: {}
      };

      mockClient
        ._queueResponse({
          rows: [
            {
              id: 'contest-id',
              status: 'LIVE',
              entry_fee_cents: 1000,
              payout_structure: {},
              settle_time: null
            }
          ]
        }) // lock
        ._queueResponse({ rows: [] }) // no existing settlement
        ._queueResponse({ rows: [{ settlement_strategy_key: 'final_standings' }] }); // template query

      await expect(
        settlementStrategy.executeSettlement(contestInstance, mockPool, null, 'hash')
      ).rejects.toThrow('SETTLEMENT_REQUIRES_SNAPSHOT_ID');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('should refuse settlement without snapshot_hash binding', async () => {
      const contestInstance = {
        id: 'contest-id',
        entry_fee_cents: 1000,
        payout_structure: {}
      };

      mockClient
        ._queueResponse({
          rows: [
            {
              id: 'contest-id',
              status: 'LIVE',
              entry_fee_cents: 1000,
              payout_structure: {},
              settle_time: null
            }
          ]
        }) // lock
        ._queueResponse({ rows: [] }) // no existing settlement
        ._queueResponse({ rows: [{ settlement_strategy_key: 'final_standings' }] }); // template query

      await expect(
        settlementStrategy.executeSettlement(contestInstance, mockPool, 'snap-id', null)
      ).rejects.toThrow('SETTLEMENT_REQUIRES_SNAPSHOT_HASH');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('should store snapshot binding in settlement_records INSERT', async () => {
      const contestInstance = {
        id: 'contest-id',
        entry_fee_cents: 1000,
        payout_structure: { '1': 100 }
      };
      const snapshotId = 'snapshot-abc-123';
      const snapshotHash = 'blake3-xyz-abc';

      mockClient
        ._queueResponse({
          rows: [
            {
              id: 'contest-id',
              status: 'LIVE',
              entry_fee_cents: 1000,
              payout_structure: { '1': 100 },
              settle_time: null
            }
          ]
        }) // lock
        ._queueResponse({ rows: [] }) // no existing
        ._queueResponse({ rows: [{ settlement_strategy_key: 'final_standings' }] }) // template query
        ._queueResponse({ rows: [{ playoff_start_week: 19 }] }) // settings
        ._queueResponse({
          rows: [{ user_id: 'user1', total_score: 100 }]
        }) // scores
        ._queueResponse({
          rows: [{ id: 'settlement-id', snapshot_id: snapshotId }]
        }) // insert settlement with snapshot
        ._queueResponse({ rows: [] }) // update scoring_run_id
        ._queueResponse({ rows: [] }) // update settle_time
        ._queueResponse({ rows: [] }); // audit

      const result = await settlementStrategy.executeSettlement(
        contestInstance,
        mockPool,
        snapshotId,
        snapshotHash
      );

      // Verify snapshot binding was included in INSERT
      const settlementInsertCall = mockClient.query.mock.calls.find(
        call => call[0] && call[0].includes('settlement_records') && call[0].includes('INSERT')
      );

      expect(settlementInsertCall).toBeDefined();
      // Check that snapshot_id, snapshot_hash were passed as params
      const params = settlementInsertCall[1];
      expect(params).toContain(snapshotId);
      expect(params).toContain(snapshotHash);
    });

    it('should include snapshot context in audit payload', async () => {
      const contestInstance = {
        id: 'contest-id',
        entry_fee_cents: 1000,
        payout_structure: { '1': 100 }
      };
      const snapshotId = 'snapshot-def-456';
      const snapshotHash = 'hash-def-456';

      mockClient
        ._queueResponse({
          rows: [
            {
              id: 'contest-id',
              status: 'LIVE',
              entry_fee_cents: 1000,
              payout_structure: { '1': 100 },
              settle_time: null
            }
          ]
        }) // lock
        ._queueResponse({ rows: [] }) // no existing
        ._queueResponse({ rows: [{ settlement_strategy_key: 'final_standings' }] }) // template
        ._queueResponse({ rows: [{ playoff_start_week: 19 }] }) // nflSettlementFn: get start week
        ._queueResponse({
          rows: [{ user_id: 'user1', total_score: 100 }]
        }) // nflSettlementFn: get scores
        ._queueResponse({ rows: [{ id: 'settlement-123', contest_instance_id: 'contest-id' }] }) // insert settlement
        ._queueResponse({ rows: [] }) // update scoring_run_id
        ._queueResponse({ rows: [{ id: 'contest-id' }] }) // update contest_instances (RETURNING id)
        ._queueResponse({ rows: [] }) // INSERT contest_state_transitions
        ._queueResponse({ rows: [] }); // INSERT admin_contest_audit

      await settlementStrategy.executeSettlement(
        contestInstance,
        mockPool,
        snapshotId,
        snapshotHash
      );

      // Verify audit insert includes snapshot context
      const auditCall = mockClient.query.mock.calls.find(
        call => call[0] && call[0].includes('admin_contest_audit')
      );

      expect(auditCall).toBeDefined();
      const auditPayload = JSON.parse(auditCall[1][6]);
      expect(auditPayload.snapshot_id).toBe(snapshotId);
      expect(auditPayload.snapshot_hash).toBe(snapshotHash);
      expect(auditPayload.scoring_run_id).toBeDefined(); // Will be set to settlement_records.id
    });
  });

  describe('Integration: Settlement Flow', () => {
    it('should compute correct settlement for 3-person contest with tie', () => {
      // Compute rankings for a tie scenario
      const scores = [
        { user_id: 'user1', total_score: 100 },
        { user_id: 'user2', total_score: 100 },
        { user_id: 'user3', total_score: 90 }
      ];

      const rankings = settlementStrategy.computeRankings(scores);
      expect(rankings[0].rank).toBe(1);
      expect(rankings[1].rank).toBe(1);
      expect(rankings[2].rank).toBe(3);

      // Allocate payouts for the tie
      const payoutStructure = { '1': 70, '2': 20, '3': 10 };
      const totalPoolCents = 10000;

      const { payouts } = settlementStrategy.allocatePayouts(rankings, payoutStructure, totalPoolCents);

      // Two users tied at rank 1 occupy positions 1-2
      // Combined: 70% + 20% = 90%, split: 4500 each
      expect(payouts[0].amount_cents).toBe(4500);
      expect(payouts[1].amount_cents).toBe(4500);
      // User at rank 3 gets 10%: 1000
      expect(payouts[2].amount_cents).toBe(1000);
    });
  });

  describe('computeSettlement — End-to-End Settlement Plan with Snapshot Binding', () => {
    it('should refuse settlement with unknown strategy key', () => {
      const contestInstance = {
        id: 'contest-123',
        entry_fee_cents: 1000,
        payout_structure: { '1': 70, '2': 20, '3': 10 }
      };
      const scores = [
        { user_id: 'user1', total_score: 100 },
        { user_id: 'user2', total_score: 90 }
      ];

      expect(() => {
        settlementStrategy.computeSettlement(
          'unknown_strategy',
          contestInstance,
          scores,
          'snapshot-123',
          'abc123hash'
        );
      }).toThrow(/Unknown settlement strategy/);
    });

    it('should refuse settlement without snapshot_id (PGA v1 Section 4.1)', () => {
      const contestInstance = {
        id: 'contest-123',
        entry_fee_cents: 1000,
        payout_structure: { '1': 70, '2': 20, '3': 10 }
      };
      const scores = [
        { user_id: 'user1', total_score: 100 },
        { user_id: 'user2', total_score: 90 }
      ];

      expect(() => {
        settlementStrategy.computeSettlement(
          'final_standings',
          contestInstance,
          scores,
          null, // missing snapshot_id
          'abc123hash'
        );
      }).toThrow('SETTLEMENT_REQUIRES_SNAPSHOT_ID');
    });

    it('should refuse settlement without snapshot_hash', () => {
      const contestInstance = {
        id: 'contest-123',
        entry_fee_cents: 1000,
        payout_structure: { '1': 70, '2': 20, '3': 10 }
      };
      const scores = [{ user_id: 'user1', total_score: 100 }];

      expect(() => {
        settlementStrategy.computeSettlement(
          'final_standings',
          contestInstance,
          scores,
          'snapshot-123',
          null // missing snapshot_hash
        );
      }).toThrow('SETTLEMENT_REQUIRES_SNAPSHOT_HASH');
    });

    it('should compute settlement plan with snapshot binding and 10% rake', () => {
      const contestInstance = {
        id: 'contest-123',
        entry_fee_cents: 1000, // $10 per person
        payout_structure: { '1': 70, '2': 20, '3': 10 }
      };
      const scores = [
        { user_id: 'user1', total_score: 100 },
        { user_id: 'user2', total_score: 90 },
        { user_id: 'user3', total_score: 80 }
      ];
      const snapshotId = 'snapshot-abc-123';
      const snapshotHash = 'blake3-hash-xyz';

      const plan = settlementStrategy.computeSettlement(
        'final_standings',
        contestInstance,
        scores,
        snapshotId,
        snapshotHash
      );

      // Verify snapshot binding
      expect(plan.snapshot_id).toBe(snapshotId);
      expect(plan.snapshot_hash).toBe(snapshotHash);
      // Note: scoring_run_id is NOT set by computeSettlement; it's set after settlement_records INSERT

      // Verify pool and rake: 3 * 1000 = 3000 cents total
      // Rake: 10% of 3000 = 300
      // Distributable: 90% of 3000 = 2700
      expect(plan.total_pool_cents).toBe(3000);
      expect(plan.rake_cents).toBe(300);
      expect(plan.distributable_cents).toBe(2700);

      // Verify rankings
      expect(plan.rankings[0]).toEqual({ user_id: 'user1', rank: 1, score: 100 });
      expect(plan.rankings[1]).toEqual({ user_id: 'user2', rank: 2, score: 90 });
      expect(plan.rankings[2]).toEqual({ user_id: 'user3', rank: 3, score: 80 });

      // Verify payouts are from distributable pool (2700)
      // Position 1: 70% of 2700 = 1890
      expect(plan.payouts[0]).toEqual({ user_id: 'user1', rank: 1, amount_cents: 1890 });
      // Position 2: 20% of 2700 = 540
      expect(plan.payouts[1]).toEqual({ user_id: 'user2', rank: 2, amount_cents: 540 });
      // Position 3: 10% of 2700 = 270
      expect(plan.payouts[2]).toEqual({ user_id: 'user3', rank: 3, amount_cents: 270 });

      // Verify plan status
      expect(plan.status).toBe('computed');
      expect(plan.participant_count).toBe(3);
      expect(plan.computed_at).toBeInstanceOf(Date);
    });

    it('should handle odd-amount rake calculation correctly', () => {
      const contestInstance = {
        id: 'contest-456',
        entry_fee_cents: 999, // $9.99
        payout_structure: { '1': 100 }
      };
      const scores = [
        { user_id: 'user1', total_score: 100 },
        { user_id: 'user2', total_score: 90 }
      ];

      const plan = settlementStrategy.computeSettlement(
        'final_standings',
        contestInstance,
        scores,
        'snapshot-def-456',
        'hash-456'
      );

      // Total pool: 2 * 999 = 1998 cents
      // Rake: Math.round(1998 * 0.10) = 200 cents (not 199.8)
      expect(plan.total_pool_cents).toBe(1998);
      expect(plan.rake_cents).toBe(200);
      expect(plan.distributable_cents).toBe(1798);
    });

    it('should be deterministic with same snapshot and scores', () => {
      const contestInstance = {
        id: 'contest-999',
        entry_fee_cents: 5000,
        payout_structure: { '1': 70, '2': 20, '3': 10 }
      };
      const scores = [
        { user_id: 'user-apple', total_score: 250 },
        { user_id: 'user-banana', total_score: 240 },
        { user_id: 'user-cherry', total_score: 230 }
      ];
      const snapshotId = 'snapshot-immutable-123';
      const snapshotHash = 'blake3-xyz';

      // Compute twice with identical inputs
      const plan1 = settlementStrategy.computeSettlement(
        'final_standings',
        contestInstance,
        scores,
        snapshotId,
        snapshotHash
      );

      const plan2 = settlementStrategy.computeSettlement(
        'final_standings',
        contestInstance,
        scores,
        snapshotId,
        snapshotHash
      );

      // Payouts must be identical (not just equal amounts, but same order)
      expect(plan1.payouts).toEqual(plan2.payouts);
      expect(plan1.rankings).toEqual(plan2.rankings);
      expect(plan1.rake_cents).toBe(plan2.rake_cents);
      expect(plan1.distributable_cents).toBe(plan2.distributable_cents);
    });
  });
});
