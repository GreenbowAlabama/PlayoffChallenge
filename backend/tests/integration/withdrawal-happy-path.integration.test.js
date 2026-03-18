/**
 * Withdrawal Happy Path Integration Test
 *
 * Validates Phase 2 execution: Guard passes → Side effects occur
 *
 * Prerequisites:
 * - Test user with valid Stripe account
 * - User has ledger balance
 * - Withdrawal config present
 *
 * Validates:
 * - wallet_withdrawals row created with status = REQUESTED
 * - ledger DEBIT entry created
 * - idempotency: same request doesn't create duplicate rows
 * - withdrawal processor can pick up job
 * - Financial invariant maintained
 */

const request = require('supertest');
const express = require('express');
const { Pool } = require('pg');
const walletRoutes = require('../../routes/wallet.routes');
const { createMockUserToken } = require('../mocks/testAppFactory');

// Mock StripeWithdrawalAdapter to prevent real Stripe calls
jest.mock('../../services/StripeWithdrawalAdapter', () => ({
  getStripeInstance: jest.fn()
}));

describe('Withdrawal Happy Path - Guard Passes → Side Effects Occur', () => {
  let app;
  let pool;
  let testUserId;
  const TEST_IDEMPOTENCY_KEY = 'idem-happy-path-001';
  const WITHDRAW_AMOUNT = 5000; // $50

  beforeAll(async () => {
    // Use test database if available
    const dbUrl = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;
    pool = new Pool({ connectionString: dbUrl });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Clear mocks
    jest.clearAllMocks();

    // Create test user with Stripe account
    testUserId = '550e8400-e29b-41d4-a716-446655440001';
    const stripeAccountId = 'acct_happy_path_test';

    // Insert test user with Stripe account
    await pool.query(
      `INSERT INTO users (id, email, username, stripe_connected_account_id, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (id) DO UPDATE SET stripe_connected_account_id = $4`,
      [testUserId, `test-${Date.now()}@example.com`, `testuser-${Date.now()}`, stripeAccountId]
    );

    // Insert wallet balance via ledger (WALLET_DEPOSIT)
    const depositId = `deposit-${Date.now()}`;
    await pool.query(
      `INSERT INTO ledger
       (id, user_id, entry_type, direction, amount_cents, currency, reference_type, reference_id, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        depositId,
        testUserId,
        'WALLET_DEPOSIT',
        'CREDIT',
        50000, // $500
        'USD',
        'WALLET',
        depositId,
        `deposit-key-${Date.now()}`
      ]
    );

    // Insert withdrawal config (sandbox environment)
    await pool.query(
      `INSERT INTO withdrawal_config
       (environment, min_withdrawal_cents, max_withdrawal_cents, daily_withdrawal_limit_cents,
        max_withdrawals_per_day, instant_enabled, instant_fee_percent, instant_fee_cents, standard_fee_cents, cooldown_seconds)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (environment) DO NOTHING`,
      ['sandbox', 1000, 50000000, 500000000, 10, true, 0.5, 50, 0, 0]
    );

    // Mock Stripe account as ready
    const StripeWithdrawalAdapter = require('../../services/StripeWithdrawalAdapter');
    StripeWithdrawalAdapter.getStripeInstance.mockReturnValue({
      accounts: {
        retrieve: jest.fn().mockResolvedValue({
          payouts_enabled: true,
          details_submitted: true,
          charges_enabled: true
        })
      }
    });

    // Create Express app
    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.app.locals.pool = pool;
      next();
    });
    app.use('/api/wallet', walletRoutes);
  });

  afterEach(async () => {
    // Clean up test data
    try {
      await pool.query('DELETE FROM wallet_withdrawals WHERE user_id = $1', [testUserId]);
      await pool.query('DELETE FROM ledger WHERE user_id = $1', [testUserId]);
      await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
    } catch (err) {
      console.error('Cleanup error:', err.message);
    }
  });

  describe('Happy Path: Guard Passes → Withdrawal Created', () => {
    it('should create wallet_withdrawals row when guard passes', async () => {
      const userToken = createMockUserToken({ sub: testUserId, user_id: testUserId });

      // Verify setup: user has balance
      const balanceCheck = await pool.query(
        `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents WHEN direction = 'DEBIT' THEN -amount_cents END), 0) as balance
         FROM ledger WHERE user_id = $1`,
        [testUserId]
      );
      const balanceBefore = parseInt(balanceCheck.rows[0].balance, 10);
      expect(balanceBefore).toBeGreaterThan(WITHDRAW_AMOUNT);

      // Call withdraw endpoint
      const response = await request(app)
        .post('/api/wallet/withdraw')
        .set('Authorization', `Bearer ${userToken}`)
        .set('Idempotency-Key', TEST_IDEMPOTENCY_KEY)
        .send({ amount_cents: WITHDRAW_AMOUNT, method: 'standard' });

      // ASSERTION 1: Guard passed (200 response)
      expect(response.status).toBe(200);
      expect(response.body.withdrawal_id).toBeDefined();
      expect(response.body.status).toBeDefined();

      // ASSERTION 2: wallet_withdrawals row was created
      const withdrawalCheck = await pool.query(
        'SELECT * FROM wallet_withdrawals WHERE user_id = $1 AND amount_cents = $2',
        [testUserId, WITHDRAW_AMOUNT]
      );
      expect(withdrawalCheck.rows.length).toBeGreaterThan(0);
      const withdrawal = withdrawalCheck.rows[0];
      expect(withdrawal.status).toBe('REQUESTED'); // Phase 1 status

      // ASSERTION 3: ledger DEBIT entry was created
      const ledgerDebitCheck = await pool.query(
        `SELECT * FROM ledger WHERE user_id = $1 AND entry_type = 'WALLET_WITHDRAWAL' AND direction = 'DEBIT' AND amount_cents = $2`,
        [testUserId, WITHDRAW_AMOUNT]
      );
      expect(ledgerDebitCheck.rows.length).toBeGreaterThan(0);
      const debitEntry = ledgerDebitCheck.rows[0];
      expect(debitEntry.reference_id).toBe(withdrawal.id); // Links to withdrawal

      // ASSERTION 4: Financial invariant - balance reduced by withdrawal amount
      const balanceAfter = await pool.query(
        `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents WHEN direction = 'DEBIT' THEN -amount_cents END), 0) as balance
         FROM ledger WHERE user_id = $1`,
        [testUserId]
      );
      const balanceAfterValue = parseInt(balanceAfter.rows[0].balance, 10);
      expect(balanceAfterValue).toBe(balanceBefore - WITHDRAW_AMOUNT);
    });

    it('should enforce idempotency: same key returns same withdrawal without duplicate rows', async () => {
      const userToken = createMockUserToken({ sub: testUserId, user_id: testUserId });

      // First request
      const response1 = await request(app)
        .post('/api/wallet/withdraw')
        .set('Authorization', `Bearer ${userToken}`)
        .set('Idempotency-Key', TEST_IDEMPOTENCY_KEY)
        .send({ amount_cents: WITHDRAW_AMOUNT, method: 'standard' });

      expect(response1.status).toBe(200);
      const withdrawalId1 = response1.body.withdrawal_id;

      // Count rows after first request
      const countAfterFirst = await pool.query(
        'SELECT COUNT(*) as count FROM wallet_withdrawals WHERE user_id = $1 AND amount_cents = $2',
        [testUserId, WITHDRAW_AMOUNT]
      );
      const rowCountFirst = parseInt(countAfterFirst.rows[0].count, 10);

      // Count ledger debits after first request
      const ledgerCountFirst = await pool.query(
        `SELECT COUNT(*) as count FROM ledger WHERE user_id = $1 AND entry_type = 'WALLET_WITHDRAWAL' AND direction = 'DEBIT' AND amount_cents = $2`,
        [testUserId, WITHDRAW_AMOUNT]
      );
      const ledgerDebitCountFirst = parseInt(ledgerCountFirst.rows[0].count, 10);

      // Second request with SAME idempotency key
      const response2 = await request(app)
        .post('/api/wallet/withdraw')
        .set('Authorization', `Bearer ${userToken}`)
        .set('Idempotency-Key', TEST_IDEMPOTENCY_KEY)
        .send({ amount_cents: WITHDRAW_AMOUNT, method: 'standard' });

      expect(response2.status).toBe(200);
      const withdrawalId2 = response2.body.withdrawal_id;

      // ASSERTION 1: Same withdrawal ID returned
      expect(withdrawalId2).toBe(withdrawalId1);

      // ASSERTION 2: No duplicate wallet_withdrawals rows
      const countAfterSecond = await pool.query(
        'SELECT COUNT(*) as count FROM wallet_withdrawals WHERE user_id = $1 AND amount_cents = $2',
        [testUserId, WITHDRAW_AMOUNT]
      );
      const rowCountSecond = parseInt(countAfterSecond.rows[0].count, 10);
      expect(rowCountSecond).toBe(rowCountFirst); // No new rows

      // ASSERTION 3: No duplicate ledger entries
      const ledgerCountSecond = await pool.query(
        `SELECT COUNT(*) as count FROM ledger WHERE user_id = $1 AND entry_type = 'WALLET_WITHDRAWAL' AND direction = 'DEBIT' AND amount_cents = $2`,
        [testUserId, WITHDRAW_AMOUNT]
      );
      const ledgerDebitCountSecond = parseInt(ledgerCountSecond.rows[0].count, 10);
      expect(ledgerDebitCountSecond).toBe(ledgerDebitCountFirst); // No new entries
    });

    it('should create processable withdrawal (processor can pick up job)', async () => {
      const userToken = createMockUserToken({ sub: testUserId, user_id: testUserId });

      const response = await request(app)
        .post('/api/wallet/withdraw')
        .set('Authorization', `Bearer ${userToken}`)
        .set('Idempotency-Key', TEST_IDEMPOTENCY_KEY)
        .send({ amount_cents: WITHDRAW_AMOUNT, method: 'standard' });

      expect(response.status).toBe(200);
      const withdrawalId = response.body.withdrawal_id;

      // Simulate withdrawal processor picking up job
      const unprocessedCheck = await pool.query(
        `SELECT id, status, amount_cents, user_id FROM wallet_withdrawals
         WHERE id = $1 AND status IN ('REQUESTED', 'PROCESSING')`,
        [withdrawalId]
      );

      // ASSERTION: Withdrawal exists and is in a processable state
      expect(unprocessedCheck.rows.length).toBe(1);
      const withdrawal = unprocessedCheck.rows[0];
      expect(['REQUESTED', 'PROCESSING']).toContain(withdrawal.status);
      expect(withdrawal.amount_cents).toBe(WITHDRAW_AMOUNT);
    });
  });

  describe('Guard Failure Patterns (Re-validation)', () => {
    it('should NOT create rows when Stripe account missing (re-validate Phase 1)', async () => {
      const userToken = createMockUserToken({ sub: testUserId, user_id: testUserId });

      // Simulate guard failure: remove Stripe account
      await pool.query(
        'UPDATE users SET stripe_connected_account_id = NULL WHERE id = $1',
        [testUserId]
      );

      const response = await request(app)
        .post('/api/wallet/withdraw')
        .set('Authorization', `Bearer ${userToken}`)
        .set('Idempotency-Key', `${TEST_IDEMPOTENCY_KEY}-nosync`)
        .send({ amount_cents: WITHDRAW_AMOUNT, method: 'standard' });

      // Guard fails
      expect(response.status).toBe(400);
      expect(response.body.error_code).toBe('STRIPE_ACCOUNT_REQUIRED');

      // Verify NO wallet_withdrawals row was created
      const withdrawalCheck = await pool.query(
        'SELECT COUNT(*) as count FROM wallet_withdrawals WHERE user_id = $1',
        [testUserId]
      );
      expect(parseInt(withdrawalCheck.rows[0].count, 10)).toBe(0);

      // Verify NO new ledger entries (only the deposit from setup)
      const ledgerCheck = await pool.query(
        `SELECT COUNT(*) as count FROM ledger WHERE user_id = $1 AND entry_type = 'WALLET_WITHDRAWAL'`,
        [testUserId]
      );
      expect(parseInt(ledgerCheck.rows[0].count, 10)).toBe(0);
    });
  });
});
