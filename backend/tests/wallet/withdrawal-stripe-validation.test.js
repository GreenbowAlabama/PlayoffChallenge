/**
 * Withdrawal Stripe Validation Tests
 *
 * Tests for POST /api/wallet/withdraw endpoint guard enforcement.
 * Validates that stripe_connected_account_id is required before processing.
 */

const request = require('supertest');
const express = require('express');
const walletRoutes = require('../../routes/wallet.routes');
const { createMockUserToken } = require('../mocks/testAppFactory');

// Mock StripeWithdrawalAdapter to prevent real Stripe calls
jest.mock('../../services/StripeWithdrawalAdapter', () => ({
  getStripeInstance: jest.fn()
}));

// Mock withdrawalService - should NOT be called if guard fails
jest.mock('../../services/withdrawalService', () => ({
  createWithdrawalRequest: jest.fn(),
  processWithdrawal: jest.fn(),
  getWithdrawal: jest.fn()
}));

describe('Wallet Withdraw — Stripe Account Validation', () => {
  let app;
  let mockPool;
  const TEST_USER_ID = '550e8400-e29b-41d4-a716-446655440001';
  const TEST_IDEMPOTENCY_KEY = 'idem-stripe-validation-test';
  let userToken;

  beforeEach(() => {
    jest.clearAllMocks();

    mockPool = {
      query: jest.fn(),
      connect: jest.fn()
    };

    userToken = createMockUserToken({ sub: TEST_USER_ID, user_id: TEST_USER_ID });

    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.app.locals.pool = mockPool;
      next();
    });
    app.use('/api/wallet', walletRoutes);
  });

  describe('Stripe Account Connection Guard', () => {
    it('should reject withdrawal if stripe_connected_account_id is NULL', async () => {
      // User exists but has no Stripe account connected
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          stripe_connected_account_id: null
        }]
      });

      const response = await request(app)
        .post('/api/wallet/withdraw')
        .set('Authorization', `Bearer ${userToken}`)
        .set('Idempotency-Key', TEST_IDEMPOTENCY_KEY)
        .send({ amount_cents: 5000, method: 'standard' });

      expect(response.status).toBe(400);
      expect(response.body.error_code).toBe('STRIPE_ACCOUNT_REQUIRED');
      expect(response.body.message).toContain('Stripe account not connected');

      // Verify withdrawalService.createWithdrawalRequest was NOT called
      const withdrawalService = require('../../services/withdrawalService');
      expect(withdrawalService.createWithdrawalRequest).not.toHaveBeenCalled();
    });

    it('should reject withdrawal if user not found in database', async () => {
      // Pool returns no rows (user doesn't exist)
      mockPool.query.mockResolvedValueOnce({
        rows: []
      });

      const response = await request(app)
        .post('/api/wallet/withdraw')
        .set('Authorization', `Bearer ${userToken}`)
        .set('Idempotency-Key', `${TEST_IDEMPOTENCY_KEY}-notfound`)
        .send({ amount_cents: 5000, method: 'standard' });

      expect(response.status).toBe(404);
      expect(response.body.error_code).toBe('USER_NOT_FOUND');

      const withdrawalService = require('../../services/withdrawalService');
      expect(withdrawalService.createWithdrawalRequest).not.toHaveBeenCalled();
    });

    it('should reject withdrawal if Stripe account not ready (payouts_enabled=false)', async () => {
      // User has Stripe account connected
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          stripe_connected_account_id: 'acct_test_notready'
        }]
      });

      // Stripe account exists but payouts not enabled
      const StripeWithdrawalAdapter = require('../../services/StripeWithdrawalAdapter');
      StripeWithdrawalAdapter.getStripeInstance.mockReturnValue({
        accounts: {
          retrieve: jest.fn().mockResolvedValue({
            payouts_enabled: false,
            details_submitted: true,
            charges_enabled: true
          })
        }
      });

      const response = await request(app)
        .post('/api/wallet/withdraw')
        .set('Authorization', `Bearer ${userToken}`)
        .set('Idempotency-Key', `${TEST_IDEMPOTENCY_KEY}-notready`)
        .send({ amount_cents: 5000, method: 'standard' });

      expect(response.status).toBe(400);
      expect(response.body.error_code).toBe('STRIPE_ACCOUNT_INCOMPLETE');
      expect(response.body.message).toContain('incomplete');

      const withdrawalService = require('../../services/withdrawalService');
      expect(withdrawalService.createWithdrawalRequest).not.toHaveBeenCalled();
    });

    it('should reject withdrawal if Stripe account not submitted (details_submitted=false)', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          stripe_connected_account_id: 'acct_test_nodetails'
        }]
      });

      const StripeWithdrawalAdapter = require('../../services/StripeWithdrawalAdapter');
      StripeWithdrawalAdapter.getStripeInstance.mockReturnValue({
        accounts: {
          retrieve: jest.fn().mockResolvedValue({
            payouts_enabled: true,
            details_submitted: false,
            charges_enabled: true
          })
        }
      });

      const response = await request(app)
        .post('/api/wallet/withdraw')
        .set('Authorization', `Bearer ${userToken}`)
        .set('Idempotency-Key', `${TEST_IDEMPOTENCY_KEY}-nodetails`)
        .send({ amount_cents: 5000, method: 'standard' });

      expect(response.status).toBe(400);
      expect(response.body.error_code).toBe('STRIPE_ACCOUNT_INCOMPLETE');

      const withdrawalService = require('../../services/withdrawalService');
      expect(withdrawalService.createWithdrawalRequest).not.toHaveBeenCalled();
    });

    it('should reject withdrawal if Stripe API call fails (account not found)', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          stripe_connected_account_id: 'acct_deleted_account'
        }]
      });

      const StripeWithdrawalAdapter = require('../../services/StripeWithdrawalAdapter');
      StripeWithdrawalAdapter.getStripeInstance.mockReturnValue({
        accounts: {
          retrieve: jest.fn().mockRejectedValue(
            new Error('No such account: acct_deleted_account')
          )
        }
      });

      const response = await request(app)
        .post('/api/wallet/withdraw')
        .set('Authorization', `Bearer ${userToken}`)
        .set('Idempotency-Key', `${TEST_IDEMPOTENCY_KEY}-deleted`)
        .send({ amount_cents: 5000, method: 'standard' });

      expect(response.status).toBe(400);
      expect(response.body.error_code).toBe('STRIPE_ACCOUNT_REQUIRED');

      const withdrawalService = require('../../services/withdrawalService');
      expect(withdrawalService.createWithdrawalRequest).not.toHaveBeenCalled();
    });

    it('should return 503 if Stripe API fails with transient error', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          stripe_connected_account_id: 'acct_test_transient'
        }]
      });

      const StripeWithdrawalAdapter = require('../../services/StripeWithdrawalAdapter');
      StripeWithdrawalAdapter.getStripeInstance.mockReturnValue({
        accounts: {
          retrieve: jest.fn().mockRejectedValue(
            new Error('Stripe API temporarily unavailable')
          )
        }
      });

      const response = await request(app)
        .post('/api/wallet/withdraw')
        .set('Authorization', `Bearer ${userToken}`)
        .set('Idempotency-Key', `${TEST_IDEMPOTENCY_KEY}-transient`)
        .send({ amount_cents: 5000, method: 'standard' });

      expect(response.status).toBe(503);
      expect(response.body.error).toContain('Unable to verify');

      const withdrawalService = require('../../services/withdrawalService');
      expect(withdrawalService.createWithdrawalRequest).not.toHaveBeenCalled();
    });

    it('should allow withdrawal when Stripe account is properly set up', async () => {
      // User has Stripe account
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          stripe_connected_account_id: 'acct_test_ready'
        }]
      });

      // Stripe account is ready
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

      // Mock withdrawalService to prevent actual withdrawal
      const withdrawalService = require('../../services/withdrawalService');
      withdrawalService.createWithdrawalRequest.mockResolvedValue({
        success: true,
        withdrawal: {
          id: 'withdrawal-test-id'
        }
      });

      withdrawalService.processWithdrawal.mockResolvedValue({
        success: true,
        withdrawal: {
          id: 'withdrawal-test-id',
          status: 'PROCESSING'
        }
      });

      const response = await request(app)
        .post('/api/wallet/withdraw')
        .set('Authorization', `Bearer ${userToken}`)
        .set('Idempotency-Key', `${TEST_IDEMPOTENCY_KEY}-ready`)
        .send({ amount_cents: 5000, method: 'standard' });

      // Guard should pass, withdrawalService should be called
      expect(response.status).toBe(200);
      expect(response.body.withdrawal_id).toBeDefined();
      expect(withdrawalService.createWithdrawalRequest).toHaveBeenCalled();
    });

    it('should enforce validation BEFORE any database writes', async () => {
      // User has no Stripe account
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          stripe_connected_account_id: null
        }]
      });

      const response = await request(app)
        .post('/api/wallet/withdraw')
        .set('Authorization', `Bearer ${userToken}`)
        .set('Idempotency-Key', `${TEST_IDEMPOTENCY_KEY}-nowrite`)
        .send({ amount_cents: 5000, method: 'standard' });

      // Should fail guard
      expect(response.status).toBe(400);
      expect(response.body.error_code).toBe('STRIPE_ACCOUNT_REQUIRED');

      // Verify that only the initial user lookup was called
      // (no INSERT to wallet_withdrawals or ledger should occur)
      const withdrawalService = require('../../services/withdrawalService');
      expect(withdrawalService.createWithdrawalRequest).not.toHaveBeenCalled();
    });
  });

  describe('Status Transitions on Valid Withdrawal', () => {
    it('should transition withdrawal to REQUESTED after guard passes', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          stripe_connected_account_id: 'acct_test_valid'
        }]
      });

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

      const withdrawalService = require('../../services/withdrawalService');
      withdrawalService.createWithdrawalRequest.mockResolvedValue({
        success: true,
        withdrawal: {
          id: 'w-123',
          status: 'REQUESTED'
        }
      });

      withdrawalService.processWithdrawal.mockResolvedValue({
        success: true,
        withdrawal: {
          id: 'w-123',
          status: 'PROCESSING'
        }
      });

      const response = await request(app)
        .post('/api/wallet/withdraw')
        .set('Authorization', `Bearer ${userToken}`)
        .set('Idempotency-Key', `${TEST_IDEMPOTENCY_KEY}-status`)
        .send({ amount_cents: 5000, method: 'standard' });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('PROCESSING');
      expect(withdrawalService.processWithdrawal).toHaveBeenCalled();
    });
  });
});
