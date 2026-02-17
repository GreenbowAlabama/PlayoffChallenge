/**
 * Payout Diagnostics Tests
 *
 * Tests for the payout diagnostics endpoints:
 * - GET /api/admin/diagnostics/payouts
 * - POST /api/admin/diagnostics/run-payout-scheduler
 */

const request = require('supertest');
const { randomUUID } = require('crypto');
const { createTestApp, createMockAdminToken } = require('../mocks/testAppFactory');

describe('Payout Diagnostics Endpoints', () => {
  let app;
  let pool;
  let adminToken;
  let adminUserId;

  beforeAll(async () => {
    // Set JWT secret for testing before creating app
    process.env.ADMIN_JWT_SECRET = 'test-secret-for-unit-tests';

    const setup = await createTestApp();
    app = setup.app;
    pool = setup.pool;

    // Create admin user in database
    adminUserId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, name, email, is_admin)
       VALUES ($1, $2, $3, $4)`,
      [
        adminUserId,
        'Test Admin',
        `admin-${adminUserId}@test.example.com`,
        true
      ]
    );

    // Generate valid JWT token for the admin user
    adminToken = createMockAdminToken({ sub: adminUserId });
  });

  describe('GET /api/admin/diagnostics/payouts', () => {
    it('should return 200 and summary structure', async () => {
      const response = await request(app)
        .get('/api/admin/diagnostics/payouts')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('scheduler');
      expect(response.body).toHaveProperty('summary');
      expect(response.body).toHaveProperty('stuck_transfers');
      expect(response.body).toHaveProperty('stuck_threshold_minutes');
    });

    it('should return summary object with status counts', async () => {
      const response = await request(app)
        .get('/api/admin/diagnostics/payouts')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(typeof response.body.summary).toBe('object');
      // Summary should have status keys (pending, completed, failed, retryable, failed_terminal)
      // May be empty if no transfers exist
    });

    it('should return stuck_transfers as array', async () => {
      const response = await request(app)
        .get('/api/admin/diagnostics/payouts')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.stuck_transfers)).toBe(true);
    });

    it('should accept stuck_minutes query parameter', async () => {
      const response = await request(app)
        .get('/api/admin/diagnostics/payouts?stuck_minutes=60')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.stuck_threshold_minutes).toBe(60);
    });

    it('should default to 30 minutes when stuck_minutes not provided', async () => {
      const response = await request(app)
        .get('/api/admin/diagnostics/payouts')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.stuck_threshold_minutes).toBe(30);
    });

    it('should reject unauthenticated requests', async () => {
      const response = await request(app)
        .get('/api/admin/diagnostics/payouts');

      expect([401, 403]).toContain(response.status);
    });

    it('should reject non-admin tokens', async () => {
      const nonAdminToken = createMockAdminToken({
        is_admin: false,
        role: 'user'
      });

      const response = await request(app)
        .get('/api/admin/diagnostics/payouts')
        .set('Authorization', `Bearer ${nonAdminToken}`);

      expect([401, 403]).toContain(response.status);
    });
  });

  describe('POST /api/admin/diagnostics/run-payout-scheduler', () => {
    it('should return 200 and success structure', async () => {
      const response = await request(app)
        .post('/api/admin/diagnostics/run-payout-scheduler')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('success');
      expect(response.body).toHaveProperty('result');
    });

    it('should include success flag in result', async () => {
      const response = await request(app)
        .post('/api/admin/diagnostics/run-payout-scheduler')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(typeof response.body.success).toBe('boolean');
      expect(typeof response.body.result).toBe('object');
    });

    it('should reject unauthenticated requests', async () => {
      const response = await request(app)
        .post('/api/admin/diagnostics/run-payout-scheduler');

      expect([401, 403]).toContain(response.status);
    });

    it('should reject non-admin tokens', async () => {
      const nonAdminToken = createMockAdminToken({
        is_admin: false,
        role: 'user'
      });

      const response = await request(app)
        .post('/api/admin/diagnostics/run-payout-scheduler')
        .set('Authorization', `Bearer ${nonAdminToken}`);

      expect([401, 403]).toContain(response.status);
    });

    it('should be idempotent', async () => {
      const response1 = await request(app)
        .post('/api/admin/diagnostics/run-payout-scheduler')
        .set('Authorization', `Bearer ${adminToken}`);

      const response2 = await request(app)
        .post('/api/admin/diagnostics/run-payout-scheduler')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);
      // Both should complete without error
      expect(response1.body.success).toBeDefined();
      expect(response2.body.success).toBeDefined();
    });
  });

  describe('Scheduler invocation verification', () => {
    it('scheduler result should include processing metrics', async () => {
      const response = await request(app)
        .post('/api/admin/diagnostics/run-payout-scheduler')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      // Result should have metrics from PayoutJobService
      // (jobs_processed, jobs_completed, total_transfers_processed, etc.)
      const result = response.body.result;
      if (result.success) {
        expect(typeof result.jobs_processed).toBe('number');
      }
    });
  });
});
