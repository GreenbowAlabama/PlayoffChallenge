/**
 * PGA Player Pool Ingestion Tests
 *
 * Verifies that:
 * 1. Golfers are fetched from ESPN and upserted to players table with sport='GOLF'
 * 2. field_selections.selection_json.primary is populated with ingested golfers
 * 3. ingestion_events records are created with validation_status='VALID'
 */

'use strict';

const { Pool } = require('pg');
const ingestionService = require('../../services/ingestionService');

describe('PGA Player Pool Ingestion (BOTH Phase)', () => {
  let pool;
  let contestInstanceId;
  let templateId;
  let tournamentConfigId;
  let fieldSelectionsId;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  beforeEach(async () => {
    // Create test user (organizer)
    const userResult = await pool.query(`
      INSERT INTO users (id, email, username, is_admin)
      VALUES (gen_random_uuid(), 'test@example.com', 'testuser', false)
      ON CONFLICT DO NOTHING
      RETURNING id
    `);
    const userId = userResult.rows.length > 0 ? userResult.rows[0].id : (await pool.query('SELECT id FROM users LIMIT 1')).rows[0].id;

    // Create PGA template (inactive to avoid unique_active_template_per_type constraint)
    const templateResult = await pool.query(`
      INSERT INTO contest_templates (
        id, name, sport, template_type, scoring_strategy_key, lock_strategy_key,
        settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
        allowed_entry_fee_max_cents, allowed_payout_structures, provider_tournament_id,
        season_year, is_active, created_at, updated_at
      ) VALUES (
        gen_random_uuid(),
        'Test PGA Template ' || gen_random_uuid()::text,
        'GOLF',
        'pga_tour',
        'pga_scoring_v1',
        'pga_lock',
        'pga_settlement',
        5000,
        1000,
        20000,
        '["50-50"]'::jsonb,
        'espn_pga_401811935',
        2025,
        false,
        NOW(),
        NOW()
      )
      RETURNING id
    `);
    templateId = templateResult.rows[0].id;

    // Create contest instance
    const contestResult = await pool.query(`
      INSERT INTO contest_instances (
        id, template_id, organizer_id, entry_fee_cents, payout_structure,
        status, max_entries, contest_name, provider_event_id, created_at, updated_at
      ) VALUES (
        gen_random_uuid(),
        $1,
        $2,
        5000,
        '{"structure": "50-50"}'::jsonb,
        'LIVE',
        20,
        'Test PGA Contest ' || gen_random_uuid()::text,
        'espn_pga_401811935',
        NOW(),
        NOW()
      )
      RETURNING id
    `, [templateId, userId]);
    contestInstanceId = contestResult.rows[0].id;

    // Create tournament config
    const tcResult = await pool.query(`
      INSERT INTO tournament_configs (
        id, contest_instance_id, provider_event_id, ingestion_endpoint,
        event_start_date, event_end_date, round_count, cut_after_round,
        leaderboard_schema_version, field_source, hash, published_at, is_active, created_at
      ) VALUES (
        gen_random_uuid(),
        $1,
        'espn_pga_401811935',
        'https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard',
        NOW(),
        NOW() + interval '7 days',
        4,
        2,
        1,
        'provider_sync',
        '',
        NOW(),
        false,
        NOW()
      )
      RETURNING id
    `, [contestInstanceId]);
    tournamentConfigId = tcResult.rows[0].id;

    // Create field selections with empty selection
    const fsResult = await pool.query(`
      INSERT INTO field_selections (
        id, contest_instance_id, tournament_config_id, selection_json, created_at
      ) VALUES (
        gen_random_uuid(),
        $1,
        $2,
        '{"primary": []}'::jsonb,
        NOW()
      )
      RETURNING id
    `, [contestInstanceId, tournamentConfigId]);
    fieldSelectionsId = fsResult.rows[0].id;
  });

  afterEach(async () => {
    // Cleanup (skip ingestion_events which is append-only and FK to contest_instances)
    await pool.query('DELETE FROM ingestion_runs WHERE contest_instance_id = $1', [contestInstanceId]);
    await pool.query('DELETE FROM field_selections WHERE contest_instance_id = $1', [contestInstanceId]);
    await pool.query('DELETE FROM tournament_configs WHERE contest_instance_id = $1', [contestInstanceId]);
    await pool.query('DELETE FROM contest_state_transitions WHERE contest_instance_id = $1', [contestInstanceId]);
    await pool.query('DELETE FROM contest_participants WHERE contest_instance_id = $1', [contestInstanceId]);
  });


  it('should ingest PGA golfers into players table with sport=GOLF', async () => {
    // Mock the ESPN API call
    const pgaEspnIngestion = require('../../services/ingestion/strategies/pgaEspnIngestion');
    const originalGetWorkUnits = pgaEspnIngestion.getWorkUnits;

    pgaEspnIngestion.getWorkUnits = jest.fn().mockResolvedValue([
      {
        externalPlayerId: '12345',
        providerEventId: 'espn_pga_401811935',
        providerData: null,
        golfer: {
          external_id: '12345',
          name: 'Scottie Scheffler',
          image_url: 'https://example.com/scottie.jpg',
          sport: 'GOLF',
          position: 'G'
        }
      },
      {
        externalPlayerId: '67890',
        providerEventId: 'espn_pga_401811935',
        providerData: null,
        golfer: {
          external_id: '67890',
          name: 'Rory McIlroy',
          image_url: 'https://example.com/rory.jpg',
          sport: 'GOLF',
          position: 'G'
        }
      }
    ]);

    // Run ingestion
    const summary = await ingestionService.run(contestInstanceId, pool);

    // Verify return value
    expect(summary.processed).toBe(2);
    expect(summary.skipped).toBe(0);
    expect(summary.errors).toHaveLength(0);

    // Verify golfers in players table
    const playersResult = await pool.query(
      `SELECT id, espn_id, full_name, sport FROM players WHERE sport = 'GOLF' AND espn_id IN ('12345', '67890') ORDER BY espn_id`
    );
    expect(playersResult.rows).toHaveLength(2);
    expect(playersResult.rows[0]).toEqual({
      id: expect.stringMatching(/^espn_/),
      espn_id: '12345',
      full_name: 'Scottie Scheffler',
      sport: 'GOLF'
    });
    expect(playersResult.rows[1]).toEqual({
      id: expect.stringMatching(/^espn_/),
      espn_id: '67890',
      full_name: 'Rory McIlroy',
      sport: 'GOLF'
    });

    // Restore mock
    pgaEspnIngestion.getWorkUnits = originalGetWorkUnits;
  });

  it('should populate field_selections.selection_json.primary with ingested golfers', async () => {
    // Mock the ESPN API call
    const pgaEspnIngestion = require('../../services/ingestion/strategies/pgaEspnIngestion');
    const originalGetWorkUnits = pgaEspnIngestion.getWorkUnits;

    pgaEspnIngestion.getWorkUnits = jest.fn().mockResolvedValue([
      {
        externalPlayerId: '12345',
        providerEventId: 'espn_pga_401811935',
        providerData: null,
        golfer: {
          external_id: '12345',
          name: 'Scottie Scheffler',
          image_url: 'https://example.com/scottie.jpg',
          sport: 'GOLF',
          position: 'G'
        }
      },
      {
        externalPlayerId: '67890',
        providerEventId: 'espn_pga_401811935',
        providerData: null,
        golfer: {
          external_id: '67890',
          name: 'Rory McIlroy',
          image_url: 'https://example.com/rory.jpg',
          sport: 'GOLF',
          position: 'G'
        }
      }
    ]);

    // Run ingestion (phase='BOTH' by default)
    await ingestionService.run(contestInstanceId, pool);

    // Verify field_selections is populated
    const fsResult = await pool.query(
      `SELECT selection_json FROM field_selections WHERE contest_instance_id = $1`,
      [contestInstanceId]
    );
    expect(fsResult.rows).toHaveLength(1);

    const selection = fsResult.rows[0].selection_json;
    expect(selection.primary).toBeDefined();
    expect(selection.primary.length).toBe(2);

    // Verify primary has correct structure
    expect(selection.primary[0]).toMatchObject({
      espn_id: expect.any(String),
      name: expect.any(String),
      player_id: expect.any(String)
    });

    // Restore mock
    pgaEspnIngestion.getWorkUnits = originalGetWorkUnits;
  });

  it('should create ingestion_events record with validation_status=VALID', async () => {
    // Mock the ESPN API call with a SCORING phase unit
    const pgaEspnIngestion = require('../../services/ingestion/strategies/pgaEspnIngestion');
    const originalGetWorkUnits = pgaEspnIngestion.getWorkUnits;

    pgaEspnIngestion.getWorkUnits = jest.fn().mockResolvedValue([
      {
        externalPlayerId: '12345',
        providerEventId: 'espn_pga_401811935',
        providerData: {
          events: [
            {
              id: '401811935',
              status: { type: { name: 'STATUS_FINAL' } },
              competitions: [
                {
                  competitors: [
                    {
                      id: '12345',
                      startTime: '2025-04-10T07:00Z',
                      linescores: []
                    }
                  ]
                }
              ]
            }
          ]
        },
        golfer: {
          external_id: '12345',
          name: 'Scottie Scheffler',
          image_url: 'https://example.com/scottie.jpg',
          sport: 'GOLF',
          position: 'G'
        }
      }
    ]);

    // Run ingestion
    await ingestionService.run(contestInstanceId, pool);

    // Verify ingestion_events record
    const eventsResult = await pool.query(
      `SELECT provider, event_type, validation_status FROM ingestion_events WHERE contest_instance_id = $1`,
      [contestInstanceId]
    );
    expect(eventsResult.rows.length).toBeGreaterThan(0);
    expect(eventsResult.rows[0]).toMatchObject({
      provider: 'pga_espn',
      event_type: 'tournament_data',
      validation_status: 'VALID'
    });

    // Restore mock
    pgaEspnIngestion.getWorkUnits = originalGetWorkUnits;
  });

  it('should handle empty golfers gracefully', async () => {
    // Mock empty golfers
    const pgaEspnIngestion = require('../../services/ingestion/strategies/pgaEspnIngestion');
    const originalGetWorkUnits = pgaEspnIngestion.getWorkUnits;

    pgaEspnIngestion.getWorkUnits = jest.fn().mockResolvedValue([]);

    // Run ingestion
    const summary = await ingestionService.run(contestInstanceId, pool);

    // Verify no players ingested
    expect(summary.processed).toBe(0);

    // Verify field_selections unchanged
    const fsResult = await pool.query(
      `SELECT selection_json FROM field_selections WHERE contest_instance_id = $1`,
      [contestInstanceId]
    );
    expect(fsResult.rows[0].selection_json.primary).toHaveLength(0);

    // Restore mock
    pgaEspnIngestion.getWorkUnits = originalGetWorkUnits;
  });

  it('should be idempotent: re-ingestion with same golfers produces no duplicates', async () => {
    // Mock ESPN API
    const pgaEspnIngestion = require('../../services/ingestion/strategies/pgaEspnIngestion');
    const originalGetWorkUnits = pgaEspnIngestion.getWorkUnits;

    pgaEspnIngestion.getWorkUnits = jest.fn().mockResolvedValue([
      {
        externalPlayerId: '12345',
        providerEventId: 'espn_pga_401811935',
        providerData: null,
        golfer: {
          external_id: '12345',
          name: 'Scottie Scheffler',
          image_url: 'https://example.com/scottie.jpg',
          sport: 'GOLF',
          position: 'G'
        }
      }
    ]);

    // First ingestion
    await ingestionService.run(contestInstanceId, pool);

    // Verify 1 player with specific espn_id
    let playersResult = await pool.query(
      `SELECT COUNT(*)::int as count FROM players WHERE sport = 'GOLF' AND espn_id = '12345'`
    );
    expect(playersResult.rows[0].count).toBe(1);

    // Second ingestion (same golfer)
    await ingestionService.run(contestInstanceId, pool);

    // Verify still 1 player (no duplicate)
    playersResult = await pool.query(
      `SELECT COUNT(*)::int as count FROM players WHERE sport = 'GOLF' AND espn_id = '12345'`
    );
    expect(playersResult.rows[0].count).toBe(1);

    // Restore mock
    pgaEspnIngestion.getWorkUnits = originalGetWorkUnits;
  });
});
