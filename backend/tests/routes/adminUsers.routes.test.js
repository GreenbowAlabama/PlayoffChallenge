/**
 * Admin Users Routes Tests
 *
 * Purpose: Verify admin user management endpoints
 * - GET /api/admin/users - list all users with wallet visibility
 * - GET /api/admin/users/:userId - detailed user info
 * - POST /api/admin/users/:userId/wallet/credit - issue wallet credit
 * - GET /api/admin/users/:userId/wallet-ledger - get user transaction history
 */

const request = require('supertest');
const { randomUUID } = require('crypto');
const { getIntegrationApp, createMockAdminToken } = require('../mocks/testAppFactory');
const { ensureNflPlayoffChallengeTemplate } = require('../helpers/templateFactory');

describe('Admin Users Routes', () => {
  let app;
  let pool;
  let adminToken;
  let adminUserId;
  let testUserId;
  let templateId;

  beforeAll(async () => {
    const { app: integrationApp, pool: dbPool } = getIntegrationApp();
    app = integrationApp;
    pool = dbPool;

    // Create admin user (matching the mock token)
    adminUserId = '33333333-3333-3333-3333-333333333333';
    await pool.query(
      `INSERT INTO users (id, name, email, is_admin)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET is_admin = TRUE`,
      [adminUserId, 'Admin User', 'admin@example.com', true]
    );

    adminToken = createMockAdminToken({ is_admin: true });

    // Create test user
    testUserId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, name, email) VALUES ($1, $2, $3)`,
      [testUserId, 'Test User', `testuser-${testUserId}@test.example.com`]
    );

    // Create template for contests
    const template = await ensureNflPlayoffChallengeTemplate(pool);
    templateId = template.id;
  });

  afterAll(async () => {
    // Don't call pool.end() — it's a shared cached pool managed by testAppFactory
    // Calling end() would break other tests using the same pool
  });

  describe('GET /api/admin/users/:userId/wallet-ledger', () => {
    test('returns wallet transactions for user', async () => {
      // Create some ledger entries for the user
      const txn1Id = randomUUID();
      const txn2Id = randomUUID();

      await pool.query(
        `INSERT INTO ledger
         (id, user_id, entry_type, direction, amount_cents, currency, reference_type, reference_id, idempotency_key, metadata_json, created_at)
         VALUES
           ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW() - INTERVAL '2 hours'),
           ($11, $2, $12, $13, $14, $6, $7, $15, $16, $10, NOW() - INTERVAL '1 hour')`,
        [
          txn1Id, testUserId, 'WALLET_DEPOSIT', 'CREDIT', 6000,
          'USD', 'WALLET', testUserId, `wallet_deposit:${testUserId}:1`, JSON.stringify({}),
          txn2Id, 'ENTRY_FEE', 'DEBIT', 5000,
          testUserId, `entry_fee:${testUserId}:1`
        ]
      );

      const response = await request(app)
        .get(`/api/admin/users/${testUserId}/wallet-ledger`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('user_id', testUserId);
      expect(response.body).toHaveProperty('current_balance_cents');
      expect(response.body).toHaveProperty('transactions');
      expect(Array.isArray(response.body.transactions)).toBe(true);
      expect(response.body.transactions.length).toBeGreaterThan(0);

      // Verify transaction structure
      const transaction = response.body.transactions[0];
      expect(transaction).toHaveProperty('id');
      expect(transaction).toHaveProperty('entry_type');
      expect(transaction).toHaveProperty('direction');
      expect(transaction).toHaveProperty('amount_cents');
      expect(transaction).toHaveProperty('created_at');
    });

    test('returns empty transactions array for user with no ledger', async () => {
      const emptyUserId = randomUUID();
      await pool.query(
        `INSERT INTO users (id, name, email) VALUES ($1, $2, $3)`,
        [emptyUserId, 'Empty User', `emptyuser-${emptyUserId}@test.example.com`]
      );

      const response = await request(app)
        .get(`/api/admin/users/${emptyUserId}/wallet-ledger`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.transactions).toEqual([]);
      expect(response.body.current_balance_cents).toBe(0);
    });

    test('returns 404 for non-existent user', async () => {
      const fakeUserId = randomUUID();

      const response = await request(app)
        .get(`/api/admin/users/${fakeUserId}/wallet-ledger`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
    });

    test('requires admin authentication', async () => {
      const response = await request(app)
        .get(`/api/admin/users/${testUserId}/wallet-ledger`);

      expect([401, 403]).toContain(response.status);
    });

    test('orders transactions by most recent first', async () => {
      const sortUserId = randomUUID();
      await pool.query(
        `INSERT INTO users (id, name, email) VALUES ($1, $2, $3)`,
        [sortUserId, 'Sort User', `sortuser-${sortUserId}@test.example.com`]
      );

      // Insert 3 transactions with different timestamps
      const now = new Date();
      const baseTime = new Date(now.getTime() - 3000);

      for (let i = 0; i < 3; i++) {
        const txnId = randomUUID();
        const txnTime = new Date(now.getTime() - (3 - i) * 1000);
        await pool.query(
          `INSERT INTO ledger
           (id, user_id, entry_type, direction, amount_cents, currency, reference_type, reference_id, idempotency_key, metadata_json, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            txnId, sortUserId, 'WALLET_DEPOSIT', 'CREDIT', 1000,
            'USD', 'WALLET', sortUserId, `txn${i}:${sortUserId}`, JSON.stringify({}),
            txnTime
          ]
        );
      }

      const response = await request(app)
        .get(`/api/admin/users/${sortUserId}/wallet-ledger`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.transactions.length).toBe(3);

      // Most recent should be first
      const timestamps = response.body.transactions.map(t => new Date(t.created_at).getTime());
      expect(timestamps[0]).toBeGreaterThan(timestamps[1]);
      expect(timestamps[1]).toBeGreaterThan(timestamps[2]);
    });

    test('limits results to 100 transactions', async () => {
      const manyTxnUserId = randomUUID();
      await pool.query(
        `INSERT INTO users (id, name, email) VALUES ($1, $2, $3)`,
        [manyTxnUserId, 'Many Txn User', `manytxn-${manyTxnUserId}@test.example.com`]
      );

      // Insert 105 transactions one by one
      const baseTime = new Date(2026, 0, 1).getTime();
      for (let i = 0; i < 105; i++) {
        const txnId = randomUUID();
        const key = `txn:${manyTxnUserId}:${i}`;
        const timestamp = new Date(baseTime + i * 1000);
        await pool.query(
          `INSERT INTO ledger
           (id, user_id, entry_type, direction, amount_cents, currency, reference_type, reference_id, idempotency_key, metadata_json, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            txnId, manyTxnUserId, 'WALLET_DEPOSIT', 'CREDIT', 100,
            'USD', 'WALLET', manyTxnUserId, key, JSON.stringify({}), timestamp
          ]
        );
      }

      const response = await request(app)
        .get(`/api/admin/users/${manyTxnUserId}/wallet-ledger`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.transactions.length).toBeLessThanOrEqual(100);
    });
  });
});
