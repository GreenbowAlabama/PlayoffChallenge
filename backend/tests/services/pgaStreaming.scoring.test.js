/**
 * PGA Streaming Score Ingestion Tests
 *
 * Proves the streaming scoring model works end-to-end:
 * - Partial round input is accepted and written
 * - Staggered incremental updates across multiple ingests
 * - Same golfer/round scores overwrite deterministically
 * - Mixed rounds in one payload
 * - Cut/withdrawn or absent golfers don't block scoring
 * - Empty normalizedScores no-ops safely
 */

'use strict';

const { Pool } = require('pg');
const pgaEspnIngestion = require('../../services/ingestion/strategies/pgaEspnIngestion');

describe('PGA Streaming Scoring Model', () => {
  let pool;
  let testConnection;
  let contestInstanceId;
  let organizerId;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 2,
    });
    testConnection = await pool.connect();
  });

  afterAll(async () => {
    if (testConnection) {
      await testConnection.release();
    }
    if (pool) {
      await pool.end();
    }
  });

  beforeEach(async () => {
    // Create a test organizer user
    organizerId = require('uuid').v4();
    await testConnection.query(
      'INSERT INTO users (id, email, created_at) VALUES ($1, $2, NOW())',
      [organizerId, `organizer-${organizerId}@test.com`]
    );

    // Create a minimal test contest instance using actual repo pattern
    const result = await testConnection.query(`
      INSERT INTO contest_instances (
        template_id, provider_event_id, contest_name, status, organizer_id,
        lock_time, tournament_start_time, tournament_end_time,
        entry_fee_cents, max_entries, is_platform_owned,  payout_structure
      )
      VALUES (
        (SELECT id FROM contest_templates LIMIT 1),
        'espn_pga_test_' || gen_random_uuid(),
        'Test PGA Streaming Contest',
        'LIVE',
        $1,
        NOW(),
        NOW(),
        NOW() + interval '7 days',
        10000,
        100,
        true,
        '{"type":"winner_takes_all"}'::jsonb
      )
      RETURNING id
    `, [organizerId]);
    contestInstanceId = result.rows[0].id;

    // Create tournament_config for this contest
    const configResult = await testConnection.query(`
      INSERT INTO tournament_configs (
        id, contest_instance_id, provider_event_id, ingestion_endpoint,
        event_start_date, event_end_date, round_count, leaderboard_schema_version,
        field_source, is_active, created_at, published_at, hash
      )
      VALUES (
        gen_random_uuid(), $1, 'espn_pga_test_' || gen_random_uuid(), 'https://example.com',
        NOW(), NOW() + interval '7 days', 4, 1,
        'provider_sync', true, NOW(), NOW(), 'test_hash'
      )
      RETURNING id
    `, [contestInstanceId]);

    const configId = configResult.rows[0].id;

    // Create field_selections with 5 golfers
    await testConnection.query(`
      INSERT INTO field_selections (
        id,
        contest_instance_id,
        tournament_config_id,
        selection_json
      ) VALUES (
        gen_random_uuid(),
        $1,
        $2,
        jsonb_build_object(
          'primary', jsonb_build_array(
            jsonb_build_object('player_id', 'espn_1', 'name', 'Golfer 1'),
            jsonb_build_object('player_id', 'espn_2', 'name', 'Golfer 2'),
            jsonb_build_object('player_id', 'espn_3', 'name', 'Golfer 3'),
            jsonb_build_object('player_id', 'espn_4', 'name', 'Golfer 4'),
            jsonb_build_object('player_id', 'espn_5', 'name', 'Golfer 5')
          )
        )
      )
    `, [contestInstanceId, configId]);
  });

  afterEach(async () => {
    // Clean up test data in proper order
    if (contestInstanceId) {
      await testConnection.query(
        'DELETE FROM golfer_event_scores WHERE contest_instance_id = $1',
        [contestInstanceId]
      );
      await testConnection.query(
        'DELETE FROM field_selections WHERE contest_instance_id = $1',
        [contestInstanceId]
      );
      await testConnection.query(
        'DELETE FROM tournament_configs WHERE contest_instance_id = $1',
        [contestInstanceId]
      );
      await testConnection.query(
        'DELETE FROM contest_instances WHERE id = $1',
        [contestInstanceId]
      );
    }
    if (organizerId) {
      await testConnection.query(
        'DELETE FROM users WHERE id = $1',
        [organizerId]
      );
    }
  });

  describe('Unit: Partial round acceptance', () => {
    test('accepts partial round with 3 of 5 golfers', async () => {
      const partialRound = [
        {
          contest_instance_id: contestInstanceId,
          golfer_id: 'espn_1',
          round_number: 1,
          hole_points: 10,
          bonus_points: 0,
          finish_bonus: 0,
          total_points: 10
        },
        {
          contest_instance_id: contestInstanceId,
          golfer_id: 'espn_2',
          round_number: 1,
          hole_points: 12,
          bonus_points: 0,
          finish_bonus: 0,
          total_points: 12
        },
        {
          contest_instance_id: contestInstanceId,
          golfer_id: 'espn_3',
          round_number: 1,
          hole_points: 11,
          bonus_points: 0,
          finish_bonus: 0,
          total_points: 11
        }
      ];

      const ctx = { contestInstanceId, dbClient: testConnection };
      await pgaEspnIngestion.upsertScores(ctx, partialRound);

      const result = await testConnection.query(
        'SELECT COUNT(*) as cnt FROM golfer_event_scores WHERE contest_instance_id = $1',
        [contestInstanceId]
      );

      expect(parseInt(result.rows[0].cnt, 10)).toBe(3);
    });

    test('accepts single golfer single round', async () => {
      const singleGolfer = [
        {
          contest_instance_id: contestInstanceId,
          golfer_id: 'espn_1',
          round_number: 1,
          hole_points: 10,
          bonus_points: 0,
          finish_bonus: 0,
          total_points: 10
        }
      ];

      const ctx = { contestInstanceId, dbClient: testConnection };
      await pgaEspnIngestion.upsertScores(ctx, singleGolfer);

      const result = await testConnection.query(
        'SELECT total_points FROM golfer_event_scores WHERE contest_instance_id = $1 AND golfer_id = $2',
        [contestInstanceId, 'espn_1']
      );

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].total_points).toBe(10);
    });
  });

  describe('Unit: Deterministic overwrites', () => {
    test('same golfer/round score overwrites on second ingest', async () => {
      // First score for espn_1 round 1
      const firstScore = [
        {
          contest_instance_id: contestInstanceId,
          golfer_id: 'espn_1',
          round_number: 1,
          hole_points: 10,
          bonus_points: 0,
          finish_bonus: 0,
          total_points: 10
        }
      ];

      const ctx = { contestInstanceId, dbClient: testConnection };
      await pgaEspnIngestion.upsertScores(ctx, firstScore);

      let result = await testConnection.query(
        'SELECT total_points FROM golfer_event_scores WHERE contest_instance_id = $1 AND golfer_id = $2 AND round_number = $3',
        [contestInstanceId, 'espn_1', 1]
      );
      expect(result.rows[0].total_points).toBe(10);

      // Update score for espn_1 round 1
      const updatedScore = [
        {
          contest_instance_id: contestInstanceId,
          golfer_id: 'espn_1',
          round_number: 1,
          hole_points: 15,
          bonus_points: 0,
          finish_bonus: 0,
          total_points: 15
        }
      ];

      await pgaEspnIngestion.upsertScores(ctx, updatedScore);

      result = await testConnection.query(
        'SELECT total_points FROM golfer_event_scores WHERE contest_instance_id = $1 AND golfer_id = $2 AND round_number = $3',
        [contestInstanceId, 'espn_1', 1]
      );
      expect(result.rows.length).toBe(1); // No duplicates
      expect(result.rows[0].total_points).toBe(15); // Updated value
    });
  });

  describe('Unit: Mixed rounds in one payload', () => {
    test('accepts mixed rounds 1, 2, 3 in single payload', async () => {
      const mixedRounds = [
        // Round 1: 3 golfers
        {
          contest_instance_id: contestInstanceId,
          golfer_id: 'espn_1',
          round_number: 1,
          hole_points: 10,
          bonus_points: 0,
          finish_bonus: 0,
          total_points: 10
        },
        {
          contest_instance_id: contestInstanceId,
          golfer_id: 'espn_2',
          round_number: 1,
          hole_points: 12,
          bonus_points: 0,
          finish_bonus: 0,
          total_points: 12
        },
        {
          contest_instance_id: contestInstanceId,
          golfer_id: 'espn_3',
          round_number: 1,
          hole_points: 11,
          bonus_points: 0,
          finish_bonus: 0,
          total_points: 11
        },
        // Round 2: 2 golfers
        {
          contest_instance_id: contestInstanceId,
          golfer_id: 'espn_1',
          round_number: 2,
          hole_points: 12,
          bonus_points: 0,
          finish_bonus: 0,
          total_points: 12
        },
        {
          contest_instance_id: contestInstanceId,
          golfer_id: 'espn_2',
          round_number: 2,
          hole_points: 13,
          bonus_points: 0,
          finish_bonus: 0,
          total_points: 13
        },
        // Round 3: 1 golfer
        {
          contest_instance_id: contestInstanceId,
          golfer_id: 'espn_1',
          round_number: 3,
          hole_points: 11,
          bonus_points: 0,
          finish_bonus: 0,
          total_points: 11
        }
      ];

      const ctx = { contestInstanceId, dbClient: testConnection };
      await pgaEspnIngestion.upsertScores(ctx, mixedRounds);

      const result = await testConnection.query(
        'SELECT DISTINCT round_number FROM golfer_event_scores WHERE contest_instance_id = $1 ORDER BY round_number',
        [contestInstanceId]
      );

      expect(result.rows.length).toBe(3);
      expect(result.rows[0].round_number).toBe(1);
      expect(result.rows[1].round_number).toBe(2);
      expect(result.rows[2].round_number).toBe(3);
    });
  });

  describe('Unit: Cut/withdrawn golfers', () => {
    test('absent golfers do not block scoring for others', async () => {
      const scores = [
        // Only 2 of 5 golfers have scores (3 missing)
        {
          contest_instance_id: contestInstanceId,
          golfer_id: 'espn_1',
          round_number: 1,
          hole_points: 10,
          bonus_points: 0,
          finish_bonus: 0,
          total_points: 10
        },
        {
          contest_instance_id: contestInstanceId,
          golfer_id: 'espn_2',
          round_number: 1,
          hole_points: 12,
          bonus_points: 0,
          finish_bonus: 0,
          total_points: 12
        }
      ];

      const ctx = { contestInstanceId, dbClient: testConnection };
      await pgaEspnIngestion.upsertScores(ctx, scores);

      const result = await testConnection.query(
        'SELECT COUNT(*) as cnt FROM golfer_event_scores WHERE contest_instance_id = $1',
        [contestInstanceId]
      );

      expect(parseInt(result.rows[0].cnt, 10)).toBe(2);
    });
  });

  describe('Unit: Empty and null handling', () => {
    test('empty normalizedScores no-ops safely', async () => {
      const ctx = { contestInstanceId, dbClient: testConnection };
      await pgaEspnIngestion.upsertScores(ctx, []);

      const result = await testConnection.query(
        'SELECT COUNT(*) as cnt FROM golfer_event_scores WHERE contest_instance_id = $1',
        [contestInstanceId]
      );

      expect(parseInt(result.rows[0].cnt, 10)).toBe(0);
    });

    test('null normalizedScores no-ops safely', async () => {
      const ctx = { contestInstanceId, dbClient: testConnection };
      await pgaEspnIngestion.upsertScores(ctx, null);

      const result = await testConnection.query(
        'SELECT COUNT(*) as cnt FROM golfer_event_scores WHERE contest_instance_id = $1',
        [contestInstanceId]
      );

      expect(parseInt(result.rows[0].cnt, 10)).toBe(0);
    });
  });

  describe('Integration: Multiple sequential ingests', () => {
    test('first ingest partial, second ingest updates, no duplicates created', async () => {
      const ctx = { contestInstanceId, dbClient: testConnection, providerEventId: 'espn_pga_test_event' };

      // First ingest: round 1, golfers 1-2
      const ingest1 = [
        {
          contest_instance_id: contestInstanceId,
          golfer_id: 'espn_1',
          round_number: 1,
          hole_points: 10,
          bonus_points: 0,
          finish_bonus: 0,
          total_points: 10
        },
        {
          contest_instance_id: contestInstanceId,
          golfer_id: 'espn_2',
          round_number: 1,
          hole_points: 12,
          bonus_points: 0,
          finish_bonus: 0,
          total_points: 12
        }
      ];
      await pgaEspnIngestion.upsertScores(ctx, ingest1);

      let result = await testConnection.query(
        'SELECT COUNT(*) as cnt FROM golfer_event_scores WHERE contest_instance_id = $1',
        [contestInstanceId]
      );
      expect(parseInt(result.rows[0].cnt, 10)).toBe(2);

      // Second ingest: round 1, all 5 golfers with updates to first 2
      const ingest2 = [
        {
          contest_instance_id: contestInstanceId,
          golfer_id: 'espn_1',
          round_number: 1,
          hole_points: 11, // Updated
          bonus_points: 0,
          finish_bonus: 0,
          total_points: 11
        },
        {
          contest_instance_id: contestInstanceId,
          golfer_id: 'espn_2',
          round_number: 1,
          hole_points: 13, // Updated
          bonus_points: 0,
          finish_bonus: 0,
          total_points: 13
        },
        {
          contest_instance_id: contestInstanceId,
          golfer_id: 'espn_3',
          round_number: 1,
          hole_points: 11,
          bonus_points: 0,
          finish_bonus: 0,
          total_points: 11
        },
        {
          contest_instance_id: contestInstanceId,
          golfer_id: 'espn_4',
          round_number: 1,
          hole_points: 9,
          bonus_points: 0,
          finish_bonus: 0,
          total_points: 9
        },
        {
          contest_instance_id: contestInstanceId,
          golfer_id: 'espn_5',
          round_number: 1,
          hole_points: 10,
          bonus_points: 0,
          finish_bonus: 0,
          total_points: 10
        }
      ];
      await pgaEspnIngestion.upsertScores(ctx, ingest2);

      result = await testConnection.query(
        'SELECT COUNT(*) as cnt FROM golfer_event_scores WHERE contest_instance_id = $1',
        [contestInstanceId]
      );
      expect(parseInt(result.rows[0].cnt, 10)).toBe(5); // Still 5, not 7 (no duplicates)

      // Verify updates applied
      const updatedScore = await testConnection.query(
        'SELECT total_points FROM golfer_event_scores WHERE contest_instance_id = $1 AND golfer_id = $2 AND round_number = $3',
        [contestInstanceId, 'espn_1', 1]
      );
      expect(updatedScore.rows[0].total_points).toBe(11); // Updated from 10
    });
  });

  describe('Integration: Staggered incremental updates across rounds', () => {
    test('accepts multiple ingests across rounds without deduplication', async () => {
      const ctx = { contestInstanceId, dbClient: testConnection };

      // First ingest: Round 1, golfers 1-2
      const round1 = [
        {
          contest_instance_id: contestInstanceId,
          golfer_id: 'espn_1',
          round_number: 1,
          hole_points: 10,
          bonus_points: 0,
          finish_bonus: 0,
          total_points: 10
        },
        {
          contest_instance_id: contestInstanceId,
          golfer_id: 'espn_2',
          round_number: 1,
          hole_points: 12,
          bonus_points: 0,
          finish_bonus: 0,
          total_points: 12
        }
      ];

      await pgaEspnIngestion.upsertScores(ctx, round1);

      let result = await testConnection.query(
        'SELECT COUNT(*) as cnt FROM golfer_event_scores WHERE contest_instance_id = $1',
        [contestInstanceId]
      );
      expect(parseInt(result.rows[0].cnt, 10)).toBe(2);

      // Second ingest: Round 1 golfers 3-4, Round 2 golfer 1
      const round2Mixed = [
        {
          contest_instance_id: contestInstanceId,
          golfer_id: 'espn_3',
          round_number: 1,
          hole_points: 11,
          bonus_points: 0,
          finish_bonus: 0,
          total_points: 11
        },
        {
          contest_instance_id: contestInstanceId,
          golfer_id: 'espn_4',
          round_number: 1,
          hole_points: 9,
          bonus_points: 0,
          finish_bonus: 0,
          total_points: 9
        },
        {
          contest_instance_id: contestInstanceId,
          golfer_id: 'espn_1',
          round_number: 2,
          hole_points: 12,
          bonus_points: 0,
          finish_bonus: 0,
          total_points: 12
        }
      ];

      await pgaEspnIngestion.upsertScores(ctx, round2Mixed);

      result = await testConnection.query(
        'SELECT COUNT(*) as cnt FROM golfer_event_scores WHERE contest_instance_id = $1',
        [contestInstanceId]
      );
      expect(parseInt(result.rows[0].cnt, 10)).toBe(5); // 4 from round 1 + 1 from round 2
    });
  });
});
