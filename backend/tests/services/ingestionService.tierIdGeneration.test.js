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

    // Setup: Create contest_instance
    await pool.query(
      `INSERT INTO contest_instances (id, template_id, organizer_id, status)
       VALUES ($1, (SELECT id FROM contest_templates LIMIT 1), $2, 'SCHEDULED')`,
      [contestInstanceId, uuidv4()]
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

    await pool.query(
      `INSERT INTO tournament_configs
       (id, contest_instance_id, provider_event_id, ingestion_endpoint,
        event_start_date, event_end_date, round_count, cut_after_round,
        leaderboard_schema_version, field_source, tier_definition)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
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
        'espn',
        JSON.stringify(tierDefinition)
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
    // Cleanup
    await pool.query('DELETE FROM field_selections WHERE contest_instance_id = $1', [contestInstanceId]);
    await pool.query('DELETE FROM tournament_configs WHERE contest_instance_id = $1', [contestInstanceId]);
    await pool.query('DELETE FROM contest_instances WHERE id = $1', [contestInstanceId]);
  });

  afterAll(async () => {
    // Cleanup players created in test
    await pool.query(`DELETE FROM players WHERE id LIKE 'espn_10%'`);
    if (pool) await pool.end();
  });

  it('FAILS: tier_id should be generated for each player based on rank', async () => {
    const { populateFieldSelections } = require('../../services/ingestionService');

    // Simulate selectField output: ordered list of players
    // These will become rank 1, 2, 3, ... when mapped to tiers
    const playerIds = [
      'espn_1001', 'espn_1002', 'espn_1003', 'espn_1004', 'espn_1005',
      'espn_1006', 'espn_1007', 'espn_1008', 'espn_1009', 'espn_1010'
    ];

    // Populate field selections (should generate tier_id for each player)
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

    // CRITICAL: tier_id must be GENERATED, not mocked
    // Rank 1-5 → t1, Rank 6-10 → t2
    expect(primary.length).toBeGreaterThan(0);

    // Assert each player has tier_id generated correctly
    primary.forEach((player, index) => {
      const rank = index + 1;  // 1-based rank
      expect(player.tier_id).toBeDefined();
      expect(player.tier_id).not.toBeNull();

      // Verify tier_id matches tier_definition ranges
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
