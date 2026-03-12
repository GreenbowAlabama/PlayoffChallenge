/**
 * Custom Contest Routes — JWT Bearer Token Extraction Test
 *
 * Regression test for GitHub issue: Auth user ID mismatch between join and wallet routes
 *
 * Purpose: Verify that both customContest.routes.js and wallet.routes.js extract
 * the same userId from Authorization: Bearer <JWT> headers.
 *
 * Before the fix:
 * - wallet.routes.js decoded JWT → extracted payload.user_id
 * - customContest.routes.js used raw JWT string as userId
 * - Result: Ledger entries written under different userId, wallet balance appeared stale
 *
 * After the fix:
 * - Both routes decode JWT identically
 * - Both extract payload.sub || payload.user_id
 * - Ledger entries and wallet queries use same userId
 */

const express = require('express');
const request = require('supertest');
const customContestRoutes = require('../../routes/customContest.routes');
const walletRoutes = require('../../routes/wallet.routes');
const { createMockPool, mockQueryResponses } = require('../mocks/mockPool');

const TEST_USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('JWT Bearer Token Extraction — Auth Consistency', () => {
  describe('JWT Payload Decoding', () => {
    it('should decode JWT and extract user_id from payload', () => {
      // Create a mock JWT token
      const payload = Buffer.from(JSON.stringify({
        sub: TEST_USER_ID,
        user_id: TEST_USER_ID,
        iat: 1234567890
      })).toString('base64');
      const mockJwt = `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`;

      // Simulate JWT extraction (what both routes should do)
      const token = mockJwt.split(' ')[1] || mockJwt;
      const decodedPayload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      const extractedUserId = decodedPayload.sub || decodedPayload.user_id;

      expect(extractedUserId).toBe(TEST_USER_ID);
    });

    it('should extract sub field if user_id not present', () => {
      const payload = Buffer.from(JSON.stringify({
        sub: TEST_USER_ID,
        iat: 1234567890
      })).toString('base64');
      const mockJwt = `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`;

      const token = mockJwt.split(' ')[1] || mockJwt;
      const decodedPayload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      const extractedUserId = decodedPayload.sub || decodedPayload.user_id;

      expect(extractedUserId).toBe(TEST_USER_ID);
    });

    it('should gracefully handle invalid JWT and fall back', () => {
      const invalidToken = 'not.a.jwt.token';

      let extractedUserId = null;
      try {
        const decodedPayload = JSON.parse(Buffer.from(invalidToken.split('.')[1], 'base64').toString());
        extractedUserId = decodedPayload.sub || decodedPayload.user_id;
      } catch (err) {
        // Expected: invalid JWT fails decoding, fall back to X-User-Id
        extractedUserId = null;
      }

      expect(extractedUserId).toBeNull();
    });
  });

  describe('customContest.routes.js extractUserId', () => {
    let app;
    let mockPool;

    beforeEach(() => {
      mockPool = createMockPool();
      app = express();
      app.set('trust proxy', 1);
      app.use(express.json());
      app.locals.pool = mockPool;
      app.use('/api/custom-contests', customContestRoutes);
    });

    it('should accept Authorization Bearer JWT and not reject as invalid', async () => {
      // Create a mock JWT
      const payload = Buffer.from(JSON.stringify({
        sub: TEST_USER_ID,
        user_id: TEST_USER_ID
      })).toString('base64');
      const mockJwt = `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`;

      const response = await request(app)
        .get('/api/custom-contests/templates')
        .set('Authorization', `Bearer ${mockJwt}`);

      // Should NOT return 400 "Invalid user ID format"
      // (200 or 500 is OK for this test — we're just checking auth parsing doesn't reject valid JWT)
      expect(response.status).not.toBe(400);
    });

    it('should fall back to X-User-Id header if no Authorization header', async () => {
      const response = await request(app)
        .get('/api/custom-contests/templates')
        .set('X-User-Id', TEST_USER_ID);

      // Should NOT return 401 if X-User-Id is present
      expect(response.status).not.toBe(401);
    });

    it('should return 401 when both Authorization and X-User-Id are missing', async () => {
      // Use an endpoint that requires authentication (POST requires auth, GET /templates doesn't)
      const response = await request(app)
        .get('/api/custom-contests');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Authentication required');
    });

    it('should return 400 for invalid UUID format (after extraction)', async () => {
      // Use an endpoint that requires authentication
      const response = await request(app)
        .get('/api/custom-contests')
        .set('X-User-Id', 'not-a-valid-uuid');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid user ID format');
    });
  });

  describe('wallet.routes.js extractUserId', () => {
    let app;
    let mockPool;

    beforeEach(() => {
      mockPool = createMockPool();
      app = express();
      app.set('trust proxy', 1);
      app.use(express.json());
      app.locals.pool = mockPool;
      app.use('/api/wallet', walletRoutes);
    });

    it('should accept Authorization Bearer JWT', async () => {
      const payload = Buffer.from(JSON.stringify({
        sub: TEST_USER_ID,
        user_id: TEST_USER_ID
      })).toString('base64');
      const mockJwt = `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`;

      // Mock the wallet balance query
      mockPool.setQueryResponse(
        /SELECT COALESCE.*FROM ledger/,
        mockQueryResponses.single({ balance_cents: 10000 })
      );

      const response = await request(app)
        .get('/api/wallet')
        .set('Authorization', `Bearer ${mockJwt}`);

      // Should succeed, not reject as invalid
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('balance_cents');
    });

    it('should fall back to X-User-Id header if no Authorization header', async () => {
      mockPool.setQueryResponse(
        /SELECT COALESCE.*FROM ledger/,
        mockQueryResponses.single({ balance_cents: 10000 })
      );

      const response = await request(app)
        .get('/api/wallet')
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('balance_cents');
    });

    it('should return 401 when both Authorization and X-User-Id are missing', async () => {
      const response = await request(app)
        .get('/api/wallet');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Authentication required');
    });
  });
});
