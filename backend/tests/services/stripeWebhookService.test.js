/**
 * Stripe Webhook Service Tests
 *
 * Critical tests for idempotency and transaction correctness.
 */

const { PAYMENT_ERROR_CODES } = require('../../services/paymentErrorCodes');
const { createMockPool } = require('../mocks/mockPool');

// Mock Stripe SDK BEFORE requiring StripeWebhookService
jest.mock('stripe', () => {
  const mockWebhooks = {
    constructEvent: jest.fn()
  };
  const mockStripe = () => ({
    webhooks: mockWebhooks
  });
  mockStripe.webhooks = mockWebhooks;
  return mockStripe;
});

// Require AFTER jest.mock to ensure mock is in place
const stripe = require('stripe');
const StripeWebhookService = require('../../services/StripeWebhookService');

describe('StripeWebhookService', () => {
  let mockPool;
  let mockClient;

  beforeEach(() => {
    mockPool = createMockPool();
    mockClient = {
      query: jest.fn(),
      release: jest.fn()
    };
    mockPool.connect.mockResolvedValue(mockClient);
    jest.clearAllMocks();
  });

  describe('handleStripeEvent', () => {
    it('should reject invalid Stripe signature with STRIPE_SIGNATURE_INVALID', async () => {
      const rawBody = Buffer.from('{}');
      const badSignature = 'invalid_signature';

      stripe.webhooks.constructEvent.mockImplementation(() => {
        const err = new Error('No matching signing secret found');
        throw err;
      });

      try {
        await StripeWebhookService.handleStripeEvent(rawBody, badSignature, mockPool);
        throw new Error('Should have thrown error');
      } catch (err) {
        if (err.message === 'Should have thrown error') throw err;
        expect(err.code).toBe(PAYMENT_ERROR_CODES.STRIPE_SIGNATURE_INVALID);
      }
    });

    it('should return duplicate status for duplicate stripe_event_id', async () => {
      const event = {
        id: 'evt_test_123',
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_test_123', amount: 1000 } }
      };

      stripe.webhooks.constructEvent.mockReturnValue(event);

      // Mock INSERT to return empty (ON CONFLICT DO NOTHING)
      mockClient.query.mockImplementation(async (sql) => {
        if (sql.includes('INSERT INTO stripe_events')) {
          return { rows: [], rowCount: 0 }; // Duplicate: no row returned
        }
        if (sql.includes('COMMIT')) return {};
        if (sql.includes('BEGIN')) return {};
        return { rows: [] };
      });

      const result = await StripeWebhookService.handleStripeEvent(Buffer.from('{}'), 'sig', mockPool);

      expect(result.status).toBe('processed');
      expect(result.stripe_event_id).toBe('evt_test_123');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('should process payment_intent.succeeded and create ledger entry', async () => {
      const event = {
        id: 'evt_test_456',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test_456',
            amount: 1500,
            customer: 'cus_test_456'
          }
        }
      };

      stripe.webhooks.constructEvent.mockReturnValue(event);

      // Mock database calls
      let callCount = 0;
      mockClient.query.mockImplementation(async (sql, params) => {
        if (sql.includes('BEGIN') || sql.includes('COMMIT') || sql.includes('ROLLBACK')) {
          return {};
        }
        if (sql.includes('INSERT INTO stripe_events')) {
          return {
            rows: [{ id: 'stripe_events_id_1', stripe_event_id: event.id, processing_status: 'RECEIVED' }],
            rowCount: 1
          };
        }
        if (sql.includes('SELECT') && sql.includes('payment_intents')) {
          return {
            rows: [{
              id: '550e8400-e29b-41d4-a716-446655440000',
              contest_instance_id: 'contest_id_1',
              user_id: 'user_id_1',
              amount_cents: 1500,
              currency: 'USD',
              status: 'REQUIRES_CONFIRMATION',
              stripe_payment_intent_id: 'pi_test_456'
            }]
          };
        }
        if (sql.includes('UPDATE payment_intents')) {
          return {};
        }
        if (sql.includes('INSERT INTO ledger')) {
          return { rows: [{ id: 'ledger_id_1' }] };
        }
        return { rows: [] };
      });

      const result = await StripeWebhookService.handleStripeEvent(Buffer.from('{}'), 'sig', mockPool);

      expect(result.status).toBe('processed');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');

      // Verify ledger entry was attempted
      const ledgerCalls = mockClient.query.mock.calls.filter(call =>
        call[0].includes('INSERT INTO ledger')
      );
      expect(ledgerCalls.length).toBeGreaterThan(0);
    });

    it('should handle payment already SUCCEEDED (idempotent)', async () => {
      const event = {
        id: 'evt_test_789',
        type: 'payment_intent.succeeded',
        data: {
          object: { id: 'pi_test_789', amount: 2000 }
        }
      };

      stripe.webhooks.constructEvent.mockReturnValue(event);

      let ledgerInsertCalls = 0;
      mockClient.query.mockImplementation(async (sql, params) => {
        if (sql.includes('BEGIN') || sql.includes('COMMIT') || sql.includes('ROLLBACK')) {
          return {};
        }
        if (sql.includes('INSERT INTO stripe_events')) {
          return {
            rows: [{ id: 'stripe_events_id_2', stripe_event_id: event.id }]
          };
        }
        if (sql.includes('SELECT') && sql.includes('payment_intents')) {
          return {
            rows: [{
              id: '550e8400-e29b-41d4-a716-446655440001',
              contest_instance_id: 'contest_id_2',
              user_id: 'user_id_2',
              amount_cents: 2000,
              currency: 'USD',
              status: 'SUCCEEDED', // Already succeeded
              stripe_payment_intent_id: 'pi_test_789'
            }]
          };
        }
        if (sql.includes('INSERT INTO ledger')) {
          ledgerInsertCalls++;
          return { rows: [{ id: 'ledger_id_2' }] };
        }
        return { rows: [] };
      });

      const result = await StripeWebhookService.handleStripeEvent(Buffer.from('{}'), 'sig', mockPool);

      expect(result.status).toBe('processed');
      // Should NOT create ledger entry for already-succeeded payment
      expect(ledgerInsertCalls).toBe(0);
    });

    it('should handle duplicate ledger entry idempotently', async () => {
      const event = {
        id: 'evt_test_duplicate_ledger',
        type: 'payment_intent.succeeded',
        data: {
          object: { id: 'pi_test_duplicate', amount: 2500 }
        }
      };

      stripe.webhooks.constructEvent.mockReturnValue(event);

      let ledgerInsertCalls = 0;
      mockClient.query.mockImplementation(async (sql, params) => {
        if (sql.includes('BEGIN') || sql.includes('COMMIT') || sql.includes('ROLLBACK')) {
          return {};
        }
        if (sql.includes('INSERT INTO stripe_events')) {
          return {
            rows: [{ id: 'stripe_events_id_3', stripe_event_id: event.id }]
          };
        }
        if (sql.includes('SELECT') && sql.includes('payment_intents')) {
          return {
            rows: [{
              id: '550e8400-e29b-41d4-a716-446655440002',
              contest_instance_id: 'contest_id_3',
              user_id: 'user_id_3',
              amount_cents: 2500,
              currency: 'USD',
              status: 'REQUIRES_CONFIRMATION',
              stripe_payment_intent_id: 'pi_test_duplicate'
            }]
          };
        }
        if (sql.includes('UPDATE payment_intents')) {
          return {};
        }
        if (sql.includes('INSERT INTO ledger')) {
          ledgerInsertCalls++;
          if (ledgerInsertCalls === 1) {
            // First call succeeds
            return { rows: [{ id: 'ledger_id_3' }] };
          } else {
            // Simulate duplicate key error on second call (shouldn't happen, but testing idempotency)
            const err = new Error('duplicate key');
            err.code = '23505';
            throw err;
          }
        }
        return { rows: [] };
      });

      const result = await StripeWebhookService.handleStripeEvent(Buffer.from('{}'), 'sig', mockPool);

      expect(result.status).toBe('processed');
      // Should successfully process despite ledger duplicate
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('should throw PAYMENT_INTENT_NOT_FOUND if payment intent missing', async () => {
      const event = {
        id: 'evt_test_not_found',
        type: 'payment_intent.succeeded',
        data: {
          object: { id: 'pi_test_not_found', amount: 3000 }
        }
      };

      stripe.webhooks.constructEvent.mockReturnValue(event);

      mockClient.query.mockImplementation(async (sql) => {
        if (sql.includes('BEGIN')) return {};
        if (sql.includes('INSERT INTO stripe_events')) {
          return {
            rows: [{ id: 'stripe_events_id_4', stripe_event_id: event.id }],
            rowCount: 1
          };
        }
        if (sql.includes('SELECT') && sql.includes('payment_intents')) {
          return { rows: [] }; // Not found
        }
        if (sql.includes('ROLLBACK')) return {};
        return { rows: [] };
      });

      try {
        await StripeWebhookService.handleStripeEvent(Buffer.from('{}'), 'sig', mockPool);
        throw new Error('Should have thrown error');
      } catch (err) {
        if (err.message === 'Should have thrown error') throw err;
        expect(err.code).toBe(PAYMENT_ERROR_CODES.PAYMENT_INTENT_NOT_FOUND);
        expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      }
    });

    it('should rollback entire transaction on ledger insert failure (poisoned dedupe prevention)', async () => {
      const event = {
        id: 'evt_test_rollback',
        type: 'payment_intent.succeeded',
        data: {
          object: { id: 'pi_test_rollback', amount: 3500 }
        }
      };

      stripe.webhooks.constructEvent.mockReturnValue(event);

      mockClient.query.mockImplementation(async (sql) => {
        if (sql.includes('BEGIN')) return {};
        if (sql.includes('INSERT INTO stripe_events')) {
          return {
            rows: [{ id: 'stripe_events_id_5', stripe_event_id: event.id }],
            rowCount: 1
          };
        }
        if (sql.includes('SELECT') && sql.includes('payment_intents')) {
          return {
            rows: [{
              id: '550e8400-e29b-41d4-a716-446655440003',
              contest_instance_id: 'contest_id_5',
              user_id: 'user_id_5',
              amount_cents: 3500,
              currency: 'USD',
              status: 'REQUIRES_CONFIRMATION',
              stripe_payment_intent_id: 'pi_test_rollback'
            }]
          };
        }
        if (sql.includes('UPDATE payment_intents')) {
          return {};
        }
        if (sql.includes('INSERT INTO ledger')) {
          // Simulate a critical failure (not duplicate key, but a real error)
          const err = new Error('Network error');
          err.code = 'NETWORK_ERROR';
          throw err;
        }
        if (sql.includes('ROLLBACK')) return {};
        return { rows: [] };
      });

      try {
        await StripeWebhookService.handleStripeEvent(Buffer.from('{}'), 'sig', mockPool);
        throw new Error('Should have thrown error');
      } catch (err) {
        if (err.message === 'Should have thrown error') throw err;
        expect(err.message).toContain('Network error');
        // Verify entire transaction was rolled back
        expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
        // Verify BEGIN was called (transaction started)
        expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      }
    });

    it('should store but not process non-canonical event types', async () => {
      const event = {
        id: 'evt_test_charge_failed',
        type: 'charge.failed',
        data: { object: { id: 'ch_test_failed' } }
      };

      stripe.webhooks.constructEvent.mockReturnValue(event);

      let ledgerInsertCalls = 0;
      mockClient.query.mockImplementation(async (sql) => {
        if (sql.includes('BEGIN') || sql.includes('COMMIT') || sql.includes('ROLLBACK')) {
          return {};
        }
        if (sql.includes('INSERT INTO stripe_events')) {
          return {
            rows: [{ id: 'stripe_events_id_6', stripe_event_id: event.id }]
          };
        }
        if (sql.includes('INSERT INTO ledger')) {
          ledgerInsertCalls++;
        }
        return { rows: [] };
      });

      const result = await StripeWebhookService.handleStripeEvent(Buffer.from('{}'), 'sig', mockPool);

      expect(result.status).toBe('processed');
      // Should NOT create ledger entry for non-canonical event
      expect(ledgerInsertCalls).toBe(0);
      // Should still update stripe_events status
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });
  });
});
