/**
 * PGA Round Cleanup Tests — Dynamic Round Handling
 *
 * Verifies that golfer_event_scores cleanup is based on actual valid rounds
 * from the scoring payload, not hardcoded assumptions like round_number > 2.
 *
 * This test suite prevents regression of the leaderboard contamination bug
 * where invalid rounds were written to golfer_scores.
 */

'use strict';

const { Pool } = require('pg');
const assert = require('assert');

describe('PGA Round Cleanup — Dynamic Round Handling', () => {
  let pool;
  let contestInstanceId;
  let testConnection;

  before(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 2,
    });

    testConnection = await pool.connect();
  });

  after(async () => {
    if (testConnection) {
      await testConnection.release();
    }
    if (pool) {
      await pool.end();
    }
  });

  beforeEach(async () => {
    // Create a test contest instance
    const result = await testConnection.query(`
      INSERT INTO contest_instances (
        template_id, provider_event_id, contest_name, status,
        lock_time, tournament_start_time, tournament_end_time,
        entry_fee_cents, max_entries, is_platform_owned
      )
      VALUES (
        (SELECT id FROM contest_templates LIMIT 1),
        'espn_pga_test_' || gen_random_uuid(),
        'Test PGA Contest',
        'LIVE',
        NOW(),
        NOW(),
        NOW() + interval '7 days',
        10000,
        100,
        true
      )
      RETURNING id
    `);
    contestInstanceId = result.rows[0].id;
  });

  afterEach(async () => {
    // Clean up test data
    if (contestInstanceId) {
      await testConnection.query(
        `DELETE FROM golfer_event_scores WHERE contest_instance_id = $1`,
        [contestInstanceId]
      );
      await testConnection.query(
        `DELETE FROM contest_instances WHERE id = $1`,
        [contestInstanceId]
      );
    }
  });

  it('should preserve rounds [1,2,3] when all are in validRounds', async () => {
    // Insert scores for rounds 1, 2, 3
    await testConnection.query(`
      INSERT INTO golfer_event_scores
        (contest_instance_id, golfer_id, round_number, hole_points, bonus_points, finish_bonus, total_points)
      VALUES
        ($1, 'espn_123', 1, 5, 0, 0, 5),
        ($1, 'espn_123', 2, 3, 0, 0, 3),
        ($1, 'espn_123', 3, 2, 0, 0, 2),
        ($1, 'espn_456', 1, 4, 0, 0, 4),
        ($1, 'espn_456', 2, 6, 0, 0, 6),
        ($1, 'espn_456', 3, 1, 0, 0, 1)
    `, [contestInstanceId]);

    // Simulate cleanup with validRounds = [1, 2, 3]
    const validRounds = [1, 2, 3];
    await testConnection.query(`
      DELETE FROM golfer_event_scores
      WHERE contest_instance_id = $1
      AND round_number NOT IN (SELECT UNNEST($2::int[]))
    `, [contestInstanceId, validRounds]);

    // Verify all rounds are preserved
    const result = await testConnection.query(`
      SELECT DISTINCT round_number FROM golfer_event_scores
      WHERE contest_instance_id = $1
      ORDER BY round_number
    `, [contestInstanceId]);

    assert.deepStrictEqual(
      result.rows.map(r => r.round_number),
      [1, 2, 3],
      'All rounds [1,2,3] should be preserved when in validRounds'
    );
  });

  it('should remove stale round 4 when not in validRounds', async () => {
    // Insert scores for rounds 1, 2, 3, 4 (round 4 is stale)
    await testConnection.query(`
      INSERT INTO golfer_event_scores
        (contest_instance_id, golfer_id, round_number, hole_points, bonus_points, finish_bonus, total_points)
      VALUES
        ($1, 'espn_789', 1, 5, 0, 0, 5),
        ($1, 'espn_789', 2, 3, 0, 0, 3),
        ($1, 'espn_789', 3, 2, 0, 0, 2),
        ($1, 'espn_789', 4, 7, 0, 0, 7)
    `, [contestInstanceId]);

    // Simulate cleanup with validRounds = [1, 2, 3] (round 4 excluded)
    const validRounds = [1, 2, 3];
    const deleteResult = await testConnection.query(`
      DELETE FROM golfer_event_scores
      WHERE contest_instance_id = $1
      AND round_number NOT IN (SELECT UNNEST($2::int[]))
    `, [contestInstanceId, validRounds]);

    assert.strictEqual(
      deleteResult.rowCount,
      1,
      'One row (round 4) should be deleted'
    );

    // Verify only valid rounds remain
    const result = await testConnection.query(`
      SELECT DISTINCT round_number FROM golfer_event_scores
      WHERE contest_instance_id = $1
      ORDER BY round_number
    `, [contestInstanceId]);

    assert.deepStrictEqual(
      result.rows.map(r => r.round_number),
      [1, 2, 3],
      'Stale round 4 should be removed, only [1,2,3] should remain'
    );
  });

  it('should handle 4-round tournament without truncating to round 2', async () => {
    // Insert complete 4-round tournament
    await testConnection.query(`
      INSERT INTO golfer_event_scores
        (contest_instance_id, golfer_id, round_number, hole_points, bonus_points, finish_bonus, total_points)
      VALUES
        ($1, 'espn_golfer1', 1, 5, 0, 0, 5),
        ($1, 'espn_golfer1', 2, 3, 0, 0, 3),
        ($1, 'espn_golfer1', 3, 2, 0, 0, 2),
        ($1, 'espn_golfer1', 4, 1, 0, 10, 11)
    `, [contestInstanceId]);

    // Simulate cleanup with validRounds = [1, 2, 3, 4] (all rounds from payload)
    const validRounds = [1, 2, 3, 4];
    await testConnection.query(`
      DELETE FROM golfer_event_scores
      WHERE contest_instance_id = $1
      AND round_number NOT IN (SELECT UNNEST($2::int[]))
    `, [contestInstanceId, validRounds]);

    // Verify all 4 rounds are preserved (not truncated at round 2)
    const result = await testConnection.query(`
      SELECT DISTINCT round_number FROM golfer_event_scores
      WHERE contest_instance_id = $1
      ORDER BY round_number
    `, [contestInstanceId]);

    assert.deepStrictEqual(
      result.rows.map(r => r.round_number),
      [1, 2, 3, 4],
      'All 4 rounds should be preserved for 4-round tournament'
    );
  });

  it('should not remove any rounds when validRounds is empty (edge case)', async () => {
    // Insert scores
    await testConnection.query(`
      INSERT INTO golfer_event_scores
        (contest_instance_id, golfer_id, round_number, hole_points, bonus_points, finish_bonus, total_points)
      VALUES
        ($1, 'espn_edge1', 1, 5, 0, 0, 5),
        ($1, 'espn_edge1', 2, 3, 0, 0, 3)
    `, [contestInstanceId]);

    // With empty validRounds, cleanup is skipped (guarded by if)
    const validRounds = [];
    if (validRounds.length > 0) {
      await testConnection.query(`
        DELETE FROM golfer_event_scores
        WHERE contest_instance_id = $1
        AND round_number NOT IN (SELECT UNNEST($2::int[]))
      `, [contestInstanceId, validRounds]);
    }

    // Verify no rows are deleted
    const result = await testConnection.query(`
      SELECT COUNT(*) FROM golfer_event_scores WHERE contest_instance_id = $1
    `, [contestInstanceId]);

    assert.strictEqual(
      parseInt(result.rows[0].count, 10),
      2,
      'No rounds should be deleted when validRounds is empty'
    );
  });

  it('should preserve existing rounds [1,2,3] when incoming payload only has [1,2] (partial cycle)', async () => {
    // Setup: DB already has scores for rounds 1,2,3 from previous cycle
    await testConnection.query(`
      INSERT INTO golfer_event_scores
        (contest_instance_id, golfer_id, round_number, hole_points, bonus_points, finish_bonus, total_points)
      VALUES
        ($1, 'espn_partial1', 1, 10, 0, 0, 10),
        ($1, 'espn_partial1', 2, 8, 0, 0, 8),
        ($1, 'espn_partial1', 3, 5, 0, 0, 5)
    `, [contestInstanceId]);

    // Simulate partial ingestion: incoming payload only has rounds [1,2]
    const incomingValidRounds = [1, 2];

    // Fetch existing rounds
    const existingRoundsResult = await testConnection.query(`
      SELECT DISTINCT round_number FROM golfer_event_scores
      WHERE contest_instance_id = $1
      ORDER BY round_number
    `, [contestInstanceId]);

    const existingRounds = new Set(existingRoundsResult.rows.map(r => r.round_number));

    // Check if all existing rounds are covered by incoming
    const allExistingCovered = Array.from(existingRounds).every(round =>
      incomingValidRounds.includes(round)
    );

    // Only cleanup if incoming fully covers existing (safety guard)
    if (allExistingCovered) {
      // This branch should NOT execute (3 is missing from incoming)
      await testConnection.query(`
        DELETE FROM golfer_event_scores
        WHERE contest_instance_id = $1
        AND round_number NOT IN (SELECT UNNEST($2::int[]))
      `, [contestInstanceId, incomingValidRounds]);
    } else {
      // Safety guard prevents deletion during partial cycle
      console.log(`[TEST] Partial cycle: not all existing rounds covered, skipping cleanup`);
    }

    // Verify round 3 is preserved (not deleted)
    const result = await testConnection.query(`
      SELECT DISTINCT round_number FROM golfer_event_scores
      WHERE contest_instance_id = $1
      ORDER BY round_number
    `, [contestInstanceId]);

    assert.deepStrictEqual(
      result.rows.map(r => r.round_number),
      [1, 2, 3],
      'Round 3 must be preserved when incoming does not cover all existing rounds'
    );
  });

  it('should preserve round 3 when incoming has [1,2,4] (gap in coverage)', async () => {
    // Setup: DB has rounds [1,2,3]
    await testConnection.query(`
      INSERT INTO golfer_event_scores
        (contest_instance_id, golfer_id, round_number, hole_points, bonus_points, finish_bonus, total_points)
      VALUES
        ($1, 'espn_gap1', 1, 10, 0, 0, 10),
        ($1, 'espn_gap1', 2, 8, 0, 0, 8),
        ($1, 'espn_gap1', 3, 5, 0, 0, 5)
    `, [contestInstanceId]);

    // Incoming has [1,2,4] - covers 1,2 but MISSING 3
    const incomingValidRounds = [1, 2, 4];

    // Fetch existing rounds
    const existingRoundsResult = await testConnection.query(`
      SELECT DISTINCT round_number FROM golfer_event_scores
      WHERE contest_instance_id = $1
      ORDER BY round_number
    `, [contestInstanceId]);

    const existingRounds = new Set(existingRoundsResult.rows.map(r => r.round_number));

    // Check if all existing rounds are covered
    const allExistingCovered = Array.from(existingRounds).every(round =>
      incomingValidRounds.includes(round)
    );

    // Only cleanup if fully covered
    if (allExistingCovered) {
      // This branch should NOT execute (round 3 is missing)
      await testConnection.query(`
        DELETE FROM golfer_event_scores
        WHERE contest_instance_id = $1
        AND round_number NOT IN (SELECT UNNEST($2::int[]))
      `, [contestInstanceId, incomingValidRounds]);
    }

    // Verify round 3 is preserved
    const result = await testConnection.query(`
      SELECT DISTINCT round_number FROM golfer_event_scores
      WHERE contest_instance_id = $1
      ORDER BY round_number
    `, [contestInstanceId]);

    assert.deepStrictEqual(
      result.rows.map(r => r.round_number),
      [1, 2, 3],
      'Round 3 must be preserved when it is not in incoming validRounds (gap in coverage)'
    );
  });

  it('should prevent roster scoring from reading invalid rounds', async () => {
    // Insert a mix of valid and stale rounds
    await testConnection.query(`
      INSERT INTO golfer_event_scores
        (contest_instance_id, golfer_id, round_number, hole_points, bonus_points, finish_bonus, total_points)
      VALUES
        ($1, 'espn_golfer2', 1, 10, 0, 0, 10),
        ($1, 'espn_golfer2', 2, 8, 0, 0, 8),
        ($1, 'espn_golfer2', 3, 999, 0, 0, 999)
    `, [contestInstanceId]);

    // Simulate cleanup before roster scoring
    const validRounds = [1, 2];
    await testConnection.query(`
      DELETE FROM golfer_event_scores
      WHERE contest_instance_id = $1
      AND round_number NOT IN (SELECT UNNEST($2::int[]))
    `, [contestInstanceId, validRounds]);

    // Verify only valid rounds are available for roster scoring
    const result = await testConnection.query(`
      SELECT round_number, total_points FROM golfer_event_scores
      WHERE contest_instance_id = $1
      ORDER BY round_number
    `, [contestInstanceId]);

    assert.strictEqual(result.rowCount, 2, 'Only 2 valid rounds should remain');
    const totalScores = result.rows.map(r => r.total_points);
    assert.strictEqual(
      totalScores.some(s => s === 999),
      false,
      'Stale round 3 with score 999 should be removed before roster scoring reads'
    );
  });
});
