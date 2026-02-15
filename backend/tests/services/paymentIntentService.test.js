/**
 * Payment Intent Service Tests
 *
 * Tests for idempotent payment intent creation.
 */

const { PAYMENT_ERROR_CODES } = require('../../services/paymentErrorCodes');
const { createMockPool } = require('../mocks/mockPool');

// Mock Stripe SDK BEFORE requiring PaymentIntentService
jest.mock('stripe', () => {
  const mockPaymentIntents = {
    create: jest.fn()
  };
  const mockStripe = () => ({
    paymentIntents: mockPaymentIntents
  });
  mockStripe.paymentIntents = mockPaymentIntents;
  return mockStripe;
});

// Require AFTER jest.mock to ensure mock is in place
const stripe = require('stripe');
const PaymentIntentService = require('../../services/PaymentIntentService');

describe('PaymentIntentService', () => {
  let mockPool;
  let mockUpdateClient;

  beforeEach(() => {
    jest.clearAllMocks();
    stripe.paymentIntents.create.mockClear();
    mockPool = createMockPool();
    // Create updateClient with same query implementation as mockPool
    mockUpdateClient = mockPool;
    mockUpdateClient.release = jest.fn();
    mockPool.connect.mockResolvedValue(mockUpdateClient);
  });

  describe('createPaymentIntent', () => {
    it('should throw IDEMPOTENCY_KEY_REQUIRED when idempotency key is missing', async () => {
      try {
        await PaymentIntentService.createPaymentIntent(
          mockPool,
          'contest_id_1',
          'user_id_1',
          1000,
          null // No key
        );
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err.code).toBe(PAYMENT_ERROR_CODES.IDEMPOTENCY_KEY_REQUIRED);
      }
    });

    it('should throw IDEMPOTENCY_KEY_REQUIRED when idempotency key is empty string', async () => {
      try {
        await PaymentIntentService.createPaymentIntent(
          mockPool,
          'contest_id_1',
          'user_id_1',
          1000,
          '  ' // Whitespace only
        );
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err.code).toBe(PAYMENT_ERROR_CODES.IDEMPOTENCY_KEY_REQUIRED);
      }
    });

    it('should return cached payment intent for duplicate idempotency key', async () => {
      const existingIntent = {
        id: 'pi_id_1',
        idempotency_key: 'test_key_1',
        status: 'REQUIRES_CONFIRMATION',
        stripe_client_secret: 'secret_cached_1'
      };

      mockPool.setQueryResponse(/WHERE idempotency_key/, {
        rows: [existingIntent],
        rowCount: 1
      });

      stripe.paymentIntents.create.mockClear();

      const result = await PaymentIntentService.createPaymentIntent(
        mockPool,
        'contest_id_1',
        'user_id_1',
        1000,
        'test_key_1'
      );

      expect(result.payment_intent_id).toBe('pi_id_1');
      expect(result.status).toBe('REQUIRES_CONFIRMATION');
      expect(result.client_secret).toBe('secret_cached_1');
      // Should NOT call Stripe API
      expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('should create new payment intent if idempotency key is new', async () => {
      mockPool.setQueryResponse(/WHERE idempotency_key/, {
        rows: [],
        rowCount: 0
      });

      mockPool.setQueryResponse(/INSERT INTO payment_intents/, {
        rows: [{ id: 'pi_id_2', status: 'REQUIRES_CONFIRMATION' }],
        rowCount: 1
      });

      mockPool.setQueryResponse(/BEGIN|COMMIT/, {
        rows: [],
        rowCount: 0
      });

      stripe.paymentIntents.create.mockResolvedValue({
        id: 'stripe_pi_123',
        client_secret: 'secret_123',
        status: 'REQUIRES_PAYMENT_METHOD',
        customer: null
      });


      const result = await PaymentIntentService.createPaymentIntent(
        mockPool,
        'contest_id_2',
        'user_id_2',
        1500,
        'test_key_2'
      );

      expect(result.payment_intent_id).toBe('pi_id_2');
      expect(result.client_secret).toBe('secret_123');
      expect(result.status).toBe('REQUIRES_PAYMENT_METHOD');

      // Verify Stripe was called with correct parameters
      expect(stripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 1500,
          currency: 'usd',
          metadata: {
            contest_instance_id: 'contest_id_2',
            user_id: 'user_id_2'
          }
        }),
        expect.objectContaining({
          idempotencyKey: 'test_key_2'
        })
      );
    });

    it('should handle duplicate idempotency key from database (PG 23505)', async () => {
      const existingIntent = {
        id: 'pi_id_3',
        idempotency_key: 'test_key_3',
        status: 'SUCCEEDED',
        stripe_client_secret: 'secret_race_winner'
      };

      // First findByIdempotencyKey returns null (will try insert)
      // Then after duplicate error, fetch will succeed
      let findCallCount = 0;
      mockPool.query.mockImplementation(async (sql, params) => {
        if (sql.includes('WHERE idempotency_key')) {
          findCallCount++;
          if (findCallCount === 1) {
            // First check: not found
            return { rows: [], rowCount: 0 };
          } else {
            // After duplicate error: found
            return { rows: [existingIntent], rowCount: 1 };
          }
        }
        if (sql.includes('INSERT INTO payment_intents')) {
          // INSERT throws duplicate key error
          const err = new Error('Unique violation on idempotency_key');
          err.code = '23505';
          throw err;
        }
        if (sql.includes('BEGIN') || sql.includes('ROLLBACK')) {
          return {};
        }
        return { rows: [], rowCount: 0 };
      });

      stripe.paymentIntents.create.mockClear();

      const result = await PaymentIntentService.createPaymentIntent(
        mockPool,
        'contest_id_3',
        'user_id_3',
        2000,
        'test_key_3'
      );

      expect(result.payment_intent_id).toBe('pi_id_3');
      expect(result.status).toBe('SUCCEEDED');
      expect(result.client_secret).toBe('secret_race_winner');
      // Should NOT call Stripe for duplicate idempotency key
      expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('should pass same idempotency key to Stripe for Stripe-level deduplication', async () => {
      mockPool.setQueryResponse(/WHERE idempotency_key/, {
        rows: [],
        rowCount: 0
      });

      mockPool.setQueryResponse(/INSERT INTO payment_intents/, {
        rows: [{ id: 'pi_id_4' }],
        rowCount: 1
      });

      mockPool.setQueryResponse(/BEGIN|COMMIT/, {
        rows: [],
        rowCount: 0
      });

      stripe.paymentIntents.create.mockResolvedValue({
        id: 'stripe_pi_456',
        client_secret: 'secret_456',
        status: 'REQUIRES_ACTION',
        customer: 'cus_456'
      });


      await PaymentIntentService.createPaymentIntent(
        mockPool,
        'contest_id_4',
        'user_id_4',
        2500,
        'test_key_4'
      );

      // Verify idempotency key passed to Stripe
      const stripeCall = stripe.paymentIntents.create.mock.calls[0];
      expect(stripeCall[1].idempotencyKey).toBe('test_key_4');
    });

    it('should handle Stripe API errors with STRIPE_API_ERROR code', async () => {
      mockPool.setQueryResponse(/WHERE idempotency_key/, {
        rows: [],
        rowCount: 0
      });

      mockPool.setQueryResponse(/INSERT INTO payment_intents/, {
        rows: [{ id: 'pi_id_5' }],
        rowCount: 1
      });

      mockPool.setQueryResponse(/BEGIN|ROLLBACK/, {
        rows: [],
        rowCount: 0
      });

      stripe.paymentIntents.create.mockRejectedValue(
        new Error('Your card was declined')
      );

      try {
        await PaymentIntentService.createPaymentIntent(
          mockPool,
          'contest_id_5',
          'user_id_5',
          3000,
          'test_key_5'
        );
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err.code).toBe(PAYMENT_ERROR_CODES.STRIPE_API_ERROR);
        expect(err.message).toContain('Your card was declined');
      }
    });

    it('should update database with Stripe response details', async () => {
      mockPool.setQueryResponse(/WHERE idempotency_key/, {
        rows: [],
        rowCount: 0
      });

      mockPool.setQueryResponse(/INSERT INTO payment_intents/, {
        rows: [{ id: 'pi_id_6' }],
        rowCount: 1
      });

      mockPool.setQueryResponse(/BEGIN|COMMIT/, {
        rows: [],
        rowCount: 0
      });

      stripe.paymentIntents.create.mockResolvedValue({
        id: 'stripe_pi_789',
        client_secret: 'secret_789',
        status: 'PROCESSING',
        customer: 'cus_789'
      });


      await PaymentIntentService.createPaymentIntent(
        mockPool,
        'contest_id_6',
        'user_id_6',
        3500,
        'test_key_6'
      );

      // Verify update with Stripe details including client_secret
      expect(mockUpdateClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE payment_intents'),
        expect.arrayContaining(['stripe_pi_789', 'cus_789', 'secret_789', 'PROCESSING'])
      );
    });

    it('should handle missing customer in Stripe response gracefully', async () => {
      mockPool.setQueryResponse(/WHERE idempotency_key/, {
        rows: [],
        rowCount: 0
      });

      mockPool.setQueryResponse(/INSERT INTO payment_intents/, {
        rows: [{ id: 'pi_id_7' }],
        rowCount: 1
      });

      mockPool.setQueryResponse(/BEGIN|COMMIT/, {
        rows: [],
        rowCount: 0
      });

      stripe.paymentIntents.create.mockResolvedValue({
        id: 'stripe_pi_nil',
        client_secret: 'secret_nil',
        status: 'REQUIRES_CONFIRMATION',
        customer: null // No customer
      });


      const result = await PaymentIntentService.createPaymentIntent(
        mockPool,
        'contest_id_7',
        'user_id_7',
        4000,
        'test_key_7'
      );

      expect(result.client_secret).toBe('secret_nil');
      // Should complete successfully
      expect(mockPool.release).toHaveBeenCalled();
    });
  });
});
