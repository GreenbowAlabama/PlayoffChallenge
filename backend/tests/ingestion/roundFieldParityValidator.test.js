/**
 * Round Field Parity Validator Tests
 *
 * DETERMINISTIC BASELINE APPROACH:
 * Baseline comes ONLY from field_selections.selection_json.primary
 * All rounds must match this baseline exactly or be rejected.
 *
 * Test cases enforce:
 * 1. No field_selections → everything blocked
 * 2. Empty field_selections → everything blocked
 * 3. Full round matching baseline → accepted
 * 4. Partial round → rejected
 * 5. Multiple rounds, some match, some don't → only valid ones accepted
 * 6. Idempotency: re-running validator produces same result
 * 7. Baseline never changes during ingestion
 */

'use strict';

const { validateRoundParity } = require('../../services/ingestion/validators/roundFieldParityValidator');
const assert = require('assert');

// Mock database client
class MockDbClient {
  constructor(fieldSize = null) {
    this.fieldSize = fieldSize; // null = no field_selections, or a number = field size
  }

  async query(sql, params) {
    // Query for field_selections
    if (sql.includes('jsonb_array_length') && sql.includes('field_selections')) {
      if (this.fieldSize === null) {
        // field_selections doesn't exist
        return { rows: [] };
      }
      // field_selections exists with specified size
      return { rows: [{ golfer_count: this.fieldSize }] };
    }

    return { rows: [] };
  }
}

// Helper to create score objects
function createScores(roundNumber, golferCount, contestId = 'contest-123') {
  const scores = [];
  for (let i = 1; i <= golferCount; i++) {
    scores.push({
      contest_instance_id: contestId,
      golfer_id: `espn_${1000 + i}`,
      round_number: roundNumber,
      hole_points: 0,
      bonus_points: 0,
      finish_bonus: 0,
      total_points: 0
    });
  }
  return scores;
}

