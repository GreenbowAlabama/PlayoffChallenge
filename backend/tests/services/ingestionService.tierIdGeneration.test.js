/**
 * Ingestion Service — Tier ID Generation Test
 *
 * Tests that populateFieldSelections correctly assigns tier_id to each player
 * based on their rank (1-based position in sorted field).
 *
 * This is a failing test before implementation — tier_id must be GENERATED
 * by the system, not injected in test data.
 */

const { v4: uuidv4 } = require('uuid');

describe('Ingestion Service — Field Population with Tier ID Generation', () => {
  let pool;
  let client;
  let contestInstanceId;
  let tournamentConfigId;

  beforeAll(async () => {
    const { getIntegrationApp } = require('../mocks/testAppFactory');
    const { pool: integrationPool } = getIntegrationApp();
    pool = integrationPool;
  });

  beforeEach(async () => {
    contestInstanceId = uuidv4();
    tournamentConfigId = uuidv4();
    const organizerId = uuidv4();

    // Setup: Create test user (organizer)
    await pool.query(
      `INSERT INTO users (id, username, email, is_admin) VALUES ($1, $2, $3, false)
       ON CONFLICT (id) DO NOTHING`,
      [organizerId, `test-organizer-${Date.now()}`, `test-${Date.now()}@example.com`]
    );

    // Setup: Create contest_instance with all required fields
    await pool.query(
      `INSERT INTO contest_instances (
         id, template_id, organizer_id, entry_fee_cents, payout_structure, status,
         contest_name, max_entries, is_platform_owned, is_primary_marketing, is_system_generated
       ) VALUES (
         $1, (SELECT id FROM contest_templates LIMIT 1), $2, 0, $3, 'SCHEDULED',
         $4, 20, false, false, false
       )`,
      [contestInstanceId, organizerId, JSON.stringify({}), 'Test Contest']
    );

    // Setup: Create tournament_configs with tier_definition
    const tierDefinition = {
      required_per_tier: 1,
      tiers: [
        { id: 't1', rank_min: 1, rank_max: 5 },
        { id: 't2', rank_min: 6, rank_max: 10 },
        { id: 't3', rank_min: 11, rank_max: 15 }
      ]
    };

    const configHash = require('crypto')
      .createHash('sha256')
      .update(JSON.stringify(tierDefinition) + Date.now())
      .digest('hex');

    await pool.query(
      `INSERT INTO tournament_configs
       (id, contest_instance_id, provider_event_id, ingestion_endpoint,
        event_start_date, event_end_date, round_count, cut_after_round,
        leaderboard_schema_version, field_source, tier_definition, published_at, is_active, hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), false, $12)`,
      [
        tournamentConfigId,
        contestInstanceId,
        'espn_pga_test_' + Date.now(),
        'https://test.example.com',
        new Date('2026-03-20'),
        new Date('2026-03-23'),
        4,
        2,
        1,
        'provider_sync',
        JSON.stringify(tierDefinition),
        configHash
      ]
    );

    // Setup: Create field_selections row (empty, will be populated)
    await pool.query(
      `INSERT INTO field_selections
       (id, contest_instance_id, tournament_config_id, selection_json, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [uuidv4(), contestInstanceId, tournamentConfigId, JSON.stringify({ primary: [], alternates: [] })]
    );

    // Setup: Create test golf players with ESPN IDs
    const playerIds = [];
    for (let i = 1; i <= 10; i++) {
      const playerId = `espn_${1000 + i}`;
      playerIds.push(playerId);
      await pool.query(
        `INSERT INTO players (id, full_name, sport, is_active, espn_id)
         VALUES ($1, $2, 'GOLF', true, $3)
         ON CONFLICT (id) DO NOTHING`,
        [playerId, `Player ${i}`, i]
      );
    }
  });

  afterEach(async () => {
    // Cleanup in reverse dependency order
    try {
      await pool.query('DELETE FROM field_selections WHERE contest_instance_id = $1', [contestInstanceId]);
      await pool.query('DELETE FROM tournament_configs WHERE contest_instance_id = $1', [contestInstanceId]);
      await pool.query('DELETE FROM contest_instances WHERE id = $1', [contestInstanceId]);
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  afterAll(async () => {
    // Cleanup players created in test
    await pool.query(`DELETE FROM players WHERE id LIKE 'espn_10%'`);
    // Note: Do NOT call pool.end() here - test infrastructure handles it
  });

  it('tier_id generated from tier_definition with deterministic ranking', async () => {
    const { populateFieldSelections } = require('../../services/ingestionService');

    // Simulate selectField output: ordered list of players
    const playerIds = [
      'espn_1001', 'espn_1002', 'espn_1003', 'espn_1004', 'espn_1005',
      'espn_1006', 'espn_1007', 'espn_1008', 'espn_1009', 'espn_1010'
    ];

    // Populate field selections with tier_definition
    // tier_id should be generated based on deterministic rank (index + 1)
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await populateFieldSelections(client, contestInstanceId, playerIds);
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    // Read back the generated field_selections
    const result = await pool.query(
      `SELECT selection_json FROM field_selections WHERE contest_instance_id = $1`,
      [contestInstanceId]
    );

    expect(result.rows.length).toBe(1);
    const { primary, alternates } = result.rows[0].selection_json;

    // Verify tier_id generated for each player based on rank
    expect(primary.length).toBe(playerIds.length);

    primary.forEach((player, index) => {
      const rank = index + 1;  // deterministic ranking
      expect(player.player_id).toBeDefined();
      expect(player.name).toBeDefined();
      expect(player.espn_id).toBeDefined();
      expect(player.image_url).toBeDefined();

      // tier_id should be generated based on tier_definition ranges
      expect(player.tier_id).toBeDefined();
      if (rank >= 1 && rank <= 5) {
        expect(player.tier_id).toBe('t1');
      } else if (rank >= 6 && rank <= 10) {
        expect(player.tier_id).toBe('t2');
      } else if (rank >= 11 && rank <= 15) {
        expect(player.tier_id).toBe('t3');
      }
    });

    // Verify alternates also have tier_id
    alternates.forEach((player, index) => {
      const primaryCount = primary.length;
      const rank = primaryCount + index + 1;
      expect(player.tier_id).toBeDefined();
      if (rank >= 1 && rank <= 5) {
        expect(player.tier_id).toBe('t1');
      } else if (rank >= 6 && rank <= 10) {
        expect(player.tier_id).toBe('t2');
      } else if (rank >= 11 && rank <= 15) {
        expect(player.tier_id).toBe('t3');
      }
    });
  });
});
