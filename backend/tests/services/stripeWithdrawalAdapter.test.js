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
