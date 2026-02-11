/**
 * Contests Routes Tests (My Contests - GAP-12)
 *
 * Purpose: Test GET /api/contests/my endpoint
 * - Authentication requirement
 * - Data scope (user entered + SCHEDULED)
 * - 6-tier sorting contract
 * - ERROR fail-closed visibility
 * - Pagination stability
 * - Deterministic ordering
 */

const request = require('supertest');
const express = require('express');
const contestsRoutes = require('../../routes/contests.routes');
const { createMockPool, mockQueryResponses } = require('../mocks/mockPool');

// Test fixtures
const TEST_USER_ID = '11111111-1111-1111-1111-111111111111';
const ADMIN_USER_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_USER_ID = '33333333-3333-3333-3333-333333333333';

/**
 * Create a mock contest instance with all fields needed for mapContestToApiResponseForList
 */
function createMockContest(overrides = {}) {
  const now = new Date();
  const oneHourLater = new Date(now.getTime() + 3600000);
  const twoHoursLater = new Date(now.getTime() + 7200000);

  return {
    id: '00000000-0000-0000-0000-000000000001',
    template_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    organizer_id: OTHER_USER_ID,
    entry_fee_cents: 2500,
    payout_structure: { first: 70, second: 20, third: 10 },
    status: 'SCHEDULED',
    start_time: twoHoursLater,
    lock_time: oneHourLater,
    created_at: now,
    updated_at: now,
    join_token: 'dev_token123',
    max_entries: 20,
    contest_name: 'Test Contest',
    end_time: new Date(now.getTime() + 14400000), // 4 hours from now
    settle_time: null,
    organizer_name: 'Test Organizer',
    entry_count: 5,
    user_has_entered: false,
    ...overrides
  };
}

