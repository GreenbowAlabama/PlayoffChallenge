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
  });
});
