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
  entry_fee_cents: 2500,
  payout_structure: { first: 70, second: 20, third: 10 },
  status: 'draft',
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
    mockPool = createMockPool();

    app = express();
    app.use(express.json());
    app.locals.pool = mockPool;
    app.use('/api/custom-contests', customContestRoutes);
  });

  afterEach(() => {
    mockPool.reset();
    delete process.env.APP_ENV;
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
    it('should return valid contest for valid token', async () => {
      const token = 'dev_abc123def456abc123def456abc123';
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.join_token/,
        mockQueryResponses.single({ ...mockInstanceWithTemplate, join_token: token })
      );

      const response = await request(app)
        .get(`/api/custom-contests/join/${token}`);

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(true);
      expect(response.body.contest).toBeDefined();
      expect(response.body.contest.id).toBe(TEST_INSTANCE_ID);
    });

    it('should return invalid for environment mismatch', async () => {
      const response = await request(app)
        .get('/api/custom-contests/join/prd_abc123');

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(false);
      expect(response.body.environment_mismatch).toBe(true);
    });

    it('should return invalid for unknown token', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.join_token/,
        mockQueryResponses.empty()
      );

      const response = await request(app)
        .get('/api/custom-contests/join/dev_notfound123456789012');

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(false);
      expect(response.body.reason).toContain('Contest not found');
    });
  });

  describe('POST /api/custom-contests', () => {
    const validInput = {
      template_id: TEST_TEMPLATE_ID,
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

    it('should return 201 with valid input', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_templates WHERE id/,
        mockQueryResponses.single(mockTemplate)
      );
      mockPool.setQueryResponse(
        /INSERT INTO contest_instances/,
        mockQueryResponses.single(mockInstance)
      );

      const response = await request(app)
        .post('/api/custom-contests')
        .set('X-User-Id', TEST_USER_ID)
        .send(validInput);

      expect(response.status).toBe(201);
      expect(response.body.id).toBe(TEST_INSTANCE_ID);
      expect(response.body.status).toBe('draft');
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

    it('should return 400 for nonexistent template', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_templates WHERE id/,
        mockQueryResponses.empty()
      );

      const response = await request(app)
        .post('/api/custom-contests')
        .set('X-User-Id', TEST_USER_ID)
        .send(validInput);

      expect(response.status).toBe(400);
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
      expect(response.body.template_name).toBe('NFL Playoff Challenge');
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

    it('should publish draft contest', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
        mockQueryResponses.single({ ...mockInstanceWithTemplate, status: 'draft' })
      );
      mockPool.setQueryResponse(
        /UPDATE contest_instances SET status/,
        mockQueryResponses.single({ ...mockInstance, status: 'open' })
      );

      const response = await request(app)
        .post(`/api/custom-contests/${TEST_INSTANCE_ID}/publish`)
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('open');
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
        mockQueryResponses.single({ ...mockInstanceWithTemplate, status: 'locked' })
      );

      const response = await request(app)
        .post(`/api/custom-contests/${TEST_INSTANCE_ID}/publish`)
        .set('X-User-Id', TEST_USER_ID);

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Cannot transition');
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
        mockQueryResponses.single({ ...mockInstanceWithTemplate, status: 'draft' })
      );
      mockPool.setQueryResponse(
        /UPDATE contest_instances SET status/,
        mockQueryResponses.single({ ...mockInstance, status: 'cancelled' })
      );

      const response = await request(app)
        .patch(`/api/custom-contests/${TEST_INSTANCE_ID}/status`)
        .set('X-User-Id', TEST_USER_ID)
        .send({ status: 'cancelled' });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('cancelled');
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
        .send({ status: 'cancelled' });

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Only the organizer');
    });

    it('should return 403 for invalid transition', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*JOIN contest_templates ct[\s\S]*WHERE ci\.id/,
        mockQueryResponses.single({ ...mockInstanceWithTemplate, status: 'settled' })
      );

      const response = await request(app)
        .patch(`/api/custom-contests/${TEST_INSTANCE_ID}/status`)
        .set('X-User-Id', TEST_USER_ID)
        .send({ status: 'open' });

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Cannot transition');
    });
  });
});
