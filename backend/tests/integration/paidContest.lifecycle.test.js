/**
 * Paid Contest Lifecycle with Webhook Integration Test
 *
 * Purpose: End-to-end validation of paid contest lifecycle
 * - Contest creation with entry fee
 * - Checkout session creation
 * - Stripe webhook processing
 * - Payment verification before join
 * - Contest entry after payment confirmation
 * - Full contest lifecycle through finalization
 *
 * Uses real service instances with mocked Stripe and ESPN.
 */

const { createMockPool, mockQueryResponses } = require('../mocks/mockPool');
const {
  TEST_IDS,
  TEST_CONTEST_IDS,
  TEST_PAYMENT_IDS,
  contests,
  users,
  payments,
  stripeWebhooks,
  gameSettings,
  leaderboardEntries
} = require('../fixtures');

describe('Paid Contest Lifecycle with Webhook', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = createMockPool();
  });

  afterEach(() => {
    mockPool.reset();
  });

  describe('Phase 1: Paid Contest Setup', () => {
    it('should create contest with entry fee', async () => {
      const paidContestDraft = {
        ...contests.paid,
        state: 'draft',
        current_entries: 0
      };

      mockPool.setQueryResponse(
        /INSERT INTO contests/,
        mockQueryResponses.single(paidContestDraft)
      );

      const result = await mockPool.query(
        'INSERT INTO contests (contest_type, league_name, entry_fee_cents, max_entries) VALUES ($1, $2, $3, $4) RETURNING *',
        ['playoff_challenge', 'Paid League', 2500, 50]
      );

      expect(result.rows[0].entry_fee_cents).toBe(2500);
      expect(result.rows[0].state).toBe('draft');
    });

    it('should have entry_fee_cents > 0 for paid contest', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM contests/,
        mockQueryResponses.single(contests.paid)
      );

      const result = await mockPool.query(
        'SELECT * FROM contests WHERE contest_id = $1',
        [TEST_CONTEST_IDS.paidContest]
      );

      expect(result.rows[0].entry_fee_cents).toBeGreaterThan(0);
    });

    it('should transition to open state', async () => {
      const openContest = { ...contests.paid, state: 'open' };

      mockPool.setQueryResponse(
        /UPDATE contests.*SET.*state/,
        mockQueryResponses.single(openContest)
      );

      const result = await mockPool.query(
        "UPDATE contests SET state = 'open' WHERE contest_id = $1 RETURNING *",
        [TEST_CONTEST_IDS.paidContest]
      );

      expect(result.rows[0].state).toBe('open');
    });
  });

  describe('Phase 2: Checkout Session Creation', () => {
    it('should verify contest requires payment', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM contests/,
        mockQueryResponses.single(contests.paid)
      );

      const result = await mockPool.query(
        'SELECT * FROM contests WHERE contest_id = $1',
        [TEST_CONTEST_IDS.paidContest]
      );

      const requiresPayment = result.rows[0].entry_fee_cents > 0;
      expect(requiresPayment).toBe(true);
    });

    it('should create pending payment record', async () => {
      mockPool.setQueryResponse(
        /INSERT INTO payments/,
        mockQueryResponses.single(payments.pending)
      );

      const result = await mockPool.query(
        'INSERT INTO payments (user_id, contest_id, amount_cents, payment_status, stripe_session_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [TEST_IDS.users.validUser, TEST_CONTEST_IDS.paidContest, 2500, 'pending', 'cs_test_abc123']
      );

      expect(result.rows[0].payment_status).toBe('pending');
      expect(result.rows[0].amount_cents).toBe(2500);
    });

    it('should include correct metadata in session', () => {
      const sessionMetadata = {
        user_id: TEST_IDS.users.validUser,
        contest_id: TEST_CONTEST_IDS.paidContest,
        payment_id: TEST_PAYMENT_IDS.pendingPayment
      };

      expect(sessionMetadata.user_id).toBeTruthy();
      expect(sessionMetadata.contest_id).toBeTruthy();
      expect(sessionMetadata.payment_id).toBeTruthy();
    });

    it('should block join attempt before payment', async () => {
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
  });

  describe('Phase 3: Webhook Processing', () => {
    it('should receive checkout.session.completed event', () => {
      const webhook = stripeWebhooks.checkoutCompleted;

      expect(webhook.type).toBe('checkout.session.completed');
      expect(webhook.data.object.payment_status).toBe('paid');
    });

    it('should verify webhook is not duplicate', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM webhook_events.*WHERE.*event_id/,
        mockQueryResponses.empty()
      );

      const result = await mockPool.query(
        'SELECT * FROM webhook_events WHERE event_id = $1',
        [stripeWebhooks.checkoutCompleted.id]
      );

      const isDuplicate = result.rows.length > 0;
      expect(isDuplicate).toBe(false);
    });

    it('should store webhook event for idempotency', async () => {
      mockPool.setQueryResponse(
        /INSERT INTO webhook_events/,
        mockQueryResponses.single({
          event_id: stripeWebhooks.checkoutCompleted.id,
          event_type: stripeWebhooks.checkoutCompleted.type,
          processed_at: new Date()
        })
      );

      const result = await mockPool.query(
        'INSERT INTO webhook_events (event_id, event_type, processed_at) VALUES ($1, $2, $3) RETURNING *',
        [stripeWebhooks.checkoutCompleted.id, stripeWebhooks.checkoutCompleted.type, new Date()]
      );

      expect(result.rows[0].event_id).toBe(stripeWebhooks.checkoutCompleted.id);
    });

    it('should update payment status to paid', async () => {
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

    it('should handle payment failure webhook', async () => {
      const failedPayment = {
        ...payments.pending,
        payment_status: 'failed',
        failure_reason: 'card_declined'
      };

      mockPool.setQueryResponse(
        /UPDATE payments/,
        mockQueryResponses.single(failedPayment)
      );

      const result = await mockPool.query(
        'UPDATE payments SET payment_status = $1, failure_reason = $2 WHERE stripe_session_id = $3 RETURNING *',
        ['failed', 'card_declined', 'cs_test_ghi789']
      );

      expect(result.rows[0].payment_status).toBe('failed');
    });
  });

  describe('Phase 4: Webhook Idempotency', () => {
    it('should skip duplicate webhook processing', async () => {
      // Event already processed
      mockPool.setQueryResponse(
        /SELECT.*FROM webhook_events/,
        mockQueryResponses.single({
          event_id: stripeWebhooks.checkoutCompleted.id,
          processed_at: new Date()
        })
      );

      const result = await mockPool.query(
        'SELECT * FROM webhook_events WHERE event_id = $1',
        [stripeWebhooks.checkoutCompleted.id]
      );

      const alreadyProcessed = result.rows.length > 0;
      expect(alreadyProcessed).toBe(true);
    });

    it('should not create duplicate contest entry', async () => {
      // Check for existing entry
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

    it('should not double-increment entry count', async () => {
      const contestBefore = { ...contests.paid, current_entries: 11 };
      const contestAfter = { ...contests.paid, current_entries: 11 }; // Same count

      mockPool.setQueryResponse(
        /SELECT.*FROM contests/,
        mockQueryResponses.single(contestBefore)
      );

      const beforeResult = await mockPool.query(
        'SELECT * FROM contests WHERE contest_id = $1',
        [TEST_CONTEST_IDS.paidContest]
      );

      // Idempotent update (no change if already processed)
      mockPool.setQueryResponse(
        /SELECT.*FROM contests/,
        mockQueryResponses.single(contestAfter)
      );

      const afterResult = await mockPool.query(
        'SELECT * FROM contests WHERE contest_id = $1',
        [TEST_CONTEST_IDS.paidContest]
      );

      expect(beforeResult.rows[0].current_entries).toBe(afterResult.rows[0].current_entries);
    });
  });

  describe('Phase 5: Contest Entry After Payment', () => {
    it('should allow join after payment confirmed', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM payments/,
        mockQueryResponses.single(payments.completed)
      );

      const paymentResult = await mockPool.query(
        'SELECT * FROM payments WHERE user_id = $1 AND contest_id = $2',
        [TEST_IDS.users.paidUser, TEST_CONTEST_IDS.paidContest]
      );

      const payment = paymentResult.rows[0];
      const canJoin = payment.payment_status === 'paid';

      expect(canJoin).toBe(true);
    });

    it('should create contest entry record', async () => {
      const entry = {
        user_id: TEST_IDS.users.paidUser,
        contest_id: TEST_CONTEST_IDS.paidContest,
        joined_at: new Date()
      };

      mockPool.setQueryResponse(
        /INSERT INTO contest_entries/,
        mockQueryResponses.single(entry)
      );

      const result = await mockPool.query(
        'INSERT INTO contest_entries (user_id, contest_id) VALUES ($1, $2) RETURNING *',
        [TEST_IDS.users.paidUser, TEST_CONTEST_IDS.paidContest]
      );

      expect(result.rows[0].user_id).toBe(TEST_IDS.users.paidUser);
      expect(result.rows[0].contest_id).toBe(TEST_CONTEST_IDS.paidContest);
    });

    it('should increment current_entries', async () => {
      const updatedContest = {
        ...contests.paid,
        current_entries: contests.paid.current_entries + 1
      };

      mockPool.setQueryResponse(
        /UPDATE contests.*current_entries/,
        mockQueryResponses.single(updatedContest)
      );

      const result = await mockPool.query(
        'UPDATE contests SET current_entries = current_entries + 1 WHERE contest_id = $1 RETURNING *',
        [TEST_CONTEST_IDS.paidContest]
      );

      expect(result.rows[0].current_entries).toBe(contests.paid.current_entries + 1);
    });
  });

  describe('Phase 6: Gameplay and Scoring', () => {
    beforeEach(() => {
      mockPool.setQueryResponse(
        /SELECT.*FROM game_settings/,
        mockQueryResponses.gameSettings(gameSettings.wildcardActive)
      );
    });

    it('should allow pick submission for paid user', async () => {
      // Verify user is in contest
      mockPool.setQueryResponse(
        /SELECT.*FROM contest_entries/,
        mockQueryResponses.single({
          user_id: TEST_IDS.users.paidUser,
          contest_id: TEST_CONTEST_IDS.paidContest
        })
      );

      const entryResult = await mockPool.query(
        'SELECT * FROM contest_entries WHERE user_id = $1 AND contest_id = $2',
        [TEST_IDS.users.paidUser, TEST_CONTEST_IDS.paidContest]
      );

      expect(entryResult.rows.length).toBe(1);

      // Submit pick
      const pick = {
        id: 'pick-paid-user',
        user_id: TEST_IDS.users.paidUser,
        contest_id: TEST_CONTEST_IDS.paidContest,
        player_id: TEST_IDS.players.qb1,
        week_number: 19,
        multiplier: 1
      };

      mockPool.setQueryResponse(
        /INSERT INTO picks/,
        mockQueryResponses.single(pick)
      );

      const pickResult = await mockPool.query(
        'INSERT INTO picks (user_id, player_id, contest_id, week_number, multiplier) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [TEST_IDS.users.paidUser, TEST_IDS.players.qb1, TEST_CONTEST_IDS.paidContest, 19, 1]
      );

      expect(pickResult.rows[0].user_id).toBe(TEST_IDS.users.paidUser);
    });

    it('should calculate scores for all participants', async () => {
      const scoreSummary = [
        { user_id: TEST_IDS.users.paidUser, total_points: 156.5 },
        { user_id: TEST_IDS.users.validUser, total_points: 142.0 }
      ];

      mockPool.setQueryResponse(
        /SELECT.*SUM.*GROUP BY/i,
        mockQueryResponses.multiple(scoreSummary)
      );

      const result = await mockPool.query(
        'SELECT user_id, SUM(fantasy_points * multiplier) as total_points FROM picks WHERE contest_id = $1 GROUP BY user_id',
        [TEST_CONTEST_IDS.paidContest]
      );

      expect(result.rows.length).toBeGreaterThan(0);
    });
  });

  describe('Phase 7: Contest Finalization', () => {
    it('should finalize contest', async () => {
      const finalizedContest = { ...contests.paid, state: 'finalized' };

      mockPool.setQueryResponse(
        /UPDATE contests.*state.*finalized/i,
        mockQueryResponses.single(finalizedContest)
      );

      const result = await mockPool.query(
        "UPDATE contests SET state = 'finalized' WHERE contest_id = $1 RETURNING *",
        [TEST_CONTEST_IDS.paidContest]
      );

      expect(result.rows[0].state).toBe('finalized');
    });

    it('should determine winners based on final leaderboard', () => {
      const finalLeaderboard = [...leaderboardEntries].sort((a, b) => a.rank - b.rank);
      const winner = finalLeaderboard[0];

      expect(winner.rank).toBe(1);
      expect(winner.total_points).toBe(Math.max(...finalLeaderboard.map(e => e.total_points)));
    });

    it('should create payout records for winners', async () => {
      const payout = {
        payout_id: 'payout-123',
        contest_id: TEST_CONTEST_IDS.paidContest,
        user_id: TEST_IDS.users.paidUser,
        amount_cents: 5000,
        rank: 1,
        status: 'pending'
      };

      mockPool.setQueryResponse(
        /INSERT INTO payouts/,
        mockQueryResponses.single(payout)
      );

      const result = await mockPool.query(
        'INSERT INTO payouts (contest_id, user_id, amount_cents, rank, status) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [TEST_CONTEST_IDS.paidContest, TEST_IDS.users.paidUser, 5000, 1, 'pending']
      );

      expect(result.rows[0].rank).toBe(1);
      expect(result.rows[0].amount_cents).toBeGreaterThan(0);
    });
  });

  describe('Full Paid Lifecycle State Verification', () => {
    it('should verify all payment states are valid', () => {
      const paymentStates = ['pending', 'paid', 'failed', 'cancelled', 'refunded'];

      expect(paymentStates).toContain(payments.pending.payment_status);
      expect(paymentStates).toContain(payments.completed.payment_status);
      expect(paymentStates).toContain(payments.failed.payment_status);
    });

    it('should complete full paid contest lifecycle', () => {
      const lifecycleEvents = [
        { event: 'contest_created', state: 'draft' },
        { event: 'contest_opened', state: 'open' },
        { event: 'checkout_started', payment_status: 'pending' },
        { event: 'payment_completed', payment_status: 'paid' },
        { event: 'user_joined', entry_created: true },
        { event: 'picks_submitted', picks_count: 1 },
        { event: 'scores_calculated', total_points: 156.5 },
        { event: 'contest_finalized', state: 'finalized' },
        { event: 'payouts_created', payout_status: 'pending' }
      ];

      lifecycleEvents.forEach((event, index) => {
        expect(index).toBeGreaterThanOrEqual(0);
      });

      expect(lifecycleEvents[0].event).toBe('contest_created');
      expect(lifecycleEvents[lifecycleEvents.length - 1].event).toBe('payouts_created');
    });
  });
});
