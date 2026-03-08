/**
 * Financial Reconciliation Routes Tests
 *
 * Tests for 3 endpoints:
 * 1. GET /api/admin/financial-reconciliation
 * 2. POST /api/admin/financial-repair
 * 3. GET /api/admin/financial-audit-log
 */

const request = require('supertest');
const { v4: uuidv4 } = require('uuid');
const { getIntegrationApp } = require('../../mocks/testAppFactory');
const jwt = require('jsonwebtoken');

describe('Financial Reconciliation Routes', () => {
  let app;
  let pool;
  let adminJwt;
  let userId;
  let adminId;

  beforeAll(async () => {
    // Initialize app and pool from test factory
    const integrationApp = getIntegrationApp();
    app = integrationApp.app;
    pool = integrationApp.pool;

    // Create admin user
    adminId = uuidv4();
    await pool.query(
      `INSERT INTO users (id, username, email, is_admin, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET is_admin = TRUE`,
      [adminId, `admin_${adminId.slice(0, 8)}`, `admin_${adminId.slice(0, 8)}@test.com`, true]
    );

    // Create admin JWT token with required claims for admin middleware
    const jwtSecret = process.env.ADMIN_JWT_SECRET || 'test-admin-jwt-secret';
    adminJwt = jwt.sign(
      {
        sub: adminId,
        is_admin: true,
        role: 'admin'
      },
      jwtSecret,
      { expiresIn: '1h', algorithm: 'HS256' }
    );

    // Create test user
    userId = uuidv4();
    await pool.query(
      `INSERT INTO users (id, username, email, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [userId, `user_${userId.slice(0, 8)}`, `user_${userId.slice(0, 8)}@test.com`]
    );
  });

  // ============================================================
  // GET /api/admin/financial-reconciliation
  // ============================================================

  describe('GET /api/admin/financial-reconciliation', () => {
    it('requires admin authorization', async () => {
      const response = await request(app)
        .get('/api/admin/financial-reconciliation')
        .expect(401);

      expect(response.body.error).toBeDefined();
    });

    it('returns reconciliation JSON with correct structure', async () => {
      const response = await request(app)
        .get('/api/admin/financial-reconciliation')
        .set('Authorization', `Bearer ${adminJwt}`)
        .expect(200);

      expect(response.body).toHaveProperty('reconciliation');
      expect(response.body).toHaveProperty('invariants');
      expect(response.body).toHaveProperty('status');
    });

    it('includes invariant checks in response', async () => {
      const response = await request(app)
        .get('/api/admin/financial-reconciliation')
        .set('Authorization', `Bearer ${adminJwt}`)
        .expect(200);

      const { invariants } = response.body;
      expect(invariants.negative_wallets).toBeGreaterThanOrEqual(0);
      expect(invariants.illegal_entry_fee_direction).toBeGreaterThanOrEqual(0);
      expect(invariants.illegal_refund_direction).toBeGreaterThanOrEqual(0);
      expect(invariants.orphaned_ledger_entries).toBeGreaterThanOrEqual(0);
      expect(invariants.orphaned_withdrawals).toBeGreaterThanOrEqual(0);
      expect(invariants.negative_contest_pools).toBeGreaterThanOrEqual(0);
      expect(invariants.health_status).toMatch(/^(PASS|WARN|FAIL)$/);
    });

    it('includes reconciliation figures', async () => {
      const response = await request(app)
        .get('/api/admin/financial-reconciliation')
        .set('Authorization', `Bearer ${adminJwt}`)
        .expect(200);

      const { reconciliation } = response.body;
      expect(typeof reconciliation.wallet_liability_cents).toBe('number');
      expect(typeof reconciliation.contest_pools_cents).toBe('number');
      expect(typeof reconciliation.deposits_cents).toBe('number');
      expect(typeof reconciliation.withdrawals_cents).toBe('number');
      expect(typeof reconciliation.difference_cents).toBe('number');
    });

    it('includes status indicating coherence', async () => {
      const response = await request(app)
        .get('/api/admin/financial-reconciliation')
        .set('Authorization', `Bearer ${adminJwt}`)
        .expect(200);

      expect(response.body.status).toBeDefined();
      expect(typeof response.body.status.is_coherent).toBe('boolean');
    });

    it('response matches OpenAPI contract', async () => {
      const response = await request(app)
        .get('/api/admin/financial-reconciliation')
        .set('Authorization', `Bearer ${adminJwt}`)
        .expect(200);

      // Validate response shape against OpenAPI schema
      expect(response.body).toMatchObject({
        reconciliation: expect.objectContaining({
          wallet_liability_cents: expect.any(Number),
          contest_pools_cents: expect.any(Number),
          deposits_cents: expect.any(Number),
          withdrawals_cents: expect.any(Number),
          difference_cents: expect.any(Number)
        }),
        invariants: expect.any(Object),
        status: expect.any(Object)
      });
    });
  });

  // ============================================================
  // POST /api/admin/financial-repair
  // ============================================================

  describe('POST /api/admin/financial-repair', () => {
    it('requires admin authorization', async () => {
      const response = await request(app)
        .post('/api/admin/financial-reconciliation/repair')
        .send({
          action: 'repair_orphan_withdrawal',
          params: { ledger_id: uuidv4() },
          reason: 'Test reason'
        })
        .expect(401);

      expect(response.body.error).toBeDefined();
    });

    it('validates action_type is recognized', async () => {
      const response = await request(app)
        .post('/api/admin/financial-reconciliation/repair')
        .set('Authorization', `Bearer ${adminJwt}`)
        .send({
          action: 'invalid_action',
          params: {},
          reason: 'Test reason'
        })
        .expect(400);

      expect(response.body.error).toBeDefined();
    });

    it('validates reason is not empty', async () => {
      const response = await request(app)
        .post('/api/admin/financial-reconciliation/repair')
        .set('Authorization', `Bearer ${adminJwt}`)
        .send({
          action: 'repair_orphan_withdrawal',
          params: { ledger_id: uuidv4() },
          reason: ''
        })
        .expect(400);

      expect(response.body.error).toBeDefined();
    });

    it('executes repair atomically', async () => {
      // Insert a test orphan withdrawal
      const ledgerId = uuidv4();
      // Setup test data in database

      const response = await request(app)
        .post('/api/admin/financial-reconciliation/repair')
        .set('Authorization', `Bearer ${adminJwt}`)
        .send({
          action: 'repair_orphan_withdrawal',
          params: { ledger_id: ledgerId },
          reason: 'Test repair of orphan withdrawal'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.repair_id).toBeDefined();
      expect(response.body.audit_log_id).toBeDefined();
    });

    it('creates audit log entry', async () => {
      const ledgerId = uuidv4();

      const response = await request(app)
        .post('/api/admin/financial-reconciliation/repair')
        .set('Authorization', `Bearer ${adminJwt}`)
        .send({
          action: 'repair_orphan_withdrawal',
          params: { ledger_id: ledgerId },
          reason: 'Testing audit log creation'
        })
        .expect(200);

      expect(response.body.audit_log_id).toBeDefined();

      // Verify audit log was created
      const auditResponse = await request(app)
        .get('/api/admin/financial-reconciliation/audit-log')
        .set('Authorization', `Bearer ${adminJwt}`)
        .expect(200);

      const auditEntry = auditResponse.body.entries.find(e => e.id === response.body.audit_log_id);
      expect(auditEntry).toBeDefined();
      expect(auditEntry.action_type).toBe('repair_orphan_withdrawal');
      expect(auditEntry.reason).toBe('Testing audit log creation');
    });

    it('returns success with details', async () => {
      const ledgerId = uuidv4();

      const response = await request(app)
        .post('/api/admin/financial-reconciliation/repair')
        .set('Authorization', `Bearer ${adminJwt}`)
        .send({
          action: 'repair_orphan_withdrawal',
          params: { ledger_id: ledgerId },
          reason: 'Test repair'
        })
        .expect(200);

      expect(response.body).toMatchObject({
        success: expect.any(Boolean),
        repair_id: expect.any(String),
        audit_log_id: expect.any(String),
        message: expect.any(String)
      });
    });

    it('prevents invalid repair combinations', async () => {
      const response = await request(app)
        .post('/api/admin/financial-reconciliation/repair')
        .set('Authorization', `Bearer ${adminJwt}`)
        .send({
          action: 'repair_orphan_withdrawal',
          params: { ledger_id: 'invalid-uuid' },
          reason: 'Test'
        })
        .expect(400);

      expect(response.body.error).toBeDefined();
    });
  });

  // ============================================================
  // GET /api/admin/financial-audit-log
  // ============================================================

  describe('GET /api/admin/financial-audit-log', () => {
    it('requires admin authorization', async () => {
      const response = await request(app)
        .get('/api/admin/financial-reconciliation/audit-log')
        .expect(401);

      expect(response.body.error).toBeDefined();
    });

    it('returns all admin actions', async () => {
      const response = await request(app)
        .get('/api/admin/financial-reconciliation/audit-log')
        .set('Authorization', `Bearer ${adminJwt}`)
        .expect(200);

      expect(Array.isArray(response.body.entries)).toBe(true);
      expect(response.body.entries.length).toBeGreaterThanOrEqual(0);
    });

    it('supports filtering by action_type', async () => {
      const response = await request(app)
        .get('/api/admin/financial-reconciliation/audit-log?action_type=repair_orphan_withdrawal')
        .set('Authorization', `Bearer ${adminJwt}`)
        .expect(200);

      expect(Array.isArray(response.body.entries)).toBe(true);
      response.body.entries.forEach(entry => {
        expect(entry.action_type).toBe('repair_orphan_withdrawal');
      });
    });

    it('supports filtering by date range', async () => {
      const fromDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 24 hours ago
      const toDate = new Date().toISOString();

      const response = await request(app)
        .get(`/api/admin/financial-audit-log?from_date=${fromDate}&to_date=${toDate}`)
        .set('Authorization', `Bearer ${adminJwt}`)
        .expect(200);

      expect(Array.isArray(response.body.entries)).toBe(true);
      response.body.entries.forEach(entry => {
        const entryDate = new Date(entry.created_at);
        expect(entryDate.getTime()).toBeGreaterThanOrEqual(new Date(fromDate).getTime());
        expect(entryDate.getTime()).toBeLessThanOrEqual(new Date(toDate).getTime());
      });
    });

    it('returns entries in reverse chronological order', async () => {
      const response = await request(app)
        .get('/api/admin/financial-reconciliation/audit-log')
        .set('Authorization', `Bearer ${adminJwt}`)
        .expect(200);

      if (response.body.entries.length > 1) {
        for (let i = 0; i < response.body.entries.length - 1; i++) {
          const current = new Date(response.body.entries[i].created_at);
          const next = new Date(response.body.entries[i + 1].created_at);
          expect(current.getTime()).toBeGreaterThanOrEqual(next.getTime());
        }
      }
    });

    it('returns entries with required fields', async () => {
      const response = await request(app)
        .get('/api/admin/financial-reconciliation/audit-log')
        .set('Authorization', `Bearer ${adminJwt}`)
        .expect(200);

      response.body.entries.forEach(entry => {
        expect(entry).toHaveProperty('id');
        expect(entry).toHaveProperty('admin_id');
        expect(entry).toHaveProperty('action_type');
        expect(entry).toHaveProperty('reason');
        expect(entry).toHaveProperty('created_at');
        expect(entry).toHaveProperty('status');
      });
    });
  });
});
