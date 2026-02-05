/**
 * Join Endpoint Parity Tests
 *
 * Purpose: Assert that the canonical join endpoint (/api/custom-contests/join/:token)
 * and the legacy join endpoint (/api/join/:token) return identical responses.
 *
 * Both endpoints delegate to customContestService.resolveJoinToken.
 * The legacy route must have the same rate limiting, error codes, and response shape.
 *
 * These tests use an isolated Express app with a mock pool — no DB required.
 */

const request = require('supertest');
const express = require('express');
const customContestRoutes = require('../../routes/customContest.routes');
const customContestService = require('../../services/customContestService');
const { createCombinedJoinRateLimiter } = require('../../middleware/joinRateLimit');
const { logJoinSuccess, logJoinFailure } = require('../../services/joinAuditService');
const { createMockPool, mockQueryResponses } = require('../mocks/mockPool');

const TEST_INSTANCE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const TEST_TEMPLATE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TEST_USER_ID = '11111111-1111-1111-1111-111111111111';

const mockInstance = {
  id: TEST_INSTANCE_ID,
  template_id: TEST_TEMPLATE_ID,
  organizer_id: TEST_USER_ID,
  entry_fee_cents: 2500,
  payout_structure: { first: 70, second: 20, third: 10 },
  status: 'open',
  join_token: 'dev_abc123def456abc123def456abc123',
  template_name: 'NFL Playoff Challenge',
  template_sport: 'NFL',
  template_type: 'playoff_challenge',
  scoring_strategy_key: 'ppr',
  lock_strategy_key: 'first_game_kickoff',
  settlement_strategy_key: 'final_standings',
  start_time: null,
  lock_time: null,
  settlement_time: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
};

/**
 * Build an isolated Express app that mounts both join endpoints.
 * This mirrors how the real server.js and customContest.routes.js coexist.
 */
function buildParityApp(mockPool) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.locals.pool = mockPool;

  // Canonical endpoint (via router)
  app.use('/api/custom-contests', customContestRoutes);

  // Legacy endpoint (mirrors server.js delegate)
  const legacyJoinRateLimiter = createCombinedJoinRateLimiter();
  app.get('/api/join/:token', legacyJoinRateLimiter, async (req, res) => {
    const { token } = req.params;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const joinSource = req.query.source || 'legacy_join';
    const userId = req.headers['x-user-id'] || null;

    try {
      const pool = req.app.locals.pool;
      const result = await customContestService.resolveJoinToken(pool, token);

      if (result.valid) {
        logJoinSuccess({ token, contestId: result.contest.id, userId, ipAddress, joinSource });
      } else {
        logJoinFailure({
          token, errorCode: result.error_code, contestId: result.contest?.id || null,
          userId, ipAddress, joinSource,
          extra: result.environment_mismatch ? {
            token_environment: result.token_environment,
            current_environment: result.current_environment
          } : undefined
        });
      }

      return res.json(result);
    } catch (err) {
      logJoinFailure({
        token, errorCode: 'INTERNAL_ERROR', userId, ipAddress, joinSource,
        extra: { error: err.message }
      });
      return res.status(500).json({
        valid: false, error_code: 'INTERNAL_ERROR', reason: 'Failed to resolve token'
      });
    }
  });

  return app;
}

