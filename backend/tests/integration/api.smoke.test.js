/**
 * API Smoke Test
 *
 * Purpose: End-to-end validation that the system works as a whole
 * - Server boots successfully
 * - Database connection is established
 * - Health endpoint responds
 * - One read path works end-to-end
 * - One authenticated path rejects properly
 *
 * Run this test first after any infrastructure change.
 */

const request = require('supertest');
const { getIntegrationApp } = require('../mocks/testAppFactory');

describe('API Smoke Tests', () => {
  let app;
  let pool;

  beforeAll(() => {
    const integration = getIntegrationApp();
    app = integration.app;
    pool = integration.pool;
  });

  describe('Server Boot', () => {
    it('should have a valid Express app', () => {
      expect(app).toBeDefined();
      expect(typeof app.listen).toBe('function');
      expect(typeof app.get).toBe('function');
      expect(typeof app.post).toBe('function');
    });

    it('should have a valid database pool', () => {
      expect(pool).toBeDefined();
      expect(typeof pool.query).toBe('function');
    });
  });

  describe('Database Connection', () => {
    it('should connect successfully', async () => {
      const result = await pool.query('SELECT 1 as connected');

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].connected).toBe(1);
    });

    it('should have critical tables', async () => {
      const tables = ['users', 'players', 'picks', 'scores', 'scoring_rules', 'game_settings'];

      for (const table of tables) {
        const result = await pool.query(
          `SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = $1
          )`,
          [table]
        );
        expect(result.rows[0].exists).toBe(true);
      }
    });
  });

  describe('Health Endpoint', () => {
    it('GET /health should respond 200', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
    });

    it('should return status ok', async () => {
      const response = await request(app).get('/health');

      expect(response.body.status).toBe('ok');
    });

    it('should include timestamp', async () => {
      const response = await request(app).get('/health');

      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('Universal Links (iOS)', () => {
    it('GET /.well-known/apple-app-site-association should return AASA JSON', async () => {
      const response = await request(app).get('/.well-known/apple-app-site-association');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.body).toHaveProperty('applinks');
      expect(response.body.applinks).toHaveProperty('details');
      expect(response.body.applinks.details[0]).toHaveProperty('appID');
      expect(response.body.applinks.details[0]).toHaveProperty('paths');
      expect(response.body.applinks.details[0].paths).toContain('/join/*');
    });

    it('GET /join/:token should redirect to App Store', async () => {
      const response = await request(app).get('/join/test-token-123');

      expect(response.status).toBe(302);
      expect(response.headers.location).toMatch(/apps\.apple\.com/);
    });
  });

  describe('Read Path (End-to-End)', () => {
    it('GET /api/players should return data', async () => {
      const response = await request(app).get('/api/players?limit=1');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('players');
    });

    it('GET /api/scoring-rules should return rules', async () => {
      const response = await request(app).get('/api/scoring-rules');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('GET /api/game-config should return config', async () => {
      const response = await request(app).get('/api/game-config');

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
    });
  });

  describe('Auth Protection', () => {
    it('admin routes should reject unauthenticated requests', async () => {
      const response = await request(app).get('/api/admin/cache-status');

      expect([401, 403]).toContain(response.status);
    });

    it('should return JSON error for auth failures', async () => {
      const response = await request(app).get('/api/admin/cache-status');

      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid routes gracefully', async () => {
      const response = await request(app).get('/api/nonexistent');

      expect([404, 500]).toContain(response.status);
    });

    it('should handle malformed JSON gracefully', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('{ invalid json }');

      expect([400, 500]).toContain(response.status);
    });
  });

  describe('Response Format', () => {
    it('should return JSON for API endpoints', async () => {
      const response = await request(app).get('/api/game-config');

      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    it('should support CORS', async () => {
      const response = await request(app)
        .options('/api/players')
        .set('Origin', 'http://localhost:3000');

      // CORS headers should be present
      expect(response.headers).toHaveProperty('access-control-allow-origin');
    });
  });
});
