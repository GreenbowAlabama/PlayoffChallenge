/**
 * Stripe Webhook Idempotency & Replay Safety Tests
 *
 * Purpose: Validate that Stripe webhook processing is:
 * - Signature-safe: Invalid signatures reject cleanly with no DB writes
 * - Idempotent: Same event replayed creates exactly 1 ledger entry
 * - Concurrency-safe: Concurrent replays serialize correctly without deadlocks
 *
 * Uses real database and real webhook endpoint to validate:
 * - Transaction isolation and idempotency guarantees
 * - UNIQUE constraints on stripe_event_id
 * - Actual row counts before/after
 */

const request = require('supertest');
const crypto = require('crypto');
const { getIntegrationApp } = require('../mocks/testAppFactory');

// Mock Stripe SDK BEFORE loading services
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

// Load Stripe mock after jest.mock
const stripe = require('stripe');

describe('Stripe Webhook Idempotency & Replay Safety', () => {
  let app;
  let pool;
  let contestId;
  let templateId;
  let organizerId;
  let userId;
  let paymentIntentId;

  beforeAll(() => {
    const integrationApp = getIntegrationApp();
    app = integrationApp.app;
    pool = integrationApp.pool;
  });

  beforeEach(async () => {
    // Generate test IDs
    contestId = crypto.randomUUID();
    templateId = crypto.randomUUID();
    organizerId = crypto.randomUUID();
    userId = crypto.randomUUID();
    paymentIntentId = crypto.randomUUID();

    // Create test users
    await pool.query(
      `INSERT INTO users (id, email) VALUES ($1, $2)`,
      [organizerId, `organizer-${crypto.randomUUID()}@test.com`]
    );

    await pool.query(
      `INSERT INTO users (id, email) VALUES ($1, $2)`,
      [userId, `user-${crypto.randomUUID()}@test.com`]
    );

    // Create contest template
    await pool.query(
      `INSERT INTO contest_templates
       (id, name, sport, template_type, scoring_strategy_key, lock_strategy_key, settlement_strategy_key,
        default_entry_fee_cents, allowed_entry_fee_min_cents, allowed_entry_fee_max_cents, allowed_payout_structures, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false)`,
      [templateId, 'Test', 'golf', 'standard', 'golf_scoring', 'golf_lock', 'golf_settlement',
       0, 0, 1000000, JSON.stringify({})]
    );

    // Create contest instance
    await pool.query(
      `INSERT INTO contest_instances
       (id, template_id, organizer_id, status, entry_fee_cents, payout_structure, contest_name, max_entries)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [contestId, templateId, organizerId, 'LIVE', 0, JSON.stringify({}), 'Test', 20]
    );

    // Create payment intent
    const stripePaymentIntentId = 'pi_test_' + crypto.randomBytes(8).toString('hex');
    await pool.query(
      `INSERT INTO payment_intents
       (id, idempotency_key, contest_instance_id, user_id, amount_cents, currency, status,
        stripe_payment_intent_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
      [paymentIntentId, crypto.randomUUID(), contestId, userId, 2500, 'USD', 'REQUIRES_CONFIRMATION',
       stripePaymentIntentId]
    );

    jest.clearAllMocks();
  });

  afterEach(async () => {
    // Cleanup in reverse FK order
    try {
      await pool.query('DELETE FROM ledger WHERE contest_instance_id = $1', [contestId]);
      await pool.query('DELETE FROM stripe_events WHERE stripe_event_id LIKE $1', ['evt_test_%']);
      await pool.query('DELETE FROM payment_intents WHERE contest_instance_id = $1', [contestId]);
      await pool.query('DELETE FROM contest_instances WHERE id = $1', [contestId]);
      await pool.query('DELETE FROM contest_templates WHERE id = $1', [templateId]);
      await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [organizerId, userId]);
    } catch (err) {
      // Cleanup non-fatal
    }
  });

  describe('1. Signature Failure Test', () => {
    it('should reject missing stripe-signature header with HTTP 400 and no DB writes', async () => {
      const eventId = 'evt_test_missing_sig_' + crypto.randomUUID().substring(0, 8);

      // Count rows before
      const beforeStripeEvents = await pool.query('SELECT COUNT(*)::int as count FROM stripe_events');
      const beforeLedger = await pool.query('SELECT COUNT(*)::int as count FROM ledger WHERE contest_instance_id = $1', [contestId]);

      const response = await request(app)
        .post('/api/webhooks/stripe')
        .send(Buffer.from(JSON.stringify({ id: eventId })))
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(400);

      // Verify no rows written
      const afterStripeEvents = await pool.query('SELECT COUNT(*)::int as count FROM stripe_events');
      const afterLedger = await pool.query('SELECT COUNT(*)::int as count FROM ledger WHERE contest_instance_id = $1', [contestId]);

      expect(parseInt(afterStripeEvents.rows[0].count)).toBe(parseInt(beforeStripeEvents.rows[0].count));
      expect(parseInt(afterLedger.rows[0].count)).toBe(parseInt(beforeLedger.rows[0].count));
    });

    it('should reject invalid signature with HTTP 400 and no DB writes', async () => {
      const eventId = 'evt_test_invalid_sig_' + crypto.randomUUID().substring(0, 8);
      const rawBody = Buffer.from(JSON.stringify({
        id: eventId,
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_invalid', amount: 2500 } }
      }));

      // Mock Stripe to throw signature error
      stripe.webhooks.constructEvent.mockImplementation(() => {
        const err = new Error('No matching signing secret found');
        throw err;
      });

      const beforeStripeEvents = await pool.query('SELECT COUNT(*)::int as count FROM stripe_events');
      const beforeLedger = await pool.query('SELECT COUNT(*)::int as count FROM ledger WHERE contest_instance_id = $1', [contestId]);

      const response = await request(app)
        .post('/api/webhooks/stripe')
        .send(rawBody)
        .set('stripe-signature', 'invalid_sig')
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(400);

      const afterStripeEvents = await pool.query('SELECT COUNT(*)::int as count FROM stripe_events');
      const afterLedger = await pool.query('SELECT COUNT(*)::int as count FROM ledger WHERE contest_instance_id = $1', [contestId]);

      expect(parseInt(afterStripeEvents.rows[0].count)).toBe(parseInt(beforeStripeEvents.rows[0].count));
      expect(parseInt(afterLedger.rows[0].count)).toBe(parseInt(beforeLedger.rows[0].count));
    });
  });

  describe('2. Duplicate Event Replay Test', () => {
    it('should process same event once, idempotently for duplicates', async () => {
      const eventId = 'evt_test_replay_' + crypto.randomUUID().substring(0, 8);

      // Get the payment intent's Stripe ID
      const paymentResult = await pool.query(
        'SELECT stripe_payment_intent_id FROM payment_intents WHERE id = $1',
        [paymentIntentId]
      );
      const stripePaymentIntentId = paymentResult.rows[0].stripe_payment_intent_id;

      const event = {
        id: eventId,
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: stripePaymentIntentId,
            amount: 2500,
            customer: 'cus_test_123'
          }
        }
      };

      const rawBody = Buffer.from(JSON.stringify(event));
      stripe.webhooks.constructEvent.mockReturnValue(event);

      // Fire same event 10 times concurrently
      const responses = await Promise.all(
        Array(10).fill(null).map(() =>
          request(app)
            .post('/api/webhooks/stripe')
            .send(rawBody)
            .set('stripe-signature', 'valid_sig')
            .set('Content-Type', 'application/json')
        )
      );

      // All should return 200
      responses.forEach((res, idx) => {
        if (res.status !== 200) {
          console.log(`Response ${idx}: status=${res.status}, body=`, res.body);
        }
        expect(res.status).toBe(200);
      });

      // Verify exactly 1 stripe_events row
      const stripeEventsResult = await pool.query(
        'SELECT COUNT(*)::int as count FROM stripe_events WHERE stripe_event_id = $1',
        [eventId]
      );
      expect(parseInt(stripeEventsResult.rows[0].count)).toBe(1);

      // Verify exactly 1 ledger row for this contest
      const ledgerResult = await pool.query(
        `SELECT COUNT(*)::int as count FROM ledger
         WHERE contest_instance_id = $1 AND entry_type = 'ENTRY_FEE' AND stripe_event_id = $2`,
        [contestId, eventId]
      );
      expect(parseInt(ledgerResult.rows[0].count)).toBe(1);
    });
  });

  describe('3. Stress Replay Test (Local Only)', () => {
    it('should handle 50 concurrent replays with no deadlocks or duplicate writes', async () => {
      // Skip in CI
      if (process.env.CI === 'true') {
        return;
      }

      const eventId = 'evt_test_stress_' + crypto.randomUUID().substring(0, 8);

      const paymentResult = await pool.query(
        'SELECT stripe_payment_intent_id FROM payment_intents WHERE id = $1',
        [paymentIntentId]
      );
      const stripePaymentIntentId = paymentResult.rows[0].stripe_payment_intent_id;

      const event = {
        id: eventId,
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: stripePaymentIntentId,
            amount: 2500
          }
        }
      };

      const rawBody = Buffer.from(JSON.stringify(event));
      stripe.webhooks.constructEvent.mockReturnValue(event);

      // Fire 50 concurrent requests
      const startTime = Date.now();
      const responses = await Promise.all(
        Array(50).fill(null).map(() =>
          request(app)
            .post('/api/webhooks/stripe')
            .send(rawBody)
            .set('stripe-signature', 'valid_sig')
            .set('Content-Type', 'application/json')
        )
      );
      const duration = Date.now() - startTime;

      // All should succeed
      responses.forEach((res, idx) => {
        if (res.status !== 200) {
          console.log(`Response ${idx}: status=${res.status}, body=`, res.body);
        }
        expect(res.status).toBe(200);
      });

      // Verify exactly 1 stripe_events row
      const stripeEventsResult = await pool.query(
        'SELECT COUNT(*)::int as count FROM stripe_events WHERE stripe_event_id = $1',
        [eventId]
      );
      expect(parseInt(stripeEventsResult.rows[0].count)).toBe(1);

      // Verify exactly 1 ledger row (no duplicates)
      const ledgerResult = await pool.query(
        `SELECT COUNT(*)::int as count FROM ledger
         WHERE contest_instance_id = $1 AND stripe_event_id = $2`,
        [contestId, eventId]
      );
      expect(parseInt(ledgerResult.rows[0].count)).toBe(1);

      // Should complete reasonably fast
      expect(duration).toBeLessThan(30000);
    }, 60000);
  });
});
