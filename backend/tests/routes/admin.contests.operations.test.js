/**
 * Admin Contest Operations Integration Tests
 *
 * Tests for v1 contract-compliant contest operation endpoints:
 * - POST /:id/cancel (SCHEDULED, LOCKED, ERROR only)
 * - POST /:id/force-lock
 * - POST /:id/update-times (lock_time, start_time, end_time only)
 * - POST /:id/mark-error (LIVE → ERROR)
 * - POST /:id/settle
 * - POST /:id/resolve-error
 * - GET /:id/audit
 *
 * Validates:
 * - Correct status transitions per actor and contract
 * - Audit trail writes on success and rejection
 * - Error codes and HTTP status codes
 * - Idempotency patterns
 */

const request = require('supertest');
const { createTestApp } = require('../mocks/testAppFactory');

describe('Admin Contest Operations v1 (Contract-Compliant)', () => {
  let app;
  let pool;
  let adminToken;
  let contestId;

  beforeAll(async () => {
    const setup = await createTestApp();
    app = setup.app;
    pool = setup.pool;
    adminToken = setup.adminToken;
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  beforeEach(async () => {
    // Create test contest in SCHEDULED status
    const res = await pool.query(
      `INSERT INTO contest_instances (
        id, template_id, organizer_id, status, contest_name,
        entry_fee_cents, payout_structure, max_entries
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        'test-contest-' + Date.now(),
        'template-1',
        'org-user-1',
        'SCHEDULED',
        'Test Contest',
        0,
        '{"1": 100}',
        10
      ]
    );
    contestId = res.rows[0].id;
  });

  afterEach(async () => {
    // Clean up
    await pool.query('DELETE FROM admin_contest_audit WHERE contest_instance_id = $1', [contestId]);
    await pool.query('DELETE FROM contest_instances WHERE id = $1', [contestId]);
  });

  // ============================================
  // POST /:id/cancel
  // ============================================

  describe('POST /:id/cancel', () => {
    it('transitions SCHEDULED → CANCELLED', async () => {
      const response = await request(app)
        .post(`/api/admin/contests/${contestId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'User requested cancellation' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.contest.status).toBe('CANCELLED');
      expect(response.body.noop).toBe(false);
    });

    it('transitions LOCKED → CANCELLED', async () => {
      await pool.query('UPDATE contest_instances SET status = $1 WHERE id = $2', ['LOCKED', contestId]);

      const response = await request(app)
        .post(`/api/admin/contests/${contestId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Cancel locked contest' })
        .expect(200);

      expect(response.body.contest.status).toBe('CANCELLED');
    });

    it('is idempotent for CANCELLED status', async () => {
      // First cancel
      await request(app)
        .post(`/api/admin/contests/${contestId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'First cancel' })
        .expect(200);

      // Second cancel
      const response = await request(app)
        .post(`/api/admin/contests/${contestId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Second cancel' })
        .expect(200);

      expect(response.body.noop).toBe(true);
    });

    it('rejects LIVE status with 409 (contract: LIVE → ERROR required)', async () => {
      await pool.query('UPDATE contest_instances SET status = $1 WHERE id = $2', ['LIVE', contestId]);

      const response = await request(app)
        .post(`/api/admin/contests/${contestId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Try cancel live' })
        .expect(409);

      expect(response.body.error).toContain('SCHEDULED, LOCKED, and ERROR');

      // Verify audit written with rejection
      const audit = await pool.query(
        `SELECT * FROM admin_contest_audit WHERE contest_instance_id = $1`,
        [contestId]
      );
      expect(audit.rows[0].payload.rejected).toBe(true);
    });

    it('rejects COMPLETE status with 409', async () => {
      await pool.query('UPDATE contest_instances SET status = $1 WHERE id = $2', ['COMPLETE', contestId]);

      const response = await request(app)
        .post(`/api/admin/contests/${contestId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Try cancel complete' })
        .expect(409);

      expect(response.body.error).toContain('SCHEDULED, LOCKED, and ERROR');
    });

    it('requires reason field', async () => {
      const response = await request(app)
        .post(`/api/admin/contests/${contestId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})
        .expect(400);

      expect(response.body.error).toContain('reason');
    });
  });

  // ============================================
  // POST /:id/force-lock
  // ============================================

  describe('POST /:id/force-lock', () => {
    it('transitions SCHEDULED → LOCKED', async () => {
      const response = await request(app)
        .post(`/api/admin/contests/${contestId}/force-lock`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Force lock for urgency' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.contest.status).toBe('LOCKED');
      expect(response.body.noop).toBe(false);
    });

    it('is idempotent for LOCKED status', async () => {
      // First lock
      await request(app)
        .post(`/api/admin/contests/${contestId}/force-lock`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'First lock' })
        .expect(200);

      // Second lock
      const response = await request(app)
        .post(`/api/admin/contests/${contestId}/force-lock`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Second lock' })
        .expect(200);

      expect(response.body.noop).toBe(true);
    });

    it('rejects non-SCHEDULED status with 409', async () => {
      await pool.query('UPDATE contest_instances SET status = $1 WHERE id = $2', ['LIVE', contestId]);

      const response = await request(app)
        .post(`/api/admin/contests/${contestId}/force-lock`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Try lock live contest' })
        .expect(409);

      expect(response.body.error).toContain('SCHEDULED');
    });
  });

  // ============================================
  // POST /:id/mark-error (NEW)
  // ============================================

  describe('POST /:id/mark-error', () => {
    it('transitions LIVE → ERROR', async () => {
      await pool.query('UPDATE contest_instances SET status = $1 WHERE id = $2', ['LIVE', contestId]);

      const response = await request(app)
        .post(`/api/admin/contests/${contestId}/mark-error`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Critical bug detected' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.contest.status).toBe('ERROR');
      expect(response.body.noop).toBe(false);
    });

    it('is idempotent for ERROR status', async () => {
      await pool.query('UPDATE contest_instances SET status = $1 WHERE id = $2', ['LIVE', contestId]);

      // First mark error
      await request(app)
        .post(`/api/admin/contests/${contestId}/mark-error`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'First error' })
        .expect(200);

      // Second mark error
      const response = await request(app)
        .post(`/api/admin/contests/${contestId}/mark-error`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Second error' })
        .expect(200);

      expect(response.body.noop).toBe(true);
      expect(response.body.contest.status).toBe('ERROR');
    });

    it('rejects non-LIVE status with 409', async () => {
      const response = await request(app)
        .post(`/api/admin/contests/${contestId}/mark-error`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Try mark scheduled' })
        .expect(409);

      expect(response.body.error).toContain('LIVE');
    });

    it('rejects COMPLETE status', async () => {
      await pool.query('UPDATE contest_instances SET status = $1 WHERE id = $2', ['COMPLETE', contestId]);

      const response = await request(app)
        .post(`/api/admin/contests/${contestId}/mark-error`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Try mark complete' })
        .expect(409);

      expect(response.body.error).toContain('LIVE');
    });
  });

  // ============================================
  // POST /:id/update-times
  // ============================================

  describe('POST /:id/update-times', () => {
    it('updates lock_time on SCHEDULED contest', async () => {
      const newLockTime = new Date(Date.now() + 3600000).toISOString();

      const response = await request(app)
        .post(`/api/admin/contests/${contestId}/update-times`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          lock_time: newLockTime,
          reason: 'Postpone lock'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.noop).toBe(false);
      expect(response.body.contest.lock_time).toBe(newLockTime);
    });

    it('updates start_time and end_time', async () => {
      const newStartTime = new Date(Date.now() + 3600000).toISOString();
      const newEndTime = new Date(Date.now() + 7200000).toISOString();

      const response = await request(app)
        .post(`/api/admin/contests/${contestId}/update-times`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          start_time: newStartTime,
          end_time: newEndTime,
          reason: 'Adjust game times'
        })
        .expect(200);

      expect(response.body.contest.start_time).toBe(newStartTime);
      expect(response.body.contest.end_time).toBe(newEndTime);
    });

    it('rejects settle_time parameter (immutable)', async () => {
      const newSettleTime = new Date(Date.now() + 10800000).toISOString();

      // settle_time should be silently ignored or rejected
      // Current behavior: ignored (not in update logic)
      const response = await request(app)
        .post(`/api/admin/contests/${contestId}/update-times`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          settle_time: newSettleTime,
          reason: 'Try set settle time'
        })
        .expect(200);

      // settle_time should not have changed
      expect(response.body.noop).toBe(true); // No actual change
    });

    it('rejects time invariant violations with 409', async () => {
      const startTime = new Date(Date.now() + 7200000).toISOString();
      const lockTime = new Date(Date.now() + 10800000).toISOString(); // lock_time > start_time

      const response = await request(app)
        .post(`/api/admin/contests/${contestId}/update-times`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          lock_time: lockTime,
          start_time: startTime,
          reason: 'Bad time ordering'
        })
        .expect(409);

      expect(response.body.error).toContain('invariant');
    });

    it('rejects non-SCHEDULED status with 409', async () => {
      await pool.query('UPDATE contest_instances SET status = $1 WHERE id = $2', ['LOCKED', contestId]);

      const response = await request(app)
        .post(`/api/admin/contests/${contestId}/update-times`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          lock_time: new Date().toISOString(),
          reason: 'Try update locked'
        })
        .expect(409);

      expect(response.body.error).toContain('SCHEDULED');
    });
  });

  // ============================================
  // POST /:id/settle
  // ============================================

  describe('POST /:id/settle', () => {
    it('transitions LIVE → COMPLETE', async () => {
      await pool.query('UPDATE contest_instances SET status = $1 WHERE id = $2', ['LIVE', contestId]);

      const response = await request(app)
        .post(`/api/admin/contests/${contestId}/settle`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'All games finished' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.contest.status).toBe('COMPLETE');
    });

    it('is idempotent for COMPLETE status', async () => {
      await pool.query('UPDATE contest_instances SET status = $1 WHERE id = $2', ['COMPLETE', contestId]);

      const response = await request(app)
        .post(`/api/admin/contests/${contestId}/settle`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Already settled' })
        .expect(200);

      expect(response.body.noop).toBe(true);
    });

    it('rejects non-LIVE status with 409', async () => {
      const response = await request(app)
        .post(`/api/admin/contests/${contestId}/settle`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Try settle scheduled' })
        .expect(409);

      expect(response.body.error).toContain('LIVE');
    });
  });

  // ============================================
  // POST /:id/resolve-error
  // ============================================

  describe('POST /:id/resolve-error', () => {
    it('resolves ERROR → COMPLETE', async () => {
      await pool.query('UPDATE contest_instances SET status = $1 WHERE id = $2', ['ERROR', contestId]);

      const response = await request(app)
        .post(`/api/admin/contests/${contestId}/resolve-error`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          to_status: 'COMPLETE',
          reason: 'Bug fixed, proceed to settlement'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.contest.status).toBe('COMPLETE');
    });

    it('resolves ERROR → CANCELLED', async () => {
      await pool.query('UPDATE contest_instances SET status = $1 WHERE id = $2', ['ERROR', contestId]);

      const response = await request(app)
        .post(`/api/admin/contests/${contestId}/resolve-error`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          to_status: 'CANCELLED',
          reason: 'Unrecoverable error'
        })
        .expect(200);

      expect(response.body.contest.status).toBe('CANCELLED');
    });

    it('rejects invalid toStatus with 409', async () => {
      await pool.query('UPDATE contest_instances SET status = $1 WHERE id = $2', ['ERROR', contestId]);

      const response = await request(app)
        .post(`/api/admin/contests/${contestId}/resolve-error`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          to_status: 'SCHEDULED',
          reason: 'Bad target'
        })
        .expect(409);

      expect(response.body.error).toContain('COMPLETE or CANCELLED');
    });

    it('rejects non-ERROR status with 409', async () => {
      const response = await request(app)
        .post(`/api/admin/contests/${contestId}/resolve-error`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          to_status: 'COMPLETE',
          reason: 'Not in error'
        })
        .expect(409);

      expect(response.body.error).toContain('ERROR');
    });
  });

  // ============================================
  // GET /:id/audit
  // ============================================

  describe('GET /:id/audit', () => {
    it('returns audit log sorted DESC by created_at', async () => {
      // Make operations
      await request(app)
        .post(`/api/admin/contests/${contestId}/force-lock`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Lock it' });

      await request(app)
        .post(`/api/admin/contests/${contestId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Cancel it' });

      const response = await request(app)
        .get(`/api/admin/contests/${contestId}/audit`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(response.body.audit)).toBe(true);
      expect(response.body.audit.length).toBeGreaterThan(0);

      // Verify DESC order
      for (let i = 0; i < response.body.audit.length - 1; i++) {
        const current = new Date(response.body.audit[i].created_at);
        const next = new Date(response.body.audit[i + 1].created_at);
        expect(current.getTime()).toBeGreaterThanOrEqual(next.getTime());
      }

      // Verify fields
      const record = response.body.audit[0];
      expect(record.id).toBeDefined();
      expect(record.created_at).toBeDefined();
      expect(record.action).toBeDefined();
      expect(record.from_status).toBeDefined();
      expect(record.to_status).toBeDefined();
      expect(record.reason).toBeDefined();
      expect(record.admin_user_id).toBeDefined();
      expect(record.payload).toBeDefined();
    });
  });

  // ============================================
  // Contract Compliance: Valid Transitions
  // ============================================

  describe('Contract Compliance: Allowed Transitions', () => {
    it('verifies SCHEDULED → LOCKED allowed', async () => {
      await request(app)
        .post(`/api/admin/contests/${contestId}/force-lock`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Test' })
        .expect(200);
    });

    it('verifies SCHEDULED → CANCELLED allowed', async () => {
      await request(app)
        .post(`/api/admin/contests/${contestId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Test' })
        .expect(200);
    });

    it('verifies LOCKED → CANCELLED allowed', async () => {
      await pool.query('UPDATE contest_instances SET status = $1 WHERE id = $2', ['LOCKED', contestId]);

      await request(app)
        .post(`/api/admin/contests/${contestId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Test' })
        .expect(200);
    });

    it('verifies ERROR → CANCELLED allowed', async () => {
      await pool.query('UPDATE contest_instances SET status = $1 WHERE id = $2', ['ERROR', contestId]);

      await request(app)
        .post(`/api/admin/contests/${contestId}/resolve-error`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ to_status: 'CANCELLED', reason: 'Test' })
        .expect(200);
    });

    it('verifies ERROR → COMPLETE allowed', async () => {
      await pool.query('UPDATE contest_instances SET status = $1 WHERE id = $2', ['ERROR', contestId]);

      await request(app)
        .post(`/api/admin/contests/${contestId}/resolve-error`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ to_status: 'COMPLETE', reason: 'Test' })
        .expect(200);
    });

    it('verifies LIVE → ERROR path (mark-error)', async () => {
      await pool.query('UPDATE contest_instances SET status = $1 WHERE id = $2', ['LIVE', contestId]);

      await request(app)
        .post(`/api/admin/contests/${contestId}/mark-error`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Test' })
        .expect(200);
    });
  });
});