describe('Round Field Parity Validator (Deterministic Baseline)', () => {

  describe('Scenario 1: No field_selections → everything blocked', () => {
    it('should reject all rounds when field_selections not found', async () => {
      const mockDb = new MockDbClient(null); // No field_selections

      const round1 = createScores(1, 135);
      const round2 = createScores(2, 135);
      const incoming = [...round1, ...round2];

      const result = await validateRoundParity(incoming, 'contest-123', mockDb);

      assert.strictEqual(result.validScores.length, 0, 'No scores should be accepted');
      assert.strictEqual(result.rejectedRounds.length, 2, 'Both rounds should be rejected');
      assert.strictEqual(result.baselineGolferCount, null, 'Baseline should be null');
      assert(result.rejectedRounds[0].reason.includes('field_selections not ready'));
    });
  });

  describe('Scenario 2: Empty field_selections → everything blocked', () => {
    it('should reject all rounds when field_selections is empty (0 golfers)', async () => {
      const mockDb = new MockDbClient(0); // Empty field

      const round1 = createScores(1, 135);
      const incoming = round1;

      const result = await validateRoundParity(incoming, 'contest-123', mockDb);

      assert.strictEqual(result.validScores.length, 0, 'No scores should be accepted');
      assert.strictEqual(result.rejectedRounds.length, 1, 'Round should be rejected');
      assert.strictEqual(result.baselineGolferCount, 0);
      assert(result.rejectedRounds[0].reason.includes('empty'));
    });
  });

  describe('Scenario 3: Full round matching baseline → accepted', () => {
    it('should accept round when golfer count matches baseline', async () => {
      const mockDb = new MockDbClient(135); // Baseline = 135

      const round1 = createScores(1, 135);
      const incoming = round1;

      const result = await validateRoundParity(incoming, 'contest-123', mockDb);

      assert.strictEqual(result.validScores.length, 135, 'All round 1 scores should be accepted');
      assert.strictEqual(result.rejectedRounds.length, 0, 'No rejections');
      assert.strictEqual(result.baselineGolferCount, 135);
    });
  });

  describe('Scenario 4: Partial round → rejected', () => {
    it('should reject round with 12 golfers when baseline is 135', async () => {
      const mockDb = new MockDbClient(135); // Baseline = 135

      const round1 = createScores(1, 12); // Only 12 golfers
      const incoming = round1;

      const result = await validateRoundParity(incoming, 'contest-123', mockDb);

      assert.strictEqual(result.validScores.length, 0, 'Round 1 should be rejected');
      assert.strictEqual(result.rejectedRounds.length, 1, 'Should have 1 rejection');
      assert.strictEqual(result.rejectedRounds[0].incoming_golfer_count, 12);
      assert.strictEqual(result.rejectedRounds[0].baseline_golfer_count, 135);
    });
  });

  describe('Scenario 5: Multiple rounds, some match, some don\'t', () => {
    it('should accept only rounds matching baseline and reject others', async () => {
      const mockDb = new MockDbClient(135); // Baseline = 135

      const round1 = createScores(1, 135); // Matches
      const round2 = createScores(2, 12);  // Doesn't match
      const round3 = createScores(3, 135); // Matches
      const incoming = [...round1, ...round2, ...round3];

      const result = await validateRoundParity(incoming, 'contest-123', mockDb);

      assert.strictEqual(result.validScores.length, 270, 'Rounds 1 and 3 accepted (135 each)');
      assert.strictEqual(result.rejectedRounds.length, 1, 'Round 2 rejected');
      assert.strictEqual(result.rejectedRounds[0].round_number, 2);
      assert.strictEqual(result.rejectedRounds[0].incoming_golfer_count, 12);
    });
  });

  describe('Scenario 6: Idempotency - re-running validator produces same result', () => {
    it('should produce identical results when run twice with same input', async () => {
      const mockDb = new MockDbClient(135);

      const round1 = createScores(1, 135);
      const round2 = createScores(2, 12);
      const incoming = [...round1, ...round2];

      // First run
      const result1 = await validateRoundParity(incoming, 'contest-123', mockDb);

      // Second run with same input
      const result2 = await validateRoundParity(incoming, 'contest-123', mockDb);

      assert.strictEqual(result1.validScores.length, result2.validScores.length);
      assert.strictEqual(result1.rejectedRounds.length, result2.rejectedRounds.length);
      assert.deepStrictEqual(result1.rejectedRounds, result2.rejectedRounds);
    });
  });

  describe('Scenario 7: Baseline never changes during ingestion', () => {
    it('should use same baseline for both rounds even if they arrive in different calls', async () => {
      const mockDb = new MockDbClient(135);

      const round1 = createScores(1, 135);
      const round2 = createScores(2, 135);

      // First call with round 1
      const result1 = await validateRoundParity(round1, 'contest-123', mockDb);
      assert.strictEqual(result1.baselineGolferCount, 135);

      // Second call with round 2
      const result2 = await validateRoundParity(round2, 'contest-123', mockDb);
      assert.strictEqual(result2.baselineGolferCount, 135);

      // Both rounds should be accepted with same baseline
      assert.strictEqual(result1.validScores.length, 135);
      assert.strictEqual(result2.validScores.length, 135);
    });
  });

  describe('Scenario 8: Empty incoming scores → return empty', () => {
    it('should handle empty normalizedScores gracefully', async () => {
      const mockDb = new MockDbClient(135);

      const result = await validateRoundParity([], 'contest-123', mockDb);

      assert.strictEqual(result.validScores.length, 0);
      assert.strictEqual(result.rejectedRounds.length, 0);
      assert.strictEqual(result.baselineGolferCount, 135);
    });
  });

  describe('Scenario 9: Null/undefined incoming scores → return empty', () => {
    it('should handle null/undefined normalizedScores gracefully', async () => {
      const mockDb = new MockDbClient(135);

      const result = await validateRoundParity(null, 'contest-123', mockDb);

      assert.strictEqual(result.validScores.length, 0);
      assert.strictEqual(result.rejectedRounds.length, 0);
    });
  });

  describe('Scenario 10: Gap in rounds (1,2,4 missing 3)', () => {
    it('should accept all rounds that match baseline regardless of gaps', async () => {
      const mockDb = new MockDbClient(135);

      const round1 = createScores(1, 135);
      const round2 = createScores(2, 135);
      const round4 = createScores(4, 135);
      // Round 3 is missing, but rounds 1,2,4 all match baseline
      const incoming = [...round1, ...round2, ...round4];

      const result = await validateRoundParity(incoming, 'contest-123', mockDb);

      assert.strictEqual(result.validScores.length, 405, 'All 3 rounds accepted (135 each)');
      assert.strictEqual(result.rejectedRounds.length, 0, 'No rejections');
    });
  });

  describe('Scenario 11: Partial first round cannot establish baseline', () => {
    it('should reject partial round 1 even though it arrives first', async () => {
      const mockDb = new MockDbClient(135);

      const round1Partial = createScores(1, 50); // Partial (< baseline)
      const round2Full = createScores(2, 135);   // Full
      const incoming = [...round1Partial, ...round2Full];

      const result = await validateRoundParity(incoming, 'contest-123', mockDb);

      assert.strictEqual(result.validScores.length, 135, 'Only round 2 accepted');
      assert.strictEqual(result.rejectedRounds.length, 1, 'Round 1 rejected');
      assert.strictEqual(result.rejectedRounds[0].round_number, 1);
    });
  });

  describe('Scenario 12: Baseline from field_selections is immutable source', () => {
    it('should always enforce baseline from field_selections, never from incoming data', async () => {
      const mockDb = new MockDbClient(135);

      // Even if first incoming round had 50 golfers, baseline should still be 135
      const round1 = createScores(1, 50);
      const incoming = round1;

      const result = await validateRoundParity(incoming, 'contest-123', mockDb);

      // Round 1 should be rejected because it doesn't match baseline (135)
      assert.strictEqual(result.validScores.length, 0);
      assert.strictEqual(result.rejectedRounds[0].baseline_golfer_count, 135);
      assert.strictEqual(result.baselineGolferCount, 135, 'Baseline is always from field_selections');
    });
  });

});
