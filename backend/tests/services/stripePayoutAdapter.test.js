/**
 * Stripe Payout Adapter Tests
 *
 * Tests for Stripe transfer API integration with error classification.
 *
 * Coverage:
 * - Successful transfer creation
 * - Idempotency key usage
 * - Transient error classification (timeout, 5xx, 429)
 * - Permanent error classification (4xx validation, invalid account)
 * - Error reason extraction
 */

const StripePayoutAdapter = require('../../services/StripePayoutAdapter');

// Mock stripe SDK
jest.mock('stripe');

describe('StripePayoutAdapter', () => {
  let stripeMock;
  let stripeTransfersCreateMock;

  beforeEach(() => {
    jest.clearAllMocks();

    stripeTransfersCreateMock = jest.fn();
    stripeMock = {
      transfers: {
        create: stripeTransfersCreateMock
      }
    };

    // Mock the stripe constructor
    const stripe = require('stripe');
    stripe.mockReturnValue(stripeMock);
  });

  const validParams = {
    amountCents: 5000,
    destination: 'acct_stripe123',
    idempotencyKey: 'payout:transfer-uuid-1'
  };

  describe('createTransfer', () => {
    it('should create successful transfer with idempotency key', async () => {
      stripeTransfersCreateMock.mockResolvedValueOnce({
        id: 'tr_123',
        amount: 5000,
        destination: 'acct_stripe123'
      });

      const result = await StripePayoutAdapter.createTransfer({
        ...validParams,
        stripeOverride: stripeMock
      });

      expect(result).toEqual({
        success: true,
        transferId: 'tr_123'
      });

      expect(stripeTransfersCreateMock).toHaveBeenCalledWith(
        {
          amount: 5000,
          currency: 'usd',
          destination: 'acct_stripe123',
          metadata: {}
        },
        {
          idempotencyKey: 'payout:transfer-uuid-1',
          timeout: 30000
        }
      );
    });

    it('should pass custom timeout to Stripe', async () => {
      stripeTransfersCreateMock.mockResolvedValueOnce({
        id: 'tr_123',
        amount: 5000
      });

      await StripePayoutAdapter.createTransfer({
        ...validParams,
        timeoutMs: 60000,
        stripeOverride: stripeMock
      });

      expect(stripeTransfersCreateMock).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ timeout: 60000 })
      );
    });

    it('should include metadata in transfer', async () => {
      stripeTransfersCreateMock.mockResolvedValueOnce({
        id: 'tr_123'
      });

      await StripePayoutAdapter.createTransfer({
        ...validParams,
        metadata: { contest_id: 'contest-uuid', user_id: 'user-uuid' },
        stripeOverride: stripeMock
      });

      expect(stripeTransfersCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { contest_id: 'contest-uuid', user_id: 'user-uuid' }
        }),
        expect.any(Object)
      );
    });

    it('should return permanent error for invalid amount', async () => {
      const result = await StripePayoutAdapter.createTransfer({
        ...validParams,
        amountCents: 0
      });

      expect(result).toEqual({
        success: false,
        classification: 'permanent',
        reason: 'invalid_amount'
      });

      expect(stripeTransfersCreateMock).not.toHaveBeenCalled();
    });

    it('should return permanent error for invalid destination', async () => {
      const result = await StripePayoutAdapter.createTransfer({
        ...validParams,
        destination: null
      });

      expect(result).toEqual({
        success: false,
        classification: 'permanent',
        reason: 'invalid_destination'
      });

      expect(stripeTransfersCreateMock).not.toHaveBeenCalled();
    });

    it('should return permanent error for invalid idempotency key', async () => {
      const result = await StripePayoutAdapter.createTransfer({
        ...validParams,
        idempotencyKey: null
      });

      expect(result).toEqual({
        success: false,
        classification: 'permanent',
        reason: 'invalid_idempotency_key'
      });

      expect(stripeTransfersCreateMock).not.toHaveBeenCalled();
    });

    it('should classify timeout as retryable', async () => {
      const timeoutError = new Error('Timeout');
      timeoutError.code = 'ETIMEDOUT';

      stripeTransfersCreateMock.mockRejectedValueOnce(timeoutError);

      const result = await StripePayoutAdapter.createTransfer({
        ...validParams,
        stripeOverride: stripeMock
      });

      expect(result).toEqual({
        success: false,
        classification: 'retryable',
        reason: 'stripe_timeout'
      });
    });

    it('should classify connection errors as retryable', async () => {
      const connError = new Error('Connection reset');
      connError.code = 'ECONNRESET';

      stripeTransfersCreateMock.mockRejectedValueOnce(connError);

      const result = await StripePayoutAdapter.createTransfer({
        ...validParams,
        stripeOverride: stripeMock
      });

      expect(result).toEqual({
        success: false,
        classification: 'retryable',
        reason: 'stripe_connection_error'
      });
    });

    it('should classify 5xx errors as retryable', async () => {
      const serverError = new Error('Server error');
      serverError.status = 500;
      serverError.type = 'StripeAPIError';

      stripeTransfersCreateMock.mockRejectedValueOnce(serverError);

      const result = await StripePayoutAdapter.createTransfer({
        ...validParams,
        stripeOverride: stripeMock
      });

      expect(result).toEqual({
        success: false,
        classification: 'retryable',
        reason: 'stripe_server_error'
      });
    });

    it('should classify 429 rate limit as retryable', async () => {
      const rateLimitError = new Error('Rate limit');
      rateLimitError.status = 429;

      stripeTransfersCreateMock.mockRejectedValueOnce(rateLimitError);

      const result = await StripePayoutAdapter.createTransfer({
        ...validParams,
        stripeOverride: stripeMock
      });

      expect(result).toEqual({
        success: false,
        classification: 'retryable',
        reason: 'stripe_rate_limit'
      });
    });

    it('should classify 4xx validation errors as permanent', async () => {
      const validationError = new Error('Invalid request');
      validationError.status = 400;
      validationError.type = 'StripeInvalidRequestError';

      stripeTransfersCreateMock.mockRejectedValueOnce(validationError);

      const result = await StripePayoutAdapter.createTransfer({
        ...validParams,
        stripeOverride: stripeMock
      });

      expect(result).toEqual({
        success: false,
        classification: 'permanent',
        reason: 'stripe_invalid_request'
      });
    });

    it('should classify invalid account as permanent', async () => {
      const accountError = new Error('Invalid destination account');
      accountError.status = 400;
      accountError.type = 'StripeInvalidRequestError';

      stripeTransfersCreateMock.mockRejectedValueOnce(accountError);

      const result = await StripePayoutAdapter.createTransfer({
        ...validParams,
        stripeOverride: stripeMock
      });

      expect(result).toEqual({
        success: false,
        classification: 'permanent',
        reason: 'stripe_invalid_account'
      });
    });

    it('should classify permission errors as permanent', async () => {
      const permError = new Error('Permission denied');
      permError.type = 'StripePermissionError';

      stripeTransfersCreateMock.mockRejectedValueOnce(permError);

      const result = await StripePayoutAdapter.createTransfer({
        ...validParams,
        stripeOverride: stripeMock
      });

      expect(result).toEqual({
        success: false,
        classification: 'permanent',
        reason: 'stripe_permission_error'
      });
    });

    it('should default unknown errors to retryable', async () => {
      const unknownError = new Error('Unknown error');
      unknownError.type = 'UnknownError';

      stripeTransfersCreateMock.mockRejectedValueOnce(unknownError);

      const result = await StripePayoutAdapter.createTransfer({
        ...validParams,
        stripeOverride: stripeMock
      });

      expect(result.classification).toBe('retryable');
    });
  });
});
