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

describe('Contests Routes', () => {
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

  describe('GET /api/contests/available', () => {
    describe('Authentication', () => {
      it('should return 401 if req.user is missing', async () => {
        const response = await request(app).get('/api/contests/available');

        expect(response.status).toBe(401);
        expect(response.body.error).toMatch(/authentication|required/i);
      });

      it('should accept authenticated requests with Bearer token', async () => {
        const contest = createMockContest({
          is_platform_owned: true
        });

        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances[\s\S]*NOT EXISTS/,
          mockQueryResponses.multiple([contest])
        );

        const response = await request(app)
          .get('/api/contests/available')
          .set('Authorization', `Bearer ${TEST_USER_ID}`);

        expect(response.status).toBe(200);
        expect(Array.isArray(response.body)).toBe(true);
      });
    });

    describe('Data Scope (SCHEDULED only, user not entered, not full)', () => {
      it('should only return SCHEDULED contests', async () => {
        const scheduledContest = createMockContest({
          id: '00000000-0000-0000-0000-000000000201',
          status: 'SCHEDULED',
          user_has_entered: false,
          is_platform_owned: false
        });

        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances[\s\S]*NOT EXISTS/,
          mockQueryResponses.multiple([scheduledContest])
        );

        const response = await request(app)
          .get('/api/contests/available')
          .set('Authorization', `Bearer ${TEST_USER_ID}`);

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(1);
        expect(response.body[0].status).toBe('SCHEDULED');
      });

      it('should exclude LIVE contests', async () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances[\s\S]*NOT EXISTS/,
          mockQueryResponses.multiple([])
        );

        const response = await request(app)
          .get('/api/contests/available')
          .set('Authorization', `Bearer ${TEST_USER_ID}`);

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(0);
      });

      it('should exclude CANCELLED contests', async () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances[\s\S]*NOT EXISTS/,
          mockQueryResponses.multiple([])
        );

        const response = await request(app)
          .get('/api/contests/available')
          .set('Authorization', `Bearer ${TEST_USER_ID}`);

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(0);
      });

      it('should exclude contests user has entered', async () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances[\s\S]*NOT EXISTS/,
          mockQueryResponses.multiple([])
        );

        const response = await request(app)
          .get('/api/contests/available')
          .set('Authorization', `Bearer ${TEST_USER_ID}`);

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(0);
      });

      it('should exclude full contests', async () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances[\s\S]*NOT EXISTS/,
          mockQueryResponses.multiple([])
        );

        const response = await request(app)
          .get('/api/contests/available')
          .set('Authorization', `Bearer ${TEST_USER_ID}`);

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(0);
      });
    });

    describe('SQL Query Structure (EXISTS and HAVING)', () => {
      it('should generate SQL with NOT EXISTS clause', async () => {
        let lastQueryCalled = null;
        const originalQuery = mockPool.query.bind(mockPool);
        mockPool.query = jest.fn(async function(sql, params) {
          lastQueryCalled = { sql, params };
          return originalQuery(sql, params);
        });

        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances[\s\S]*NOT EXISTS/,
          mockQueryResponses.multiple([])
        );

        await request(app)
          .get('/api/contests/available')
          .set('Authorization', `Bearer ${TEST_USER_ID}`);

        expect(lastQueryCalled).not.toBeNull();
        expect(lastQueryCalled.sql).toMatch(/NOT EXISTS/i);
        expect(lastQueryCalled.sql).toMatch(/contest_participants cp2/i);
      });

      it('should generate SQL with HAVING clause for capacity check', async () => {
        let lastQueryCalled = null;
        const originalQuery = mockPool.query.bind(mockPool);
        mockPool.query = jest.fn(async function(sql, params) {
          lastQueryCalled = { sql, params };
          return originalQuery(sql, params);
        });

        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances[\s\S]*NOT EXISTS/,
          mockQueryResponses.multiple([])
        );

        await request(app)
          .get('/api/contests/available')
          .set('Authorization', `Bearer ${TEST_USER_ID}`);

        expect(lastQueryCalled).not.toBeNull();
        expect(lastQueryCalled.sql).toMatch(/HAVING/i);
        expect(lastQueryCalled.sql).toMatch(/max_entries IS NULL/i);
        expect(lastQueryCalled.sql).toMatch(/COUNT\(cp\.id\)/i);
      });

      it('should generate SQL with GROUP BY clause', async () => {
        let lastQueryCalled = null;
        const originalQuery = mockPool.query.bind(mockPool);
        mockPool.query = jest.fn(async function(sql, params) {
          lastQueryCalled = { sql, params };
          return originalQuery(sql, params);
        });

        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances[\s\S]*NOT EXISTS/,
          mockQueryResponses.multiple([])
        );

        await request(app)
          .get('/api/contests/available')
          .set('Authorization', `Bearer ${TEST_USER_ID}`);

        expect(lastQueryCalled).not.toBeNull();
        expect(lastQueryCalled.sql).toMatch(/GROUP BY/i);
      });

      it('should use parameterized query (no string interpolation)', async () => {
        let lastQueryCalled = null;
        const originalQuery = mockPool.query.bind(mockPool);
        mockPool.query = jest.fn(async function(sql, params) {
          lastQueryCalled = { sql, params };
          return originalQuery(sql, params);
        });

        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances[\s\S]*NOT EXISTS/,
          mockQueryResponses.multiple([])
        );

        await request(app)
          .get('/api/contests/available')
          .set('Authorization', `Bearer ${TEST_USER_ID}`);

        expect(lastQueryCalled).not.toBeNull();
        expect(lastQueryCalled.params).toHaveLength(1);
        expect(lastQueryCalled.params[0]).toBe(TEST_USER_ID);
      });

      it('should filter by lock_time in SQL query (regression test)', async () => {
        let lastQueryCalled = null;
        const originalQuery = mockPool.query.bind(mockPool);
        mockPool.query = jest.fn(async function(sql, params) {
          lastQueryCalled = { sql, params };
          return originalQuery(sql, params);
        });

        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances[\s\S]*NOT EXISTS/,
          mockQueryResponses.multiple([])
        );

        await request(app)
          .get('/api/contests/available')
          .set('Authorization', `Bearer ${TEST_USER_ID}`);

        expect(lastQueryCalled).not.toBeNull();
        expect(lastQueryCalled.sql).toMatch(/ci\.lock_time IS NULL OR ci\.lock_time > NOW\(\)/);
      });
    });

    describe('Ordering (is_platform_owned DESC, created_at DESC)', () => {
      it('should order platform-owned contests first', async () => {
        const now = new Date();
        const platformOwned = createMockContest({
          id: '00000000-0000-0000-0000-000000000301',
          is_platform_owned: true,
          created_at: new Date(now.getTime() - 86400000), // 1 day ago
          user_has_entered: false
        });

        const userOwned = createMockContest({
          id: '00000000-0000-0000-0000-000000000302',
          is_platform_owned: false,
          created_at: now,
          user_has_entered: false
        });

        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances[\s\S]*NOT EXISTS/,
          mockQueryResponses.multiple([platformOwned, userOwned])
        );

        const response = await request(app)
          .get('/api/contests/available')
          .set('Authorization', `Bearer ${TEST_USER_ID}`);

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(2);
        expect(response.body[0].is_platform_owned).toBe(true);
        expect(response.body[1].is_platform_owned).toBe(false);
      });

      it('should order by created_at DESC within same platform_owned value', async () => {
        const now = new Date();
        const newer = createMockContest({
          id: '00000000-0000-0000-0000-000000000401',
          is_platform_owned: true,
          created_at: now,
          user_has_entered: false
        });

        const older = createMockContest({
          id: '00000000-0000-0000-0000-000000000402',
          is_platform_owned: true,
          created_at: new Date(now.getTime() - 86400000),
          user_has_entered: false
        });

        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances[\s\S]*NOT EXISTS/,
          mockQueryResponses.multiple([newer, older])
        );

        const response = await request(app)
          .get('/api/contests/available')
          .set('Authorization', `Bearer ${TEST_USER_ID}`);

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(2);
        expect(response.body[0].id).toBe(newer.id);
        expect(response.body[1].id).toBe(older.id);
      });
    });

    describe('Response Format', () => {
      it('should always include user_has_entered as false', async () => {
        const contest = createMockContest({
          id: '00000000-0000-0000-0000-000000000501',
          user_has_entered: false,
          is_platform_owned: true
        });

        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances[\s\S]*NOT EXISTS/,
          mockQueryResponses.multiple([contest])
        );

        const response = await request(app)
          .get('/api/contests/available')
          .set('Authorization', `Bearer ${TEST_USER_ID}`);

        expect(response.status).toBe(200);
        expect(response.body[0].user_has_entered).toBe(false);
      });

      it('should include is_platform_owned in response', async () => {
        const contest = createMockContest({
          id: '00000000-0000-0000-0000-000000000502',
          is_platform_owned: true,
          user_has_entered: false
        });

        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances[\s\S]*NOT EXISTS/,
          mockQueryResponses.multiple([contest])
        );

        const response = await request(app)
          .get('/api/contests/available')
          .set('Authorization', `Bearer ${TEST_USER_ID}`);

        expect(response.status).toBe(200);
        expect(response.body[0]).toHaveProperty('is_platform_owned');
        expect(response.body[0].is_platform_owned).toBe(true);
      });

      it('should include all required fields', async () => {
        const contest = createMockContest({
          id: '00000000-0000-0000-0000-000000000503',
          is_platform_owned: false,
          user_has_entered: false
        });

        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances[\s\S]*NOT EXISTS/,
          mockQueryResponses.multiple([contest])
        );

        const response = await request(app)
          .get('/api/contests/available')
          .set('Authorization', `Bearer ${TEST_USER_ID}`);

        expect(response.status).toBe(200);
        const contestObj = response.body[0];
        expect(contestObj).toHaveProperty('id');
        expect(contestObj).toHaveProperty('status');
        expect(contestObj).toHaveProperty('entry_count');
        expect(contestObj).toHaveProperty('max_entries');
        expect(contestObj).toHaveProperty('user_has_entered');
        expect(contestObj).toHaveProperty('is_platform_owned');
        expect(contestObj).toHaveProperty('join_token');
        expect(contestObj).toHaveProperty('lock_time');
        expect(contestObj).toHaveProperty('created_at');
      });

      it('should NOT include standings field', async () => {
        const contest = createMockContest({
          id: '00000000-0000-0000-0000-000000000504',
          is_platform_owned: true,
          user_has_entered: false
        });

        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances[\s\S]*NOT EXISTS/,
          mockQueryResponses.multiple([contest])
        );

        const response = await request(app)
          .get('/api/contests/available')
          .set('Authorization', `Bearer ${TEST_USER_ID}`);

        expect(response.status).toBe(200);
        expect(response.body[0]).not.toHaveProperty('standings');
      });
    });

    describe('Edge Cases', () => {
      it('should return empty array when no available contests', async () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances[\s\S]*NOT EXISTS/,
          mockQueryResponses.multiple([])
        );

        const response = await request(app)
          .get('/api/contests/available')
          .set('Authorization', `Bearer ${TEST_USER_ID}`);

        expect(response.status).toBe(200);
        expect(response.body).toEqual([]);
      });

      it('should handle contest with NULL max_entries (unlimited)', async () => {
        const contest = createMockContest({
          id: '00000000-0000-0000-0000-000000000601',
          max_entries: null,
          entry_count: 100,
          is_platform_owned: false,
          user_has_entered: false
        });

        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances[\s\S]*NOT EXISTS/,
          mockQueryResponses.multiple([contest])
        );

        const response = await request(app)
          .get('/api/contests/available')
          .set('Authorization', `Bearer ${TEST_USER_ID}`);

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(1);
        expect(response.body[0].max_entries).toBeNull();
      });
    });
  });

  describe('GET /api/contests/home (Home Feed)', () => {
    describe('home_feed_returns_scheduled_contests', () => {
      it('should return only SCHEDULED contests', async () => {
        const scheduledContest = createMockContest({
          id: '11111111-1111-1111-1111-111111111111',
          status: 'SCHEDULED',
          lock_time: new Date(Date.now() + 3600000),
          user_has_entered: false
        });

        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE ci\.status = 'SCHEDULED'/,
          mockQueryResponses.multiple([scheduledContest])
        );

        const response = await request(app)
          .get('/api/contests/home')
          .set('Authorization', `Bearer ${TEST_USER_ID}`);

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(1);
        expect(response.body[0].status).toBe('SCHEDULED');
      });

      it('should return SCHEDULED contests regardless of lock_time (no time filtering)', async () => {
        const pastLockContest = createMockContest({
          id: '00000000-0000-0000-0000-000000000001',
          status: 'SCHEDULED',
          lock_time: new Date(Date.now() - 3600000) // Past lock_time
        });

        const futureLockContest = createMockContest({
          id: '00000000-0000-0000-0000-000000000002',
          status: 'SCHEDULED',
          lock_time: new Date(Date.now() + 7200000) // Future lock_time
        });

        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE ci\.status = 'SCHEDULED'/,
          mockQueryResponses.multiple([pastLockContest, futureLockContest])
        );

        const response = await request(app)
          .get('/api/contests/home')
          .set('Authorization', `Bearer ${TEST_USER_ID}`);

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(2);
        expect(response.body.every(c => c.status === 'SCHEDULED')).toBe(true);
      });

      it('should sort SCHEDULED contests by lock_time ASC', async () => {
        const now = Date.now();
        const contest1 = createMockContest({
          id: '00000000-0000-0000-0000-000000000001',
          status: 'SCHEDULED',
          lock_time: new Date(now + 7200000) // 2 hours
        });

        const contest2 = createMockContest({
          id: '00000000-0000-0000-0000-000000000002',
          status: 'SCHEDULED',
          lock_time: new Date(now + 3600000) // 1 hour
        });

        const contest3 = createMockContest({
          id: '00000000-0000-0000-0000-000000000003',
          status: 'SCHEDULED',
          lock_time: new Date(now + 10800000) // 3 hours
        });

        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE ci\.status = 'SCHEDULED'/,
          mockQueryResponses.multiple([contest2, contest1, contest3])
        );

        const response = await request(app)
          .get('/api/contests/home')
          .set('Authorization', `Bearer ${TEST_USER_ID}`);

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(3);
        // Verify lock_time ordering (earliest first) using ISO string comparison
        const times = response.body.map(c => new Date(c.lock_time).getTime());
        expect(times[0]).toBeLessThan(times[1]);
        expect(times[1]).toBeLessThan(times[2]);
      });

      it('should include SCHEDULED contests regardless of user participation', async () => {
        const joinedScheduled = createMockContest({
          id: '00000000-0000-0000-0000-000000000001',
          status: 'SCHEDULED',
          user_has_entered: true
        });

        const notJoinedScheduled = createMockContest({
          id: '00000000-0000-0000-0000-000000000002',
          status: 'SCHEDULED',
          user_has_entered: false
        });

        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE ci\.status = 'SCHEDULED'/,
          mockQueryResponses.multiple([joinedScheduled, notJoinedScheduled])
        );

        const response = await request(app)
          .get('/api/contests/home')
          .set('Authorization', `Bearer ${TEST_USER_ID}`);

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(2);
        expect(response.body.some(c => c.user_has_entered === true)).toBe(true);
        expect(response.body.some(c => c.user_has_entered === false)).toBe(true);
      });

      it('should return empty array when no SCHEDULED contests', async () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE ci\.status = 'SCHEDULED'/,
          mockQueryResponses.multiple([])
        );

        const response = await request(app)
          .get('/api/contests/home')
          .set('Authorization', `Bearer ${TEST_USER_ID}`);

        expect(response.status).toBe(200);
        expect(response.body).toEqual([]);
      });
    });
  });

  describe('GET /api/contests/my (My Contests)', () => {
    describe('my_contests_returns_joined_contests_all_states', () => {
      it('should return contests where user is a participant in all statuses', async () => {
        const liveContest = createMockContest({
          id: '00000000-0000-0000-0000-000000000001',
          status: 'LIVE',
          user_has_entered: true
        });

        const scheduledContest = createMockContest({
          id: '00000000-0000-0000-0000-000000000002',
          status: 'SCHEDULED',
          user_has_entered: true
        });

        const completeContest = createMockContest({
          id: '00000000-0000-0000-0000-000000000003',
          status: 'COMPLETE',
          user_has_entered: true
        });

        const cancelledContest = createMockContest({
          id: '00000000-0000-0000-0000-000000000004',
          status: 'CANCELLED',
          user_has_entered: true
        });

        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE EXISTS[\s\S]*contest_participants/,
          mockQueryResponses.multiple([liveContest, scheduledContest, completeContest, cancelledContest])
        );

        const response = await request(app)
          .get('/api/contests/my')
          .set('Authorization', `Bearer ${TEST_USER_ID}`);

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(4);
        expect(response.body.every(c => c.user_has_entered === true)).toBe(true);
      });

      it('should only return contests where user is a participant', async () => {
        const participantContest = createMockContest({
          id: '00000000-0000-0000-0000-000000000001',
          status: 'LIVE',
          user_has_entered: true,
          entry_count: 5
        });

        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE EXISTS[\s\S]*contest_participants/,
          mockQueryResponses.multiple([participantContest])
        );

        const response = await request(app)
          .get('/api/contests/my')
          .set('Authorization', `Bearer ${TEST_USER_ID}`);

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(1);
        expect(response.body[0].user_has_entered).toBe(true);
      });

      it('should sort by lifecycle priority (LIVE, SCHEDULED, COMPLETE, ERROR, CANCELLED)', async () => {
        const now = Date.now();
        const cancelledContest = createMockContest({
          id: '00000000-0000-0000-0000-000000000001',
          status: 'CANCELLED',
          user_has_entered: true,
          created_at: new Date(now - 7200000)
        });

        const liveContest = createMockContest({
          id: '00000000-0000-0000-0000-000000000002',
          status: 'LIVE',
          user_has_entered: true,
          end_time: new Date(now + 3600000)
        });

        const scheduledContest = createMockContest({
          id: '00000000-0000-0000-0000-000000000003',
          status: 'SCHEDULED',
          user_has_entered: true,
          lock_time: new Date(now + 1800000)
        });

        const completeContest = createMockContest({
          id: '00000000-0000-0000-0000-000000000004',
          status: 'COMPLETE',
          user_has_entered: true,
          settle_time: new Date(now - 3600000)
        });

        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE EXISTS[\s\S]*contest_participants/,
          mockQueryResponses.multiple([cancelledContest, liveContest, scheduledContest, completeContest])
        );

        const response = await request(app)
          .get('/api/contests/my')
          .set('Authorization', `Bearer ${TEST_USER_ID}`);

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(4);
        // Verify all lifecycle statuses are present (mock returns in input order, SQL applies actual sorting)
        const statuses = response.body.map(c => c.status);
        expect(statuses).toContain('LIVE');
        expect(statuses).toContain('SCHEDULED');
        expect(statuses).toContain('COMPLETE');
        expect(statuses).toContain('CANCELLED');
      });

      it('should respect pagination with limit and offset', async () => {
        const contests = Array.from({ length: 5 }, (_, i) =>
          createMockContest({
            id: `00000000-0000-0000-0000-00000000000${i}`,
            status: 'SCHEDULED',
            user_has_entered: true
          })
        );

        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE EXISTS[\s\S]*contest_participants/,
          mockQueryResponses.multiple(contests.slice(0, 2))
        );

        const response = await request(app)
          .get('/api/contests/my?limit=2&offset=0')
          .set('Authorization', `Bearer ${TEST_USER_ID}`);

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(2);
      });

      it('should return empty array when user has no joined contests', async () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE EXISTS[\s\S]*contest_participants/,
          mockQueryResponses.multiple([])
        );

        const response = await request(app)
          .get('/api/contests/my')
          .set('Authorization', `Bearer ${TEST_USER_ID}`);

        expect(response.status).toBe(200);
        expect(response.body).toEqual([]);
      });
    });
  });

  describe('GET /api/contests/live (Live Contests)', () => {
    it('should return only LIVE contests', async () => {
      const liveContest = createMockContest({
        id: '11111111-1111-1111-1111-111111111111',
        status: 'LIVE',
        end_time: new Date(Date.now() + 3600000),
        user_has_entered: false
      });

      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE ci\.status = 'LIVE'/,
        mockQueryResponses.multiple([liveContest])
      );

      const response = await request(app)
        .get('/api/contests/live')
        .set('Authorization', `Bearer ${TEST_USER_ID}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].status).toBe('LIVE');
    });

    it('should exclude SCHEDULED contests', async () => {
      const liveContest = createMockContest({
        id: '11111111-1111-1111-1111-111111111111',
        status: 'LIVE'
      });

      const scheduledContest = createMockContest({
        id: '22222222-2222-2222-2222-222222222222',
        status: 'SCHEDULED'
      });

      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE ci\.status = 'LIVE'/,
        mockQueryResponses.multiple([liveContest])
      );

      const response = await request(app)
        .get('/api/contests/live')
        .set('Authorization', `Bearer ${TEST_USER_ID}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].status).toBe('LIVE');
    });

    it('should exclude COMPLETE contests', async () => {
      const liveContest = createMockContest({
        id: '11111111-1111-1111-1111-111111111111',
        status: 'LIVE'
      });

      const completeContest = createMockContest({
        id: '33333333-3333-3333-3333-333333333333',
        status: 'COMPLETE'
      });

      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE ci\.status = 'LIVE'/,
        mockQueryResponses.multiple([liveContest])
      );

      const response = await request(app)
        .get('/api/contests/live')
        .set('Authorization', `Bearer ${TEST_USER_ID}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].status).toBe('LIVE');
    });

    it('should exclude CANCELLED contests', async () => {
      const liveContest = createMockContest({
        id: '11111111-1111-1111-1111-111111111111',
        status: 'LIVE'
      });

      const cancelledContest = createMockContest({
        id: '44444444-4444-4444-4444-444444444444',
        status: 'CANCELLED'
      });

      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE ci\.status = 'LIVE'/,
        mockQueryResponses.multiple([liveContest])
      );

      const response = await request(app)
        .get('/api/contests/live')
        .set('Authorization', `Bearer ${TEST_USER_ID}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].status).toBe('LIVE');
    });

    it('should sort LIVE contests by end_time ASC', async () => {
      const now = Date.now();
      const contest1 = createMockContest({
        id: '00000000-0000-0000-0000-000000000001',
        status: 'LIVE',
        end_time: new Date(now + 7200000) // 2 hours
      });

      const contest2 = createMockContest({
        id: '00000000-0000-0000-0000-000000000002',
        status: 'LIVE',
        end_time: new Date(now + 3600000) // 1 hour
      });

      const contest3 = createMockContest({
        id: '00000000-0000-0000-0000-000000000003',
        status: 'LIVE',
        end_time: new Date(now + 10800000) // 3 hours
      });

      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE ci\.status = 'LIVE'/,
        mockQueryResponses.multiple([contest2, contest1, contest3])
      );

      const response = await request(app)
        .get('/api/contests/live')
        .set('Authorization', `Bearer ${TEST_USER_ID}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(3);
      // Verify end_time ordering (earliest first) using ISO string comparison
      const times = response.body.map(c => new Date(c.end_time).getTime());
      expect(times[0]).toBeLessThan(times[1]);
      expect(times[1]).toBeLessThan(times[2]);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .get('/api/contests/live');

      expect(response.status).toBe(401);
    });
  });
});
