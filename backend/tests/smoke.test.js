/**
 * Smoke Tests
 *
 * Purpose: Verify server boots without crashing
 * - Express app initializes
 * - Database connection is reachable
 * - No uncaught exceptions on startup
 */

const request = require('supertest');
const { app, pool } = require('../server');

describe('Smoke Tests', () => {
  // Pool cleanup is handled globally in setup.js

  describe('Server Boot', () => {
    it('should have a valid Express app instance', () => {
      expect(app).toBeDefined();
      expect(typeof app.listen).toBe('function');
      expect(typeof app.get).toBe('function');
      expect(typeof app.post).toBe('function');
    });

    it('should have a valid database pool instance', () => {
      expect(pool).toBeDefined();
      expect(typeof pool.query).toBe('function');
    });
  });

  describe('Database Connection', () => {
    it('should connect to the database successfully', async () => {
      const result = await pool.query('SELECT 1 as test');
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].test).toBe(1);
    });

    it('should have access to required tables', async () => {
      // Verify critical tables exist
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
    it('GET /health should respond with 200 and status ok', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
    });
  });
});
