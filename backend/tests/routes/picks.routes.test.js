/**
 * Picks Routes Contract Tests (v2 Only)
 *
 * Purpose: Lock in API contract for picks-related endpoints
 * - GET /api/picks/v2
 * - POST /api/picks/v2
 * - POST /api/picks/replace-player
 * - GET /api/picks/eliminated/:userId/:weekNumber
 *
 * These tests verify response shapes and validation behavior.
 * They are read-only and do not create persistent data.
 *
 * Note: v1 endpoints (GET /api/picks/:userId, POST /api/picks, DELETE /api/picks/:pickId)
 * have been removed. All clients must use v2 endpoints.
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

  describe('GET /api/picks/v2', () => {
    it('should return 400 without userId', async () => {
      const response = await requestFactory.get('/api/picks/v2');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should handle request without weekNumber (defaults to current week)', async () => {
      const response = await requestFactory.get(`/api/picks/v2?userId=${TEST_IDS.users.validUser}`);

      // API defaults to current week when weekNumber is omitted
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('picks');
    });

    it('should return 200 with picks for valid params', async () => {
      const response = await requestFactory.get(`/api/picks/v2?userId=${TEST_IDS.users.validUser}&weekNumber=1`);

      expect(response.status).toBe(200);
    });

    it('should include picks array in response', async () => {
      const response = await requestFactory.get(`/api/picks/v2?userId=${TEST_IDS.users.validUser}&weekNumber=1`);

      expect(response.body).toHaveProperty('picks');
      expect(Array.isArray(response.body.picks)).toBe(true);
    });
  });

  describe('POST /api/picks/v2', () => {
    it('should return 400 without ops array', async () => {
      const response = await requestFactory.post('/api/picks/v2')
        .send({
          userId: TEST_IDS.users.validUser,
          weekNumber: 1
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('ops');
    });

    it('should accept add operation in ops array', async () => {
      const response = await requestFactory.post('/api/picks/v2')
        .send({
          userId: TEST_IDS.users.validUser,
          weekNumber: 1,
          ops: [{
            op: 'add',
            playerId: TEST_IDS.players.qb1,
            slot: 'QB'
          }]
        });

      // May succeed or fail based on game state or user existence, but not 500
      expect([200, 201, 400, 403, 404]).toContain(response.status);
    });

    it('should accept remove operation in ops array', async () => {
      const response = await requestFactory.post('/api/picks/v2')
        .send({
          userId: TEST_IDS.users.validUser,
          weekNumber: 1,
          ops: [{
            op: 'remove',
            pickId: TEST_IDS.picks.pick1
          }]
        });

      // May succeed or fail based on game state, but not 500
      expect([200, 400, 403, 404]).toContain(response.status);
    });

    it('should accept replace operation in ops array', async () => {
      const response = await requestFactory.post('/api/picks/v2')
        .send({
          userId: TEST_IDS.users.validUser,
          weekNumber: 1,
          ops: [{
            op: 'replace',
            oldPlayerId: TEST_IDS.players.qb1,
            newPlayerId: TEST_IDS.players.rb1
          }]
        });

      // May succeed or fail based on game state, but not 500
      expect([200, 400, 403, 404]).toContain(response.status);
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
    it('should return 200 with elimination data', async () => {
      const response = await request(app)
        .get(`/api/picks/eliminated/${TEST_IDS.users.validUser}/1`);

      expect(response.status).toBe(200);
      // Response is an object with eliminated array and metadata
      expect(response.body).toHaveProperty('eliminated');
      expect(Array.isArray(response.body.eliminated)).toBe(true);
    });

    it('should return elimination data structure for non-existent user', async () => {
      const response = await request(app)
        .get(`/api/picks/eliminated/${TEST_IDS.users.nonExistent}/1`);

      expect(response.status).toBe(200);
      // Response includes eliminated array (empty for non-existent user)
      expect(response.body).toHaveProperty('eliminated');
    });
  });
});
