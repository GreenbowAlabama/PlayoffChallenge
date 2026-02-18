/**
 * Custom Contest Routes Unit Tests
 *
 * Purpose: Test custom contest API endpoints
 * - Template listing
 * - Contest creation with validation
 * - Contest retrieval
 * - Status transitions
 * - Join token resolution
 */

const request = require('supertest');
const express = require('express');
const customContestRoutes = require('../../routes/customContest.routes');
const { createMockPool, mockQueryResponses } = require('../mocks/mockPool');

// Test fixtures
const TEST_USER_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_USER_ID = '22222222-2222-2222-2222-222222222222';
const TEST_TEMPLATE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TEST_INSTANCE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const mockTemplate = {
  id: TEST_TEMPLATE_ID,
  name: 'NFL Playoff Challenge',
  sport: 'NFL',
  template_type: 'playoff_challenge',
  scoring_strategy_key: 'ppr',
  lock_strategy_key: 'first_game_kickoff',
  settlement_strategy_key: 'final_standings',
  default_entry_fee_cents: 2500,
  allowed_entry_fee_min_cents: 0,
  allowed_entry_fee_max_cents: 10000,
  allowed_payout_structures: [
    { first: 70, second: 20, third: 10 },
    { first: 100 }
  ],
  is_active: true
};

const mockInstance = {
  id: TEST_INSTANCE_ID,
  template_id: TEST_TEMPLATE_ID,
  organizer_id: TEST_USER_ID,
  contest_name: 'Test Contest',
  max_entries: 20,
  entry_fee_cents: 2500,
  payout_structure: { first: 70, second: 20, third: 10 },
  status: 'SCHEDULED',
  join_token: 'dev_abc123def456abc123def456abc123',
  start_time: null,
  lock_time: null,
  settlement_time: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
};

const mockInstanceWithTemplate = {
  ...mockInstance,
  template_name: mockTemplate.name,
  template_sport: mockTemplate.sport,
  template_type: mockTemplate.template_type,
  scoring_strategy_key: mockTemplate.scoring_strategy_key,
  lock_strategy_key: mockTemplate.lock_strategy_key,
  settlement_strategy_key: mockTemplate.settlement_strategy_key
};

