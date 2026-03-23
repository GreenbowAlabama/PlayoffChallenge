/**
 * Settlement Strategy — Invariant Guard Tests
 *
 * Tests for financial invariant enforcement:
 * - Zero payout guard (prevents invalid settlements)
 * - Payout structure normalization (handles nested percentages)
 */

const settlementStrategy = require('../../services/settlementStrategy');
const { validateSettlementInvariants } = settlementStrategy;

describe('Settlement Strategy — Invariant Guards', () => {

  describe('CRITICAL: Invariant Guards (THROW Enforcement)', () => {

    it('should THROW when distributable pool exists but payouts are zero', () => {
      const scores = [
        { user_id: 'user1', total_score: 100 },
        { user_id: 'user2', total_score: 90 }
      ];

      const contestInstance = {
        id: 'contest1',
        entry_fee_cents: 10000,
        payout_structure: {} // forces zero payouts
      };

      expect(() => {
        settlementStrategy.computeSettlement(
          'pga_standard_v1',
          contestInstance,
          scores,
          'snap1',
          'hash1'
        );
      }).toThrow('INVALID_SETTLEMENT_ZERO_PAYOUTS');
    });

    it('should THROW with clear error message identifying the issue', () => {
      const scores = [
        { user_id: 'user1', total_score: 100 },
        { user_id: 'user2', total_score: 90 },
        { user_id: 'user3', total_score: 80 }
      ];

      const contestInstance = {
        id: 'contest-abc-123',
        entry_fee_cents: 10000,
        payout_structure: {} // empty structure causes zero payouts
      };

      const fn = () => {
        settlementStrategy.computeSettlement(
          'pga_standard_v1',
          contestInstance,
          scores,
          'snap1',
          'hash1'
        );
      };

      expect(fn).toThrow('INVALID_SETTLEMENT_ZERO_PAYOUTS');
      expect(fn).toThrow(/Pool/);
      expect(fn).toThrow(/payouts = 0/);
    });

    it('should NOT throw when pool is zero (empty contest is valid)', () => {
      const scores = []; // no participants

      const contestInstance = {
        id: 'contest1',
        entry_fee_cents: 10000,
        payout_structure: {
          "1": 100
        }
      };

      // Should not throw - empty contests are valid
      const result = settlementStrategy.computeSettlement(
        'pga_standard_v1',
        contestInstance,
        scores,
        'snap1',
        'hash1'
      );

      expect(result.total_pool_cents).toBe(0);
      expect(result.payouts).toHaveLength(0);
    });

    it('should NOT throw when payouts are non-zero despite missing positions', () => {
      const scores = [
        { user_id: 'user1', total_score: 100 },
        { user_id: 'user2', total_score: 90 }
      ];

      const contestInstance = {
        id: 'contest1',
        entry_fee_cents: 10000,
        payout_structure: {
          "1": 100
          // Only position 1 defined, but still > 0
        }
      };

      // Should not throw - at least one payout is non-zero
      const result = settlementStrategy.computeSettlement(
        'pga_standard_v1',
        contestInstance,
        scores,
        'snap1',
        'hash1'
      );

      expect(result.payouts[0].amount_cents).toBeGreaterThan(0);
    });

    it('should satisfy conservation law on valid settlement', () => {
      // This test verifies that a valid settlement satisfies conservation law:
      // payouts + remainder = distributable pool
      const scores = [
        { user_id: 'user1', total_score: 100 }
      ];

      const contestInstance = {
        id: 'contest1',
        entry_fee_cents: 10000,
        payout_structure: {
          "1": 100
        }
      };

      // Valid settlement should complete
      const result = settlementStrategy.computeSettlement(
        'pga_standard_v1',
        contestInstance,
        scores,
        'snap1',
        'hash1'
      );

      // Verify conservation: payouts + remainder = distributable
      const totalPayouts = result.payouts.reduce((sum, p) => sum + p.amount_cents, 0);
      const conservation = totalPayouts + result.platform_remainder_cents;
      expect(conservation).toBe(result.distributable_cents);
    });

    it('should THROW when conservation law is violated', () => {
      // Direct test of validateSettlementInvariants helper
      // Simulating: distributable=9000, payouts=8000, remainder=0 (mismatch!)
      expect(() => {
        validateSettlementInvariants(
          9000,  // distributableCents
          8000,  // totalPayoutsCents (missing 1000!)
          0      // platformRemainderCents
        );
      }).toThrow('INVALID_SETTLEMENT_CONSERVATION_MISMATCH');
    });

    it('should THROW with clear message on conservation violation', () => {
      expect(() => {
        validateSettlementInvariants(
          10000, // distributableCents
          5000,  // totalPayoutsCents
          3000   // platformRemainderCents (total=8000, expected 10000)
        );
      }).toThrow(/payouts \(5000\) \+ remainder \(3000\) = 8000, expected 10000/);
    });
  });

  describe('allocatePayouts - Payout Structure Normalization', () => {

    it('should handle flat payout structure {"1": 50, "2": 30, "3": 20}', () => {
      const rankings = [
        { user_id: 'user1', rank: 1, score: 100 },
        { user_id: 'user2', rank: 2, score: 90 },
        { user_id: 'user3', rank: 3, score: 80 }
      ];

      const flatStructure = {
        "1": 50,
        "2": 30,
        "3": 20
      };

      const result = settlementStrategy.allocatePayouts(rankings, flatStructure, 10000);

      expect(result.payouts).toHaveLength(3);
      expect(result.payouts[0].amount_cents).toBe(5000); // rank 1: 50%
      expect(result.payouts[1].amount_cents).toBe(3000); // rank 2: 30%
      expect(result.payouts[2].amount_cents).toBe(2000); // rank 3: 20%
    });

    it('should handle nested payout structure with payout_percentages key', () => {
      const rankings = [
        { user_id: 'user1', rank: 1, score: 100 },
        { user_id: 'user2', rank: 2, score: 90 },
        { user_id: 'user3', rank: 3, score: 80 }
      ];

      const nestedStructure = {
        min_entries: 2,
        payout_percentages: {
          "1": 50,
          "2": 30,
          "3": 20
        }
      };

      const result = settlementStrategy.allocatePayouts(rankings, nestedStructure, 10000);

      expect(result.payouts).toHaveLength(3);
      expect(result.payouts[0].amount_cents).toBe(5000); // rank 1: 50%
      expect(result.payouts[1].amount_cents).toBe(3000); // rank 2: 30%
      expect(result.payouts[2].amount_cents).toBe(2000); // rank 3: 20%
    });

    it('should return zero payouts if structure is empty', () => {
      const rankings = [
        { user_id: 'user1', rank: 1, score: 100 }
      ];

      const emptyStructure = {};

      const result = settlementStrategy.allocatePayouts(rankings, emptyStructure, 10000);

      expect(result.payouts).toHaveLength(1);
      expect(result.payouts[0].amount_cents).toBe(0);
    });

    it('should return zero payouts if structure is null', () => {
      const rankings = [
        { user_id: 'user1', rank: 1, score: 100 }
      ];

      const result = settlementStrategy.allocatePayouts(rankings, null, 10000);

      expect(result.payouts).toHaveLength(1);
      expect(result.payouts[0].amount_cents).toBe(0);
    });
  });

  describe('allocatePayouts - Multiple positions and ties', () => {

    it('should allocate correct amounts with 4 participants and 3-position structure', () => {
      const rankings = [
        { user_id: 'user1', rank: 1, score: 100 },
        { user_id: 'user2', rank: 2, score: 90 },
        { user_id: 'user3', rank: 3, score: 80 },
        { user_id: 'user4', rank: 4, score: 70 }
      ];

      const structure = {
        "1": 50,
        "2": 30,
        "3": 20
      };

      const result = settlementStrategy.allocatePayouts(rankings, structure, 40000);

      expect(result.payouts).toHaveLength(4);
      expect(result.payouts[0].amount_cents).toBe(20000); // rank 1: 50% of 40000
      expect(result.payouts[1].amount_cents).toBe(12000); // rank 2: 30% of 40000
      expect(result.payouts[2].amount_cents).toBe(8000);  // rank 3: 20% of 40000
      expect(result.payouts[3].amount_cents).toBe(0);     // rank 4: 0% (no position in structure)
    });

    it('should handle ties (same rank) correctly', () => {
      const rankings = [
        { user_id: 'user1', rank: 1, score: 100 },
        { user_id: 'user2', rank: 1, score: 100 }, // tie with user1
        { user_id: 'user3', rank: 3, score: 80 }
      ];

      const structure = {
        "1": 60,
        "2": 30,
        "3": 10
      };

      const result = settlementStrategy.allocatePayouts(rankings, structure, 10000);

      expect(result.payouts).toHaveLength(3);
      // Rank 1 (2 users) combines positions 1-2: (60 + 30) / 2 per user
      expect(result.payouts[0].amount_cents).toBe(4500); // (60 + 30) / 2 = 45%
      expect(result.payouts[1].amount_cents).toBe(4500); // same as user1
      expect(result.payouts[2].amount_cents).toBe(1000); // rank 3: 10%
    });
  });

  describe('computeSettlement - Happy path', () => {

    it('should complete normally when payouts are non-zero', () => {
      const scores = [
        { user_id: 'user1', total_score: 100 },
        { user_id: 'user2', total_score: 90 }
      ];

      const contestInstance = {
        id: 'contest1',
        entry_fee_cents: 10000,
        payout_structure: {
          "1": 60,
          "2": 40
        }
      };

      // Should not throw
      const result = settlementStrategy.computeSettlement(
        'pga_standard_v1',
        contestInstance,
        scores,
        'snap1',
        'hash1'
      );

      expect(result.payouts).toHaveLength(2);
      expect(result.payouts[0].amount_cents).toBeGreaterThan(0);
      expect(result.payouts[1].amount_cents).toBeGreaterThan(0);
    });

    it('should compute correct settlement with valid payout structure', () => {
      const scores = [
        { user_id: 'user1', total_score: 100 },
        { user_id: 'user2', total_score: 90 },
        { user_id: 'user3', total_score: 80 }
      ];

      const contestInstance = {
        id: 'contest1',
        entry_fee_cents: 10000,
        payout_structure: {
          "1": 50,
          "2": 30,
          "3": 20
        }
      };

      const result = settlementStrategy.computeSettlement(
        'pga_standard_v1',
        contestInstance,
        scores,
        'snap1',
        'hash1'
      );

      expect(result.total_pool_cents).toBe(30000); // 3 × 10000
      const totalPayouts = result.payouts.reduce((sum, p) => sum + p.amount_cents, 0);
      expect(totalPayouts).toBeGreaterThan(0);
    });
  });

  describe('Edge cases', () => {

    it('should handle empty scores array', () => {
      const scores = [];

      const contestInstance = {
        id: 'contest1',
        entry_fee_cents: 10000,
        payout_structure: {
          "1": 100
        }
      };

      const result = settlementStrategy.computeSettlement(
        'pga_standard_v1',
        contestInstance,
        scores,
        'snap1',
        'hash1'
      );

      expect(result.payouts).toHaveLength(0);
      expect(result.total_pool_cents).toBe(0);
    });

    it('should handle single participant', () => {
      const scores = [
        { user_id: 'user1', total_score: 100 }
      ];

      const contestInstance = {
        id: 'contest1',
        entry_fee_cents: 10000,
        payout_structure: {
          "1": 100
        }
      };

      const result = settlementStrategy.computeSettlement(
        'pga_standard_v1',
        contestInstance,
        scores,
        'snap1',
        'hash1'
      );

      expect(result.payouts).toHaveLength(1);
      expect(result.payouts[0].amount_cents).toBe(9000); // 100% of 10000 after 10% rake
    });
  });
});
