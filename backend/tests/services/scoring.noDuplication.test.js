/**
 * Scoring Service Test — No Duplication / Cross-User Aggregation
 *
 * Verifies that when multiple users share the same golfer in their rosters,
 * each user receives only their own golfer scores, not aggregated scores from
 * other users.
 */

const { Pool } = require('pg');
const pgaStandardV1 = require('../../services/strategies/pgaStandardV1');

describe('PGA Scoring — No Cross-User Duplication', () => {
  let pool;

  beforeAll(() => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL_TEST
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  test('same golfer across users → each user gets exact same score, no duplication', async () => {
    // Scenario:
    // - Contest: PGA event with 2 users
    // - User A: roster [PGA_1, PGA_2, PGA_3, PGA_4, PGA_5, PGA_6, PGA_7]
    // - User B: roster [PGA_1, PGA_2, PGA_3, PGA_4, PGA_5, PGA_6, PGA_7] (SAME golfers)
    // - Golfer PGA_1: scores 10 points for User A, 10 points for User B
    //
    // Expected:
    // - User A sees PGA_1 = 10 points (User A's own score)
    // - User B sees PGA_1 = 10 points (User B's own score)
    // NOT: Both see combined 20 points

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Create a test contest template
      const templateResult = await client.query(
        `INSERT INTO contest_templates (
           name,
           sport,
           template_type,
           scoring_strategy_key,
           lock_strategy_key,
           settlement_strategy_key,
           default_entry_fee_cents,
           allowed_entry_fee_min_cents,
           allowed_entry_fee_max_cents,
           allowed_payout_structures
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          'Test PGA',
          'golf',
          'PGA',
          'pga_standard_v1',
          'lock_at_field_lock',
          'standard_settlement',
          0,
          0,
          100000,
          '[]'
        ]
      );
      const templateId = templateResult.rows[0].id;

      // Create users first (organizer + participants)
      const organizer = '11111111-1111-1111-1111-111111111111';
      const userA = '22222222-2222-2222-2222-222222222222';
      const userB = '33333333-3333-3333-3333-333333333333';

      await client.query(
        `INSERT INTO users (id, username, email)
         VALUES ($1, $2, $3),
                ($4, $5, $6),
                ($7, $8, $9)
         ON CONFLICT (id) DO NOTHING`,
        [
          organizer, 'organizer', 'organizer@test.com',
          userA, 'userA', 'userA@test.com',
          userB, 'userB', 'userB@test.com'
        ]
      );

      // Create contest instance
      const contestResult = await client.query(
        `INSERT INTO contest_instances (
           template_id,
           organizer_id,
           entry_fee_cents,
           payout_structure,
           status,
           contest_name,
           lock_time,
           tournament_start_time,
           tournament_end_time
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          templateId,
          organizer,
          0,
          '{}',
          'LIVE',
          'Shared Golfer Test',
          new Date(),
          new Date(),
          new Date(Date.now() + 86400000)
        ]
      );
      const contestId = contestResult.rows[0].id;

      // Create participants
      await client.query(
        `INSERT INTO contest_participants (contest_instance_id, user_id)
         VALUES ($1, $2),
                ($1, $3)
         ON CONFLICT (contest_instance_id, user_id) DO NOTHING`,
        [contestId, userA, userB]
      );

      // Create identical rosters (both users have same 7 golfers)
      const golfers = ['PGA_1', 'PGA_2', 'PGA_3', 'PGA_4', 'PGA_5', 'PGA_6', 'PGA_7'];
      await client.query(
        `INSERT INTO entry_rosters (contest_instance_id, user_id, player_ids)
         VALUES ($1, $2, $3),
                ($1, $4, $3)
         ON CONFLICT (contest_instance_id, user_id) DO NOTHING`,
        [contestId, userA, golfers, userB]
      );

      // Assign scores: Each user gets their own scores
      // User A: PGA_1 = 10, PGA_2 = 8, PGA_3 = 6, PGA_4 = 4, PGA_5 = 2, PGA_6 = 0, PGA_7 = -2
      // User B: PGA_1 = 10, PGA_2 = 8, PGA_3 = 6, PGA_4 = 4, PGA_5 = 2, PGA_6 = 0, PGA_7 = -2
      // (identical scores to test that each user only counts their own)

      const userAScores = [
        ['PGA_1', 10],
        ['PGA_2', 8],
        ['PGA_3', 6],
        ['PGA_4', 4],
        ['PGA_5', 2],
        ['PGA_6', 0],
        ['PGA_7', -2]
      ];

      const userBScores = [
        ['PGA_1', 10],
        ['PGA_2', 8],
        ['PGA_3', 6],
        ['PGA_4', 4],
        ['PGA_5', 2],
        ['PGA_6', 0],
        ['PGA_7', -2]
      ];

      // Insert User A's scores
      for (const [golferId, points] of userAScores) {
        await client.query(
          `INSERT INTO golfer_scores (
             contest_instance_id,
             user_id,
             golfer_id,
             round_number,
             hole_points,
             bonus_points,
             finish_bonus,
             total_points,
             created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
          [
            contestId,
            userA,
            golferId,
            1,
            points,
            0,
            0,
            points
          ]
        );
      }

      // Insert User B's scores (SAME values as User A)
      for (const [golferId, points] of userBScores) {
        await client.query(
          `INSERT INTO golfer_scores (
             contest_instance_id,
             user_id,
             golfer_id,
             round_number,
             hole_points,
             bonus_points,
             finish_bonus,
             total_points,
             created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
          [
            contestId,
            userB,
            golferId,
            1,
            points,
            0,
            0,
            points
          ]
        );
      }

      await client.query('COMMIT');

      // Now fetch standings using the PGA strategy
      const standings = await pgaStandardV1.liveStandings(pool, contestId);

      // Verify results
      expect(standings).toHaveLength(2);

      const userAStanding = standings.find(s => s.user_id === userA);
      const userBStanding = standings.find(s => s.user_id === userB);

      expect(userAStanding).toBeDefined();
      expect(userBStanding).toBeDefined();

      // Both users have 7 golfers, best 6 of 7 = 10+8+6+4+2+0 = 30 points
      const expectedScore = 30;

      console.log(`User A standing:`, userAStanding);
      console.log(`User B standing:`, userBStanding);

      expect(userAStanding.total_score).toEqual(expectedScore);
      expect(userBStanding.total_score).toEqual(expectedScore);

      // CRITICAL CHECK: Both users have identical scores
      // If the bug exists (missing user_id in aggregation), one user would see 60 points
      expect(userAStanding.total_score).not.toEqual(60);
      expect(userBStanding.total_score).not.toEqual(60);

      console.log(`✅ Test passed: Both users see exact same score (no cross-user duplication)`);
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });

  test('multiple contests with same golfer → scores isolated per contest', async () => {
    // Verify that golfer scores are scoped to contest_instance_id
    // (should already work, but good to confirm during refactor)

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Create template
      const templateResult = await client.query(
        `INSERT INTO contest_templates (
           name,
           sport,
           template_type,
           scoring_strategy_key,
           lock_strategy_key,
           settlement_strategy_key,
           default_entry_fee_cents,
           allowed_entry_fee_min_cents,
           allowed_entry_fee_max_cents,
           allowed_payout_structures
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          'Multi Contest',
          'golf',
          'PGA',
          'pga_standard_v1',
          'lock_at_field_lock',
          'standard_settlement',
          0,
          0,
          100000,
          '[]'
        ]
      );
      const templateId = templateResult.rows[0].id;

      const organizer2 = '44444444-4444-4444-4444-444444444444';
      const userId = '55555555-5555-5555-5555-555555555555';
      const golfers = ['PGA_A', 'PGA_B', 'PGA_C', 'PGA_D', 'PGA_E', 'PGA_F', 'PGA_G'];

      // Setup users first
      await client.query(
        `INSERT INTO users (id, username, email)
         VALUES ($1, $2, $3),
                ($4, $5, $6)
         ON CONFLICT (id) DO NOTHING`,
        [
          organizer2, 'organizer2', 'organizer2@test.com',
          userId, 'testUser', 'test@test.com'
        ]
      );

      // Create 2 contests
      const contest1Result = await client.query(
        `INSERT INTO contest_instances (
           template_id, organizer_id, entry_fee_cents, payout_structure, status,
           contest_name, lock_time, tournament_start_time, tournament_end_time
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          templateId,
          organizer2,
          0,
          '{}',
          'LIVE',
          'Contest 1',
          new Date(),
          new Date(),
          new Date(Date.now() + 86400000)
        ]
      );
      const contestId1 = contest1Result.rows[0].id;

      const contest2Result = await client.query(
        `INSERT INTO contest_instances (
           template_id, organizer_id, entry_fee_cents, payout_structure, status,
           contest_name, lock_time, tournament_start_time, tournament_end_time
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          templateId,
          organizer2,
          0,
          '{}',
          'LIVE',
          'Contest 2',
          new Date(),
          new Date(),
          new Date(Date.now() + 86400000)
        ]
      );
      const contestId2 = contest2Result.rows[0].id;

      // Contest 1: user has scores
      await client.query(
        `INSERT INTO contest_participants (contest_instance_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (contest_instance_id, user_id) DO NOTHING`,
        [contestId1, userId]
      );

      await client.query(
        `INSERT INTO entry_rosters (contest_instance_id, user_id, player_ids)
         VALUES ($1, $2, $3)
         ON CONFLICT (contest_instance_id, user_id) DO NOTHING`,
        [contestId1, userId, golfers]
      );

      // Contest 1: assign high scores
      for (let i = 0; i < golfers.length; i++) {
        await client.query(
          `INSERT INTO golfer_scores (
             contest_instance_id, user_id, golfer_id, round_number,
             hole_points, bonus_points, finish_bonus, total_points, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
          [contestId1, userId, golfers[i], 1, 20, 0, 0, 20]
        );
      }

      // Contest 2: user has scores
      await client.query(
        `INSERT INTO contest_participants (contest_instance_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (contest_instance_id, user_id) DO NOTHING`,
        [contestId2, userId]
      );

      await client.query(
        `INSERT INTO entry_rosters (contest_instance_id, user_id, player_ids)
         VALUES ($1, $2, $3)
         ON CONFLICT (contest_instance_id, user_id) DO NOTHING`,
        [contestId2, userId, golfers]
      );

      // Contest 2: assign low scores
      for (let i = 0; i < golfers.length; i++) {
        await client.query(
          `INSERT INTO golfer_scores (
             contest_instance_id, user_id, golfer_id, round_number,
             hole_points, bonus_points, finish_bonus, total_points, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
          [contestId2, userId, golfers[i], 1, 2, 0, 0, 2]
        );
      }

      await client.query('COMMIT');

      // Fetch standings for both contests
      const standings1 = await pgaStandardV1.liveStandings(pool, contestId1);
      const standings2 = await pgaStandardV1.liveStandings(pool, contestId2);

      const user1 = standings1.find(s => s.user_id === userId);
      const user2 = standings2.find(s => s.user_id === userId);

      // Contest 1: best 6 of 7 golfers @ 20 points each = 120 points
      expect(user1.total_score).toEqual(120);

      // Contest 2: best 6 of 7 golfers @ 2 points each = 12 points
      expect(user2.total_score).toEqual(12);

      // Confirm isolation (scores don't mix across contests)
      expect(user1.total_score).not.toEqual(user2.total_score);

      console.log(`✅ Test passed: Contest isolation confirmed (scores don't mix)`);
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });
});