describe('Custom Contest Routes', () => {
  let app;
  let mockPool;

  beforeEach(() => {
    process.env.APP_ENV = 'dev';
    process.env.JOIN_BASE_URL = 'https://app.playoffchallenge.com';
    mockPool = createMockPool();

    app = express();
    app.set('trust proxy', 1);
    app.use(express.json());
    app.locals.pool = mockPool;
    app.use('/api/custom-contests', customContestRoutes);
  });

  afterEach(() => {
    mockPool.reset();
    delete process.env.APP_ENV;
    delete process.env.JOIN_BASE_URL;
  });

  describe('GET /api/custom-contests/templates', () => {
    it('should return 200 with list of templates', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_templates WHERE is_active/,
        mockQueryResponses.multiple([mockTemplate])
      );

      const response = await request(app)
        .get('/api/custom-contests/templates');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body[0].name).toBe('NFL Playoff Challenge');
    });

    it('should return empty array if no templates', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_templates WHERE is_active/,
        mockQueryResponses.empty()
      );

      const response = await request(app)
        .get('/api/custom-contests/templates');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });
  });

  describe('GET /api/custom-contests/join/:token', () => {
    it('should return valid contest with join_url and enriched fields for valid token', async () => {
      const token = 'dev_abc123def456abc123def456abc123';
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*WHERE ci\.join_token/,
        mockQueryResponses.single({
          ...mockInstanceWithTemplate,
          join_token: token,
          status: 'SCHEDULED',
          max_entries: 10,
          entry_count: 3,
          user_has_entered: false,
          lock_time: new Date(Date.now() + 3600 * 1000).toISOString(),
          settle_time: null
        })
      );

      const response = await request(app)
        .get(`/api/custom-contests/join/${token}`);

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(true);
      expect(response.body.contest).toBeDefined();
      expect(response.body.contest.id).toBe(TEST_INSTANCE_ID);
      expect(response.body.contest.join_url).toBeDefined();
      expect(response.body.contest.join_url).toContain('/join/');
      // Derived fields from mapper
      expect(response.body.contest.entry_count).toBe(3);
      expect(response.body.contest.max_entries).toBe(10);
      expect(response.body.contest.is_locked).toBe(false);
      expect(response.body.contest.is_live).toBe(false);
      expect(response.body.contest.is_settled).toBe(false);
    });

    it('should return invalid with error_code for environment mismatch', async () => {
      const response = await request(app)
        .get('/api/custom-contests/join/prd_abc123');

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(false);
      expect(response.body.environment_mismatch).toBe(true);
      expect(response.body.error_code).toBe('CONTEST_ENV_MISMATCH');
    });

    it('should return invalid with error_code for unknown token', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*WHERE ci\.join_token/,
        mockQueryResponses.empty()
      );

      const response = await request(app)
        .get('/api/custom-contests/join/dev_notfound123456789012');

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(false);
      expect(response.body.reason).toContain('Contest not found');
      expect(response.body.error_code).toBe('CONTEST_NOT_FOUND');
    });

    it('should return CONTEST_LOCKED for locked contest', async () => {
      const token = 'dev_locked12345678901234567890';
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*WHERE ci\.join_token/,
        mockQueryResponses.single({
          ...mockInstanceWithTemplate,
          join_token: token,
          status: 'LOCKED',
          entry_count: 5,
          user_has_entered: false,
          lock_time: new Date(Date.now() - 1000).toISOString(),
          settle_time: null
        })
      );

      const response = await request(app)
        .get(`/api/custom-contests/join/${token}`);

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(false);
      expect(response.body.error_code).toBe('CONTEST_LOCKED');
    });

    it('should return CONTEST_UNAVAILABLE for cancelled contest', async () => {
      const token = 'dev_cancelled123456789012345';
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*WHERE ci\.join_token/,
        mockQueryResponses.single({
          ...mockInstanceWithTemplate,
          join_token: token,
          status: 'CANCELLED',
          entry_count: 5,
          user_has_entered: false,
          lock_time: null,
          settle_time: null
        })
      );

      const response = await request(app)
        .get(`/api/custom-contests/join/${token}`);

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(false);
      expect(response.body.error_code).toBe('CONTEST_UNAVAILABLE');
    });

    it('should accept optional source query parameter', async () => {
      const token = 'dev_abc123def456abc123def456abc123';
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*WHERE ci\.join_token/,
        mockQueryResponses.single({
          ...mockInstanceWithTemplate,
          join_token: token,
          status: 'SCHEDULED',
          max_entries: null,
          entry_count: 0,
          user_has_entered: false,
          lock_time: new Date(Date.now() + 3600 * 1000).toISOString(),
          settle_time: null
        })
      );

      const response = await request(app)
        .get(`/api/custom-contests/join/${token}?source=qr_code`);

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(true);
    });
  });

  describe('POST /api/custom-contests', () => {
    const validInput = {
      template_id: TEST_TEMPLATE_ID,
      contest_name: 'Test Contest',
      entry_fee_cents: 2500,
      payout_structure: { first: 70, second: 20, third: 10 }
    };

    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .post('/api/custom-contests')
        .send(validInput);

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Authentication required');
    });

    it('should return 400 for invalid UUID in X-User-Id header', async () => {
      const response = await request(app)
        .post('/api/custom-contests')
        .set('X-User-Id', 'not-a-uuid')
        .send(validInput);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid user ID format');

      // Verify no database query was made with invalid UUID
      const queries = mockPool.getQueryHistory();
      expect(queries.length).toBe(0);
    });

    it('should return 201 with valid input (no join_token until publish)', async () => {
      // Instances are created in SCHEDULED state with no join_token
      const scheduledInstance = { ...mockInstance, status: 'SCHEDULED', join_token: null };
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_templates WHERE id/,
        mockQueryResponses.single(mockTemplate)
      );
      mockPool.setQueryResponse(
        /INSERT INTO contest_instances/,
        mockQueryResponses.single(scheduledInstance)
      );

      const response = await request(app)
        .post('/api/custom-contests')
        .set('X-User-Id', TEST_USER_ID)
        .send(validInput);

      expect(response.status).toBe(201);
      expect(response.body.id).toBe(TEST_INSTANCE_ID);
      expect(response.body.status).toBe('SCHEDULED');
      // join_token and join_url are only set at publish time, not creation
      expect(response.body.join_token).toBeNull();
    });

    it('should return 400 for missing template_id', async () => {
      const response = await request(app)
        .post('/api/custom-contests')
        .set('X-User-Id', TEST_USER_ID)
        .send({
          entry_fee_cents: 2500,
          payout_structure: { first: 100 }
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('template_id is required');
    });

    it('should return 400 for invalid template_id format', async () => {
      const response = await request(app)
        .post('/api/custom-contests')
        .set('X-User-Id', TEST_USER_ID)
        .send({
          ...validInput,
          template_id: 'not-a-uuid'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid template_id format');
    });

    it('should return 404 for nonexistent template', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_templates WHERE id/,
        mockQueryResponses.empty()
      );

      const response = await request(app)
        .post('/api/custom-contests')
        .set('X-User-Id', TEST_USER_ID)
        .send(validInput);

      expect(response.status).toBe(404);
      expect(response.body.error).toContain('Template not found');
    });

    it('should return 400 for entry fee outside range', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_templates WHERE id/,
        mockQueryResponses.single(mockTemplate)
      );

      const response = await request(app)
        .post('/api/custom-contests')
        .set('X-User-Id', TEST_USER_ID)
        .send({
          ...validInput,
          entry_fee_cents: 50000
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('entry_fee_cents must be at most');
    });

    it('should return 400 for invalid payout structure', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_templates WHERE id/,
        mockQueryResponses.single(mockTemplate)
      );

      const response = await request(app)
        .post('/api/custom-contests')
        .set('X-User-Id', TEST_USER_ID)
        .send({
          ...validInput,
          payout_structure: { first: 50, second: 50 }
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('payout_structure must match');
    });

    describe('lock_time validation (contract enforcement)', () => {
      it('should allow lock_time = null', async () => {
        const scheduledInstance = { ...mockInstance, status: 'SCHEDULED', join_token: null, lock_time: null };
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_templates WHERE id/,
          mockQueryResponses.single(mockTemplate)
        );
        mockPool.setQueryResponse(
          /INSERT INTO contest_instances/,
          mockQueryResponses.single(scheduledInstance)
        );

        const response = await request(app)
          .post('/api/custom-contests')
          .set('X-User-Id', TEST_USER_ID)
          .send({
            ...validInput,
            lock_time: null
          });

        expect(response.status).toBe(201);
        expect(response.body.lock_time).toBeNull();
      });

      it('should normalize undefined lock_time to null', async () => {
        const scheduledInstance = { ...mockInstance, status: 'SCHEDULED', join_token: null, lock_time: null };
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_templates WHERE id/,
          mockQueryResponses.single(mockTemplate)
        );
        mockPool.setQueryResponse(
          /INSERT INTO contest_instances/,
          mockQueryResponses.single(scheduledInstance)
        );

        const response = await request(app)
          .post('/api/custom-contests')
          .set('X-User-Id', TEST_USER_ID)
          .send({
            template_id: TEST_TEMPLATE_ID,
            contest_name: 'Test Contest',
            entry_fee_cents: 2500,
            payout_structure: { first: 70, second: 20, third: 10 }
            // lock_time omitted entirely
          });

        expect(response.status).toBe(201);
        expect(response.body.lock_time).toBeNull();
      });

      it('should allow valid ISO lock_time', async () => {
        const isoTime = new Date(Date.now() + 3600000).toISOString();
        const scheduledInstance = { ...mockInstance, status: 'SCHEDULED', join_token: null, lock_time: isoTime };
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_templates WHERE id/,
          mockQueryResponses.single(mockTemplate)
        );
        mockPool.setQueryResponse(
          /INSERT INTO contest_instances/,
          mockQueryResponses.single(scheduledInstance)
        );

        const response = await request(app)
          .post('/api/custom-contests')
          .set('X-User-Id', TEST_USER_ID)
          .send({
            ...validInput,
            lock_time: isoTime
          });

        expect(response.status).toBe(201);
        expect(response.body.lock_time).toBeDefined();
        expect(response.body.lock_time).toBe(isoTime);
      });

      it('should reject invalid lock_time string with 400', async () => {
        mockPool.setQueryResponse(
          /SELECT[\s\S]*FROM contest_templates WHERE id/,
          mockQueryResponses.single(mockTemplate)
        );

        const response = await request(app)
          .post('/api/custom-contests')
          .set('X-User-Id', TEST_USER_ID)
          .send({
            ...validInput,
            lock_time: 'not-a-date'
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/Invalid lock_time|must be valid ISO date/);
      });
    });
  });

  describe('GET /api/custom-contests', () => {
    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .get('/api/custom-contests');

      expect(response.status).toBe(401);
    });

    it('should return organizer contests', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.organizer_id/,
        mockQueryResponses.multiple([{
          ...mockInstanceWithTemplate,
          entry_count: 5,
          user_has_entered: false,
          lock_time: new Date(Date.now() + 3600 * 1000).toISOString()
        }])
      );

      const response = await request(app)
        .get('/api/custom-contests')
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body[0].id).toBe(TEST_INSTANCE_ID);
    });

    it('should return empty array if no contests', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.organizer_id/,
        mockQueryResponses.empty()
      );

      const response = await request(app)
        .get('/api/custom-contests')
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should return user_has_entered: true when organizer is a participant in their contest', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.organizer_id/,
        mockQueryResponses.multiple([{
          ...mockInstanceWithTemplate,
          entry_count: 1,
          user_has_entered: true,
          lock_time: new Date(Date.now() + 3600 * 1000).toISOString()
        }])
      );

      const response = await request(app)
        .get('/api/custom-contests')
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(1);
      expect(response.body[0].user_has_entered).toBe(true);
    });

    it('should include user_has_entered for all contests in list', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.organizer_id/,
        mockQueryResponses.multiple([
          {
            ...mockInstanceWithTemplate,
            id: 'contest-1-id',
            entry_count: 5,
            user_has_entered: true,
            lock_time: new Date(Date.now() + 3600 * 1000).toISOString()
          },
          {
            ...mockInstanceWithTemplate,
            id: 'contest-2-id',
            entry_count: 3,
            user_has_entered: false,
            lock_time: new Date(Date.now() + 7200 * 1000).toISOString()
          }
        ])
      );

      const response = await request(app)
        .get('/api/custom-contests')
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(200);
      expect(response.body.length).toBe(2);
      expect(response.body[0].user_has_entered).toBe(true);
      expect(response.body[1].user_has_entered).toBe(false);
      // Verify both are boolean
      expect(typeof response.body[0].user_has_entered).toBe('boolean');
      expect(typeof response.body[1].user_has_entered).toBe('boolean');
    });
  });

  describe('GET /api/custom-contests/available', () => {
    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .get('/api/custom-contests/available');

      expect(response.status).toBe(401);
    });

    it('should return empty array when no published scheduled contests exist', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*WHERE ci\.status = 'SCHEDULED'[\s\S]*AND ci\.join_token IS NOT NULL/,
        mockQueryResponses.empty()
      );

      const response = await request(app)
        .get('/api/custom-contests/available')
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toEqual([]);
    });

    it('should return published scheduled contests', async () => {
      const futureTime = new Date(Date.now() + 3600 * 1000).toISOString();
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*WHERE ci\.status = 'SCHEDULED'[\s\S]*AND ci\.join_token IS NOT NULL/,
        mockQueryResponses.multiple([{
          ...mockInstanceWithTemplate,
          status: 'SCHEDULED',
          join_token: 'dev_abc123def456abc123def456abc123',
          entry_count: 5,
          user_has_entered: false,
          lock_time: futureTime
        }])
      );

      const response = await request(app)
        .get('/api/custom-contests/available')
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(1);
      expect(response.body[0].id).toBe(TEST_INSTANCE_ID);
      expect(response.body[0].status).toBe('SCHEDULED');
    });

    it('should include user_has_entered field correctly', async () => {
      const futureTime = new Date(Date.now() + 3600 * 1000).toISOString();
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*WHERE ci\.status = 'SCHEDULED'[\s\S]*AND ci\.join_token IS NOT NULL/,
        mockQueryResponses.multiple([
          {
            ...mockInstanceWithTemplate,
            id: 'contest-1-id',
            status: 'SCHEDULED',
            join_token: 'dev_token1',
            entry_count: 3,
            user_has_entered: true,
            lock_time: futureTime
          },
          {
            ...mockInstanceWithTemplate,
            id: 'contest-2-id',
            status: 'SCHEDULED',
            join_token: 'dev_token2',
            entry_count: 8,
            user_has_entered: false,
            lock_time: futureTime
          }
        ])
      );

      const response = await request(app)
        .get('/api/custom-contests/available')
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(200);
      expect(response.body.length).toBe(2);
      expect(response.body[0].user_has_entered).toBe(true);
      expect(response.body[1].user_has_entered).toBe(false);
      expect(typeof response.body[0].user_has_entered).toBe('boolean');
      expect(typeof response.body[1].user_has_entered).toBe('boolean');
    });

    it('should include contests where user has already entered', async () => {
      const futureTime = new Date(Date.now() + 3600 * 1000).toISOString();
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*WHERE ci\.status = 'SCHEDULED'[\s\S]*AND ci\.join_token IS NOT NULL/,
        mockQueryResponses.multiple([{
          ...mockInstanceWithTemplate,
          status: 'SCHEDULED',
          join_token: 'dev_abc123',
          entry_count: 15,
          user_has_entered: true,
          lock_time: futureTime
        }])
      );

      const response = await request(app)
        .get('/api/custom-contests/available')
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(200);
      expect(response.body.length).toBe(1);
      expect(response.body[0].user_has_entered).toBe(true);
    });

    it('should include full contests in results', async () => {
      const futureTime = new Date(Date.now() + 3600 * 1000).toISOString();
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*WHERE ci\.status = 'SCHEDULED'[\s\S]*AND ci\.join_token IS NOT NULL/,
        mockQueryResponses.multiple([{
          ...mockInstanceWithTemplate,
          status: 'SCHEDULED',
          join_token: 'dev_full123',
          max_entries: 10,
          entry_count: 10,
          user_has_entered: false,
          lock_time: futureTime
        }])
      );

      const response = await request(app)
        .get('/api/custom-contests/available')
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(200);
      expect(response.body.length).toBe(1);
      expect(response.body[0].entry_count).toBe(10);
      expect(response.body[0].max_entries).toBe(10);
    });

    it('should preserve organizer_name from database (regression test)', async () => {
      const futureTime = new Date(Date.now() + 3600 * 1000).toISOString();
      const organizerUsername = 'Ian-testin';
      const requestingUserId = 'B9F8EFF1-16AC-4B94-9DD7-06BA0B372E54';
      const contestOrganizerId = OTHER_USER_ID; // Different from requesting user

      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*WHERE ci\.status = 'SCHEDULED'[\s\S]*AND ci\.join_token IS NOT NULL/,
        mockQueryResponses.multiple([{
          ...mockInstanceWithTemplate,
          id: 'contest-with-different-organizer',
          organizer_id: contestOrganizerId,
          organizer_name: organizerUsername, // Key assertion: this should NOT be overwritten
          status: 'SCHEDULED',
          join_token: 'dev_test_token_123',
          entry_count: 2,
          user_has_entered: false,
          lock_time: futureTime
        }])
      );

      const response = await request(app)
        .get('/api/custom-contests/available')
        .set('X-User-Id', requestingUserId);

      expect(response.status).toBe(200);
      expect(response.body.length).toBe(1);
      expect(response.body[0].id).toBe('contest-with-different-organizer');
      expect(response.body[0].organizer_id).toBe(contestOrganizerId);
      // CRITICAL: organizer_name must come from DB, NOT from requesting user
      expect(response.body[0].organizer_name).toBe(organizerUsername);
      expect(response.body[0].organizer_name).not.toBe(requestingUserId);
    });
  });

  describe('GET /api/custom-contests/:id', () => {
    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .get(`/api/custom-contests/${TEST_INSTANCE_ID}`);

      expect(response.status).toBe(401);
    });

    it('should return contest instance', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id/,
        mockQueryResponses.single({
          ...mockInstanceWithTemplate,
          entry_count: 5,
          user_has_entered: false,
          lock_time: new Date(Date.now() + 3600 * 1000).toISOString()
        })
      );

      const response = await request(app)
        .get(`/api/custom-contests/${TEST_INSTANCE_ID}`)
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(TEST_INSTANCE_ID);
      expect(response.body.contest_name).toBe('Test Contest');
      expect(response.body.max_entries).toBe(20);
    });

    it('should return 400 for invalid UUID', async () => {
      const response = await request(app)
        .get('/api/custom-contests/not-a-uuid')
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid contest ID format');
    });

    it('should return 404 for nonexistent contest', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id/,
        mockQueryResponses.empty()
      );

      const response = await request(app)
        .get(`/api/custom-contests/${TEST_INSTANCE_ID}`)
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Contest not found');
    });

    it('should return user_has_entered: true when authenticated user has entered contest', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id/,
        mockQueryResponses.single({
          ...mockInstanceWithTemplate,
          entry_count: 5,
          user_has_entered: true,
          lock_time: new Date(Date.now() + 3600 * 1000).toISOString()
        })
      );

      const response = await request(app)
        .get(`/api/custom-contests/${TEST_INSTANCE_ID}`)
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(200);
      expect(response.body.user_has_entered).toBe(true);
    });

    it('should return user_has_entered: false when authenticated user has not entered contest', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id/,
        mockQueryResponses.single({
          ...mockInstanceWithTemplate,
          entry_count: 5,
          user_has_entered: false,
          lock_time: new Date(Date.now() + 3600 * 1000).toISOString()
        })
      );

      const response = await request(app)
        .get(`/api/custom-contests/${TEST_INSTANCE_ID}`)
        .set('X-User-Id', OTHER_USER_ID);

      expect(response.status).toBe(200);
      expect(response.body.user_has_entered).toBe(false);
    });

    it('should always include user_has_entered field in response', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id/,
        mockQueryResponses.single({
          ...mockInstanceWithTemplate,
          entry_count: 0,
          user_has_entered: false,
          lock_time: new Date(Date.now() + 3600 * 1000).toISOString()
        })
      );

      const response = await request(app)
        .get(`/api/custom-contests/${TEST_INSTANCE_ID}`)
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('user_has_entered');
      expect(typeof response.body.user_has_entered).toBe('boolean');
    });
  });

  describe('POST /api/custom-contests/:id/publish', () => {
    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .post(`/api/custom-contests/${TEST_INSTANCE_ID}/publish`);

      expect(response.status).toBe(401);
    });

    it('should publish SCHEDULED contest and return contestId, joinToken, joinURL', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id/,
        mockQueryResponses.single({
          ...mockInstanceWithTemplate,
          status: 'SCHEDULED',
          join_token: null,
          entry_count: 0,
          user_has_entered: false,
          lock_time: new Date(Date.now() + 3600 * 1000).toISOString()
        })
      );
      // The mock response from publishContestInstance will have the token
      mockPool.setQueryResponse(
        /UPDATE contest_instances SET join_token/,
        mockQueryResponses.single({ ...mockInstance, status: 'SCHEDULED' })
      );
      mockPool.setQueryResponse(
        /INSERT INTO contest_participants/,
        mockQueryResponses.single({})
      );

      const response = await request(app)
        .post(`/api/custom-contests/${TEST_INSTANCE_ID}/publish`)
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(200);
      // Verify the specific response format
      expect(response.body.contestId).toBe(TEST_INSTANCE_ID);
      expect(response.body.joinToken).toBe(mockInstance.join_token);
      expect(response.body.joinURL).toBeDefined();
      expect(response.body.joinURL).toContain('/join/');
      expect(response.body.joinURL).toContain(mockInstance.join_token);
    });

    it('should return 400 for invalid UUID', async () => {
      const response = await request(app)
        .post('/api/custom-contests/not-a-uuid/publish')
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid contest ID format');
    });

    it('should return 404 for nonexistent contest', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id/,
        mockQueryResponses.empty()
      );

      const response = await request(app)
        .post(`/api/custom-contests/${TEST_INSTANCE_ID}/publish`)
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(404);
      expect(response.body.error).toContain('Contest instance not found');
    });

    it('should return 403 if not organizer', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id/,
        mockQueryResponses.single({
          ...mockInstanceWithTemplate,
          organizer_id: OTHER_USER_ID,
          entry_count: 0,
          user_has_entered: false,
          lock_time: new Date(Date.now() + 3600 * 1000).toISOString()
        })
      );

      const response = await request(app)
        .post(`/api/custom-contests/${TEST_INSTANCE_ID}/publish`)
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Only the organizer');
    });

    it('should return 403 for invalid transition', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id/,
        mockQueryResponses.single({
          ...mockInstanceWithTemplate,
          status: 'LOCKED',
          join_token: null,
          entry_count: 0,
          user_has_entered: false,
          lock_time: new Date(Date.now() + 3600 * 1000).toISOString()
        })
      );

      const response = await request(app)
        .post(`/api/custom-contests/${TEST_INSTANCE_ID}/publish`)
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(403);
      expect(response.body.error).toContain("Only 'SCHEDULED' contests can be published");
    });

    it('should return 409 for race condition during publish', async () => {
      // First query returns SCHEDULED contest
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id/,
        mockQueryResponses.single({
          ...mockInstanceWithTemplate,
          status: 'SCHEDULED',
          join_token: null,
          entry_count: 0,
          user_has_entered: false,
          lock_time: new Date(Date.now() + 3600 * 1000).toISOString()
        })
      );
      // Update returns empty (another operation modified it)
      mockPool.setQueryResponse(
        /UPDATE contest_instances SET join_token/,
        mockQueryResponses.empty()
      );

      const response = await request(app)
        .post(`/api/custom-contests/${TEST_INSTANCE_ID}/publish`)
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(409);
      expect(response.body.error).toContain('was modified by another operation');
    });
  });

  describe('PATCH /api/custom-contests/:id/status', () => {
    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .patch(`/api/custom-contests/${TEST_INSTANCE_ID}/status`)
        .send({ status: 'cancelled' });

      expect(response.status).toBe(401);
    });

    it('should update status successfully', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id/,
        mockQueryResponses.single({
          ...mockInstanceWithTemplate,
          status: 'SCHEDULED',
          entry_count: 5,
          user_has_entered: false,
          lock_time: new Date(Date.now() + 3600 * 1000).toISOString()
        })
      );
      mockPool.setQueryResponse(
        /SELECT status FROM contest_instances WHERE id/,
        mockQueryResponses.single({ status: 'SCHEDULED' })
      );
      mockPool.setQueryResponse(
        /UPDATE contest_instances SET status/,
        mockQueryResponses.single({ ...mockInstance, status: 'CANCELLED' })
      );

      const response = await request(app)
        .patch(`/api/custom-contests/${TEST_INSTANCE_ID}/status`)
        .set('X-User-Id', TEST_USER_ID)
        .send({ status: 'CANCELLED' });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('CANCELLED');
    });

    it('should return 400 for missing status', async () => {
      const response = await request(app)
        .patch(`/api/custom-contests/${TEST_INSTANCE_ID}/status`)
        .set('X-User-Id', TEST_USER_ID)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('status is required');
    });

    it('should return 400 for invalid status value', async () => {
      const response = await request(app)
        .patch(`/api/custom-contests/${TEST_INSTANCE_ID}/status`)
        .set('X-User-Id', TEST_USER_ID)
        .send({ status: 'invalid_status' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid status');
    });

    it('should return 403 if not organizer', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id/,
        mockQueryResponses.single({
          ...mockInstanceWithTemplate,
          organizer_id: OTHER_USER_ID,
          entry_count: 5,
          user_has_entered: false,
          lock_time: new Date(Date.now() + 3600 * 1000).toISOString()
        })
      );

      const response = await request(app)
        .patch(`/api/custom-contests/${TEST_INSTANCE_ID}/status`)
        .set('X-User-Id', TEST_USER_ID)
        .send({ status: 'CANCELLED' });

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Only the organizer');
    });

    it('should return 403 for invalid transition', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*LEFT JOIN users u ON u\.id = ci\.organizer_id[\s\S]*WHERE ci\.id/,
        mockQueryResponses.single({
          ...mockInstanceWithTemplate,
          status: 'COMPLETE',
          entry_count: 5,
          user_has_entered: false,
          lock_time: new Date().toISOString(),
          settle_time: new Date().toISOString()
        })
      );
      mockPool.setQueryResponse(
        /SELECT status FROM contest_instances WHERE id/,
        mockQueryResponses.single({ status: 'COMPLETE' })
      );
      mockPool.setQueryResponse(
        /SELECT results FROM settlement_records WHERE contest_instance_id/,
        mockQueryResponses.single({
          results: { rankings: [{ user_id: TEST_USER_ID, score: 100, rank: 1 }], payouts: [] }
        })
      );
      mockPool.setQueryResponse(
        /SELECT id, COALESCE\(username, name, 'Unknown'\) AS user_display_name FROM users WHERE id = ANY/,
        mockQueryResponses.multiple([{ id: TEST_USER_ID, user_display_name: 'TestUser' }])
      );

      const response = await request(app)
        .patch(`/api/custom-contests/${TEST_INSTANCE_ID}/status`)
        .set('X-User-Id', TEST_USER_ID)
        .send({ status: 'SCHEDULED' });

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Cannot transition');
    });
  });

  // ==========================================================
  // JOIN ENDPOINT (Step 5 — participant enforcement)
  // ==========================================================

  describe('POST /api/custom-contests/:id/join', () => {
    const openInstance = {
      id: TEST_INSTANCE_ID,
      status: 'SCHEDULED',
      join_token: 'dev_some_token',
      max_entries: 10,
    };

    const mockParticipant = {
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      contest_instance_id: TEST_INSTANCE_ID,
      user_id: TEST_USER_ID,
      joined_at: new Date().toISOString()
    };

    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .post(`/api/custom-contests/${TEST_INSTANCE_ID}/join`);

      expect(response.status).toBe(401);
    });

    it('should return 400 for invalid UUID', async () => {
      const response = await request(app)
        .post('/api/custom-contests/not-a-uuid/join')
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid contest ID format');
    });

    it('should return 200 on successful join', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE[\s\S]*id[\s\S]*=[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(openInstance)
      );
      // Pre-check: no existing participant
      mockPool.setQueryResponse(
        /SELECT[\s\S]*id[\s\S]*contest_instance_id[\s\S]*user_id[\s\S]*FROM contest_participants[\s\S]*WHERE[\s\S]*contest_instance_id[\s\S]*AND[\s\S]*user_id/,
        mockQueryResponses.empty()
      );
      // Capacity check
      mockPool.setQueryResponse(
        /SELECT COUNT\(\*\) AS current_count FROM contest_participants/,
        mockQueryResponses.single({ current_count: '3' })
      );
      // INSERT succeeds with capacity available
      mockPool.setQueryResponse(
        /INSERT INTO contest_participants[\s\S]*ON CONFLICT[\s\S]*DO NOTHING/,
        mockQueryResponses.single(mockParticipant)
      );

      const response = await request(app)
        .post(`/api/custom-contests/${TEST_INSTANCE_ID}/join`)
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(200);
      expect(response.body.joined).toBe(true);
      expect(response.body.participant).toBeDefined();
      expect(response.body.participant.contest_instance_id).toBe(TEST_INSTANCE_ID);
    });

    it('should return 200 (idempotent) when user already joined', async () => {
      // Simulate user already being a participant
      // Contest lock query
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE[\s\S]*id[\s\S]*=[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(openInstance)
      );
      // Pre-check: finds existing participant
      mockPool.setQueryResponse(
        /SELECT[\s\S]*id[\s\S]*contest_instance_id[\s\S]*user_id[\s\S]*FROM contest_participants[\s\S]*WHERE[\s\S]*contest_instance_id[\s\S]*AND[\s\S]*user_id/,
        mockQueryResponses.single(mockParticipant)
      );

      const response = await request(app)
        .post(`/api/custom-contests/${TEST_INSTANCE_ID}/join`)
        .set('X-User-Id', TEST_USER_ID);

      // Should return success (200), not error (409) - this is idempotency
      expect(response.status).toBe(200);
      expect(response.body.joined).toBe(true);
      expect(response.body.participant).toBeDefined();
      expect(response.body.participant.user_id).toBe(TEST_USER_ID);
    });

    it('should return 409 for CONTEST_FULL', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE[\s\S]*id[\s\S]*=[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({ ...openInstance, max_entries: 5 })
      );
      // Pre-check: no existing participant
      mockPool.setQueryResponse(
        /SELECT[\s\S]*id[\s\S]*contest_instance_id[\s\S]*user_id[\s\S]*FROM contest_participants[\s\S]*WHERE[\s\S]*contest_instance_id[\s\S]*AND[\s\S]*user_id/,
        mockQueryResponses.empty()
      );
      // Capacity check: already at max
      mockPool.setQueryResponse(
        /SELECT COUNT\(\*\) AS current_count FROM contest_participants/,
        mockQueryResponses.single({ current_count: '5' })
      );

      const response = await request(app)
        .post(`/api/custom-contests/${TEST_INSTANCE_ID}/join`)
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(409);
      expect(response.body.error_code).toBe('CONTEST_FULL');
    });

    it('should return 404 for non-existent contest', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE[\s\S]*id[\s\S]*=[\s\S]*FOR UPDATE/,
        mockQueryResponses.empty()
      );

      const response = await request(app)
        .post(`/api/custom-contests/${TEST_INSTANCE_ID}/join`)
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(404);
      expect(response.body.error_code).toBe('CONTEST_NOT_FOUND');
    });

    it('should return 409 for locked contest', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE[\s\S]*id[\s\S]*=[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({ ...openInstance, status: 'LOCKED' })
      );

      const response = await request(app)
        .post(`/api/custom-contests/${TEST_INSTANCE_ID}/join`)
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(409);
      expect(response.body.error_code).toBe('CONTEST_LOCKED');
    });

    it('should return 409 for unpublished contest', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE[\s\S]*id[\s\S]*=[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({ ...openInstance, status: 'SCHEDULED', join_token: null })
      );

      const response = await request(app)
        .post(`/api/custom-contests/${TEST_INSTANCE_ID}/join`)
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(409);
      expect(response.body.error_code).toBe('CONTEST_UNAVAILABLE');
    });
  });

  // ============================================
  // Iteration 01: Presentation Contract Tests
  // ============================================

  describe('GET /api/custom-contests/:id (Contest Detail Contract)', () => {
    it('should include leaderboard_state, actions, payout_table, roster_config in response', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*WHERE ci\.id = \$1/,
        mockQueryResponses.single({
          ...mockInstanceWithTemplate,
          status: 'LIVE',
          entry_count: 5,
          user_has_entered: true,
          settle_time: null,
          standings: [
            { user_id: 'user1', user_display_name: 'Player 1', total_score: 100, rank: 1 },
            { user_id: 'user2', user_display_name: 'Player 2', total_score: 90, rank: 2 }
          ]
        })
      );

      // Mock settlement_records query
      mockPool.setQueryResponse(
        /SELECT 1 FROM settlement_records WHERE contest_instance_id/,
        mockQueryResponses.empty()
      );

      const response = await request(app)
        .get(`/api/custom-contests/${TEST_INSTANCE_ID}`)
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('leaderboard_state');
      expect(response.body).toHaveProperty('actions');
      expect(response.body).toHaveProperty('payout_table');
      expect(response.body).toHaveProperty('roster_config');
    });

    it('should have actions object with boolean flags', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*WHERE ci\.id = \$1/,
        mockQueryResponses.single({
          ...mockInstanceWithTemplate,
          status: 'SCHEDULED',
          entry_count: 5,
          user_has_entered: false,
          lock_time: new Date(Date.now() + 3600000).toISOString(),
          settle_time: null
        })
      );

      mockPool.setQueryResponse(
        /SELECT 1 FROM settlement_records WHERE contest_instance_id/,
        mockQueryResponses.empty()
      );

      const response = await request(app)
        .get(`/api/custom-contests/${TEST_INSTANCE_ID}`)
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(200);
      const actions = response.body.actions;
      expect(typeof actions.can_join).toBe('boolean');
      expect(typeof actions.can_edit_entry).toBe('boolean');
      expect(typeof actions.is_live).toBe('boolean');
      expect(typeof actions.is_closed).toBe('boolean');
      expect(typeof actions.is_scoring).toBe('boolean');
      expect(typeof actions.is_scored).toBe('boolean');
      expect(typeof actions.is_read_only).toBe('boolean');
    });

    it('should have payout_table as array', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*WHERE ci\.id = \$1/,
        mockQueryResponses.single({
          ...mockInstanceWithTemplate,
          status: 'SCHEDULED',
          payout_structure: { first: 70, second: 20, third: 10 },
          entry_count: 5,
          user_has_entered: false,
          lock_time: new Date(Date.now() + 3600000).toISOString(),
          settle_time: null
        })
      );

      mockPool.setQueryResponse(
        /SELECT 1 FROM settlement_records WHERE contest_instance_id/,
        mockQueryResponses.empty()
      );

      const response = await request(app)
        .get(`/api/custom-contests/${TEST_INSTANCE_ID}`)
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.payout_table)).toBe(true);
      expect(response.body.payout_table.length).toBe(3);
      expect(response.body.payout_table[0]).toHaveProperty('place');
      expect(response.body.payout_table[0]).toHaveProperty('payout_percent');
    });

    it('CONTRACT: payout_table rows must have rank_min (iOS compatibility)', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*WHERE ci\.id = \$1/,
        mockQueryResponses.single({
          ...mockInstanceWithTemplate,
          status: 'SCHEDULED',
          payout_structure: { first: 70, second: 20, third: 10 },
          entry_count: 5,
          user_has_entered: false,
          lock_time: new Date(Date.now() + 3600000).toISOString(),
          settle_time: null
        })
      );

      mockPool.setQueryResponse(
        /SELECT 1 FROM settlement_records WHERE contest_instance_id/,
        mockQueryResponses.empty()
      );

      const response = await request(app)
        .get(`/api/custom-contests/${TEST_INSTANCE_ID}`)
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(200);
      expect(response.body.payout_table).toBeDefined();
      expect(Array.isArray(response.body.payout_table)).toBe(true);
      expect(response.body.payout_table.length).toBeGreaterThan(0);

      // CONTRACT: All payout rows must include rank_min (required for iOS decoder)
      response.body.payout_table.forEach(row => {
        expect(row).toHaveProperty('rank_min');
        expect(typeof row.rank_min).toBe('number');
      });
    });

    it('CONTRACT: payout_table rows must have rank_max (iOS compatibility)', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*WHERE ci\.id = \$1/,
        mockQueryResponses.single({
          ...mockInstanceWithTemplate,
          status: 'SCHEDULED',
          payout_structure: { first: 70, second: 20, third: 10 },
          entry_count: 5,
          user_has_entered: false,
          lock_time: new Date(Date.now() + 3600000).toISOString(),
          settle_time: null
        })
      );

      mockPool.setQueryResponse(
        /SELECT 1 FROM settlement_records WHERE contest_instance_id/,
        mockQueryResponses.empty()
      );

      const response = await request(app)
        .get(`/api/custom-contests/${TEST_INSTANCE_ID}`)
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(200);
      expect(response.body.payout_table).toBeDefined();
      expect(Array.isArray(response.body.payout_table)).toBe(true);
      expect(response.body.payout_table.length).toBeGreaterThan(0);

      // CONTRACT: All payout rows must include rank_max (required for iOS decoder)
      response.body.payout_table.forEach(row => {
        expect(row).toHaveProperty('rank_max');
        expect(typeof row.rank_max).toBe('number');
      });
    });

    it('CONTRACT: payout_table rows must have payout_amount (iOS ContestDetailResponseContract)', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*WHERE ci\.id = \$1/,
        mockQueryResponses.single({
          ...mockInstanceWithTemplate,
          status: 'SCHEDULED',
          payout_structure: { first: 70, second: 20, third: 10 },
          entry_count: 5,
          user_has_entered: false,
          lock_time: new Date(Date.now() + 3600000).toISOString(),
          settle_time: null
        })
      );

      mockPool.setQueryResponse(
        /SELECT 1 FROM settlement_records WHERE contest_instance_id/,
        mockQueryResponses.empty()
      );

      const response = await request(app)
        .get(`/api/custom-contests/${TEST_INSTANCE_ID}`)
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(200);
      expect(response.body.payout_table).toBeDefined();

      // CONTRACT: All payout rows must include payout_amount (required for iOS decoder)
      response.body.payout_table.forEach(row => {
        expect(row).toHaveProperty('payout_amount');
        // payout_amount is null until settlement; iOS decoder expects field to exist
      });
    });

    it('CONTRACT: payout_table must NOT include legacy min_rank or max_rank fields', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*WHERE ci\.id = \$1/,
        mockQueryResponses.single({
          ...mockInstanceWithTemplate,
          status: 'SCHEDULED',
          payout_structure: { first: 70, second: 20, third: 10 },
          entry_count: 5,
          user_has_entered: false,
          lock_time: new Date(Date.now() + 3600000).toISOString(),
          settle_time: null
        })
      );

      mockPool.setQueryResponse(
        /SELECT 1 FROM settlement_records WHERE contest_instance_id/,
        mockQueryResponses.empty()
      );

      const response = await request(app)
        .get(`/api/custom-contests/${TEST_INSTANCE_ID}`)
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(200);
      expect(response.body.payout_table).toBeDefined();

      // CONTRACT: Must NOT include old field names (would break iOS decoder)
      response.body.payout_table.forEach(row => {
        expect(row).not.toHaveProperty('min_rank');
        expect(row).not.toHaveProperty('max_rank');
      });
    });

    it('CONTRACT: can_manage_contest must be true for organizer (case-insensitive)', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*WHERE ci\.id = \$1/,
        mockQueryResponses.single({
          ...mockInstanceWithTemplate,
          organizer_id: TEST_USER_ID.toUpperCase(), // Test case-insensitive comparison
          status: 'SCHEDULED',
          payout_structure: { first: 70, second: 20, third: 10 },
          entry_count: 5,
          user_has_entered: true,
          lock_time: new Date(Date.now() + 3600000).toISOString(),
          settle_time: null
        })
      );

      mockPool.setQueryResponse(
        /SELECT 1 FROM settlement_records WHERE contest_instance_id/,
        mockQueryResponses.empty()
      );

      // Request with lowercase userId
      const response = await request(app)
        .get(`/api/custom-contests/${TEST_INSTANCE_ID}`)
        .set('X-User-Id', TEST_USER_ID.toLowerCase());

      expect(response.status).toBe(200);
      expect(response.body.actions).toBeDefined();
      // GOVERNANCE: Organizer can manage contest
      expect(response.body.actions.can_manage_contest).toBe(true);
    });
  });

  describe('GET /api/custom-contests/:id/leaderboard', () => {
    it('should return 404 for non-existent contest', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*WHERE ci\.id = \$1/,
        mockQueryResponses.empty()
      );

      const response = await request(app)
        .get(`/api/custom-contests/${TEST_INSTANCE_ID}/leaderboard`)
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error');
    });

    it('should return leaderboard for LIVE contest with pending state', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*WHERE ci\.id = \$1/,
        mockQueryResponses.single({
          id: TEST_INSTANCE_ID,
          template_type: 'playoff_challenge',
          status: 'LIVE',
          start_time: null,
          lock_time: null,
          end_time: new Date(Date.now() + 3600000).toISOString(),
          template_id: TEST_TEMPLATE_ID
        })
      );

      mockPool.setQueryResponse(
        /SELECT 1 FROM settlement_records WHERE contest_instance_id/,
        mockQueryResponses.empty()
      );

      // Mock standings query
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_participants cp[\s\S]*LEFT JOIN picks/,
        mockQueryResponses.multiple([
          { user_id: 'user1', user_display_name: 'Player 1', total_score: 100 },
          { user_id: 'user2', user_display_name: 'Player 2', total_score: 90 }
        ])
      );

      const response = await request(app)
        .get(`/api/custom-contests/${TEST_INSTANCE_ID}/leaderboard`)
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(200);
      expect(response.body.contest_id).toBe(TEST_INSTANCE_ID);
      expect(response.body.leaderboard_state).toBe('pending');
      expect(response.body).toHaveProperty('generated_at');
      expect(response.body).toHaveProperty('column_schema');
      expect(response.body).toHaveProperty('rows');
      expect(response.body).toHaveProperty('pagination');
      expect(Array.isArray(response.body.rows)).toBe(true);
    });

    it('should return leaderboard for COMPLETE contest with computed state', async () => {
      const settlementResults = {
        rankings: [
          { user_id: 'user1', score: 100, rank: 1 },
          { user_id: 'user2', score: 90, rank: 2 }
        ]
      };

      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*WHERE ci\.id = \$1/,
        mockQueryResponses.single({
          id: TEST_INSTANCE_ID,
          template_type: 'playoff_challenge',
          status: 'COMPLETE',
          start_time: null,
          lock_time: null,
          end_time: null,
          template_id: TEST_TEMPLATE_ID
        })
      );

      mockPool.setQueryResponse(
        /SELECT 1 FROM settlement_records WHERE contest_instance_id/,
        mockQueryResponses.single({ id: 'settlement-1' })
      );

      // Mock settlement_records results query
      mockPool.setQueryResponse(
        /SELECT results FROM settlement_records WHERE contest_instance_id/,
        mockQueryResponses.single({ results: settlementResults })
      );

      // Mock users query for display names
      mockPool.setQueryResponse(
        /SELECT id, COALESCE\(username, name, 'Unknown'\) AS user_display_name FROM users WHERE id = ANY/,
        mockQueryResponses.multiple([
          { id: 'user1', user_display_name: 'Player 1' },
          { id: 'user2', user_display_name: 'Player 2' }
        ])
      );

      const response = await request(app)
        .get(`/api/custom-contests/${TEST_INSTANCE_ID}/leaderboard`)
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(200);
      expect(response.body.leaderboard_state).toBe('computed');
      expect(Array.isArray(response.body.rows)).toBe(true);
    });

    it('should return error state for ERROR contest', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*WHERE ci\.id = \$1/,
        mockQueryResponses.single({
          id: TEST_INSTANCE_ID,
          template_type: 'playoff_challenge',
          status: 'ERROR',
          start_time: null,
          lock_time: null,
          end_time: null,
          template_id: TEST_TEMPLATE_ID
        })
      );

      mockPool.setQueryResponse(
        /SELECT 1 FROM settlement_records WHERE contest_instance_id/,
        mockQueryResponses.empty()
      );

      const response = await request(app)
        .get(`/api/custom-contests/${TEST_INSTANCE_ID}/leaderboard`)
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(200);
      expect(response.body.leaderboard_state).toBe('error');
      expect(response.body.rows).toEqual([]);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .get(`/api/custom-contests/${TEST_INSTANCE_ID}/leaderboard`);

      expect(response.status).toBe(401);
    });

    it('should include column_schema in response', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*WHERE ci\.id = \$1/,
        mockQueryResponses.single({
          id: TEST_INSTANCE_ID,
          template_type: 'playoff_challenge',
          status: 'LIVE',
          start_time: null,
          lock_time: null,
          end_time: new Date(Date.now() + 3600000).toISOString(),
          template_id: TEST_TEMPLATE_ID
        })
      );

      mockPool.setQueryResponse(
        /SELECT 1 FROM settlement_records WHERE contest_instance_id/,
        mockQueryResponses.empty()
      );

      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_participants cp[\s\S]*LEFT JOIN picks/,
        mockQueryResponses.multiple([
          { user_id: 'user1', user_display_name: 'Player 1', total_score: 100 }
        ])
      );

      const response = await request(app)
        .get(`/api/custom-contests/${TEST_INSTANCE_ID}/leaderboard`)
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.column_schema)).toBe(true);
      expect(response.body.column_schema.length).toBeGreaterThan(0);
      // Verify schema has expected fields
      const rankColumn = response.body.column_schema.find(col => col.key === 'rank');
      expect(rankColumn).toBeDefined();
    });
  });
});
