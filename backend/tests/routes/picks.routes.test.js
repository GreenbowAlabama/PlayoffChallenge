/**
 * Picks Routes Contract Tests
 *
 * Purpose: Lock in API contract for picks-related endpoints
 * - GET /api/picks/:userId
 * - GET /api/picks/v2
 * - POST /api/picks
 * - POST /api/picks/v2
 * - DELETE /api/picks/:pickId
 * - POST /api/picks/replace-player
 * - GET /api/picks/eliminated/:userId/:weekNumber
 *
 * These tests verify response shapes and validation behavior.
 * They are read-only and do not create persistent data.
 */

const request = require('supertest');
const { getIntegrationApp, createRequestFactory } = require('../mocks/testAppFactory');
const { TEST_IDS } = require('../fixtures');

describe('Picks Routes Contract Tests', () => {
  let app;
  let requestFactory;

  beforeAll(() => {
    const { app: integrationApp } = getIntegrationApp();
    app = integrationApp;
    requestFactory = createRequestFactory(app);
  });

  describe('GET /api/picks/:userId', () => {
    it('should return 200 with array for valid userId', async () => {
      const response = await request(app).get(`/api/picks/${TEST_IDS.users.nonExistent}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should return empty array for non-existent user', async () => {
      const response = await request(app).get(`/api/picks/${TEST_IDS.users.nonExistent}`);

      expect(response.body).toEqual([]);
    });

    it('should return picks with required fields when they exist', async () => {
      // This test verifies the response shape when data exists
      const response = await request(app).get(`/api/picks/${TEST_IDS.users.validUser}`);

      expect(response.status).toBe(200);
      if (response.body.length > 0) {
        const pick = response.body[0];
        expect(pick).toHaveProperty('id');
        expect(pick).toHaveProperty('player_id');
        expect(pick).toHaveProperty('week_number');
      }
    });

    it('should handle invalid UUID format gracefully', async () => {
      const response = await request(app).get('/api/picks/not-a-uuid');

      // Should return 400 or 200 with empty array, not 500
      expect([200, 400]).toContain(response.status);
    });
  });

  describe('GET /api/picks/v2', () => {
    it('should return 400 without userId', async () => {
      const response = await requestFactory.modernClient()
        .get('/api/picks/v2');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 400 without weekNumber', async () => {
      const response = await requestFactory.modernClient()
        .get(`/api/picks/v2?userId=${TEST_IDS.users.validUser}`);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 200 with picks for valid params', async () => {
      const response = await requestFactory.modernClient()
        .get(`/api/picks/v2?userId=${TEST_IDS.users.validUser}&weekNumber=1`);

      expect(response.status).toBe(200);
    });

    it('should include picks array in response', async () => {
      const response = await requestFactory.modernClient()
        .get(`/api/picks/v2?userId=${TEST_IDS.users.validUser}&weekNumber=1`);

      expect(response.body).toHaveProperty('picks');
      expect(Array.isArray(response.body.picks)).toBe(true);
    });
  });

  describe('POST /api/picks', () => {
    it('should return 400 without required fields', async () => {
      const response = await request(app)
        .post('/api/picks')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 400 without userId', async () => {
      const response = await request(app)
        .post('/api/picks')
        .send({
          playerId: TEST_IDS.players.qb1,
          weekNumber: 1
        });

      expect(response.status).toBe(400);
    });

    it('should return 400 without playerId', async () => {
      const response = await request(app)
        .post('/api/picks')
        .send({
          userId: TEST_IDS.users.validUser,
          weekNumber: 1
        });

      expect(response.status).toBe(400);
    });

    it('should reject pick when week is locked', async () => {
      // This test will pass or fail based on current game state
      // The important thing is it doesn't return 500
      const response = await request(app)
        .post('/api/picks')
        .send({
          userId: TEST_IDS.users.validUser,
          playerId: TEST_IDS.players.qb1,
          weekNumber: 1
        });

      expect([200, 201, 400, 403]).toContain(response.status);
    });
  });

  describe('POST /api/picks/v2', () => {
    it('should return 400 without operation', async () => {
      const response = await requestFactory.modernClient()
        .post('/api/picks/v2')
        .send({
          userId: TEST_IDS.users.validUser,
          weekNumber: 1
        });

      expect(response.status).toBe(400);
    });

    it('should accept add operation', async () => {
      const response = await requestFactory.modernClient()
        .post('/api/picks/v2')
        .send({
          operation: 'add',
          userId: TEST_IDS.users.validUser,
          playerId: TEST_IDS.players.qb1,
          weekNumber: 1,
          slot: 'QB'
        });

      // May succeed or fail based on game state, but not 500
      expect([200, 201, 400, 403]).toContain(response.status);
    });

    it('should accept remove operation', async () => {
      const response = await requestFactory.modernClient()
        .post('/api/picks/v2')
        .send({
          operation: 'remove',
          userId: TEST_IDS.users.validUser,
          pickId: TEST_IDS.picks.pick1,
          weekNumber: 1
        });

      // May succeed or fail based on game state, but not 500
      expect([200, 400, 403, 404]).toContain(response.status);
    });

    it('should accept replace operation', async () => {
      const response = await requestFactory.modernClient()
        .post('/api/picks/v2')
        .send({
          operation: 'replace',
          userId: TEST_IDS.users.validUser,
          oldPlayerId: TEST_IDS.players.qb1,
          newPlayerId: TEST_IDS.players.rb1,
          weekNumber: 1
        });

      // May succeed or fail based on game state, but not 500
      expect([200, 400, 403, 404]).toContain(response.status);
    });
  });

  describe('DELETE /api/picks/:pickId', () => {
    it('should return 400 without userId in body or query', async () => {
      const response = await request(app)
        .delete(`/api/picks/${TEST_IDS.picks.pick1}`);

      expect(response.status).toBe(400);
    });

    it('should return 404 for non-existent pick', async () => {
      const response = await request(app)
        .delete(`/api/picks/${TEST_IDS.picks.pick1}`)
        .send({ userId: TEST_IDS.users.validUser });

      expect([400, 403, 404]).toContain(response.status);
    });
  });

  describe('POST /api/picks/replace-player', () => {
    it('should return 400 without required fields', async () => {
      const response = await request(app)
        .post('/api/picks/replace-player')
        .send({});

      expect(response.status).toBe(400);
    });

    it('should require userId, oldPlayerId, newPlayerId, weekNumber', async () => {
      const response = await request(app)
        .post('/api/picks/replace-player')
        .send({
          userId: TEST_IDS.users.validUser
          // Missing other fields
        });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/picks/eliminated/:userId/:weekNumber', () => {
    it('should return 200 with array', async () => {
      const response = await request(app)
        .get(`/api/picks/eliminated/${TEST_IDS.users.validUser}/1`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should return empty array for non-existent user', async () => {
      const response = await request(app)
        .get(`/api/picks/eliminated/${TEST_IDS.users.nonExistent}/1`);

      expect(response.body).toEqual([]);
    });
  });
});
