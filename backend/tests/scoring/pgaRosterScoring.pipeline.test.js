/**
 * PGA Roster Scoring Pipeline Test
 *
 * Tests the full scoring pipeline:
 * 1. golfer_event_scores populated with ESPN data
 * 2. entry_rosters populated with user selections
 * 3. scoreContestRosters() populates golfer_scores
 * 4. Leaderboard queries can read golfer_scores
 */

'use strict';

const { Pool } = require('pg');

// Use test database
const pool = new Pool({
  host: process.env.TEST_DB_HOST || 'localhost',
  port: process.env.TEST_DB_PORT || 5432,
  database: process.env.TEST_DB_NAME || 'playoff_challenge_test',
  user: process.env.TEST_DB_USER || 'postgres',
  password: process.env.TEST_DB_PASSWORD || 'postgres'
});

describe('PGA Roster Scoring Pipeline', () => {
  let client;
  let contestInstanceId;
  let userId;
  let golfer1;
  let golfer2;
  let golfer3;

  beforeAll(async () => {
    client = await pool.connect();
  });

  afterAll(async () => {
    if (client) {
      await client.release();
    }
    await pool.end();
  });

  beforeEach(async () => {
    // Start transaction for test isolation
    await client.query('BEGIN');

    // Create test contest
    const contestResult = await client.query(`
      INSERT INTO contest_instances (
        id, template_id, organizer_id, status, entry_fee_cents, max_entries,
        lock_time, tournament_start_time, tournament_end_time
      ) VALUES (
        gen_random_uuid(),
        (SELECT id FROM contest_templates LIMIT 1),
        gen_random_uuid(),
        'LIVE',
        1000,
        100,
        NOW() - interval '1 hour',
        NOW() - interval '1 hour',
        NOW() + interval '24 hours'
      ) RETURNING id
    `);
    contestInstanceId = contestResult.rows[0].id;

    // Create test user
    const userResult = await client.query(`
      INSERT INTO users (id, email, username) VALUES (
        gen_random_uuid(),
        $1,
        $2
      ) RETURNING id
    `, [`test${Date.now()}@example.com`, `testuser${Date.now()}`]);
    userId = userResult.rows[0].id;

    // Create test golfers with generated UUIDs
    const golfer1Result = await client.query(`
      INSERT INTO players (id, espn_id, full_name, sport, position, is_active, available)
      VALUES (
        gen_random_uuid(),
        'espn_1001',
        'Golfer One',
        'GOLF',
        'G',
        true,
        true
      ) RETURNING id
    `);
    golfer1 = golfer1Result.rows[0].id;

    const golfer2Result = await client.query(`
      INSERT INTO players (id, espn_id, full_name, sport, position, is_active, available)
      VALUES (
        gen_random_uuid(),
        'espn_1002',
        'Golfer Two',
        'GOLF',
        'G',
        true,
        true
      ) RETURNING id
    `);
    golfer2 = golfer2Result.rows[0].id;

    const golfer3Result = await client.query(`
      INSERT INTO players (id, espn_id, full_name, sport, position, is_active, available)
      VALUES (
        gen_random_uuid(),
        'espn_1003',
        'Golfer Three',
        'GOLF',
        'G',
        true,
        true
      ) RETURNING id
    `);
    golfer3 = golfer3Result.rows[0].id;

    // Create entry roster with 3 golfers
    await client.query(`
      INSERT INTO entry_rosters (
        id,
        contest_instance_id,
        user_id,
        player_ids,
        submitted_at
      ) VALUES (
        gen_random_uuid(),
        $1,
        $2,
        $3,
        NOW()
      )
    `, [contestInstanceId, userId, [golfer1, golfer2, golfer3]]);

    // Create golfer event scores (ESPN ingestion output)
    await client.query(`
      INSERT INTO golfer_event_scores (
        id,
        contest_instance_id,
        golfer_id,
        round_number,
        hole_points,
        bonus_points,
        finish_bonus,
        total_points,
        created_at
      ) VALUES
        (gen_random_uuid(), $1, $2, 1, 50, 10, 5, 65, NOW()),
        (gen_random_uuid(), $1, $3, 1, 45, 5, 0, 50, NOW()),
        (gen_random_uuid(), $1, $4, 1, 40, 0, 10, 50, NOW())
    `, [contestInstanceId, golfer1, golfer2, golfer3]);
  });

  afterEach(async () => {
    // Rollback transaction
    await client.query('ROLLBACK');
  });

  test('scoreContestRosters creates golfer_scores rows for rostered golfers', async () => {
    const scoreContestRosters = require('../../services/scoring/pgaRosterScoringService').scoreContestRosters;

    // Before scoring: golfer_scores should be empty
    const beforeCount = await client.query(
      'SELECT COUNT(*) as count FROM golfer_scores WHERE contest_instance_id = $1',
      [contestInstanceId]
    );
    expect(parseInt(beforeCount.rows[0].count, 10)).toBe(0);

    // Call the scoring service
    await scoreContestRosters(contestInstanceId, client);

    // After scoring: golfer_scores should have 3 rows (1 user × 3 golfers)
    const afterResult = await client.query(
      `SELECT user_id, golfer_id, round_number, total_points
       FROM golfer_scores
       WHERE contest_instance_id = $1
       ORDER BY golfer_id`,
      [contestInstanceId]
    );

    expect(afterResult.rows.length).toBe(3);
    expect(afterResult.rows[0].user_id).toBe(userId);
    expect(afterResult.rows[0].golfer_id).toBe(golfer1);
    expect(afterResult.rows[0].round_number).toBe(1);
    expect(afterResult.rows[0].total_points).toBe(65);
  });

  test('scoreContestRosters is idempotent - re-running does not create duplicates', async () => {
    const scoreContestRosters = require('../../services/scoring/pgaRosterScoringService').scoreContestRosters;

    // First run
    await scoreContestRosters(contestInstanceId, client);

    const afterFirst = await client.query(
      'SELECT COUNT(*) as count FROM golfer_scores WHERE contest_instance_id = $1',
      [contestInstanceId]
    );
    expect(parseInt(afterFirst.rows[0].count, 10)).toBe(3);

    // Second run
    await scoreContestRosters(contestInstanceId, client);

    // Should still be 3 rows (idempotent)
    const afterSecond = await client.query(
      'SELECT COUNT(*) as count FROM golfer_scores WHERE contest_instance_id = $1',
      [contestInstanceId]
    );
    expect(parseInt(afterSecond.rows[0].count, 10)).toBe(3);
  });

  test('scoreContestRosters updates scores on re-run with changed data', async () => {
    const scoreContestRosters = require('../../services/scoring/pgaRosterScoringService').scoreContestRosters;

    // First run
    await scoreContestRosters(contestInstanceId, client);

    const firstResult = await client.query(
      `SELECT total_points FROM golfer_scores
       WHERE contest_instance_id = $1 AND golfer_id = $2 AND round_number = 1`,
      [contestInstanceId, golfer1]
    );
    expect(firstResult.rows[0].total_points).toBe(65);

    // Update ESPN scores
    await client.query(
      `UPDATE golfer_event_scores
       SET total_points = 80
       WHERE contest_instance_id = $1 AND golfer_id = $2`,
      [contestInstanceId, golfer1]
    );

    // Second run
    await scoreContestRosters(contestInstanceId, client);

    // Score should be updated
    const secondResult = await client.query(
      `SELECT total_points FROM golfer_scores
       WHERE contest_instance_id = $1 AND golfer_id = $2 AND round_number = 1`,
      [contestInstanceId, golfer1]
    );
    expect(secondResult.rows[0].total_points).toBe(80);
  });

  test('scoreContestRosters handles missing golfer_event_scores gracefully', async () => {
    const scoreContestRosters = require('../../services/scoring/pgaRosterScoringService').scoreContestRosters;

    // Delete one golfer's scores
    await client.query(
      `DELETE FROM golfer_event_scores WHERE golfer_id = $1`,
      [golfer1]
    );

    // Run scoring - should not throw
    await scoreContestRosters(contestInstanceId, client);

    // Only 2 golfers should have scores (golfer1 is missing)
    const result = await client.query(
      `SELECT COUNT(*) as count FROM golfer_scores WHERE contest_instance_id = $1`,
      [contestInstanceId]
    );
    expect(parseInt(result.rows[0].count, 10)).toBe(2);
  });

  test('scoreContestRosters handles empty entry_rosters', async () => {
    const scoreContestRosters = require('../../services/scoring/pgaRosterScoringService').scoreContestRosters;

    // Create a new contest with no entry_rosters
    const emptyContestResult = await client.query(`
      INSERT INTO contest_instances (
        id, template_id, organizer_id, status, entry_fee_cents,
        lock_time, tournament_start_time, tournament_end_time
      ) VALUES (
        gen_random_uuid(),
        (SELECT id FROM contest_templates LIMIT 1),
        gen_random_uuid(),
        'LIVE',
        1000,
        NOW() - interval '1 hour',
        NOW() - interval '1 hour',
        NOW() + interval '24 hours'
      ) RETURNING id
    `);
    const emptyContestId = emptyContestResult.rows[0].id;

    // Run scoring - should not throw
    await scoreContestRosters(emptyContestId, client);

    // No rows should be created
    const result = await client.query(
      `SELECT COUNT(*) as count FROM golfer_scores WHERE contest_instance_id = $1`,
      [emptyContestId]
    );
    expect(parseInt(result.rows[0].count, 10)).toBe(0);
  });
});