describe('Contests Routes (GET /api/contests/my - GAP-12)', () => {
  let app;
  let mockPool;
  let lastQueryCalled = null;

  beforeEach(() => {
    mockPool = createMockPool();

    // Store the last query for inspection
    const originalQuery = mockPool.query.bind(mockPool);
    mockPool.query = jest.fn(async function(sql, params) {
      lastQueryCalled = { sql, params };
      return originalQuery(sql, params);
    });

    app = express();
    app.set('trust proxy', 1);
    app.use(express.json());
    app.locals.pool = mockPool;

    // Test-only middleware: Simulate centralized auth
    // Parses Authorization header and populates req.user
    app.use((req, res, next) => {
      const authHeader = req.headers['authorization'];
      const xUserIsAdmin = req.headers['x-user-is-admin'] === 'true';

      if (authHeader && authHeader.startsWith('Bearer ')) {
        const userId = authHeader.substring(7);
        req.user = {
          id: userId,
          isAdmin: xUserIsAdmin
        };
      }

      next();
    });

    app.use('/api/contests', contestsRoutes);
  });

  afterEach(() => {
    mockPool.reset();
    lastQueryCalled = null;
  });

  describe('Authentication', () => {
    it('should return 401 if req.user is missing', async () => {
      const response = await request(app)
        .get('/api/contests/my');

      expect(response.status).toBe(401);
      expect(response.body.error).toMatch(/authentication|required/i);
    });

    it('should accept authenticated requests with Bearer token', async () => {
      const contest = createMockContest();

      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances/,
        mockQueryResponses.multiple([contest])
      );

      const response = await request(app)
        .get('/api/contests/my')
        .set('Authorization', `Bearer ${TEST_USER_ID}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('Data Scope (user entered OR status = SCHEDULED)', () => {
    it('should include contests where user is a participant', async () => {
      const participantContest = createMockContest({
        id: '00000000-0000-0000-0000-000000000001',
        status: 'LIVE',
        user_has_entered: true,
        entry_count: 3
      });

      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances/,
        mockQueryResponses.multiple([participantContest])
      );

      const response = await request(app)
        .get('/api/contests/my')
        .set('Authorization', `Bearer ${TEST_USER_ID}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].id).toBe(participantContest.id);
      expect(response.body[0].user_has_entered).toBe(true);
    });

    it('should include SCHEDULED contests even if user is not a participant', async () => {
      const scheduledContest = createMockContest({
        id: '00000000-0000-0000-0000-000000000002',
        status: 'SCHEDULED',
        user_has_entered: false,
        entry_count: 0
      });

      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances/,
        mockQueryResponses.multiple([scheduledContest])
      );

      const response = await request(app)
        .get('/api/contests/my')
        .set('Authorization', `Bearer ${TEST_USER_ID}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].status).toBe('SCHEDULED');
      expect(response.body[0].user_has_entered).toBe(false);
    });
  });

  describe('SQL Query Structure (6-Tier Sorting Contract)', () => {
    it('should generate SQL with CASE tier mapping for all six statuses', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances/,
        mockQueryResponses.multiple([])
      );

      await request(app)
        .get('/api/contests/my')
        .set('Authorization', `Bearer ${TEST_USER_ID}`);

      expect(lastQueryCalled).not.toBeNull();
      const sql = lastQueryCalled.sql;

      // Verify tier CASE mapping exists
      expect(sql).toMatch(/CASE ci\.status/i);
      expect(sql).toMatch(/WHEN 'LIVE' THEN 0/);
      expect(sql).toMatch(/WHEN 'LOCKED' THEN 1/);
      expect(sql).toMatch(/WHEN 'SCHEDULED' THEN 2/);
      expect(sql).toMatch(/WHEN 'COMPLETE' THEN 3/);
      expect(sql).toMatch(/WHEN 'CANCELLED' THEN 4/);
      expect(sql).toMatch(/WHEN 'ERROR' THEN 5/);
    });

    it('should generate SQL with status-scoped time columns', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances/,
        mockQueryResponses.multiple([])
      );

      await request(app)
        .get('/api/contests/my')
        .set('Authorization', `Bearer ${TEST_USER_ID}`);

      expect(lastQueryCalled).not.toBeNull();
      const sql = lastQueryCalled.sql;

      // Verify tier-specific time columns
      expect(sql).toMatch(/CASE WHEN ci\.status = 'LIVE' THEN ci\.end_time END AS live_end_time/i);
      expect(sql).toMatch(/CASE WHEN ci\.status = 'LOCKED' THEN ci\.start_time END AS locked_start_time/i);
      expect(sql).toMatch(/CASE WHEN ci\.status = 'SCHEDULED' THEN ci\.lock_time END AS scheduled_lock_time/i);
      expect(sql).toMatch(/CASE WHEN ci\.status = 'COMPLETE' THEN ci\.settle_time END AS complete_settle_time/i);
      expect(sql).toMatch(/CASE WHEN ci\.status = 'CANCELLED' THEN ci\.created_at END AS cancelled_created_at/i);
      expect(sql).toMatch(/CASE WHEN ci\.status = 'ERROR' THEN ci\.created_at END AS error_created_at/i);
    });

    it('should order by tier ASC first', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances/,
        mockQueryResponses.multiple([])
      );

      await request(app)
        .get('/api/contests/my')
        .set('Authorization', `Bearer ${TEST_USER_ID}`);

      expect(lastQueryCalled).not.toBeNull();
      const sql = lastQueryCalled.sql;

      // Verify ORDER BY starts with tier ASC
      expect(sql).toMatch(/ORDER BY[\s\n]+tier ASC/i);
    });

    it('should use NULLS LAST for time-based sorting', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances/,
        mockQueryResponses.multiple([])
      );

      await request(app)
        .get('/api/contests/my')
        .set('Authorization', `Bearer ${TEST_USER_ID}`);

      expect(lastQueryCalled).not.toBeNull();
      const sql = lastQueryCalled.sql;

      // Verify NULLS LAST appears in ORDER BY
      const orderByMatch = sql.match(/ORDER BY[\s\S]*LIMIT/i);
      expect(orderByMatch).not.toBeNull();
      const orderByClause = orderByMatch[0];
      expect(orderByClause).toMatch(/NULLS LAST/);
    });

    it('should have ci.id ASC as final tie-breaker', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances/,
        mockQueryResponses.multiple([])
      );

      await request(app)
        .get('/api/contests/my')
        .set('Authorization', `Bearer ${TEST_USER_ID}`);

      expect(lastQueryCalled).not.toBeNull();
      const sql = lastQueryCalled.sql;

      // Verify final tie-breaker
      expect(sql).toMatch(/ci\.id ASC[\s\n]+LIMIT/i);
    });
  });

  describe('ERROR Visibility (Fail-Closed)', () => {
    it('should filter ERROR by WHERE clause for non-admin', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances/,
        mockQueryResponses.multiple([])
      );

      await request(app)
        .get('/api/contests/my')
        .set('Authorization', `Bearer ${TEST_USER_ID}`);

      expect(lastQueryCalled).not.toBeNull();
      const sql = lastQueryCalled.sql;

      // Verify WHERE clause excludes ERROR for non-admin
      // The WHERE clause should check: ($2 = true OR ci.status != 'ERROR')
      expect(sql).toMatch(/\$2 = true/);
      expect(sql).toMatch(/ci\.status != 'ERROR'/);
    });

    it('should include ERROR for admin users via isAdmin parameter', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances/,
        mockQueryResponses.multiple([])
      );

      await request(app)
        .get('/api/contests/my')
        .set('Authorization', `Bearer ${ADMIN_USER_ID}`)
        .set('X-User-Is-Admin', 'true');

      expect(lastQueryCalled).not.toBeNull();
      const params = lastQueryCalled.params;

      // Verify second parameter (isAdmin) is true
      expect(params[1]).toBe(true);
    });

    it('should exclude ERROR for non-admin users via isAdmin parameter', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances/,
        mockQueryResponses.multiple([])
      );

      await request(app)
        .get('/api/contests/my')
        .set('Authorization', `Bearer ${TEST_USER_ID}`);

      expect(lastQueryCalled).not.toBeNull();
      const params = lastQueryCalled.params;

      // Verify second parameter (isAdmin) is false
      expect(params[1]).toBe(false);
    });
  });

  describe('Pagination', () => {
    it('should apply default limit of 50', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances/,
        mockQueryResponses.multiple([])
      );

      await request(app)
        .get('/api/contests/my')
        .set('Authorization', `Bearer ${TEST_USER_ID}`);

      expect(lastQueryCalled).not.toBeNull();
      const params = lastQueryCalled.params;

      // Verify limit parameter (third param) is 50
      expect(params[2]).toBe(50);
    });

    it('should respect limit parameter', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances/,
        mockQueryResponses.multiple([])
      );

      await request(app)
        .get('/api/contests/my?limit=30')
        .set('Authorization', `Bearer ${TEST_USER_ID}`);

      expect(lastQueryCalled).not.toBeNull();
      const params = lastQueryCalled.params;

      // Verify limit parameter is 30
      expect(params[2]).toBe(30);
    });

    it('should clamp limit to maximum 200', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances/,
        mockQueryResponses.multiple([])
      );

      await request(app)
        .get('/api/contests/my?limit=500')
        .set('Authorization', `Bearer ${TEST_USER_ID}`);

      expect(lastQueryCalled).not.toBeNull();
      const params = lastQueryCalled.params;

      // Verify limit is clamped to 200
      expect(params[2]).toBeLessThanOrEqual(200);
      expect(params[2]).toBe(200);
    });

    it('should clamp limit to minimum 1', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances/,
        mockQueryResponses.multiple([])
      );

      await request(app)
        .get('/api/contests/my?limit=0')
        .set('Authorization', `Bearer ${TEST_USER_ID}`);

      expect(lastQueryCalled).not.toBeNull();
      const params = lastQueryCalled.params;

      // Verify limit is clamped to 1
      expect(params[2]).toBe(1);
    });

    it('should apply default offset of 0', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances/,
        mockQueryResponses.multiple([])
      );

      await request(app)
        .get('/api/contests/my')
        .set('Authorization', `Bearer ${TEST_USER_ID}`);

      expect(lastQueryCalled).not.toBeNull();
      const params = lastQueryCalled.params;

      // Verify offset parameter (fourth param) is 0
      expect(params[3]).toBe(0);
    });

    it('should respect offset parameter', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances/,
        mockQueryResponses.multiple([])
      );

      await request(app)
        .get('/api/contests/my?offset=20')
        .set('Authorization', `Bearer ${TEST_USER_ID}`);

      expect(lastQueryCalled).not.toBeNull();
      const params = lastQueryCalled.params;

      // Verify offset parameter is 20
      expect(params[3]).toBe(20);
    });

    it('should return 400 for invalid limit parameter', async () => {
      const response = await request(app)
        .get('/api/contests/my?limit=invalid')
        .set('Authorization', `Bearer ${TEST_USER_ID}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/invalid|pagination/i);
    });

    it('should return 400 for invalid offset parameter', async () => {
      const response = await request(app)
        .get('/api/contests/my?offset=invalid')
        .set('Authorization', `Bearer ${TEST_USER_ID}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/invalid|pagination/i);
    });
  });

  describe('Response Format', () => {
    it('should return array of contests with correct fields', async () => {
      const contest = createMockContest({
        id: '00000000-0000-0000-0000-000000000100',
        status: 'SCHEDULED',
        user_has_entered: false
      });

      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances/,
        mockQueryResponses.multiple([contest])
      );

      const response = await request(app)
        .get('/api/contests/my')
        .set('Authorization', `Bearer ${TEST_USER_ID}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body[0]).toHaveProperty('id');
      expect(response.body[0]).toHaveProperty('status');
      expect(response.body[0]).toHaveProperty('is_locked');
      expect(response.body[0]).toHaveProperty('is_live');
      expect(response.body[0]).toHaveProperty('is_settled');
      expect(response.body[0]).toHaveProperty('entry_count');
      expect(response.body[0]).toHaveProperty('user_has_entered');
      expect(response.body[0]).toHaveProperty('time_until_lock');
    });

    it('should NOT include standings field (metadata-only list endpoint)', async () => {
      const liveContest = createMockContest({
        id: '00000000-0000-0000-0000-000000000101',
        status: 'LIVE',
        user_has_entered: true
      });

      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances/,
        mockQueryResponses.multiple([liveContest])
      );

      const response = await request(app)
        .get('/api/contests/my')
        .set('Authorization', `Bearer ${TEST_USER_ID}`);

      expect(response.status).toBe(200);
      expect(response.body[0]).not.toHaveProperty('standings');
    });

    it('should compute derived fields correctly', async () => {
      const now = new Date();
      const lockTime = new Date(now.getTime() + 3600000); // 1 hour from now

      const scheduledContest = createMockContest({
        id: '00000000-0000-0000-0000-000000000102',
        status: 'SCHEDULED',
        lock_time: lockTime,
        user_has_entered: false
      });

      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances/,
        mockQueryResponses.multiple([scheduledContest])
      );

      const response = await request(app)
        .get('/api/contests/my')
        .set('Authorization', `Bearer ${TEST_USER_ID}`);

      expect(response.status).toBe(200);
      expect(response.body[0].status).toBe('SCHEDULED');
      expect(response.body[0].is_locked).toBe(false);
      expect(response.body[0].is_live).toBe(false);
      expect(response.body[0].is_settled).toBe(false);
      expect(typeof response.body[0].time_until_lock).toBe('number');
      expect(response.body[0].time_until_lock).toBeGreaterThan(0);
    });
  });
});
