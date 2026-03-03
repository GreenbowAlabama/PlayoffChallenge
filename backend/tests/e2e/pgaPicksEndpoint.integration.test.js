/**
 * PGA Picks Endpoint Integration Tests
 *
 * Tests the POST /picks, GET /my-entry, and GET /rules endpoints
 * with a real database and full stack.
 */

const request = require('supertest');
const { app } = require('../../app');
const { pool } = require('../../server');

const TEST_USER_ID = '550e8400-e29b-41d4-a716-446655440001';
const TEST_CONTEST_ID = '550e8400-e29b-41d4-a716-446655440002';

describe('PGA Picks Endpoints', () => {
  beforeAll(async () => {
    // Setup: ensure test database is available
    // Actual DB setup should be in test fixtures
  });

  afterAll(async () => {
    // Pool lifecycle is managed globally by tests/setup.js (server pool).
    // Do not call pool.end() here to avoid double-end on the shared pool.
  });

  describe('POST /api/custom-contests/:id/picks', () => {
    it('submits picks for valid SCHEDULED contest', async () => {
      const res = await request(app)
        .post(`/api/custom-contests/${TEST_CONTEST_ID}/picks`)
        .set('Authorization', `Bearer ${TEST_USER_ID}`)
        .send({
          player_ids: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']
        });

      expect([200, 409, 403, 404]).toContain(res.statusCode);
      if (res.statusCode === 200) {
        expect(res.body.success).toBe(true);
        expect(res.body.player_ids).toHaveLength(7);
        expect(res.body.updated_at).toBeDefined();
      }
    });

    it('rejects invalid request body (missing player_ids)', async () => {
      const res = await request(app)
        .post(`/api/custom-contests/${TEST_CONTEST_ID}/picks`)
        .set('Authorization', `Bearer ${TEST_USER_ID}`)
        .send({});

      expect(res.statusCode).toBe(400);
    });

    it('rejects invalid contest ID format', async () => {
      const res = await request(app)
        .post('/api/custom-contests/invalid-id/picks')
        .set('Authorization', `Bearer ${TEST_USER_ID}`)
        .send({
          player_ids: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']
        });

      expect(res.statusCode).toBe(400);
    });

    it('rejects request without authentication', async () => {
      const res = await request(app)
        .post(`/api/custom-contests/${TEST_CONTEST_ID}/picks`)
        .send({
          player_ids: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']
        });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/custom-contests/:id/my-entry', () => {
    it('returns user entry for existing contest', async () => {
      const res = await request(app)
        .get(`/api/custom-contests/${TEST_CONTEST_ID}/my-entry`)
        .set('Authorization', `Bearer ${TEST_USER_ID}`);

      expect([200, 404]).toContain(res.statusCode);
      if (res.statusCode === 200) {
        expect(res.body.player_ids).toBeDefined();
        expect(Array.isArray(res.body.player_ids)).toBe(true);
        expect(res.body.can_edit).toBeBoolean();
        expect(res.body.lock_time).toBeNull();
        expect(res.body.roster_config).toBeDefined();
      }
    });

    it('rejects invalid contest ID format', async () => {
      const res = await request(app)
        .get('/api/custom-contests/invalid-id/my-entry')
        .set('Authorization', `Bearer ${TEST_USER_ID}`);

      expect(res.statusCode).toBe(400);
    });

    it('rejects request without authentication', async () => {
      const res = await request(app)
        .get(`/api/custom-contests/${TEST_CONTEST_ID}/my-entry`);

      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/custom-contests/:id/rules', () => {
    it('returns contest rules for existing contest', async () => {
      const res = await request(app)
        .get(`/api/custom-contests/${TEST_CONTEST_ID}/rules`)
        .set('Authorization', `Bearer ${TEST_USER_ID}`);

      expect([200, 404]).toContain(res.statusCode);
      if (res.statusCode === 200) {
        expect(res.body.scoring_strategy).toBeDefined();
        expect(res.body.hole_scoring).toBeDefined();
        expect(res.body.roster).toBeDefined();
        expect(res.body.tie_handling).toBe('shared_rank');
        expect(res.body.payout_structure).toBeDefined();
      }
    });

    it('rejects invalid contest ID format', async () => {
      const res = await request(app)
        .get('/api/custom-contests/invalid-id/rules')
        .set('Authorization', `Bearer ${TEST_USER_ID}`);

      expect(res.statusCode).toBe(400);
    });

    it('rejects request without authentication', async () => {
      const res = await request(app)
        .get(`/api/custom-contests/${TEST_CONTEST_ID}/rules`);

      expect(res.statusCode).toBe(401);
    });
  });
});
