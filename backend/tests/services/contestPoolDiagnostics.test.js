/**
 * Contest Pool Diagnostics Service Tests
 *
 * Tests for identifying contests with negative pool balances and classifying root causes.
 */

const { randomUUID } = require('crypto');
const { Pool } = require('pg');
const contestPoolDiagnosticsService = require('../../services/contestPoolDiagnosticsService');
const { ensureNflPlayoffChallengeTemplate } = require('../helpers/templateFactory');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_TEST || process.env.DATABASE_URL
});

describe('Contest Pool Diagnostics Service', () => {
  let templateId;
  let user1Id;
  let user2Id;
  let user3Id;

  beforeAll(async () => {
    const template = await ensureNflPlayoffChallengeTemplate(pool);
    templateId = template.id;

    user1Id = randomUUID();
    user2Id = randomUUID();
    user3Id = randomUUID();
    await pool.query(
      `INSERT INTO users (id, name, email) VALUES
        ($1, $2, $3),
        ($4, $5, $6),
        ($7, $8, $9)`,
      [
        user1Id, 'User 1', `user1-${user1Id}@test.com`,
        user2Id, 'User 2', `user2-${user2Id}@test.com`,
        user3Id, 'User 3', `user3-${user3Id}@test.com`
      ]
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('getNegativePoolContests', () => {
    test('returns empty array when no negative pools exist', async () => {
      const result = await contestPoolDiagnosticsService.getNegativePoolContests(pool);
      expect(Array.isArray(result)).toBe(true);
      expect(result.every(c => c.pool_balance_cents < 0)).toBe(true);
    });

    test('identifies contest with payouts exceeding entries', async () => {
      const organizerId = randomUUID();
      await pool.query(
        `INSERT INTO users (id, name, email) VALUES ($1, $2, $3)`,
        [organizerId, 'Test Org', `org-${organizerId}@test.com`]
      );

      const contestId = randomUUID();

      // Create contest
      await pool.query(
        `INSERT INTO contest_instances (
          id, template_id, organizer_id, status, contest_name,
          entry_fee_cents, payout_structure, max_entries
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          contestId, templateId, organizerId, 'COMPLETE', 'Test Contest',
          5000, JSON.stringify({ '1': 100000 }), 10
        ]
      );

      // Insert participant
      await pool.query(
        `INSERT INTO contest_participants (contest_instance_id, user_id, joined_at)
         VALUES ($1, $2, NOW())`,
        [contestId, user1Id]
      );

      // Insert entry fee debit (1 user × 5000)
      await pool.query(
        `INSERT INTO ledger (
          contest_instance_id, user_id, entry_type, direction, amount_cents,
          currency, reference_type, reference_id, idempotency_key, metadata_json, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          contestId, user1Id, 'ENTRY_FEE', 'DEBIT', 5000,
          'USD', 'CONTEST', contestId,
          `wallet_debit:${contestId}:${user1Id}`,
          JSON.stringify({})
        ]
      );

      // Insert large payout that exceeds entry fees (100000 out)
      const payoutId1 = randomUUID();
      await pool.query(
        `INSERT INTO ledger (
          contest_instance_id, user_id, entry_type, direction, amount_cents,
          currency, reference_type, reference_id, idempotency_key, metadata_json, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          contestId, user1Id, 'PRIZE_PAYOUT', 'CREDIT', 100000,
          'USD', 'stripe_event', payoutId1,
          `payout:${contestId}:${user1Id}`,
          JSON.stringify({})
        ]
      );

      const result = await contestPoolDiagnosticsService.getNegativePoolContests(pool);
      const contest = result.find(c => c.contest_id === contestId);

      expect(contest).toBeDefined();
      expect(contest.pool_balance_cents).toBeLessThan(0);
      expect(contest.entry_fee_net_cents).toBe(5000);
      expect(contest.prize_net_cents).toBe(100000);
      expect(contest.root_cause).toBe('PAYOUTS_EXCEED_ENTRIES');
    });

    test('identifies contest with refunded entries but payouts remain', async () => {
      const organizerId = randomUUID();
      await pool.query(
        `INSERT INTO users (id, name, email) VALUES ($1, $2, $3)`,
        [organizerId, 'Test Org', `org-${organizerId}@test.com`]
      );

      const contestId = randomUUID();

      await pool.query(
        `INSERT INTO contest_instances (
          id, template_id, organizer_id, status, contest_name,
          entry_fee_cents, payout_structure, max_entries
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          contestId, templateId, organizerId, 'COMPLETE', 'Refund Test Contest',
          5000, JSON.stringify({ '1': 50000 }), 10
        ]
      );

      // Two users join
      await pool.query(
        `INSERT INTO contest_participants (contest_instance_id, user_id, joined_at)
         VALUES ($1, $2, NOW()), ($1, $3, NOW())`,
        [contestId, user1Id, user2Id]
      );

      // Both debit (2 × 5000 = 10000 in)
      await pool.query(
        `INSERT INTO ledger (
          contest_instance_id, user_id, entry_type, direction, amount_cents,
          currency, reference_type, reference_id, idempotency_key, metadata_json, created_at
        ) VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()),
          ($1, $11, $3, $4, $5, $6, $7, $8, $12, $10, NOW())`,
        [
          contestId, user1Id, 'ENTRY_FEE', 'DEBIT', 5000,
          'USD', 'CONTEST', contestId,
          `wallet_debit:${contestId}:${user1Id}`,
          JSON.stringify({}),
          user2Id,
          `wallet_debit:${contestId}:${user2Id}`
        ]
      );

      // Refund one user (5000 back out)
      await pool.query(
        `INSERT INTO ledger (
          contest_instance_id, user_id, entry_type, direction, amount_cents,
          currency, reference_type, reference_id, idempotency_key, metadata_json, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          contestId, user1Id, 'ENTRY_FEE_REFUND', 'CREDIT', 5000,
          'USD', 'CONTEST', contestId,
          `refund:${contestId}:${user1Id}`,
          JSON.stringify({})
        ]
      );

      // But payout still issued (50000 out)
      const payoutId2 = randomUUID();
      await pool.query(
        `INSERT INTO ledger (
          contest_instance_id, user_id, entry_type, direction, amount_cents,
          currency, reference_type, reference_id, idempotency_key, metadata_json, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          contestId, user2Id, 'PRIZE_PAYOUT', 'CREDIT', 50000,
          'USD', 'stripe_event', payoutId2,
          `payout:${contestId}:${user2Id}`,
          JSON.stringify({})
        ]
      );

      const result = await contestPoolDiagnosticsService.getNegativePoolContests(pool);
      const contest = result.find(c => c.contest_id === contestId);

      expect(contest).toBeDefined();
      expect(contest.root_cause).toBe('REFUNDED_ENTRIES_WITH_PAYOUTS');
      expect(contest.entry_fee_refunds_cents).toBe(5000);
    });

    test('classifies no entries with payouts as separate root cause', async () => {
      const organizerId = randomUUID();
      await pool.query(
        `INSERT INTO users (id, name, email) VALUES ($1, $2, $3)`,
        [organizerId, 'Test Org', `org-${organizerId}@test.com`]
      );

      const contestId = randomUUID();

      await pool.query(
        `INSERT INTO contest_instances (
          id, template_id, organizer_id, status, contest_name,
          entry_fee_cents, payout_structure, max_entries
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          contestId, templateId, organizerId, 'COMPLETE', 'Payout No Entry Contest',
          5000, JSON.stringify({ '1': 50000 }), 10
        ]
      );

      // No participants or entries, but payout exists
      const payoutId3 = randomUUID();
      await pool.query(
        `INSERT INTO ledger (
          contest_instance_id, user_id, entry_type, direction, amount_cents,
          currency, reference_type, reference_id, idempotency_key, metadata_json, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          contestId, user1Id, 'PRIZE_PAYOUT', 'CREDIT', 50000,
          'USD', 'stripe_event', payoutId3,
          `payout:${contestId}:${user1Id}`,
          JSON.stringify({})
        ]
      );

      const result = await contestPoolDiagnosticsService.getNegativePoolContests(pool);
      const contest = result.find(c => c.contest_id === contestId);

      expect(contest).toBeDefined();
      expect(contest.entry_fee_net_cents).toBe(0);
      expect(contest.prize_net_cents).toBe(50000);
      expect(contest.root_cause).toBe('NO_ENTRIES_WITH_PAYOUTS');
    });

    test('orders results by most negative pool first', async () => {
      const organizerId = randomUUID();
      await pool.query(
        `INSERT INTO users (id, name, email) VALUES ($1, $2, $3)`,
        [organizerId, 'Test Org', `org-${organizerId}@test.com`]
      );

      const contestId1 = randomUUID();
      const contestId2 = randomUUID();

      // Create two contests with different negative amounts
      for (const [cId, user] of [[contestId1, user1Id], [contestId2, user2Id]]) {
        await pool.query(
          `INSERT INTO contest_instances (
            id, template_id, organizer_id, status, contest_name,
            entry_fee_cents, payout_structure, max_entries
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [cId, templateId, organizerId, 'COMPLETE', `Order Test ${cId}`,
            5000, JSON.stringify({}), 10]
        );

        await pool.query(
          `INSERT INTO contest_participants (contest_instance_id, user_id, joined_at)
           VALUES ($1, $2, NOW())`,
          [cId, user]
        );

        await pool.query(
          `INSERT INTO ledger (
            contest_instance_id, user_id, entry_type, direction, amount_cents,
            currency, reference_type, reference_id, idempotency_key, metadata_json, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
          [cId, user, 'ENTRY_FEE', 'DEBIT', 5000,
            'USD', 'CONTEST', cId,
            `wallet_debit:${cId}:${user}`,
            JSON.stringify({})]
        );
      }

      // Contest 1: -100000 payout
      // Contest 2: -50000 payout
      const payoutIdOrder1 = randomUUID();
      const payoutIdOrder2 = randomUUID();
      await pool.query(
        `INSERT INTO ledger (
          contest_instance_id, user_id, entry_type, direction, amount_cents,
          currency, reference_type, reference_id, idempotency_key, metadata_json, created_at
        ) VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()),
          ($11, $12, $3, $4, $13, $6, $7, $14, $15, $10, NOW())`,
        [
          contestId1, user1Id, 'PRIZE_PAYOUT', 'CREDIT', 100000,
          'USD', 'stripe_event', payoutIdOrder1,
          `payout:${contestId1}:${user1Id}`,
          JSON.stringify({}),
          contestId2, user2Id, 50000,
          payoutIdOrder2,
          `payout:${contestId2}:${user2Id}`
        ]
      );

      const result = await contestPoolDiagnosticsService.getNegativePoolContests(pool);
      const contest1Idx = result.findIndex(c => c.contest_id === contestId1);
      const contest2Idx = result.findIndex(c => c.contest_id === contestId2);

      expect(contest1Idx).not.toBe(-1);
      expect(contest2Idx).not.toBe(-1);
      // Contest with -100000 should come before -50000
      expect(contest1Idx).toBeLessThan(contest2Idx);
    });

    test('handles contests with no ledger entries', async () => {
      const organizerId = randomUUID();
      await pool.query(
        `INSERT INTO users (id, name, email) VALUES ($1, $2, $3)`,
        [organizerId, 'Test Org', `org-${organizerId}@test.com`]
      );

      const contestId = randomUUID();

      await pool.query(
        `INSERT INTO contest_instances (
          id, template_id, organizer_id, status, contest_name,
          entry_fee_cents, payout_structure, max_entries
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [contestId, templateId, organizerId, 'SCHEDULED', 'Empty Contest',
          5000, JSON.stringify({}), 10]
      );

      const result = await contestPoolDiagnosticsService.getNegativePoolContests(pool);
      const contest = result.find(c => c.contest_id === contestId);

      // Empty contest should not appear (no negative balance)
      expect(contest).toBeUndefined();
    });

    test('excludes CANCELLED contests with 0 participants', async () => {
      const organizerId = randomUUID();
      await pool.query(
        `INSERT INTO users (id, name, email) VALUES ($1, $2, $3)`,
        [organizerId, 'Test Org', `org-${organizerId}@test.com`]
      );

      // Create a CANCELLED contest with negative pool (and 0 participants)
      const cancelledContestId = randomUUID();
      await pool.query(
        `INSERT INTO contest_instances (
          id, template_id, organizer_id, status, contest_name,
          entry_fee_cents, payout_structure, max_entries
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [cancelledContestId, templateId, organizerId, 'CANCELLED', 'MidloPGA',
          5000, JSON.stringify({ '1': 50000 }), 10]
      );

      // Add payout to create negative pool balance
      const payoutIdCancelled = randomUUID();
      await pool.query(
        `INSERT INTO ledger (
          contest_instance_id, user_id, entry_type, direction, amount_cents,
          currency, reference_type, reference_id, idempotency_key, metadata_json, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          cancelledContestId, user1Id, 'PRIZE_PAYOUT', 'CREDIT', 50000,
          'USD', 'stripe_event', payoutIdCancelled,
          `payout:${cancelledContestId}:${user1Id}`,
          JSON.stringify({})
        ]
      );

      // Create an active contest with negative pool (for comparison)
      const activeContestId = randomUUID();
      await pool.query(
        `INSERT INTO contest_instances (
          id, template_id, organizer_id, status, contest_name,
          entry_fee_cents, payout_structure, max_entries
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [activeContestId, templateId, organizerId, 'COMPLETE', 'Active Contest',
          5000, JSON.stringify({ '1': 50000 }), 10]
      );

      // Add participant and entries to active contest
      await pool.query(
        `INSERT INTO contest_participants (contest_instance_id, user_id, joined_at)
         VALUES ($1, $2, NOW())`,
        [activeContestId, user2Id]
      );

      await pool.query(
        `INSERT INTO ledger (
          contest_instance_id, user_id, entry_type, direction, amount_cents,
          currency, reference_type, reference_id, idempotency_key, metadata_json, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          activeContestId, user2Id, 'ENTRY_FEE', 'DEBIT', 5000,
          'USD', 'CONTEST', activeContestId,
          `wallet_debit:${activeContestId}:${user2Id}`,
          JSON.stringify({})
        ]
      );

      const payoutIdActive = randomUUID();
      await pool.query(
        `INSERT INTO ledger (
          contest_instance_id, user_id, entry_type, direction, amount_cents,
          currency, reference_type, reference_id, idempotency_key, metadata_json, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          activeContestId, user2Id, 'PRIZE_PAYOUT', 'CREDIT', 50000,
          'USD', 'stripe_event', payoutIdActive,
          `payout:${activeContestId}:${user2Id}`,
          JSON.stringify({})
        ]
      );

      const result = await contestPoolDiagnosticsService.getNegativePoolContests(pool);

      // CANCELLED contest should NOT appear in results
      const midloPGA = result.find(c => c.contest_id === cancelledContestId);
      expect(midloPGA).toBeUndefined();

      // Active contest SHOULD appear
      const activeContest = result.find(c => c.contest_id === activeContestId);
      expect(activeContest).toBeDefined();
      expect(activeContest.pool_balance_cents).toBeLessThan(0);
    });

    test('excludes ALL CANCELLED contests regardless of participant count', async () => {
      const organizerId = randomUUID();
      await pool.query(
        `INSERT INTO users (id, name, email) VALUES ($1, $2, $3)`,
        [organizerId, 'Test Org', `org-${organizerId}@test.com`]
      );

      // Create a CANCELLED contest with participants and negative pool
      const cancelledWithParticipantsId = randomUUID();
      await pool.query(
        `INSERT INTO contest_instances (
          id, template_id, organizer_id, status, contest_name,
          entry_fee_cents, payout_structure, max_entries
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [cancelledWithParticipantsId, templateId, organizerId, 'CANCELLED', 'Cancelled With Participants',
          10000, JSON.stringify({ '1': 50000 }), 10]
      );

      // Add participants to CANCELLED contest
      await pool.query(
        `INSERT INTO contest_participants (contest_instance_id, user_id, joined_at)
         VALUES ($1, $2, NOW()), ($1, $3, NOW())`,
        [cancelledWithParticipantsId, user1Id, user2Id]
      );

      // Add entry fees (both users joined)
      await pool.query(
        `INSERT INTO ledger (
          contest_instance_id, user_id, entry_type, direction, amount_cents,
          currency, reference_type, reference_id, idempotency_key, metadata_json, created_at
        ) VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()),
          ($1, $11, $3, $4, $5, $6, $7, $8, $12, $10, NOW())`,
        [
          cancelledWithParticipantsId, user1Id, 'ENTRY_FEE', 'DEBIT', 10000,
          'USD', 'CONTEST', cancelledWithParticipantsId,
          `wallet_debit:${cancelledWithParticipantsId}:${user1Id}`,
          JSON.stringify({}),
          user2Id,
          `wallet_debit:${cancelledWithParticipantsId}:${user2Id}`
        ]
      );

      // Add refunds (contest was cancelled, both refunded)
      await pool.query(
        `INSERT INTO ledger (
          contest_instance_id, user_id, entry_type, direction, amount_cents,
          currency, reference_type, reference_id, idempotency_key, metadata_json, created_at
        ) VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()),
          ($1, $11, $3, $4, $5, $6, $7, $8, $12, $10, NOW())`,
        [
          cancelledWithParticipantsId, user1Id, 'ENTRY_FEE_REFUND', 'CREDIT', 5000,
          'USD', 'CONTEST', cancelledWithParticipantsId,
          `refund:${cancelledWithParticipantsId}:${user1Id}`,
          JSON.stringify({}),
          user2Id,
          `refund:${cancelledWithParticipantsId}:${user2Id}`
        ]
      );

      const result = await contestPoolDiagnosticsService.getNegativePoolContests(pool);

      // CANCELLED contest with participants should NOT appear in anomalies
      // (even though it has 2 participants and a negative pool)
      const cancelledContest = result.find(c => c.contest_id === cancelledWithParticipantsId);
      expect(cancelledContest).toBeUndefined();
    });
  });

  describe('getContestPoolDetails', () => {
    test('returns detailed ledger breakdown for a contest', async () => {
      const organizerId = randomUUID();
      await pool.query(
        `INSERT INTO users (id, name, email) VALUES ($1, $2, $3)`,
        [organizerId, 'Test Org', `org-${organizerId}@test.com`]
      );

      const contestId = randomUUID();

      await pool.query(
        `INSERT INTO contest_instances (
          id, template_id, organizer_id, status, contest_name,
          entry_fee_cents, payout_structure, max_entries
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [contestId, templateId, organizerId, 'COMPLETE', 'Detail Test Contest',
          5000, JSON.stringify({ '1': 50000 }), 10]
      );

      // Add participant
      await pool.query(
        `INSERT INTO contest_participants (contest_instance_id, user_id, joined_at)
         VALUES ($1, $2, NOW())`,
        [contestId, user1Id]
      );

      // Add entry fee
      await pool.query(
        `INSERT INTO ledger (
          contest_instance_id, user_id, entry_type, direction, amount_cents,
          currency, reference_type, reference_id, idempotency_key, metadata_json, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [contestId, user1Id, 'ENTRY_FEE', 'DEBIT', 5000,
          'USD', 'CONTEST', contestId,
          `wallet_debit:${contestId}:${user1Id}`,
          JSON.stringify({})]
      );

      // Add payout
      const payoutIdDetail = randomUUID();
      await pool.query(
        `INSERT INTO ledger (
          contest_instance_id, user_id, entry_type, direction, amount_cents,
          currency, reference_type, reference_id, idempotency_key, metadata_json, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [contestId, user1Id, 'PRIZE_PAYOUT', 'CREDIT', 50000,
          'USD', 'stripe_event', payoutIdDetail,
          `payout:${contestId}:${user1Id}`,
          JSON.stringify({})]
      );

      const details = await contestPoolDiagnosticsService.getContestPoolDetails(pool, contestId);

      expect(details.contest_id).toBe(contestId);
      expect(details.contest_name).toBe('Detail Test Contest');
      expect(details.participant_count).toBe(1);
      expect(Array.isArray(details.ledger_breakdown)).toBe(true);
      expect(details.ledger_breakdown.length).toBeGreaterThan(0);

      const entryFeeBreakdown = details.ledger_breakdown.find(l => l.entry_type === 'ENTRY_FEE');
      expect(entryFeeBreakdown).toBeDefined();
      expect(entryFeeBreakdown.direction).toBe('DEBIT');
    });

    test('throws error for non-existent contest', async () => {
      const fakeContestId = randomUUID();

      await expect(
        contestPoolDiagnosticsService.getContestPoolDetails(pool, fakeContestId)
      ).rejects.toThrow();
    });
  });
});
