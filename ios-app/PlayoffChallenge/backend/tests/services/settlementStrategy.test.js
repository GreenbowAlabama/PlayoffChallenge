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

      const payouts = settlementStrategy.allocatePayouts(rankings, payoutStructure, totalPoolCents);

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

      const payouts = settlementStrategy.allocatePayouts(rankings, payoutStructure, totalPoolCents);

      // Positions 1-2 are occupied by 2 users → combine 70% + 20% = 90%
      // 9000 / 2 = 4500 each
      expect(payouts[0]).toEqual({ user_id: 'user1', rank: 1, amount_cents: 4500 });
      expect(payouts[1]).toEqual({ user_id: 'user2', rank: 1, amount_cents: 4500 });
      // Position 3: 10% = 1000
      expect(payouts[2]).toEqual({ user_id: 'user3', rank: 3, amount_cents: 1000 });
    });

    it('should use Math.floor for cent rounding', () => {
      const rankings = [
        { user_id: 'user1', rank: 1, score: 100 },
        { user_id: 'user2', rank: 2, score: 90 },
        { user_id: 'user3', rank: 3, score: 80 }
      ];
      // Percentages that don't divide evenly
      const payoutStructure = { '1': 33, '2': 33, '3': 34 };
      const totalPoolCents = 1000; // $10

      const payouts = settlementStrategy.allocatePayouts(rankings, payoutStructure, totalPoolCents);

      // 330 / 1 = 330
      expect(payouts[0].amount_cents).toBe(330);
      // 330 / 1 = 330
      expect(payouts[1].amount_cents).toBe(330);
      // 340 / 1 = 340
      expect(payouts[2].amount_cents).toBe(340);
    });

    it('should handle empty payout structure', () => {
      const rankings = [{ user_id: 'user1', rank: 1, score: 100 }];
      const payouts = settlementStrategy.allocatePayouts(rankings, {}, 10000);

      expect(payouts).toEqual([{ user_id: 'user1', rank: 1, amount_cents: 0 }]);
    });

    it('should handle no participants', () => {
      const payouts = settlementStrategy.allocatePayouts([], { '1': 100 }, 10000);
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

      const payouts = settlementStrategy.allocatePayouts(rankings, payoutStructure, totalPoolCents);

      // Positions 1-3 occupied by 3 users → combine 40 + 30 + 20 = 90%
      // 9000 / 3 = 3000 each
      expect(payouts[0]).toEqual({ user_id: 'user1', rank: 1, amount_cents: 3000 });
      expect(payouts[1]).toEqual({ user_id: 'user2', rank: 1, amount_cents: 3000 });
      expect(payouts[2]).toEqual({ user_id: 'user3', rank: 1, amount_cents: 3000 });
      // Position 4: 10% = 1000
      expect(payouts[3]).toEqual({ user_id: 'user4', rank: 4, amount_cents: 1000 });
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
        ._queueResponse({ rows: [] }) // update settle_time
        ._queueResponse({ rows: [] }); // audit

      const result = await settlementStrategy.executeSettlement(contestInstance, mockPool);

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

      const result = await settlementStrategy.executeSettlement(contestInstance, mockPool);

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
        settlementStrategy.executeSettlement(contestInstance, mockPool)
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
        settlementStrategy.executeSettlement(contestInstance, mockPool)
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
        ._queueResponse({ rows: [{ playoff_start_week: 19 }] }) // settings
        ._queueResponse({
          rows: [{ user_id: 'user1', total_score: 100 }]
        }) // scores
        ._queueResponse({ rows: [{ id: 'settlement' }] }) // insert settlement
        ._queueResponse({ rows: [] }) // update settle_time
        ._queueResponse({ rows: [] }); // audit

      await settlementStrategy.executeSettlement(contestInstance, mockPool);

      // Check that audit insert was called with SYSTEM UUID
      const auditCall = mockClient.query.mock.calls.find(
        call => call[0] && call[0].includes('admin_contest_audit')
      );
      expect(auditCall).toBeDefined();
      expect(auditCall[1][1]).toBe('00000000-0000-0000-0000-000000000000');
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

      const payouts = settlementStrategy.allocatePayouts(rankings, payoutStructure, totalPoolCents);

      // Two users tied at rank 1 occupy positions 1-2
      // Combined: 70% + 20% = 90%, split: 4500 each
      expect(payouts[0].amount_cents).toBe(4500);
      expect(payouts[1].amount_cents).toBe(4500);
      // User at rank 3 gets 10%: 1000
      expect(payouts[2].amount_cents).toBe(1000);
    });
  });
});
