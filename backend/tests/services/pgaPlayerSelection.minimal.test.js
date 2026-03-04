/**
 * PGA Player Selection Minimal Test
 *
 * This test reproduces the bug: getMyEntry returns available_players=null
 * because field_selections table is never populated for PGA contests.
 *
 * Schema facts (confirmed):
 * - users.id is UUID
 * - contest_instances.id is UUID, references template_id
 * - contest_templates exists with sport='GOLF'
 * - field_selections exists: (id, contest_instance_id, tournament_config_id, selection_json, created_at)
 * - entryRosterService.getMyEntry() queries field_selections by contest_instance_id
 *
 * Test Plan:
 * 1. Create PGA contest instance
 * 2. Add user as participant
 * 3. Call getMyEntry
 * 4. Assert available_players = null (current broken behavior)
 * 5. Manually create field_selections
 * 6. Assert available_players is populated (expected fixed behavior)
 */

'use strict';

const entryRosterService = require('../../services/entryRosterService');
const { getIntegrationApp } = require('../mocks/testAppFactory');
const { v4: uuidv4 } = require('uuid');

describe('Entry Roster Service — PGA Player Selection Bug', () => {
  let pool;
  let organizerId;
  let userId;
  let pgaTemplateId;

  beforeAll(async () => {
    const { pool: testPool } = getIntegrationApp();
    pool = testPool;
  });

  beforeEach(async () => {
    // Generate valid UUIDs
    organizerId = uuidv4();
    userId = uuidv4();

    // Ensure test users exist in DB
    await pool.query(
      `INSERT INTO users (id, username, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [organizerId, 'organizer-' + organizerId.slice(0, 8)]
    );

    await pool.query(
      `INSERT INTO users (id, username, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [userId, 'user-' + userId.slice(0, 8)]
    );

    // Get any existing GOLF template, or use first available
    const templateResult = await pool.query(
      `SELECT id FROM contest_templates WHERE sport = 'GOLF' LIMIT 1`
    );

    if (templateResult.rows.length > 0) {
      pgaTemplateId = templateResult.rows[0].id;
    } else {
      // Create minimal GOLF template if none exists
      const createResult = await pool.query(
        `INSERT INTO contest_templates (
          id, name, sport, template_type, scoring_strategy_key,
          lock_strategy_key, settlement_strategy_key,
          default_entry_fee_cents, allowed_entry_fee_min_cents,
          allowed_entry_fee_max_cents, allowed_payout_structures, created_at
        )
        VALUES (
          gen_random_uuid(),
          'Test GOLF Template',
          'GOLF',
          'pga',
          'pga_standard_v1',
          'lock_time',
          'settlement_pga_v1',
          5000, 1000, 50000,
          '[{"type":"winner_only"}]',
          NOW()
        )
        RETURNING id`,
        []
      );
      pgaTemplateId = createResult.rows[0].id;
    }
  });

  afterEach(async () => {
    // Clean up: delete contest instances and related data
    const instances = await pool.query(
      `SELECT id FROM contest_instances WHERE organizer_id = $1`,
      [organizerId]
    );

    for (const instance of instances.rows) {
      const instanceId = instance.id;
      await pool.query(
        'DELETE FROM field_selections WHERE contest_instance_id = $1',
        [instanceId]
      );
      await pool.query(
        'DELETE FROM entry_rosters WHERE contest_instance_id = $1',
        [instanceId]
      );
      await pool.query(
        'DELETE FROM contest_participants WHERE contest_instance_id = $1',
        [instanceId]
      );
      await pool.query(
        'DELETE FROM tournament_configs WHERE contest_instance_id = $1',
        [instanceId]
      );
    }

    await pool.query(
      'DELETE FROM contest_instances WHERE organizer_id = $1',
      [organizerId]
    );
  });

  it('should reproduce the bug: available_players is null when field_selections is empty', async () => {
    // Create a GOLF/PGA contest instance
    const contestResult = await pool.query(
      `INSERT INTO contest_instances (
        id, template_id, organizer_id, entry_fee_cents, payout_structure,
        status, contest_name, created_at
      )
      VALUES (
        gen_random_uuid(), $1, $2, 5000, '{}', 'SCHEDULED', 'Test PGA Contest', NOW()
      )
      RETURNING id`,
      [pgaTemplateId, organizerId]
    );
    const contestInstanceId = contestResult.rows[0].id;

    // Add user as participant
    await pool.query(
      `INSERT INTO contest_participants (contest_instance_id, user_id, joined_at)
       VALUES ($1, $2, NOW())`,
      [contestInstanceId, userId]
    );

    // Verify field_selections is empty for this contest
    const fieldSelectionsCheck = await pool.query(
      'SELECT COUNT(*)::int as cnt FROM field_selections WHERE contest_instance_id = $1',
      [contestInstanceId]
    );
    expect(fieldSelectionsCheck.rows[0].cnt).toBe(0);

    // Call the actual service
    const entry = await entryRosterService.getMyEntry(pool, contestInstanceId, userId);

    // BUG: available_players is null because field_selections is empty
    expect(entry.available_players).toBeNull();
    expect(entry.player_ids).toEqual([]);
    expect(entry.can_edit).toBe(true);
    expect(entry.lock_time).toBeNull();
  });

  it('should return populated available_players when field_selections exists', async () => {
    // Create a GOLF contest instance
    const contestResult = await pool.query(
      `INSERT INTO contest_instances (
        id, template_id, organizer_id, entry_fee_cents, payout_structure,
        status, contest_name, created_at
      )
      VALUES (
        gen_random_uuid(), $1, $2, 5000, '{}', 'SCHEDULED', 'Test PGA Contest', NOW()
      )
      RETURNING id`,
      [pgaTemplateId, organizerId]
    );
    const contestInstanceId = contestResult.rows[0].id;

    // Create tournament_configs entry (required by field_selections FK)
    const tourneyResult = await pool.query(
      `INSERT INTO tournament_configs (
        id, contest_instance_id, provider_event_id, ingestion_endpoint,
        event_start_date, event_end_date, round_count,
        leaderboard_schema_version, field_source, hash, published_at, is_active, created_at
      )
      VALUES (
        gen_random_uuid(), $1, 'espn-event-123', 'https://example.com/api',
        NOW(), NOW() + interval '7 days', 4,
        1, 'provider_sync', 'hash-abc123', NOW(), true, NOW()
      )
      RETURNING id`,
      [contestInstanceId]
    );
    const tourneyConfigId = tourneyResult.rows[0].id;

    // Create field_selections with golfer list
    const golferData = {
      primary: [
        { player_id: 'golfer-1', name: 'Player One' },
        { player_id: 'golfer-2', name: 'Player Two' },
        { player_id: 'golfer-3', name: 'Player Three' }
      ]
    };

    await pool.query(
      `INSERT INTO field_selections (
        id, contest_instance_id, tournament_config_id, selection_json, created_at
      )
      VALUES (
        gen_random_uuid(), $1, $2, $3, NOW()
      )`,
      [contestInstanceId, tourneyConfigId, JSON.stringify(golferData)]
    );

    // Add user as participant
    await pool.query(
      `INSERT INTO contest_participants (contest_instance_id, user_id, joined_at)
       VALUES ($1, $2, NOW())`,
      [contestInstanceId, userId]
    );

    // Call the service
    const entry = await entryRosterService.getMyEntry(pool, contestInstanceId, userId);

    // FIXED: available_players should be populated
    expect(entry.available_players).not.toBeNull();
    expect(Array.isArray(entry.available_players)).toBe(true);
    expect(entry.available_players).toHaveLength(3);

    // Verify structure matches contract
    const names = entry.available_players.map(p => p.name);
    expect(names).toContain('Player One');
    expect(names).toContain('Player Two');
    expect(names).toContain('Player Three');

    const playerIds = entry.available_players.map(p => p.player_id);
    expect(playerIds).toContain('golfer-1');
    expect(playerIds).toContain('golfer-2');
    expect(playerIds).toContain('golfer-3');
  });
});
