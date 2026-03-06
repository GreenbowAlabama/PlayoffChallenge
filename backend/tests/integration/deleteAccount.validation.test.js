/**
 * Delete Account Validation Tests
 *
 * Tests the three-part fix for account deletion:
 * 1. Pre-deletion validation (contests, ledger, payment intents)
 * 2. Bearer token authentication verification
 * 3. Cross-user deletion prevention
 *
 * Validates that DELETE /api/user enforces proper access control and
 * prevents deletion of accounts with active obligations.
 *
 * PREREQUISITE: Test database with migrations applied
 */

const crypto = require('crypto');
const request = require('supertest');
const { getIntegrationApp } = require('../mocks/testAppFactory');
const { ensureActiveTemplate } = require('../helpers/templateFactory');

describe('DELETE /api/user — Delete Account Validation', () => {
  let pool;
  let app;
  let testUserId;
  let testUserEmail;
  let otherUserId;

  beforeAll(async () => {
    const integration = getIntegrationApp();
    app = integration.app;
    pool = integration.pool;
  });

  let templateId;

  beforeEach(async () => {
    testUserId = crypto.randomUUID();
    otherUserId = crypto.randomUUID();
    testUserEmail = `test-${testUserId}@example.com`;

    // Create shared template for all tests
    const template = await ensureActiveTemplate(pool, {
      sport: 'golf',
      templateType: 'playoff',
      name: 'Test Template',
      scoringKey: 'pga_standard_v1',
      lockKey: 'time_based_lock_v1',
      settlementKey: 'pga_standard_v1',
      allowedPayoutStructures: {},
      entryFeeCents: 0
    });
    templateId = template.id;

    await pool.query(
      'INSERT INTO users (id, email, name) VALUES ($1, $2, $3)',
      [testUserId, testUserEmail, 'Test User']
    );

    await pool.query(
      'INSERT INTO users (id, email, name) VALUES ($1, $2, $3)',
      [otherUserId, `other-${otherUserId}@example.com`, 'Other User']
    );
  });

  afterEach(async () => {
    try {
      // Cleanup payout requests
      await pool.query(
        'DELETE FROM payout_requests WHERE user_id IN ($1, $2)',
        [testUserId, otherUserId]
      );

      // Cleanup payment intents
      await pool.query(
        'DELETE FROM payment_intents WHERE user_id IN ($1, $2)',
        [testUserId, otherUserId]
      );

      // Cleanup contest-related data
      const contestIds = await pool.query(
        'SELECT id FROM contest_instances WHERE organizer_id IN ($1, $2)',
        [testUserId, otherUserId]
      );
      for (const contest of contestIds.rows) {
        await pool.query(
          'DELETE FROM contest_participants WHERE contest_instance_id = $1',
          [contest.id]
        );
        await pool.query(
          'DELETE FROM contest_instances WHERE id = $1',
          [contest.id]
        );
      }

      // Cleanup ledger entries
      await pool.query(
        'DELETE FROM ledger WHERE reference_id IN ($1, $2)',
        [testUserId, otherUserId]
      );

      // Cleanup users
      await pool.query(
        'DELETE FROM users WHERE id IN ($1, $2)',
        [testUserId, otherUserId]
      );
    } catch (err) {
      // Cleanup non-fatal
    }
  });

  describe('Test 1: User with no contests, no ledger → deletes successfully', () => {
    it('should allow deletion when user has no active obligations', async () => {
      const response = await request(app)
        .delete(`/api/user?userId=${testUserId}`)
        .set('Authorization', `Bearer ${testUserId}`)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);

      const userCheck = await pool.query(
        'SELECT id FROM users WHERE id = $1',
        [testUserId]
      );
      expect(userCheck.rows.length).toBe(0);
    });
  });

  describe('Test 2: User organizing a contest → returns 400 with reason', () => {
    it('should prevent deletion when user organizes a contest', async () => {
      const contestId = crypto.randomUUID();
      await pool.query(
        'INSERT INTO contest_instances (id, template_id, organizer_id, status, entry_fee_cents, payout_structure, contest_name, max_entries) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [contestId, templateId, testUserId, 'SCHEDULED', 0, JSON.stringify({}), 'Test Contest', 20]
      );

      const response = await request(app)
        .delete(`/api/user?userId=${testUserId}`)
        .set('Authorization', `Bearer ${testUserId}`)
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('reason');
      expect(response.body.reason).toMatch(/contest|organizer/i);

      const userCheck = await pool.query(
        'SELECT id FROM users WHERE id = $1',
        [testUserId]
      );
      expect(userCheck.rows.length).toBe(1);

      await pool.query(
        'DELETE FROM contest_instances WHERE id = $1',
        [contestId]
      );
    });
  });

  describe('Test 3: User with non-zero wallet balance → returns 400', () => {
    it('should prevent deletion when user has wallet balance', async () => {
      await pool.query(
        'INSERT INTO ledger (id, user_id, entry_type, direction, amount_cents, reference_type, reference_id, idempotency_key) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [crypto.randomUUID(), testUserId, 'WALLET_DEPOSIT', 'CREDIT', 10000, 'WALLET', testUserId, crypto.randomUUID()]
      );

      const response = await request(app)
        .delete(`/api/user?userId=${testUserId}`)
        .set('Authorization', `Bearer ${testUserId}`)
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('reason');
      expect(response.body.reason).toMatch(/wallet|balance/i);

      const userCheck = await pool.query(
        'SELECT id FROM users WHERE id = $1',
        [testUserId]
      );
      expect(userCheck.rows.length).toBe(1);
    });
  });

  describe('Test 4: Missing Bearer token → returns 401', () => {
    it('should reject deletion without Authorization header', async () => {
      const response = await request(app)
        .delete(`/api/user?userId=${testUserId}`)
        .expect(401);

      expect(response.body).toHaveProperty('error');

      const userCheck = await pool.query(
        'SELECT id FROM users WHERE id = $1',
        [testUserId]
      );
      expect(userCheck.rows.length).toBe(1);
    });
  });

  describe('Test 5: Invalid Bearer token → returns 400', () => {
    it('should reject deletion with malformed Bearer token', async () => {
      const response = await request(app)
        .delete(`/api/user?userId=${testUserId}`)
        .set('Authorization', 'Bearer invalid-uuid-format')
        .expect(400);

      expect(response.body).toHaveProperty('error');

      const userCheck = await pool.query(
        'SELECT id FROM users WHERE id = $1',
        [testUserId]
      );
      expect(userCheck.rows.length).toBe(1);
    });
  });

  describe('Test 6: Cross-user deletion attempt → returns 403', () => {
    it('should prevent user from deleting another user account', async () => {
      const response = await request(app)
        .delete(`/api/user?userId=${otherUserId}`)
        .set('Authorization', `Bearer ${testUserId}`)
        .expect(403);

      expect(response.body).toHaveProperty('error');

      const testUserCheck = await pool.query(
        'SELECT id FROM users WHERE id = $1',
        [testUserId]
      );
      expect(testUserCheck.rows.length).toBe(1);

      const otherUserCheck = await pool.query(
        'SELECT id FROM users WHERE id = $1',
        [otherUserId]
      );
      expect(otherUserCheck.rows.length).toBe(1);
    });
  });

  describe('Test 7: Pending payout requests → returns 400', () => {
    it('should prevent deletion when user has pending payout requests', async () => {
      const contestId = crypto.randomUUID();
      await pool.query(
        'INSERT INTO contest_instances (id, template_id, organizer_id, status, entry_fee_cents, payout_structure, contest_name, max_entries) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [contestId, templateId, otherUserId, 'SCHEDULED', 0, JSON.stringify({}), 'Test Contest', 20]
      );

      await pool.query(
        'INSERT INTO payout_requests (id, user_id, contest_instance_id, amount_cents, currency, status, idempotency_key) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [crypto.randomUUID(), testUserId, contestId, 5000, 'USD', 'PROCESSING', crypto.randomUUID()]
      );

      const response = await request(app)
        .delete(`/api/user?userId=${testUserId}`)
        .set('Authorization', `Bearer ${testUserId}`)
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('reason');
      expect(response.body.reason).toMatch(/pending|payout|withdrawal/i);

      const userCheck = await pool.query(
        'SELECT id FROM users WHERE id = $1',
        [testUserId]
      );
      expect(userCheck.rows.length).toBe(1);
    });
  });

  describe('Test 8: Pending payment intents → returns 400', () => {
    it('should prevent deletion when user has pending payment intents', async () => {
      const contestId = crypto.randomUUID();
      await pool.query(
        'INSERT INTO contest_instances (id, template_id, organizer_id, status, entry_fee_cents, payout_structure, contest_name, max_entries) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [contestId, templateId, otherUserId, 'SCHEDULED', 0, JSON.stringify({}), 'Test Contest', 20]
      );

      await pool.query(
        'INSERT INTO payment_intents (id, user_id, contest_instance_id, stripe_payment_intent_id, amount_cents, currency, status, idempotency_key) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [crypto.randomUUID(), testUserId, contestId, 'pi_test_' + crypto.randomUUID(), 5000, 'USD', 'REQUIRES_PAYMENT_METHOD', crypto.randomUUID()]
      );

      const response = await request(app)
        .delete(`/api/user?userId=${testUserId}`)
        .set('Authorization', `Bearer ${testUserId}`)
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('reason');
      expect(response.body.reason).toMatch(/pending|deposit|payment/i);

      const userCheck = await pool.query(
        'SELECT id FROM users WHERE id = $1',
        [testUserId]
      );
      expect(userCheck.rows.length).toBe(1);
    });
  });
});
