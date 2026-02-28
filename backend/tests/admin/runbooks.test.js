const request = require('supertest');
const express = require('express');
const { randomUUID } = require('crypto');
const { createMockAdminToken } = require('../mocks/testAppFactory');
const createAdminRunbooksRouter = require('../../routes/admin.runbooks.routes');
const { Pool } = require('pg');

describe('Admin Runbooks Endpoints', () => {
  let app;
  let pool;
  let adminToken;
  let adminUserId;

  beforeAll(async () => {
    process.env.ADMIN_JWT_SECRET = 'test-secret-for-unit-tests';

    pool = new Pool({
      connectionString: process.env.DATABASE_URL_TEST,
      ssl: false
    });

    app = express();
    app.use(express.json());
    app.locals.pool = pool;

    app.use('/api/admin/runbooks', createAdminRunbooksRouter({ pool }));

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

    adminToken = createMockAdminToken({ sub: adminUserId });
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('POST /start', () => {
    it('should return 200 and execution_id', async () => {
      const response = await request(app)
        .post('/api/admin/runbooks/start')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          runbook_name: 'test',
          runbook_version: '1.0.0',
          executed_by: 'ops'
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('execution_id');
    });
  });

  describe('POST /complete', () => {
    let executionId;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/admin/runbooks/start')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          runbook_name: 'test',
          runbook_version: '1.0.0',
          executed_by: 'ops'
        });

      executionId = res.body.execution_id;
    });

    it('should return 200 on success', async () => {
      const response = await request(app)
        .post('/api/admin/runbooks/complete')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          execution_id: executionId,
          status: 'completed'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });
});