describe('Join Endpoint Parity', () => {
  let app;
  let mockPool;

  beforeEach(() => {
    process.env.APP_ENV = 'dev';
    process.env.JOIN_BASE_URL = 'https://app.playoffchallenge.com';
    mockPool = createMockPool();
    app = buildParityApp(mockPool);
  });

  afterEach(() => {
    mockPool.reset();
    delete process.env.APP_ENV;
    delete process.env.JOIN_BASE_URL;
  });

  /**
   * Helper: make the same request to both endpoints and compare response bodies.
   */
  async function assertParity(token, setupMock) {
    if (setupMock) setupMock();
    const canonical = await request(app).get(`/api/custom-contests/join/${token}`);

    // Reset mock to ensure identical DB state for second request
    mockPool.reset();
    if (setupMock) setupMock();
    const legacy = await request(app).get(`/api/join/${token}`);

    expect(canonical.status).toBe(legacy.status);
    expect(canonical.body).toEqual(legacy.body);

    return { canonical, legacy };
  }

  describe('Response parity between canonical and legacy endpoints', () => {
    it('should return identical responses for valid open contest', async () => {
      const token = 'dev_abc123def456abc123def456abc123';
      const { canonical } = await assertParity(token, () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.join_token/,
          mockQueryResponses.single({ ...mockInstance, join_token: token })
        );
      });

      expect(canonical.body.valid).toBe(true);
      expect(canonical.body.contest.id).toBe(TEST_INSTANCE_ID);
    });

    it('should return identical responses for environment mismatch', async () => {
      const { canonical } = await assertParity('prd_abc123def456');

      expect(canonical.body.valid).toBe(false);
      expect(canonical.body.error_code).toBe('ENVIRONMENT_MISMATCH');
    });

    it('should return identical responses for malformed token', async () => {
      const { canonical } = await assertParity('notavalidtoken');

      expect(canonical.body.valid).toBe(false);
      expect(canonical.body.error_code).toBe('INVALID_TOKEN');
    });

    it('should return identical responses for not-found contest', async () => {
      const { canonical } = await assertParity('dev_notfound123456789012', () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.join_token/,
          mockQueryResponses.empty()
        );
      });

      expect(canonical.body.valid).toBe(false);
      expect(canonical.body.error_code).toBe('NOT_FOUND');
    });

    it('should return identical responses for draft contest', async () => {
      const token = 'dev_draft1234567890123456789012';
      const { canonical } = await assertParity(token, () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.join_token/,
          mockQueryResponses.single({ ...mockInstance, join_token: token, status: 'draft' })
        );
      });

      expect(canonical.body.valid).toBe(false);
      expect(canonical.body.error_code).toBe('NOT_PUBLISHED');
    });

    it('should return identical responses for locked contest', async () => {
      const token = 'dev_locked12345678901234567890';
      const { canonical } = await assertParity(token, () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.join_token/,
          mockQueryResponses.single({ ...mockInstance, join_token: token, status: 'locked' })
        );
      });

      expect(canonical.body.valid).toBe(false);
      expect(canonical.body.error_code).toBe('CONTEST_LOCKED');
    });

    it('should return identical responses for cancelled contest', async () => {
      const token = 'dev_cancelled123456789012345';
      const { canonical } = await assertParity(token, () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.join_token/,
          mockQueryResponses.single({ ...mockInstance, join_token: token, status: 'cancelled' })
        );
      });

      expect(canonical.body.valid).toBe(false);
      expect(canonical.body.error_code).toBe('EXPIRED_TOKEN');
    });
  });

  describe('Rate limiting on legacy endpoint', () => {
    it('should have rate limiter applied to legacy endpoint', async () => {
      // The legacy endpoint has rate limiting middleware.
      // We verify by checking that the rate limit headers are present.
      const response = await request(app).get('/api/join/dev_abc123def456abc123def456abc123');

      // express-rate-limit sets these standard headers
      expect(response.headers).toHaveProperty('ratelimit-limit');
      expect(response.headers).toHaveProperty('ratelimit-remaining');
    });

    it('should have rate limiter applied to canonical endpoint', async () => {
      const response = await request(app).get('/api/custom-contests/join/dev_abc123def456abc123def456abc123');

      expect(response.headers).toHaveProperty('ratelimit-limit');
      expect(response.headers).toHaveProperty('ratelimit-remaining');
    });
  });

  describe('Error response format parity', () => {
    it('should return structured error on internal failure for both endpoints', async () => {
      const token = 'dev_error1234567890123456789012';

      // Simulate DB error for canonical
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.join_token/,
        mockQueryResponses.error('Connection refused', 'ECONNREFUSED')
      );
      const canonical = await request(app).get(`/api/custom-contests/join/${token}`);

      // Reset and simulate same error for legacy
      mockPool.reset();
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.join_token/,
        mockQueryResponses.error('Connection refused', 'ECONNREFUSED')
      );
      const legacy = await request(app).get(`/api/join/${token}`);

      // Both should return 500 with identical error structure
      expect(canonical.status).toBe(500);
      expect(legacy.status).toBe(500);
      expect(canonical.body.error_code).toBe('INTERNAL_ERROR');
      expect(legacy.body.error_code).toBe('INTERNAL_ERROR');
      expect(canonical.body.valid).toBe(false);
      expect(legacy.body.valid).toBe(false);
    });
  });
});
