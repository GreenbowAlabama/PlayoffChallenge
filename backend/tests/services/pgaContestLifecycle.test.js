/**
 * PGA Contest Lifecycle Test
 *
 * Reproduces the missing initialization of tournament_configs and field_selections
 * during contest publish.
 *
 * Expected pipeline:
 * 1. Create GOLF contest template
 * 2. Create contest instance
 * 3. Publish contest
 * 4. Assert tournament_configs exists
 * 5. Assert field_selections exists
 *
 * Current status: FAILING at steps 4-5
 */

'use strict';

const customContestService = require('../../services/customContestService');
const { getIntegrationApp } = require('../mocks/testAppFactory');
const { v4: uuidv4 } = require('uuid');

describe('PGA Contest Lifecycle — Tournament Field Initialization', () => {
  let pool;
  let organizerId;
  let pgaTemplateId;

  beforeAll(async () => {
    // Set JOIN_BASE_URL for this test suite
    process.env.JOIN_BASE_URL = 'https://test.example.com';
    const { pool: testPool } = getIntegrationApp();
    pool = testPool;
  });

  beforeEach(async () => {
    // Generate valid UUID for organizer
    organizerId = uuidv4();

    // Ensure organizer exists in DB
    await pool.query(
      `INSERT INTO users (id, username, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [organizerId, 'organizer-' + organizerId.slice(0, 8)]
    );

    // Fund organizer wallet with 10,000 cents for contest publishing
    await pool.query(
      `INSERT INTO ledger (id, user_id, entry_type, direction, amount_cents, currency, reference_type, reference_id, idempotency_key, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, gen_random_uuid(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [organizerId, 'WALLET_DEPOSIT', 'CREDIT', 10000, 'USD', 'WALLET', organizerId]
    );

    // Get or create GOLF template
    const templateResult = await pool.query(
      `SELECT id FROM contest_templates WHERE sport = 'GOLF' AND provider_tournament_id IS NOT NULL LIMIT 1`
    );

    if (templateResult.rows.length > 0) {
      pgaTemplateId = templateResult.rows[0].id;
    } else {
      // Create minimal GOLF template
      const createResult = await pool.query(
        `INSERT INTO contest_templates (
          id, name, sport, template_type, scoring_strategy_key,
          lock_strategy_key, settlement_strategy_key,
          default_entry_fee_cents, allowed_entry_fee_min_cents,
          allowed_entry_fee_max_cents, allowed_payout_structures,
          provider_tournament_id, season_year, created_at
        )
        VALUES (
          gen_random_uuid(),
          'Test PGA Template',
          'GOLF',
          'pga',
          'pga_standard_v1',
          'lock_time',
          'settlement_pga_v1',
          5000, 1000, 50000,
          '[{"type":"winner_only"}]',
          'test_pga_provider_' || gen_random_uuid()::text,
          2024,
          NOW()
        )
        RETURNING id`,
        []
      );
      pgaTemplateId = createResult.rows[0].id;
    }
  });

  afterEach(async () => {
    // Clean up: each test uses a unique organizerId (UUID), so no cleanup needed
    // ledger is append-only and has FK constraints that prevent deletion
    // The test data is isolated by organizerId and won't conflict with other tests
  });

  it('SHOULD initialize tournament_configs and field_selections when contest is published', async () => {
    // STEP 1: Create a GOLF/PGA contest instance
    const contestResult = await pool.query(
      `INSERT INTO contest_instances (
        id, template_id, organizer_id, entry_fee_cents, payout_structure,
        status, contest_name, provider_event_id, created_at
      )
      VALUES (
        gen_random_uuid(), $1, $2, 5000, '{}', 'SCHEDULED', 'Test PGA Contest', 'espn_pga_test_' || gen_random_uuid()::text, NOW()
      )
      RETURNING id`,
      [pgaTemplateId, organizerId]
    );
    const contestInstanceId = contestResult.rows[0].id;

    // STEP 2: Publish the contest
    const publishResult = await customContestService.publishContestInstance(
      pool,
      contestInstanceId,
      organizerId
    );

    expect(publishResult).toBeDefined();
    expect(publishResult.join_token).toBeDefined();

    // STEP 3: Assert tournament_configs was created
    const tourneyConfigsResult = await pool.query(
      `SELECT id, contest_instance_id, provider_event_id, field_source
       FROM tournament_configs
       WHERE contest_instance_id = $1`,
      [contestInstanceId]
    );

    expect(tourneyConfigsResult.rows.length).toBeGreaterThan(0);
    const tourneyConfig = tourneyConfigsResult.rows[0];
    expect(tourneyConfig.contest_instance_id).toBe(contestInstanceId);
    expect(tourneyConfig.provider_event_id).toBeDefined();
    expect(tourneyConfig.field_source).toMatch(/provider_sync|static_import/);

    // STEP 4: Assert field_selections was created
    const fieldSelectionsResult = await pool.query(
      `SELECT id, contest_instance_id, tournament_config_id, selection_json
       FROM field_selections
       WHERE contest_instance_id = $1`,
      [contestInstanceId]
    );

    expect(fieldSelectionsResult.rows.length).toBeGreaterThan(0);
    const fieldSelection = fieldSelectionsResult.rows[0];
    expect(fieldSelection.contest_instance_id).toBe(contestInstanceId);
    expect(fieldSelection.tournament_config_id).toBe(tourneyConfig.id);
    expect(fieldSelection.selection_json).toBeDefined();

    // STEP 5: Assert field_selections has the expected structure
    const selectionJson = fieldSelection.selection_json;
    expect(selectionJson).toBeDefined();
    expect(selectionJson.primary).toBeDefined();
    expect(Array.isArray(selectionJson.primary)).toBe(true);
  });

  it('SHOULD be idempotent: calling publishContestInstance twice creates tournament tables only once', async () => {
    // Create contest
    const contestResult = await pool.query(
      `INSERT INTO contest_instances (
        id, template_id, organizer_id, entry_fee_cents, payout_structure,
        status, contest_name, provider_event_id, created_at
      )
      VALUES (
        gen_random_uuid(), $1, $2, 5000, '{}', 'SCHEDULED', 'Test PGA Contest', 'espn_pga_test_' || gen_random_uuid()::text, NOW()
      )
      RETURNING id`,
      [pgaTemplateId, organizerId]
    );
    const contestInstanceId = contestResult.rows[0].id;

    // Publish once
    await customContestService.publishContestInstance(pool, contestInstanceId, organizerId);

    const countBefore = await pool.query(
      `SELECT COUNT(*)::int as cnt FROM tournament_configs WHERE contest_instance_id = $1`,
      [contestInstanceId]
    );

    // Publish again (idempotency check)
    await customContestService.publishContestInstance(pool, contestInstanceId, organizerId);

    const countAfter = await pool.query(
      `SELECT COUNT(*)::int as cnt FROM tournament_configs WHERE contest_instance_id = $1`,
      [contestInstanceId]
    );

    // Should not create duplicate rows
    expect(countBefore.rows[0].cnt).toBe(countAfter.rows[0].cnt);
  });
});
