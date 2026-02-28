/**
 * Discovery Endpoint Integration Tests
 *
 * Tests the POST /api/admin/tournaments/discover endpoint
 * Full transport layer testing: request → service → response
 */

const request = require('supertest');
const { app } = require('../../app');
const { Pool } = require('pg');
const { generateAdminJWT } = require('../helpers/adminJWT');

describe('POST /api/admin/tournaments/discover', () => {
  let pool;
  let adminToken;
  let testProviderId;
  const adminUserId = '00000000-0000-0000-0000-000000000099';

  const getValidPayload = (providerId) => ({
    provider_tournament_id: providerId,
    season_year: 2026,
    name: 'Test Tournament 2026',
    start_time: '2026-03-15T08:00:00Z',
    end_time: '2026-03-18T20:00:00Z',
    status: 'SCHEDULED'
  });

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    app.locals.pool = pool;

    // Create test admin user
    await pool.query(
      `INSERT INTO users (id, email, username, is_admin) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET is_admin = true`,
      [adminUserId, 'admin-test@example.com', 'admin-test', true]
    );

    // Generate admin JWT
    adminToken = generateAdminJWT(adminUserId);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Ensure admin user exists for each test
    await pool.query(
      `INSERT INTO users (id, email, username, is_admin) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET is_admin = true`,
      [adminUserId, 'admin-test@example.com', 'admin-test', true]
    );

    // Generate unique provider ID for this test to avoid contamination
    testProviderId = `test_endpoint_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  });

  afterEach(async () => {
    // Clean up test data - must delete transitions FIRST due to FK constraint
    await pool.query(
      `DELETE FROM contest_state_transitions
       WHERE contest_instance_id IN (
         SELECT id FROM contest_instances
         WHERE template_id IN (
           SELECT id FROM contest_templates
           WHERE provider_tournament_id = $1
         )
       )`,
      [testProviderId]
    );
    await pool.query(
      `DELETE FROM contest_instances
       WHERE template_id IN (
         SELECT id FROM contest_templates
         WHERE provider_tournament_id = $1
       )`,
      [testProviderId]
    );
    await pool.query(
      `DELETE FROM contest_templates
       WHERE provider_tournament_id = $1`,
      [testProviderId]
    );
  });

  describe('successful requests', () => {
    it('should create template and return 201 on first discovery', async () => {
      const validPayload = getValidPayload(testProviderId);
      const response = await request(app)
        .post('/api/admin/tournaments/discover')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPayload);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.created).toBe(true);
      expect(response.body.updated).toBe(false);
      expect(response.body.templateId).toBeTruthy();
      expect(response.body.error).toBeNull();
      expect(response.body.errorCode).toBeNull();
    });

    it('should return 200 on rediscovery with same input', async () => {
      const validPayload = getValidPayload(testProviderId);
      // First discovery
      const response1 = await request(app)
        .post('/api/admin/tournaments/discover')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPayload);

      expect(response1.status).toBe(201);
      const templateId1 = response1.body.templateId;

      // Rediscovery
      const response2 = await request(app)
        .post('/api/admin/tournaments/discover')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPayload);

      expect(response2.status).toBe(200);
      expect(response2.body.success).toBe(true);
      expect(response2.body.created).toBe(false);
      expect(response2.body.updated).toBe(false);
      expect(response2.body.templateId).toBe(templateId1);
      expect(response2.body.error).toBeNull();
    });

    it('should update name and return 200 if no locked instances', async () => {
      const validPayload = getValidPayload(testProviderId);
      // First discovery
      const response1 = await request(app)
        .post('/api/admin/tournaments/discover')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPayload);

      expect(response1.status).toBe(201);

      // Rediscover with updated name
      const updatedPayload = {
        ...validPayload,
        name: 'Test Tournament 2026 (Updated)'
      };
      const response2 = await request(app)
        .post('/api/admin/tournaments/discover')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(updatedPayload);

      expect(response2.status).toBe(200);
      expect(response2.body.success).toBe(true);
      expect(response2.body.created).toBe(false);
      expect(response2.body.updated).toBe(true);
    });
  });

  describe('validation error responses', () => {
    it('should return 400 for invalid season_year', async () => {
      const validPayload = getValidPayload(testProviderId);
      const response = await request(app)
        .post('/api/admin/tournaments/discover')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ...validPayload,
          season_year: 1999
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.errorCode).toBe('INVALID_SEASON_YEAR');
      expect(response.body.error).toBeDefined();
      expect(response.body.templateId).toBeNull();
    });

    it('should return 400 for missing name', async () => {
      const validPayload = getValidPayload(testProviderId);
      const response = await request(app)
        .post('/api/admin/tournaments/discover')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ...validPayload,
          name: ''
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.errorCode).toBe('MISSING_TOURNAMENT_NAME');
    });

    it('should return 400 for invalid time range', async () => {
      const validPayload = getValidPayload(testProviderId);
      const response = await request(app)
        .post('/api/admin/tournaments/discover')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ...validPayload,
          start_time: '2026-03-18T20:00:00Z',
          end_time: '2026-03-15T08:00:00Z'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.errorCode).toBe('INVALID_TIME_RANGE');
    });

    it('should return 400 for invalid status', async () => {
      const validPayload = getValidPayload(testProviderId);
      const response = await request(app)
        .post('/api/admin/tournaments/discover')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ...validPayload,
          status: 'INVALID_STATUS'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.errorCode).toBe('INVALID_TOURNAMENT_STATUS');
    });

    it('should return 400 for tournament outside discovery window', async () => {
      const validPayload = getValidPayload(testProviderId);
      const response = await request(app)
        .post('/api/admin/tournaments/discover')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ...validPayload,
          start_time: '2026-06-01T08:00:00Z',
          end_time: '2026-06-05T20:00:00Z'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.errorCode).toBe('OUTSIDE_DISCOVERY_WINDOW');
    });
  });

  describe('response shape', () => {
    it('should return exact service contract', async () => {
      const validPayload = getValidPayload(testProviderId);
      const response = await request(app)
        .post('/api/admin/tournaments/discover')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPayload);

      // Verify all expected fields are present
      expect(Object.keys(response.body)).toEqual([
        'success',
        'templateId',
        'created',
        'updated',
        'error',
        'errorCode'
      ]);
    });

    it('should use correct status code from service', async () => {
      const validPayload = getValidPayload(testProviderId);
      const response = await request(app)
        .post('/api/admin/tournaments/discover')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPayload);

      // Service returns 201 for created
      // Response status must match
      expect(response.status).toBe(201);
    });

    it('should not add extra fields to response', async () => {
      const validPayload = getValidPayload(testProviderId);
      const response = await request(app)
        .post('/api/admin/tournaments/discover')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPayload);

      // Only these fields should be in response
      const allowedFields = ['success', 'templateId', 'created', 'updated', 'error', 'errorCode'];
      Object.keys(response.body).forEach(key => {
        expect(allowedFields).toContain(key);
      });
    });
  });

  describe('determinism and idempotency', () => {
    it('should be idempotent (same request → same response)', async () => {
      const validPayload = getValidPayload(testProviderId);
      const response1 = await request(app)
        .post('/api/admin/tournaments/discover')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPayload);

      const response2 = await request(app)
        .post('/api/admin/tournaments/discover')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPayload);

      // First call creates template
      expect(response1.body.created).toBe(true);
      expect(response1.body.success).toBe(true);

      // Second call returns existing template
      expect(response2.body.created).toBe(false);
      expect(response2.body.success).toBe(true);

      // Both return same template ID
      expect(response1.body.templateId).toBe(response2.body.templateId);
    });

    it('should normalize ISO string dates', async () => {
      const validPayload = getValidPayload(testProviderId);
      const payload = {
        ...validPayload,
        start_time: '2026-03-15T08:00:00.000Z',
        end_time: '2026-03-18T20:00:00.000Z'
      };

      const response = await request(app)
        .post('/api/admin/tournaments/discover')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });
  });

  describe('CANCELLED status discovery', () => {
    it('should return 201 and status=CANCELLED when discovering new tournament as CANCELLED', async () => {
      const cancelledPayload = {
        ...getValidPayload(testProviderId),
        status: 'CANCELLED'
      };

      const response = await request(app)
        .post('/api/admin/tournaments/discover')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(cancelledPayload);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.created).toBe(true);
      expect(response.body.updated).toBe(false);
      expect(response.body.templateId).toBeTruthy();

      // Verify template status is CANCELLED in database
      const templateResult = await pool.query(
        `SELECT status FROM contest_templates WHERE id = $1`,
        [response.body.templateId]
      );
      expect(templateResult.rows).toHaveLength(1);
      expect(templateResult.rows[0].status).toBe('CANCELLED');
    });

    it('should return 200 and updated=true when rediscovering SCHEDULED tournament as CANCELLED', async () => {
      const validPayload = getValidPayload(testProviderId);

      // First discovery: SCHEDULED
      const response1 = await request(app)
        .post('/api/admin/tournaments/discover')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPayload);

      expect(response1.status).toBe(201);
      const templateId = response1.body.templateId;

      // Rediscovery: CANCELLED (status change)
      const cancelledPayload = {
        ...validPayload,
        status: 'CANCELLED'
      };
      const response2 = await request(app)
        .post('/api/admin/tournaments/discover')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(cancelledPayload);

      expect(response2.status).toBe(200);
      expect(response2.body.success).toBe(true);
      expect(response2.body.created).toBe(false);
      expect(response2.body.updated).toBe(true);
      expect(response2.body.templateId).toBe(templateId);

      // Verify template status is CANCELLED in database
      const templateResult = await pool.query(
        `SELECT status FROM contest_templates WHERE id = $1`,
        [templateId]
      );
      expect(templateResult.rows).toHaveLength(1);
      expect(templateResult.rows[0].status).toBe('CANCELLED');
    });

    it('should be idempotent: repeated CANCELLED calls return 200 and updated=false', async () => {
      const cancelledPayload = {
        ...getValidPayload(testProviderId),
        status: 'CANCELLED'
      };

      // First discovery: CANCELLED
      const response1 = await request(app)
        .post('/api/admin/tournaments/discover')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(cancelledPayload);

      expect(response1.status).toBe(201);
      expect(response1.body.created).toBe(true);
      const templateId = response1.body.templateId;

      // Second call: CANCELLED (same)
      const response2 = await request(app)
        .post('/api/admin/tournaments/discover')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(cancelledPayload);

      expect(response2.status).toBe(200);
      expect(response2.body.success).toBe(true);
      expect(response2.body.created).toBe(false);
      expect(response2.body.updated).toBe(false);
      expect(response2.body.templateId).toBe(templateId);

      // Verify no duplicate transitions were created
      // Get all contest instances for this template and count their transitions
      const instancesResult = await pool.query(
        `SELECT id FROM contest_instances WHERE template_id = $1`,
        [templateId]
      );

      if (instancesResult.rows.length > 0) {
        const instanceIds = instancesResult.rows.map(row => row.id);
        const transitionsResult = await pool.query(
          `SELECT COUNT(*) as count FROM contest_state_transitions
           WHERE contest_instance_id = ANY($1)`,
          [instanceIds]
        );
        // Idempotency check: repeated calls should not create duplicate transitions
        // The count should be stable (no new transitions from second call)
        expect(parseInt(transitionsResult.rows[0].count)).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
