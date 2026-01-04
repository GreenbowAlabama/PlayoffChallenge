/**
 * API Behavior Tests
 *
 * Purpose: Golden-path tests for core API endpoints
 * - Health endpoint responds
 * - Authenticated endpoints work
 * - Admin-protected endpoints reject unauthenticated access
 * - Read-only endpoints return data
 */

const request = require('supertest');
const { app, pool } = require('../server');

describe('API Behavior Tests', () => {
  // Pool cleanup is handled globally in setup.js

  describe('Public Endpoints', () => {
    it('GET /health should return status ok', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
    });

    it('GET /api/game-config should return game settings', async () => {
      const response = await request(app).get('/api/game-config');

      expect(response.status).toBe(200);
      // Should have basic game config structure
      expect(response.body).toBeDefined();
    });

    it('GET /api/scoring-rules should return scoring rules', async () => {
      const response = await request(app).get('/api/scoring-rules');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('GET /api/players should return players data', async () => {
      const response = await request(app).get('/api/players');

      expect(response.status).toBe(200);
      // API returns { players: [], total, limit, offset }
      expect(response.body).toHaveProperty('players');
      expect(Array.isArray(response.body.players)).toBe(true);
    });
  });

  describe('Leaderboard Endpoint', () => {
    it('GET /api/leaderboard should return leaderboard data', async () => {
      const response = await request(app).get('/api/leaderboard');

      expect(response.status).toBe(200);
      // Leaderboard returns an array of user rankings
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('GET /api/leaderboard with weekNumber should filter by week', async () => {
      const response = await request(app).get('/api/leaderboard?weekNumber=1');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('Scores Endpoint', () => {
    it('GET /api/scores without required params should return 400', async () => {
      const response = await request(app).get('/api/scores');

      // Endpoint requires userId and weekNumber
      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('GET /api/scores with required params should work', async () => {
      // Use a fake but valid UUID format
      const fakeUserId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app).get(`/api/scores?userId=${fakeUserId}&weekNumber=1`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('Admin Protected Endpoints', () => {
    it('POST /api/admin/update-week-status should reject unauthenticated requests', async () => {
      const response = await request(app)
        .post('/api/admin/update-week-status')
        .send({ is_week_active: true });

      // Should be 401 Unauthorized or 403 Forbidden
      expect([401, 403]).toContain(response.status);
    });

    it('POST /api/admin/sync-espn-ids should reject unauthenticated requests', async () => {
      const response = await request(app)
        .post('/api/admin/sync-espn-ids');

      expect([401, 403]).toContain(response.status);
    });

    it('GET /api/admin/cache-status should reject unauthenticated requests', async () => {
      const response = await request(app)
        .get('/api/admin/cache-status');

      expect([401, 403]).toContain(response.status);
    });

    it('POST /api/admin/update-live-stats should reject unauthenticated requests', async () => {
      const response = await request(app)
        .post('/api/admin/update-live-stats');

      expect([401, 403]).toContain(response.status);
    });
  });

  describe('Auth Endpoints', () => {
    it('POST /api/auth/login with invalid credentials should return 401', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@test.com',
          password: 'wrongpassword'
        });

      expect([400, 401]).toContain(response.status);
    });

    it('POST /api/auth/register with missing fields should return error', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'incomplete@test.com'
          // Missing password and other required fields
        });

      expect([400, 500]).toContain(response.status);
    });
  });

  describe('User Endpoints', () => {
    it('GET /api/users/:userId with non-existent user should handle gracefully', async () => {
      const fakeUserId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app).get(`/api/users/${fakeUserId}`);

      // Should return 404 or empty result, not 500
      expect([200, 404]).toContain(response.status);
    });

    it('GET /api/picks/:userId with non-existent user should return empty array', async () => {
      const fakeUserId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app).get(`/api/picks/${fakeUserId}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(0);
    });
  });
});
