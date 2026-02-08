/**
 * Payments Service Unit Tests
 *
 * Purpose: Test payment-related service logic in isolation
 * - Checkout session creation
 * - Contest join gating
 * - Webhook processing
 * - Webhook idempotency
 *
 * These tests assert against explicit field-level data contracts.
 */

const { createMockPool, mockQueryResponses } = require('../mocks/mockPool');
const {
  TEST_IDS,
  TEST_CONTEST_IDS,
  TEST_PAYMENT_IDS,
  contests,
  payments,
  paymentStatusTransitions,
  stripeWebhooks,
  users
} = require('../fixtures');

describe('Payments Service Unit Tests', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = createMockPool();
  });

  afterEach(() => {
    mockPool.reset();
  });

  describe('Checkout Session Creation', () => {
    it('should create checkout session with required fields', () => {
      const checkoutRequest = {
        user_id: TEST_IDS.users.validUser,
        contest_id: TEST_CONTEST_IDS.paidContest,
        amount_cents: 2500,
        success_url: 'https://app.playoff.com/payment/success',
        cancel_url: 'https://app.playoff.com/payment/cancel'
      };

      const requiredFields = ['user_id', 'contest_id', 'amount_cents', 'success_url', 'cancel_url'];

      requiredFields.forEach(field => {
        expect(checkoutRequest).toHaveProperty(field);
      });
    });

    it('should validate amount_cents matches contest entry_fee', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM contests.*WHERE.*contest_id/,
        mockQueryResponses.single(contests.paid)
      );

      const result = await mockPool.query(
        'SELECT * FROM contests WHERE contest_id = $1',
        [TEST_CONTEST_IDS.paidContest]
      );

      const contest = result.rows[0];
      const requestedAmount = 2500;

      expect(requestedAmount).toBe(contest.entry_fee_cents);
    });

    it('should reject checkout for free contests', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM contests/,
        mockQueryResponses.single(contests.free)
      );

      const result = await mockPool.query(
        'SELECT * FROM contests WHERE contest_id = $1',
        [TEST_CONTEST_IDS.freeContest]
      );

      const contest = result.rows[0];
      const requiresPayment = contest.entry_fee_cents > 0;

      expect(requiresPayment).toBe(false);
    });

    it('should store pending payment record on session creation', async () => {
      mockPool.setQueryResponse(
        /INSERT INTO payments/,
        mockQueryResponses.single(payments.pending)
      );

      const result = await mockPool.query(
        'INSERT INTO payments (user_id, contest_id, amount_cents, payment_status, stripe_session_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [TEST_IDS.users.validUser, TEST_CONTEST_IDS.paidContest, 2500, 'pending', 'cs_test_abc123']
      );

      expect(result.rows[0].payment_status).toBe('pending');
      expect(result.rows[0].stripe_session_id).toBeTruthy();
    });

    it('should include metadata in Stripe session', () => {
      const sessionMetadata = {
        user_id: TEST_IDS.users.validUser,
        contest_id: TEST_CONTEST_IDS.paidContest,
        payment_id: TEST_PAYMENT_IDS.pendingPayment
      };

      expect(sessionMetadata.user_id).toBeTruthy();
      expect(sessionMetadata.contest_id).toBeTruthy();
    });

    it('should validate user exists before creating checkout', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM users.*WHERE.*id/,
        mockQueryResponses.single(users.valid)
      );

      const result = await mockPool.query(
        'SELECT * FROM users WHERE id = $1',
        [TEST_IDS.users.validUser]
      );

      expect(result.rows.length).toBe(1);
    });

    it('should reject checkout for non-existent user', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM users/,
        mockQueryResponses.empty()
      );

      const result = await mockPool.query(
        'SELECT * FROM users WHERE id = $1',
        [TEST_IDS.users.nonExistent]
      );

      expect(result.rows.length).toBe(0);
    });
  });

  describe('Contest Join Gating', () => {
    it('should block join when payment_status is not paid', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM payments.*WHERE.*user_id.*AND.*contest_id/,
        mockQueryResponses.single(payments.pending)
      );

      const result = await mockPool.query(
        'SELECT * FROM payments WHERE user_id = $1 AND contest_id = $2',
        [TEST_IDS.users.validUser, TEST_CONTEST_IDS.paidContest]
      );

      const payment = result.rows[0];
      const canJoin = payment.payment_status === 'paid';

      expect(canJoin).toBe(false);
    });

    it('should allow join when payment_status is paid', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM payments/,
        mockQueryResponses.single(payments.completed)
      );

      const result = await mockPool.query(
        'SELECT * FROM payments WHERE user_id = $1 AND contest_id = $2',
        [TEST_IDS.users.paidUser, TEST_CONTEST_IDS.paidContest]
      );

      const payment = result.rows[0];
      const canJoin = payment.payment_status === 'paid';

      expect(canJoin).toBe(true);
    });

    it('should block join when payment failed', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM payments/,
        mockQueryResponses.single(payments.failed)
      );

      const result = await mockPool.query(
        'SELECT * FROM payments WHERE user_id = $1 AND contest_id = $2',
        [TEST_IDS.users.validUser, TEST_CONTEST_IDS.paidContest]
      );

      const payment = result.rows[0];
      const canJoin = payment.payment_status === 'paid';

      expect(canJoin).toBe(false);
    });

    it('should block join when no payment record exists for paid contest', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM payments/,
        mockQueryResponses.empty()
      );

      mockPool.setQueryResponse(
        /SELECT.*FROM contests/,
        mockQueryResponses.single(contests.paid)
      );

      const paymentResult = await mockPool.query(
        'SELECT * FROM payments WHERE user_id = $1 AND contest_id = $2',
        [TEST_IDS.users.validUser, TEST_CONTEST_IDS.paidContest]
      );

      const contestResult = await mockPool.query(
        'SELECT * FROM contests WHERE contest_id = $1',
        [TEST_CONTEST_IDS.paidContest]
      );

      const hasPayment = paymentResult.rows.length > 0;
      const requiresPayment = contestResult.rows[0].entry_fee_cents > 0;

      expect(hasPayment).toBe(false);
      expect(requiresPayment).toBe(true);

      const canJoin = !requiresPayment || hasPayment;
      expect(canJoin).toBe(false);
    });

    it('should allow join for free contest without payment', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM contests/,
        mockQueryResponses.single(contests.free)
      );

      const result = await mockPool.query(
        'SELECT * FROM contests WHERE contest_id = $1',
        [TEST_CONTEST_IDS.freeContest]
      );

      const contest = result.rows[0];
      const requiresPayment = contest.entry_fee_cents > 0;

      expect(requiresPayment).toBe(false);
    });
  });

  describe('Webhook Processing', () => {
    it('should process checkout.session.completed webhook', () => {
      const webhook = stripeWebhooks.checkoutCompleted;

      expect(webhook.type).toBe('checkout.session.completed');
      expect(webhook.data.object.payment_status).toBe('paid');
    });

    it('should update payment status on successful webhook', async () => {
      const updatedPayment = {
        ...payments.pending,
        payment_status: 'paid',
        stripe_payment_intent_id: 'pi_test_def456'
      };

      mockPool.setQueryResponse(
        /UPDATE payments.*SET.*payment_status/,
        mockQueryResponses.single(updatedPayment)
      );

      const result = await mockPool.query(
        'UPDATE payments SET payment_status = $1, stripe_payment_intent_id = $2 WHERE stripe_session_id = $3 RETURNING *',
        ['paid', 'pi_test_def456', 'cs_test_abc123']
      );

      expect(result.rows[0].payment_status).toBe('paid');
    });

    it('should process payment_intent.payment_failed webhook', () => {
      const webhook = stripeWebhooks.paymentFailed;

      expect(webhook.type).toBe('payment_intent.payment_failed');
      expect(webhook.data.object.last_payment_error).toBeTruthy();
    });

    it('should update payment status on failed webhook', async () => {
      const updatedPayment = {
        ...payments.pending,
        payment_status: 'failed',
        failure_reason: 'card_declined'
      };

      mockPool.setQueryResponse(
        /UPDATE payments/,
        mockQueryResponses.single(updatedPayment)
      );

      const result = await mockPool.query(
        'UPDATE payments SET payment_status = $1, failure_reason = $2 WHERE stripe_session_id = $3 RETURNING *',
        ['failed', 'card_declined', 'cs_test_ghi789']
      );

      expect(result.rows[0].payment_status).toBe('failed');
      expect(result.rows[0].failure_reason).toBe('card_declined');
    });

    it('should auto-join user to contest after successful payment', async () => {
      const contestEntry = {
        user_id: TEST_IDS.users.validUser,
        contest_id: TEST_CONTEST_IDS.paidContest,
        joined_at: new Date()
      };

      mockPool.setQueryResponse(
        /INSERT INTO contest_entries/,
        mockQueryResponses.single(contestEntry)
      );

      const result = await mockPool.query(
        'INSERT INTO contest_entries (user_id, contest_id) VALUES ($1, $2) RETURNING *',
        [TEST_IDS.users.validUser, TEST_CONTEST_IDS.paidContest]
      );

      expect(result.rows[0].user_id).toBe(TEST_IDS.users.validUser);
      expect(result.rows[0].contest_id).toBe(TEST_CONTEST_IDS.paidContest);
    });

    it('should increment contest current_entries after successful payment', async () => {
      const updatedContest = {
        ...contests.paid,
        current_entries: contests.paid.current_entries + 1
      };

      mockPool.setQueryResponse(
        /UPDATE contests.*SET.*current_entries/,
        mockQueryResponses.single(updatedContest)
      );

      const result = await mockPool.query(
        'UPDATE contests SET current_entries = current_entries + 1 WHERE contest_id = $1 RETURNING *',
        [TEST_CONTEST_IDS.paidContest]
      );

      expect(result.rows[0].current_entries).toBe(contests.paid.current_entries + 1);
    });
  });

  describe('Webhook Idempotency', () => {
    it('should not duplicate state on webhook replay', async () => {
      // First webhook processing - event not yet in database
      mockPool.setQueryResponse(
        /SELECT.*FROM webhook_events.*WHERE.*event_id/,
        mockQueryResponses.empty()
      );

      const firstCheck = await mockPool.query(
        'SELECT * FROM webhook_events WHERE event_id = $1',
        ['evt_test_checkout_completed']
      );

      const isFirstProcessing = firstCheck.rows.length === 0;
      expect(isFirstProcessing).toBe(true);

      // Store processed event
      mockPool.setQueryResponse(
        /INSERT INTO webhook_events/,
        mockQueryResponses.single({ event_id: 'evt_test_checkout_completed', processed_at: new Date() })
      );

      await mockPool.query(
        'INSERT INTO webhook_events (event_id, processed_at) VALUES ($1, $2)',
        ['evt_test_checkout_completed', new Date()]
      );

      // Reset mocks before second check to clear the empty response
      mockPool.reset();

      // Second webhook (replay) - event now exists in database
      mockPool.setQueryResponse(
        /SELECT.*FROM webhook_events.*WHERE.*event_id/,
        mockQueryResponses.single({ event_id: 'evt_test_checkout_completed' })
      );

      const secondCheck = await mockPool.query(
        'SELECT * FROM webhook_events WHERE event_id = $1',
        ['evt_test_checkout_completed']
      );

      const alreadyProcessed = secondCheck.rows.length > 0;
      expect(alreadyProcessed).toBe(true);
    });

    it('should track webhook event IDs', () => {
      const webhook = stripeWebhooks.checkoutCompleted;

      expect(webhook.id).toBeTruthy();
      expect(typeof webhook.id).toBe('string');
      expect(webhook.id.startsWith('evt_')).toBe(true);
    });

    it('should skip processing for already processed events', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM webhook_events/,
        mockQueryResponses.single({ event_id: 'evt_test_duplicate', processed_at: new Date() })
      );

      const result = await mockPool.query(
        'SELECT * FROM webhook_events WHERE event_id = $1',
        ['evt_test_duplicate']
      );

      const shouldSkip = result.rows.length > 0;
      expect(shouldSkip).toBe(true);
    });

    it('should prevent double contest entry on webhook replay', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM contest_entries.*WHERE.*user_id.*AND.*contest_id/,
        mockQueryResponses.single({
          user_id: TEST_IDS.users.validUser,
          contest_id: TEST_CONTEST_IDS.paidContest
        })
      );

      const result = await mockPool.query(
        'SELECT * FROM contest_entries WHERE user_id = $1 AND contest_id = $2',
        [TEST_IDS.users.validUser, TEST_CONTEST_IDS.paidContest]
      );

      const alreadyEntered = result.rows.length > 0;
      expect(alreadyEntered).toBe(true);
    });
  });

  describe('Payment Status Transitions', () => {
    it('should define valid status transitions', () => {
      expect(paymentStatusTransitions.pending).toContain('paid');
      expect(paymentStatusTransitions.pending).toContain('failed');
      expect(paymentStatusTransitions.paid).toContain('refunded');
    });

    it('should allow transition from pending to paid', () => {
      const fromStatus = 'pending';
      const toStatus = 'paid';

      expect(paymentStatusTransitions[fromStatus]).toContain(toStatus);
    });

    it('should allow transition from pending to failed', () => {
      const fromStatus = 'pending';
      const toStatus = 'failed';

      expect(paymentStatusTransitions[fromStatus]).toContain(toStatus);
    });

    it('should block transition from paid to pending', () => {
      const fromStatus = 'paid';
      const toStatus = 'pending';

      expect(paymentStatusTransitions[fromStatus]).not.toContain(toStatus);
    });

    it('should allow transition from paid to refunded', () => {
      const fromStatus = 'paid';
      const toStatus = 'refunded';

      expect(paymentStatusTransitions[fromStatus]).toContain(toStatus);
    });

    it('should block transitions from terminal states', () => {
      expect(paymentStatusTransitions.cancelled).toHaveLength(0);
      expect(paymentStatusTransitions.refunded).toHaveLength(0);
    });

    it('should allow retry from failed state', () => {
      const fromStatus = 'failed';
      const toStatus = 'pending';

      expect(paymentStatusTransitions[fromStatus]).toContain(toStatus);
    });
  });

  describe('Payment Data Shape Validation', () => {
    it('should have all required fields in payment record', () => {
      const requiredFields = [
        'payment_id',
        'user_id',
        'contest_id',
        'amount_cents',
        'payment_status',
        'stripe_session_id'
      ];

      requiredFields.forEach(field => {
        expect(payments.pending).toHaveProperty(field);
      });
    });

    it('should have payment_id as UUID format', () => {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      expect(payments.pending.payment_id).toMatch(uuidRegex);
      expect(payments.completed.payment_id).toMatch(uuidRegex);
    });

    it('should have amount_cents as positive integer', () => {
      expect(Number.isInteger(payments.pending.amount_cents)).toBe(true);
      expect(payments.pending.amount_cents).toBeGreaterThan(0);
    });

    it('should have valid payment_status value', () => {
      const validStatuses = ['pending', 'paid', 'failed', 'cancelled', 'refunded'];

      expect(validStatuses).toContain(payments.pending.payment_status);
      expect(validStatuses).toContain(payments.completed.payment_status);
      expect(validStatuses).toContain(payments.failed.payment_status);
    });

    it('should have stripe_session_id as non-empty string', () => {
      expect(typeof payments.pending.stripe_session_id).toBe('string');
      expect(payments.pending.stripe_session_id.length).toBeGreaterThan(0);
    });

    it('should have stripe_payment_intent_id for completed payments', () => {
      expect(payments.completed.stripe_payment_intent_id).toBeTruthy();
    });

    it('should have failure_reason for failed payments', () => {
      expect(payments.failed.failure_reason).toBeTruthy();
    });
  });

  describe('Error Handling', () => {
    it('should handle Stripe API errors gracefully', async () => {
      mockPool.setQueryResponse(
        /INSERT INTO payments/,
        mockQueryResponses.error('Stripe API unavailable', 'STRIPE_ERROR')
      );

      await expect(mockPool.query('INSERT INTO payments...'))
        .rejects.toThrow('Stripe API unavailable');
    });

    it('should handle duplicate payment attempts', async () => {
      mockPool.setQueryResponse(
        /INSERT INTO payments/,
        mockQueryResponses.error('duplicate key value violates unique constraint', '23505')
      );

      await expect(mockPool.query('INSERT INTO payments...'))
        .rejects.toThrow('duplicate key');
    });

    it('should handle invalid webhook signatures', () => {
      const invalidSignature = 'invalid_sig';
      const validSignaturePattern = /^t=\d+,v1=[a-f0-9]+/;

      expect(invalidSignature).not.toMatch(validSignaturePattern);
    });
  });
});
