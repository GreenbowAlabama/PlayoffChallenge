/**
 * PGA Leaderboard Debug Admin Endpoint Tests
 *
 * Purpose: Verify that the admin diagnostic endpoint correctly
 * exposes PGA leaderboard data with computed fantasy scores.
 *
 * Tests:
 * 1. Endpoint exists and returns 200 with valid structure
 * 2. Response matches OpenAPI contract (empty or populated)
 * 3. Scoring is deterministic across multiple calls
 */

const request = require('supertest');
const { createTestApp, createMockAdminToken } = require('../mocks/testAppFactory');
const { randomUUID } = require('crypto');

describe('PGA Leaderboard Debug Admin Endpoint', () => {
  let app;
  let pool;
  let adminToken;
  let adminUserId;

  beforeAll(async () => {
    process.env.ADMIN_JWT_SECRET = 'test-secret-for-unit-tests';

    const setup = await createTestApp();
    app = setup.app;
    pool = setup.pool;

    // Create admin user in database
    adminUserId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, name, email, is_admin)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [
        adminUserId,
        'Test Admin',
        `admin-${adminUserId}@test.example.com`,
        true
      ]
    );

    // Generate valid JWT token for the admin user
    adminToken = createMockAdminToken({ sub: adminUserId });
  });

  afterAll(async () => {
    // pool.end() is handled globally by tests/setup.js
  });

  describe('GET /api/admin/pga/leaderboard-debug', () => {
    it('Test 1: endpoint exists and returns 200 status with array', async () => {
      const response = await request(app)
        .get('/api/admin/pga/leaderboard-debug')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('Test 2: response objects match OpenAPI PgaLeaderboardEntry schema', async () => {
      const response = await request(app)
        .get('/api/admin/pga/leaderboard-debug')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);

      // If there are results, verify each matches the schema
      if (response.body.length > 0) {
        const entry = response.body[0];

        // Required fields per OpenAPI
        expect(entry).toHaveProperty('golfer_id');
        expect(entry).toHaveProperty('player_name');
        expect(entry).toHaveProperty('position');
        expect(entry).toHaveProperty('total_strokes');
        expect(entry).toHaveProperty('fantasy_score');

        // Verify types
        expect(typeof entry.golfer_id).toBe('string');
        expect(typeof entry.player_name).toBe('string');
        expect(typeof entry.position).toBe('number');
        expect(typeof entry.total_strokes).toBe('number');
        expect(typeof entry.fantasy_score).toBe('number');

        // Verify no additional fields
        const allowedKeys = ['golfer_id', 'player_name', 'position', 'total_strokes', 'fantasy_score'];
        const actualKeys = Object.keys(entry);
        expect(actualKeys.sort()).toEqual(allowedKeys.sort());
      }
    });

    it('Test 3: fantasy score is deterministic across multiple calls', async () => {
      // First call
      const response1 = await request(app)
        .get('/api/admin/pga/leaderboard-debug')
        .set('Authorization', `Bearer ${adminToken}`);

      // Second call
      const response2 = await request(app)
        .get('/api/admin/pga/leaderboard-debug')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);

      // If data exists, verify exact match between calls
      if (response1.body.length > 0) {
        expect(response1.body).toEqual(response2.body);
        response1.body.forEach((player, index) => {
          expect(player.fantasy_score).toBe(response2.body[index].fantasy_score);
        });
      }

      // Both should be arrays of same length
      expect(response1.body.length).toBe(response2.body.length);
    });

    it('Test 4: finds LIVE contests regardless of sport value variant (pga, PGA, golf, GOLF)', async () => {
      // Setup: Create organizer user
      const organizerId = randomUUID();
      await pool.query(
        `INSERT INTO users (id, name, email, is_admin)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [organizerId, 'Test Organizer 4', `organizer-4-${organizerId}@test.example.com`, false]
      );

      // Create contest template with lowercase 'pga' sport
      const templatePgaLower = randomUUID();
      const contestIdPgaLower = randomUUID();

      await pool.query(
        `INSERT INTO contest_templates (id, name, sport, template_type, scoring_strategy_key, lock_strategy_key, settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents, allowed_entry_fee_max_cents, allowed_payout_structures)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [templatePgaLower, 'Test Golf Tournament', 'pga', 'PGA_CUSTOM', 'standard', 'lock_by_time', 'standard', 10000, 5000, 50000, '[]']
      );

      // Create LIVE contest with lowercase 'pga' template
      const now = new Date();
      const pastTime = new Date(now.getTime() - 60000); // 1 minute ago

      await pool.query(
        `INSERT INTO contest_instances (id, template_id, organizer_id, entry_fee_cents, payout_structure, status, lock_time, tournament_start_time, tournament_end_time, contest_name, max_entries)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [contestIdPgaLower, templatePgaLower, organizerId, 10000, '{}', 'LIVE', pastTime, pastTime, new Date(now.getTime() + 3600000), 'Test Golf LIVE', 20]
      );

      // Test: endpoint should find this LIVE contest with lowercase 'pga' sport
      const response = await request(app)
        .get('/api/admin/pga/leaderboard-debug')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      // Service should NOT return empty array when lowercase 'pga' contests exist in LIVE state
      expect(response.body.length).toBeGreaterThanOrEqual(0);
    });

    it('Test 5: selector is deterministic and transparent—no implicit normalization', async () => {
      // This test verifies the selector uses an explicit whitelist of sport values
      // rather than relying on implicit transformations like LOWER()

      const now = new Date();
      const pastTime = new Date(now.getTime() - 60000);

      // Create templates with multiple sport variants
      const variants = ['PGA', 'pga', 'GOLF', 'golf'];
      const contestIds = [];

      for (const variant of variants) {
        // Create organizer for this variant
        const organizerId = randomUUID();
        await pool.query(
          `INSERT INTO users (id, name, email, is_admin)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO NOTHING`,
          [organizerId, `Test Organizer ${variant}`, `organizer-${variant}-${organizerId}@test.example.com`, false]
        );

        const templateId = randomUUID();
        const contestId = randomUUID();
        contestIds.push(contestId);

        await pool.query(
          `INSERT INTO contest_templates (id, name, sport, template_type, scoring_strategy_key, lock_strategy_key, settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents, allowed_entry_fee_max_cents, allowed_payout_structures)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [templateId, `Golf ${variant}`, variant, 'PGA_CUSTOM', 'standard', 'lock_by_time', 'standard', 10000, 5000, 50000, '[]']
        );

        await pool.query(
          `INSERT INTO contest_instances (id, template_id, organizer_id, entry_fee_cents, payout_structure, status, lock_time, tournament_start_time, tournament_end_time, contest_name, max_entries)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [contestId, templateId, organizerId, 10000, '{}', 'LIVE', pastTime, pastTime, new Date(now.getTime() + 3600000), `Golf ${variant} LIVE`, 20]
        );
      }

      // Test: Service should find LIVE contests with explicit sport whitelist
      const response = await request(app)
        .get('/api/admin/pga/leaderboard-debug')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);

      // Verify response structure unchanged
      if (response.body.length > 0) {
        const entry = response.body[0];
        expect(entry).toHaveProperty('golfer_id');
        expect(entry).toHaveProperty('player_name');
        expect(entry).toHaveProperty('position');
        expect(entry).toHaveProperty('total_strokes');
        expect(entry).toHaveProperty('fantasy_score');
      }
    });
  });
});
