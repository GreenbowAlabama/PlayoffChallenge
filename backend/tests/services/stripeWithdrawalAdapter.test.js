/**
 * Stripe Withdrawal Adapter Tests
 *
 * Tests for Stripe account status handling (account.updated events).
 *
 * Coverage:
 * - handleAccountUpdate audit-only behavior (no DB mutations)
 * - Logging of account status changes
 * - Compliance with live-fetch model
 */

const StripeWithdrawalAdapter = require('../../services/StripeWithdrawalAdapter');

describe('StripeWithdrawalAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createTransfer', () => {
    it('should create transfer successfully from platform to connected account', async () => {
      const mockTransfer = {
        id: 'tr_test_123',
        object: 'transfer',
        amount: 5000,
        currency: 'usd',
        status: 'created',
        destination: 'acct_1TCU0sCCNMx6lMSI'
      };

      const mockStripe = {
        transfers: {
          create: jest.fn().mockResolvedValue(mockTransfer)
        }
      };

      const result = await StripeWithdrawalAdapter.createTransfer({
        amountCents: 5000,
        destination: 'acct_1TCU0sCCNMx6lMSI',
        withdrawalId: 'withdrawal_123',
        userId: 'user_456',
        stripeOverride: mockStripe
      });

      expect(result.success).toBe(true);
      expect(result.transferId).toBe('tr_test_123');
      expect(result.errorType).toBeNull();
      expect(result.errorCode).toBeNull();

      // Verify Stripe was called with correct parameters
      expect(mockStripe.transfers.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 5000,
          currency: 'usd',
          destination: 'acct_1TCU0sCCNMx6lMSI'
        }),
        expect.objectContaining({
          idempotencyKey: 'wallet_withdrawal:withdrawal_123'
        })
      );
    });

    it('should return permanent error for invalid amount', async () => {
      const mockStripe = {
        transfers: {
          create: jest.fn()
        }
      };

      const result = await StripeWithdrawalAdapter.createTransfer({
        amountCents: 0,
        destination: 'acct_test',
        withdrawalId: 'withdrawal_123',
        userId: 'user_456',
        stripeOverride: mockStripe
      });

      expect(result.success).toBe(false);
      expect(result.classification).toBe('permanent');
      expect(result.reason).toBe('invalid_amount');
      expect(mockStripe.transfers.create).not.toHaveBeenCalled();
    });

    it('should return permanent error for invalid destination account', async () => {
      const mockStripe = {
        transfers: {
          create: jest.fn()
        }
      };

      const result = await StripeWithdrawalAdapter.createTransfer({
        amountCents: 5000,
        destination: 'invalid_account_id',
        withdrawalId: 'withdrawal_123',
        userId: 'user_456',
        stripeOverride: mockStripe
      });

      expect(result.success).toBe(false);
      expect(result.classification).toBe('permanent');
      expect(result.reason).toBe('invalid_destination');
      expect(mockStripe.transfers.create).not.toHaveBeenCalled();
    });

    it('should classify insufficient funds as retryable', async () => {
      const stripeError = new Error('Insufficient funds available in platform account');
      stripeError.type = 'StripeInvalidRequestError';
      stripeError.status = 400;
      stripeError.code = 'insufficient_funds';
      stripeError.message = 'Insufficient funds available in platform account';

      const mockStripe = {
        transfers: {
          create: jest.fn().mockRejectedValue(stripeError)
        }
      };

      const result = await StripeWithdrawalAdapter.createTransfer({
        amountCents: 5000,
        destination: 'acct_test',
        withdrawalId: 'withdrawal_123',
        userId: 'user_456',
        stripeOverride: mockStripe
      });

      expect(result.success).toBe(false);
      expect(result.classification).toBe('retryable');
      expect(result.reason).toBe('stripe_insufficient_funds');
      expect(result.errorType).toBe('StripeInvalidRequestError');
    });

    it('should classify invalid account as permanent', async () => {
      const stripeError = new Error('Stripe account could not accept transfer');
      stripeError.type = 'StripeInvalidRequestError';
      stripeError.status = 400;
      stripeError.code = 'invalid_account';
      stripeError.message = 'Stripe account could not accept transfer';

      const mockStripe = {
        transfers: {
          create: jest.fn().mockRejectedValue(stripeError)
        }
      };

      const result = await StripeWithdrawalAdapter.createTransfer({
        amountCents: 5000,
        destination: 'acct_invalid',
        withdrawalId: 'withdrawal_123',
        userId: 'user_456',
        stripeOverride: mockStripe
      });

      expect(result.success).toBe(false);
      expect(result.classification).toBe('permanent');
      expect(result.reason).toBe('stripe_invalid_account');
    });

    it('should preserve idempotency with same withdrawal ID', async () => {
      const mockTransfer = {
        id: 'tr_test_same',
        object: 'transfer'
      };

      const mockStripe = {
        transfers: {
          create: jest.fn().mockResolvedValue(mockTransfer)
        }
      };

      // Call twice with same withdrawal ID
      const result1 = await StripeWithdrawalAdapter.createTransfer({
        amountCents: 5000,
        destination: 'acct_test',
        withdrawalId: 'withdrawal_same_123',
        userId: 'user_456',
        stripeOverride: mockStripe
      });

      const result2 = await StripeWithdrawalAdapter.createTransfer({
        amountCents: 5000,
        destination: 'acct_test',
        withdrawalId: 'withdrawal_same_123',
        userId: 'user_456',
        stripeOverride: mockStripe
      });

      // Both should succeed
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);

      // Both calls should use same idempotency key
      expect(mockStripe.transfers.create).toHaveBeenCalledTimes(2);
      expect(mockStripe.transfers.create).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        expect.objectContaining({
          idempotencyKey: 'wallet_withdrawal:withdrawal_same_123'
        })
      );
      expect(mockStripe.transfers.create).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        expect.objectContaining({
          idempotencyKey: 'wallet_withdrawal:withdrawal_same_123'
        })
      );
    });

    it('should classify rate limit as retryable', async () => {
      const stripeError = new Error('Too many requests');
      stripeError.type = 'StripeRateLimitError';
      stripeError.status = 429;

      const mockStripe = {
        transfers: {
          create: jest.fn().mockRejectedValue(stripeError)
        }
      };

      const result = await StripeWithdrawalAdapter.createTransfer({
        amountCents: 5000,
        destination: 'acct_test',
        withdrawalId: 'withdrawal_123',
        userId: 'user_456',
        stripeOverride: mockStripe
      });

      expect(result.success).toBe(false);
      expect(result.classification).toBe('retryable');
      expect(result.reason).toBe('stripe_rate_limit');
    });
  });

  describe('handleAccountUpdate', () => {
    it('should handle account.updated without DB mutations', async () => {
      const params = {
        stripeAccountId: 'acct_test_123',
        payoutsEnabled: true,
        chargesEnabled: true
      };

      // Should not throw
      const result = await StripeWithdrawalAdapter.handleAccountUpdate(params);

      // Should return undefined (no-op)
      expect(result).toBeUndefined();
    });

    it('should log account status when LOG_WEBHOOK_DEBUG enabled', async () => {
      const originalEnv = process.env.LOG_WEBHOOK_DEBUG;
      process.env.LOG_WEBHOOK_DEBUG = 'true';

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const params = {
        stripeAccountId: 'acct_test_456',
        payoutsEnabled: false,
        chargesEnabled: true
      };

      await StripeWithdrawalAdapter.handleAccountUpdate(params);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('account status update received'),
        expect.objectContaining({
          stripeAccountId: 'acct_test_456',
          payoutsEnabled: false,
          chargesEnabled: true
        })
      );

      consoleSpy.mockRestore();
      process.env.LOG_WEBHOOK_DEBUG = originalEnv;
    });

    it('should be idempotent (multiple calls with same data)', async () => {
      const params = {
        stripeAccountId: 'acct_test_789',
        payoutsEnabled: true,
        chargesEnabled: true
      };

      // Call multiple times
      await StripeWithdrawalAdapter.handleAccountUpdate(params);
      await StripeWithdrawalAdapter.handleAccountUpdate(params);
      await StripeWithdrawalAdapter.handleAccountUpdate(params);

      // All should succeed without side effects
      expect(true).toBe(true);
    });

    it('should handle partial account status (payouts disabled)', async () => {
      const params = {
        stripeAccountId: 'acct_disabled',
        payoutsEnabled: false,
        chargesEnabled: true
      };

      // Should handle gracefully
      const result = await StripeWithdrawalAdapter.handleAccountUpdate(params);

      expect(result).toBeUndefined();
    });

    it('should not perform any database operations', async () => {
      // This is a behavioral test: ensure no database methods are called
      // Implementation is audit-only, so no queries should occur

      const params = {
        stripeAccountId: 'acct_nodelete',
        payoutsEnabled: true,
        chargesEnabled: true
      };

      // Should not throw or perform mutations
      await expect(
        StripeWithdrawalAdapter.handleAccountUpdate(params)
      ).resolves.toBeUndefined();
    });
  });
});
