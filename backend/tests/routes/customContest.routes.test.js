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
          organizer_name: 'TestUser',
          entries_current: 3
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
      // Enriched fields
      expect(response.body.contest.computedJoinState).toBe('JOINABLE');
      expect(response.body.contest.organizer_name).toBe('TestUser');
      expect(response.body.contest.entries_current).toBe(3);
      expect(response.body.contest.max_entries).toBe(10);
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
        mockQueryResponses.single({ ...mockInstanceWithTemplate, join_token: token, status: 'locked' })
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
        mockQueryResponses.single({ ...mockInstanceWithTemplate, join_token: token, status: 'cancelled' })
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
          organizer_name: 'TestUser',
          entries_current: 0
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
  });

  describe('GET /api/custom-contests', () => {
    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .get('/api/custom-contests');

      expect(response.status).toBe(401);
    });

    it('should return organizer contests', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.organizer_id/,
        mockQueryResponses.multiple([mockInstanceWithTemplate])
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
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.organizer_id/,
        mockQueryResponses.empty()
      );

      const response = await request(app)
        .get('/api/custom-contests')
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
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
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
        mockQueryResponses.single(mockInstanceWithTemplate)
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
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
        mockQueryResponses.empty()
      );

      const response = await request(app)
        .get(`/api/custom-contests/${TEST_INSTANCE_ID}`)
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Contest not found');
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
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
        mockQueryResponses.single({ ...mockInstanceWithTemplate, status: 'SCHEDULED', join_token: null })
      );
      // The mock response from publishContestInstance will have the token
      mockPool.setQueryResponse(
        /UPDATE contest_instances SET join_token/,
        mockQueryResponses.single({ ...mockInstance, status: 'SCHEDULED' })
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
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
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
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
        mockQueryResponses.single({ ...mockInstanceWithTemplate, organizer_id: OTHER_USER_ID })
      );

      const response = await request(app)
        .post(`/api/custom-contests/${TEST_INSTANCE_ID}/publish`)
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Only the organizer');
    });

    it('should return 403 for invalid transition', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
        mockQueryResponses.single({ ...mockInstanceWithTemplate, status: 'LOCKED', join_token: null })
      );

      const response = await request(app)
        .post(`/api/custom-contests/${TEST_INSTANCE_ID}/publish`)
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(500);
      expect(response.body.error).toContain("Failed to publish contest");
    });

    it('should return 409 for race condition during publish', async () => {
      // First query returns SCHEDULED contest
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
        mockQueryResponses.single({ ...mockInstanceWithTemplate, status: 'SCHEDULED', join_token: null })
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
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
        mockQueryResponses.single({ ...mockInstanceWithTemplate, status: 'SCHEDULED' })
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
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
        mockQueryResponses.single({ ...mockInstanceWithTemplate, organizer_id: OTHER_USER_ID })
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
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
        mockQueryResponses.single({ ...mockInstanceWithTemplate, status: 'COMPLETE' })
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
      mockPool.setQueryResponse(
        /INSERT INTO contest_participants/,
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

    it('should return 409 for ALREADY_JOINED', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE[\s\S]*id[\s\S]*=[\s\S]*FOR UPDATE/,
        mockQueryResponses.single(openInstance)
      );
      mockPool.setQueryResponse(
        /INSERT INTO contest_participants/,
        mockQueryResponses.error(
          'duplicate key value violates unique constraint "contest_participants_instance_user_unique"',
          '23505'
        )
      );

      const response = await request(app)
        .post(`/api/custom-contests/${TEST_INSTANCE_ID}/join`)
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(409);
      expect(response.body.error_code).toBe('ALREADY_JOINED');
    });

    it('should return 409 for CONTEST_FULL', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances[\s\S]*WHERE[\s\S]*id[\s\S]*=[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({ ...openInstance, max_entries: 5 })
      );
      mockPool.setQueryResponse(
        /INSERT INTO contest_participants/,
        mockQueryResponses.empty()
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
      expect(response.body.error_code).toBe('CONTEST_FULL');
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
      expect(response.body.error_code).toBe('CONTEST_FULL');
    });
  });
});
