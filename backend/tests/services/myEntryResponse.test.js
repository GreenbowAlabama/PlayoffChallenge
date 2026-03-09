/**
 * Test: MyEntry Response Contract
 *
 * Verifies that GET /api/custom-contests/:id/my-entry returns available_players
 * with complete player information including player_id, name, and image_url.
 *
 * OpenAPI Contract: available_players must be an array of:
 * {
 *   player_id: string (required)
 *   name: string (required)
 *   image_url: string | null (optional)
 * }
 *
 * Invariant: No placeholder "Unknown" players without identifiers.
 */

const { Pool } = require('pg');
const { v4: uuid } = require('uuid');
const entryRosterService = require('../../services/entryRosterService');

describe('MyEntry Response Contract', () => {
  let pool;
  let testUserId;
  let testContestId;
  let testTemplateId;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL_TEST || process.env.DATABASE_URL,
      statement_timeout: 10000
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    testUserId = uuid();
    testContestId = uuid();
    testTemplateId = uuid();

    const client = await pool.connect();
    try {
      // Create test user (organizer)
      await client.query(
        `INSERT INTO users (id, email, created_at, updated_at)
         VALUES ($1, $2, now(), now())
         ON CONFLICT DO NOTHING`,
        [testUserId, `test-${testUserId.substring(0, 8)}@example.com`]
      );

      // Insert test template (golf/PGA) with all required fields
      // Use unique template_type to avoid constraint conflicts
      const uniqueTemplateType = `test_playoff_${testContestId.substring(0, 8)}`;
      await client.query(
        `INSERT INTO contest_templates (
          id, name, sport, template_type, scoring_strategy_key, lock_strategy_key,
          settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
          allowed_entry_fee_max_cents, allowed_payout_structures, is_active,
          created_at, updated_at
         ) VALUES (
          $1, $2, 'golf', $4, 'pga_standard_v1', 'time_based_lock_v1',
          'pga_standard_v1', 10000, 0, 1000000, $3::jsonb, true, now(), now()
         )`,
        [testTemplateId, 'Test Golf Template', JSON.stringify([{ '1': 60, '2': 40 }]), uniqueTemplateType]
      );

      // Create test contest instance
      await client.query(
        `INSERT INTO contest_instances (
          id, template_id, organizer_id, status, entry_fee_cents,
          payout_structure, contest_name, created_at, updated_at
         ) VALUES (
          $1, $2, $3, 'SCHEDULED', 5000, $4::jsonb, 'Test Contest', now(), now()
         )`,
        [testContestId, testTemplateId, testUserId, JSON.stringify({ type: 'standard' })]
      );

      // Add user as participant
      await client.query(
        `INSERT INTO contest_participants (contest_instance_id, user_id, joined_at)
         VALUES ($1, $2, now())`,
        [testContestId, testUserId]
      );
    } finally {
      client.release();
    }
  });

  afterEach(async () => {
    const client = await pool.connect();
    try {
      await client.query(
        `DELETE FROM contest_participants WHERE contest_instance_id = $1`,
        [testContestId]
      );
      await client.query(
        `DELETE FROM entry_rosters WHERE contest_instance_id = $1`,
        [testContestId]
      );
      await client.query(
        `DELETE FROM field_selections WHERE contest_instance_id = $1`,
        [testContestId]
      );
      await client.query(
        `DELETE FROM contest_instances WHERE id = $1`,
        [testContestId]
      );
    } finally {
      client.release();
    }
  });

  describe('available_players field', () => {
    it('should include player_id for each returned player (if any)', async () => {
      // Call getMyEntry
      const result = await entryRosterService.getMyEntry(pool, testContestId, testUserId);

      // Verify available_players is present and is an array or null (per OpenAPI)
      expect(result.available_players).toBeDefined();

      // CONTRACT REQUIREMENT: available_players must be an array (not null)
      // Even if empty, it should be an array []
      expect(Array.isArray(result.available_players)).toBe(true);

      // Verify each player has player_id (if any players are returned)
      if (result.available_players && result.available_players.length > 0) {
        result.available_players.forEach((player, index) => {
          expect(player.player_id).toBeDefined(`Player ${index} missing player_id`);
          expect(typeof player.player_id).toBe('string');
          expect(player.player_id.length).toBeGreaterThan(0);
        });
      }
    });

    it('should not return placeholder "Unknown" players without identifiers', async () => {
      const result = await entryRosterService.getMyEntry(pool, testContestId, testUserId);

      if (result.available_players) {
        result.available_players.forEach((player) => {
          // If name is "Unknown", player_id must be set
          if (player.name === 'Unknown') {
            expect(player.player_id).toBeDefined();
            expect(player.player_id.length).toBeGreaterThan(0);
          }
        });
      }
    });

    it('should match OpenAPI contract: { player_id, name, image_url? }', async () => {
      const result = await entryRosterService.getMyEntry(pool, testContestId, testUserId);

      expect(result).toHaveProperty('available_players');

      if (result.available_players && result.available_players.length > 0) {
        result.available_players.forEach((player) => {
          // Required fields
          expect(player).toHaveProperty('player_id');
          expect(typeof player.player_id).toBe('string');

          expect(player).toHaveProperty('name');
          expect(typeof player.name).toBe('string');

          // Optional field
          if (player.image_url !== null && player.image_url !== undefined) {
            expect(typeof player.image_url).toBe('string');
          }
        });
      }
    });

    it('should return available_players array (empty or with valid structure)', async () => {
      // Call getMyEntry (no field_selections set, should use players table or return null)
      const result = await entryRosterService.getMyEntry(pool, testContestId, testUserId);

      expect(result).toHaveProperty('available_players');
      expect(result.available_players === null || Array.isArray(result.available_players)).toBe(true);

      // If players are present, verify structure
      if (result.available_players && Array.isArray(result.available_players)) {
        result.available_players.forEach((player) => {
          expect(player).toHaveProperty('player_id');
          expect(player).toHaveProperty('name');
        });
      }
    });
  });
});
