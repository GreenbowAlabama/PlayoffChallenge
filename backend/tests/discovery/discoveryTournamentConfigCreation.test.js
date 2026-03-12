/**
 * Discovery Tournament Config Creation Tests
 *
 * Integration tests verifying that when discovery creates contest instances,
 * tournament_configs and field_selections are properly initialized with correct data.
 */

'use strict';

const { Pool } = require('pg');
const { initializeTournamentField } = require('../../services/ingestionService');

// Mock ESPN fetcher to prevent network calls
jest.mock('../../services/discovery/espnDataFetcher', () => ({
  fetchEspnSummary: jest.fn().mockResolvedValue(null),
  extractEspnEventId: jest.requireActual('../../services/discovery/espnDataFetcher').extractEspnEventId
}));

describe('Discovery Tournament Config Creation', () => {
  let pool;
  const organizerId = '00000000-0000-0000-0000-000000000043';
  const uniqueId = Date.now().toString() + '_' + Math.random().toString(36).slice(2, 8);

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL_TEST || process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    // Create organizer user
    await pool.query(
      `INSERT INTO users (id, email, username) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [organizerId, 'discovery-config-test@platform.local', 'discovery-config-test']
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Clean up test data
    await pool.query(
      `DELETE FROM field_selections WHERE contest_instance_id IN (
        SELECT id FROM contest_instances WHERE provider_event_id LIKE $1
      )`,
      [`espn_pga_test_config_%${uniqueId}`]
    );

    await pool.query(
      `DELETE FROM tournament_configs WHERE contest_instance_id IN (
        SELECT id FROM contest_instances WHERE provider_event_id LIKE $1
      )`,
      [`espn_pga_test_config_%${uniqueId}`]
    );

    await pool.query(
      `DELETE FROM contest_instances WHERE provider_event_id LIKE $1`,
      [`espn_pga_test_config_%${uniqueId}`]
    );

    await pool.query(
      `DELETE FROM contest_templates WHERE provider_tournament_id LIKE $1 AND is_system_generated = true`,
      [`espn_pga_test_config_%${uniqueId}`]
    );
  });

  describe('initializeTournamentField integration', () => {
    it('should create tournament_configs with proper event dates from contest instance', async () => {
      // Create template
      const templateResult = await pool.query(
        `INSERT INTO contest_templates (
          name, sport, template_type, scoring_strategy_key, lock_strategy_key,
          settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
          allowed_entry_fee_max_cents, allowed_payout_structures,
          is_active, is_system_generated, status, provider_tournament_id, season_year
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
        )
        RETURNING id`,
        [
          `Test Config Template ${uniqueId}`,
          'GOLF',
          'PGA_TOURNAMENT',
          'pga_standard_v1',
          'auto_discovery',
          'pga_settlement',
          5000, 1000, 50000,
          JSON.stringify([{ payout_percentages: [0.5, 0.3, 0.2], min_entries: 2 }]),
          true, true, 'SCHEDULED',
          `espn_pga_test_config_tournament_${uniqueId}`,
          2026
        ]
      );

      const templateId = templateResult.rows[0].id;

      // Create contest instance with tournament dates
      const tournamentStart = new Date('2026-04-09T07:00:00Z');
      const tournamentEnd = new Date('2026-04-12T07:00:00Z');

      const instanceResult = await pool.query(
        `INSERT INTO contest_instances (
          template_id, organizer_id, entry_fee_cents, payout_structure,
          status, contest_name, lock_time, provider_event_id,
          tournament_start_time, tournament_end_time
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
        )
        RETURNING id, provider_event_id`,
        [
          templateId, organizerId, 5000,
          JSON.stringify({ payout_percentages: [0.5, 0.3, 0.2], min_entries: 2 }),
          'SCHEDULED', 'Test Contest',
          new Date('2026-04-09T06:00:00Z'),
          `espn_pga_test_config_event_${uniqueId}`,
          tournamentStart,
          tournamentEnd
        ]
      );

      const contestInstanceId = instanceResult.rows[0].id;

      // Call initializeTournamentField (the real implementation, not mocked)
      await initializeTournamentField(pool, contestInstanceId);

      // Verify tournament_configs was created with all required schema fields
      const configResult = await pool.query(
        `SELECT
          id,
          contest_instance_id,
          provider_event_id,
          ingestion_endpoint,
          event_start_date,
          event_end_date,
          round_count,
          leaderboard_schema_version,
          field_source,
          hash,
          published_at,
          created_at,
          is_active
         FROM tournament_configs
         WHERE contest_instance_id = $1`,
        [contestInstanceId]
      );

      expect(configResult.rows.length).toBe(1);
      const config = configResult.rows[0];

      expect(config.provider_event_id).toBe(`espn_pga_test_config_event_${uniqueId}`);
      expect(config.ingestion_endpoint).toBe('espn_pga_scoreboard');
      expect(config.round_count).toBe(4);
      expect(config.is_active).toBe(true);

      // Verify required schema fields are NOT NULL
      expect(config.hash).toBeTruthy();
      expect(config.field_source).toBe('provider_sync');
      expect(config.leaderboard_schema_version).toBe(1);
      expect(config.published_at).toBeTruthy();
      expect(config.created_at).toBeTruthy();

      // Verify event dates match tournament times (not NOW())
      const configStartDate = new Date(config.event_start_date);
      const configEndDate = new Date(config.event_end_date);

      expect(configStartDate.getTime()).toBe(tournamentStart.getTime());
      expect(configEndDate.getTime()).toBe(tournamentEnd.getTime());
    });

    it('should create field_selections row with required schema fields', async () => {
      // Create template
      const templateResult = await pool.query(
        `INSERT INTO contest_templates (
          name, sport, template_type, scoring_strategy_key, lock_strategy_key,
          settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
          allowed_entry_fee_max_cents, allowed_payout_structures,
          is_active, is_system_generated, status, provider_tournament_id, season_year
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
        )
        RETURNING id`,
        [
          `Test Field Template ${uniqueId}`,
          'GOLF',
          'PGA_DAILY',
          'pga_standard_v1',
          'auto_discovery',
          'pga_settlement',
          5000, 1000, 50000,
          JSON.stringify([{ payout_percentages: [0.5, 0.3, 0.2], min_entries: 2 }]),
          true, true, 'SCHEDULED',
          `espn_pga_test_config_field_${uniqueId}`,
          2026
        ]
      );

      const templateId = templateResult.rows[0].id;

      // Create contest instance
      const instanceResult = await pool.query(
        `INSERT INTO contest_instances (
          template_id, organizer_id, entry_fee_cents, payout_structure,
          status, contest_name, lock_time, provider_event_id,
          tournament_start_time, tournament_end_time
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
        )
        RETURNING id`,
        [
          templateId, organizerId, 5000,
          JSON.stringify({ payout_percentages: [0.5, 0.3, 0.2], min_entries: 2 }),
          'SCHEDULED', 'Test Field Contest',
          new Date('2026-04-09T06:00:00Z'),
          `espn_pga_test_config_field_event_${uniqueId}`,
          new Date('2026-04-09T07:00:00Z'),
          new Date('2026-04-12T07:00:00Z')
        ]
      );

      const contestInstanceId = instanceResult.rows[0].id;

      // Initialize field
      await initializeTournamentField(pool, contestInstanceId);

      // Verify field_selections was created
      const fsResult = await pool.query(
        `SELECT id, contest_instance_id, tournament_config_id, selection_json
         FROM field_selections
         WHERE contest_instance_id = $1`,
        [contestInstanceId]
      );

      expect(fsResult.rows.length).toBe(1);
      const fs = fsResult.rows[0];

      // Verify required schema fields exist
      expect(fs.id).toBeTruthy();
      expect(fs.contest_instance_id).toBe(contestInstanceId);
      expect(fs.tournament_config_id).toBeTruthy();

      // Handle JSONB which may be object or string depending on driver
      const selectionJson =
        typeof fs.selection_json === 'string'
          ? JSON.parse(fs.selection_json)
          : fs.selection_json;

      // Verify selection_json has required structure (may be empty or populated with active players)
      expect(selectionJson).toHaveProperty('primary');
      expect(Array.isArray(selectionJson.primary)).toBe(true);
    });

    it('should be idempotent: multiple calls do not create duplicates', async () => {
      // Create template
      const templateResult = await pool.query(
        `INSERT INTO contest_templates (
          name, sport, template_type, scoring_strategy_key, lock_strategy_key,
          settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
          allowed_entry_fee_max_cents, allowed_payout_structures,
          is_active, is_system_generated, status, provider_tournament_id, season_year
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
        )
        RETURNING id`,
        [
          `Test Idempotent Template ${uniqueId}`,
          'GOLF',
          'PGA_TOURNAMENT',
          'pga_standard_v1',
          'auto_discovery',
          'pga_settlement',
          5000, 1000, 50000,
          JSON.stringify([{ payout_percentages: [0.5, 0.3, 0.2], min_entries: 2 }]),
          true, true, 'SCHEDULED',
          `espn_pga_test_config_idempotent_${uniqueId}`,
          2026
        ]
      );

      const templateId = templateResult.rows[0].id;

      // Create contest instance
      const instanceResult = await pool.query(
        `INSERT INTO contest_instances (
          template_id, organizer_id, entry_fee_cents, payout_structure,
          status, contest_name, lock_time, provider_event_id,
          tournament_start_time, tournament_end_time
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
        )
        RETURNING id`,
        [
          templateId, organizerId, 5000,
          JSON.stringify({ payout_percentages: [0.5, 0.3, 0.2], min_entries: 2 }),
          'SCHEDULED', 'Test Idempotent Contest',
          new Date('2026-04-09T06:00:00Z'),
          `espn_pga_test_config_idempotent_event_${uniqueId}`,
          new Date('2026-04-09T07:00:00Z'),
          new Date('2026-04-12T07:00:00Z')
        ]
      );

      const contestInstanceId = instanceResult.rows[0].id;

      // Call initializeTournamentField twice
      await initializeTournamentField(pool, contestInstanceId);
      await initializeTournamentField(pool, contestInstanceId);

      // Verify only one tournament_configs row exists
      const configResult = await pool.query(
        `SELECT COUNT(*) as count FROM tournament_configs WHERE contest_instance_id = $1`,
        [contestInstanceId]
      );
      expect(Number(configResult.rows[0].count)).toBe(1);

      // Verify only one field_selections row exists
      const fsResult = await pool.query(
        `SELECT COUNT(*) as count FROM field_selections WHERE contest_instance_id = $1`,
        [contestInstanceId]
      );
      expect(Number(fsResult.rows[0].count)).toBe(1);
    });
  });
});
