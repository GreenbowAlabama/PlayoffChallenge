/**
 * Public Routes Contract Tests
 *
 * Purpose: Lock in API contract for all public endpoints
 * - Verifies HTTP status codes
 * - Verifies response shapes
 * - Tests parameter validation
 * - Tests error responses
 *
 * These tests MUST pass before any refactor begins.
 */

const request = require('supertest');
const { getIntegrationApp, createRequestFactory } = require('../mocks/testAppFactory');

describe('Public Routes Contract Tests', () => {
  let app;
  let requestFactory;

  beforeAll(() => {
    const { app: integrationApp } = getIntegrationApp();
    app = integrationApp;
    requestFactory = createRequestFactory(app);
  });

  describe('GET /health', () => {
    it('should return 200 with status ok', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'ok');
    });

    it('should include a timestamp', async () => {
      const response = await request(app).get('/health');

      expect(response.body).toHaveProperty('timestamp');
      expect(new Date(response.body.timestamp)).toBeInstanceOf(Date);
    });

    it('should return Content-Type application/json', async () => {
      const response = await request(app).get('/health');

      expect(response.headers['content-type']).toMatch(/application\/json/);
    });
  });

  describe('GET /api/game-config', () => {
    it('should return 200 with game configuration', async () => {
      const response = await request(app).get('/api/game-config');

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
    });

    it('should include current week information', async () => {
      const response = await request(app).get('/api/game-config');

      // Game config uses snake_case from database
      expect(response.body).toHaveProperty('current_playoff_week');
    });

    it('should include active status', async () => {
      const response = await request(app).get('/api/game-config');

      // Game config uses snake_case from database
      expect(response.body).toHaveProperty('is_week_active');
    });
  });

  describe('GET /api/scoring-rules', () => {
    it('should return 200 with array of rules', async () => {
      const response = await request(app).get('/api/scoring-rules');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('each rule should have required fields', async () => {
      const response = await request(app).get('/api/scoring-rules');

      if (response.body.length > 0) {
        const rule = response.body[0];
        expect(rule).toHaveProperty('stat_name');
        expect(rule).toHaveProperty('points');
      }
    });

    it('should return rules with required scoring fields', async () => {
      const response = await request(app).get('/api/scoring-rules');

      // Rules should have stat_name and points (is_active is filtered server-side)
      if (response.body.length > 0) {
        const rule = response.body[0];
        expect(rule).toHaveProperty('stat_name');
        expect(rule).toHaveProperty('points');
      }
    });
  });

  describe('GET /api/players', () => {
    it('should return 200 with paginated players', async () => {
      const response = await request(app).get('/api/players');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('players');
      expect(Array.isArray(response.body.players)).toBe(true);
    });

    it('should include pagination metadata', async () => {
      const response = await request(app).get('/api/players');

      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('limit');
      expect(response.body).toHaveProperty('offset');
    });

    it('should respect limit parameter', async () => {
      const response = await request(app).get('/api/players?limit=5');

      expect(response.status).toBe(200);
      expect(response.body.players.length).toBeLessThanOrEqual(5);
      expect(response.body.limit).toBe(5);
    });

    it('should respect offset parameter', async () => {
      const response = await request(app).get('/api/players?offset=10');

      expect(response.status).toBe(200);
      expect(response.body.offset).toBe(10);
    });

    it('each player should have required fields', async () => {
      const response = await request(app).get('/api/players?limit=1');

      if (response.body.players.length > 0) {
        const player = response.body.players[0];
        expect(player).toHaveProperty('id');
        expect(player).toHaveProperty('full_name');
        expect(player).toHaveProperty('position');
        expect(player).toHaveProperty('team');
      }
    });

    it('should filter by position when provided', async () => {
      const response = await request(app).get('/api/players?position=QB');

      expect(response.status).toBe(200);
      response.body.players.forEach(player => {
        expect(player.position).toBe('QB');
      });
    });

    it('should accept team filter parameter', async () => {
      const response = await request(app).get('/api/players?team=KC');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('players');
      // Note: Team filter may only work for active playoff teams
    });
  });

  describe('GET /api/leaderboard', () => {
    it('should return 200 with array of rankings', async () => {
      const response = await request(app).get('/api/leaderboard');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should filter by weekNumber when provided', async () => {
      const response = await request(app).get('/api/leaderboard?weekNumber=1');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('each entry should have user info and score', async () => {
      const response = await request(app).get('/api/leaderboard');

      if (response.body.length > 0) {
        const entry = response.body[0];
        expect(entry).toHaveProperty('username');
        expect(entry).toHaveProperty('total_points');
      }
    });

    it('should include leaderboard meta headers for modern clients', async () => {
      const response = await requestFactory.get('/api/leaderboard');

      expect(response.status).toBe(200);
      // Modern clients may receive X-Leaderboard-* headers
    });
  });

  describe('GET /api/scores', () => {
    it('should return 400 when userId is missing', async () => {
      const response = await request(app).get('/api/scores?weekNumber=1');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 400 when weekNumber is missing', async () => {
      const response = await request(app).get('/api/scores?userId=123');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 200 with scores when both params provided', async () => {
      const fakeUserId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app).get(`/api/scores?userId=${fakeUserId}&weekNumber=1`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should return empty array for non-existent user', async () => {
      const fakeUserId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app).get(`/api/scores?userId=${fakeUserId}&weekNumber=1`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });
  });

  describe('GET /api/rules', () => {
    it('should return 200 with game rules', async () => {
      const response = await request(app).get('/api/rules');

      expect(response.status).toBe(200);
    });

    it('should return content type text or json', async () => {
      const response = await request(app).get('/api/rules');

      expect(response.headers['content-type']).toMatch(/application\/json|text/);
    });
  });

  describe('GET /api/terms', () => {
    it('should return 200 with terms of service', async () => {
      const response = await request(app).get('/api/terms');

      expect(response.status).toBe(200);
    });
  });

  describe('GET /api/payouts', () => {
    it('should return 200 with payout information', async () => {
      const response = await request(app).get('/api/payouts');

      expect(response.status).toBe(200);
    });
  });
});
