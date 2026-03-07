/**
 * Ledger Verification Service Tests
 *
 * Tests for verifying ledger integrity and self-consistency.
 * Ensures ledger entry totals are balanced and identifiable by entry type.
 */

const { randomUUID } = require('crypto');
const { Pool } = require('pg');
const ledgerVerificationService = require('../../services/ledgerVerificationService');
const { ensureNflPlayoffChallengeTemplate } = require('../helpers/templateFactory');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_TEST || process.env.DATABASE_URL
});

describe('Ledger Verification Service', () => {
  let templateId;
  let userId1;
  let userId2;
  let contestId;

  beforeAll(async () => {
    const template = await ensureNflPlayoffChallengeTemplate(pool);
    templateId = template.id;

    userId1 = randomUUID();
    userId2 = randomUUID();
    contestId = randomUUID();

    // Create users
    await pool.query(
      `INSERT INTO users (id, name, email) VALUES
        ($1, $2, $3),
        ($4, $5, $6)`,
      [
        userId1, 'User 1', `user1-${userId1}@test.com`,
        userId2, 'User 2', `user2-${userId2}@test.com`
      ]
    );

    // Create organizer
    const organizerId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, name, email) VALUES ($1, $2, $3)`,
      [organizerId, 'Organizer', `org-${organizerId}@test.com`]
    );

    // Create contest
    await pool.query(
      `INSERT INTO contest_instances (
        id, template_id, organizer_id, status, contest_name,
        entry_fee_cents, payout_structure, max_entries
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        contestId, templateId, organizerId, 'COMPLETE', 'Test Contest',
        5000, JSON.stringify({ '1': 50000 }), 10
      ]
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Isolate each test: clear ledger before each test
    await pool.query('TRUNCATE TABLE ledger CASCADE');
  });

  describe('getLedgerVerification', () => {
    test('returns empty ledger when no entries exist', async () => {
      const result = await ledgerVerificationService.getLedgerVerification(pool);

      expect(result).toHaveProperty('by_entry_type');
      expect(result).toHaveProperty('total_credits');
      expect(result).toHaveProperty('total_debits');
      expect(result).toHaveProperty('net');
      expect(result).toHaveProperty('is_balanced');

      // Empty ledger should be balanced (0 = 0)
      expect(result.is_balanced).toBe(true);
      expect(result.total_credits).toBe(0);
      expect(result.total_debits).toBe(0);
      expect(result.net).toBe(0);
    });

    test('aggregates ENTRY_FEE debits correctly', async () => {
      const idempotencyKey1 = `entry_fee:${contestId}:${userId1}`;
      const idempotencyKey2 = `entry_fee:${contestId}:${userId2}`;

      // Insert two entry fee debits
      await pool.query(
        `INSERT INTO ledger (
          contest_instance_id, user_id, entry_type, direction, amount_cents,
          currency, reference_type, reference_id, idempotency_key, metadata_json, created_at
        ) VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()),
          ($1, $11, $3, $4, $5, $6, $7, $8, $12, $10, NOW())`,
        [
          contestId, userId1, 'ENTRY_FEE', 'DEBIT', 5000,
          'USD', 'CONTEST', contestId,
          idempotencyKey1,
          JSON.stringify({}),
          userId2,
          idempotencyKey2
        ]
      );

      const result = await ledgerVerificationService.getLedgerVerification(pool);

      expect(result.by_entry_type.ENTRY_FEE).toBeDefined();
      expect(result.by_entry_type.ENTRY_FEE.debits).toBe(10000); // 2 × 5000
      expect(result.by_entry_type.ENTRY_FEE.credits).toBe(0);
      expect(result.by_entry_type.ENTRY_FEE.net).toBe(-10000);
    });

    test('aggregates PRIZE_PAYOUT credits correctly', async () => {
      const payoutId1 = randomUUID();
      const payoutId2 = randomUUID();

      // Insert two prize payouts
      await pool.query(
        `INSERT INTO ledger (
          contest_instance_id, user_id, entry_type, direction, amount_cents,
          currency, reference_type, reference_id, idempotency_key, metadata_json, created_at
        ) VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()),
          ($1, $11, $3, $4, $12, $6, $7, $13, $14, $10, NOW())`,
        [
          contestId, userId1, 'PRIZE_PAYOUT', 'CREDIT', 25000,
          'USD', 'stripe_event', payoutId1,
          `payout:${contestId}:${userId1}`,
          JSON.stringify({}),
          userId2, 25000,
          payoutId2,
          `payout:${contestId}:${userId2}`
        ]
      );

      const result = await ledgerVerificationService.getLedgerVerification(pool);

      expect(result.by_entry_type.PRIZE_PAYOUT).toBeDefined();
      expect(result.by_entry_type.PRIZE_PAYOUT.credits).toBe(50000); // 2 × 25000
      expect(result.by_entry_type.PRIZE_PAYOUT.debits).toBe(0);
      expect(result.by_entry_type.PRIZE_PAYOUT.net).toBe(50000);
    });

    test('aggregates WALLET_DEPOSIT credits correctly', async () => {
      const depositId = randomUUID();

      await pool.query(
        `INSERT INTO ledger (
          user_id, entry_type, direction, amount_cents,
          currency, reference_type, reference_id, idempotency_key, metadata_json, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [
          userId1, 'WALLET_DEPOSIT', 'CREDIT', 10000,
          'USD', 'WALLET', depositId,
          `deposit:${userId1}:${depositId}`,
          JSON.stringify({})
        ]
      );

      const result = await ledgerVerificationService.getLedgerVerification(pool);

      expect(result.by_entry_type.WALLET_DEPOSIT).toBeDefined();
      expect(result.by_entry_type.WALLET_DEPOSIT.credits).toBe(10000);
      expect(result.by_entry_type.WALLET_DEPOSIT.debits).toBe(0);
      expect(result.by_entry_type.WALLET_DEPOSIT.net).toBe(10000);
    });

    test('aggregates WALLET_WITHDRAWAL debits correctly', async () => {
      const withdrawalId = randomUUID();

      await pool.query(
        `INSERT INTO ledger (
          user_id, entry_type, direction, amount_cents,
          currency, reference_type, reference_id, idempotency_key, metadata_json, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [
          userId1, 'WALLET_WITHDRAWAL', 'DEBIT', 5000,
          'USD', 'WALLET', withdrawalId,
          `withdrawal:${userId1}:${withdrawalId}`,
          JSON.stringify({})
        ]
      );

      const result = await ledgerVerificationService.getLedgerVerification(pool);

      expect(result.by_entry_type.WALLET_WITHDRAWAL).toBeDefined();
      expect(result.by_entry_type.WALLET_WITHDRAWAL.debits).toBe(5000);
      expect(result.by_entry_type.WALLET_WITHDRAWAL.credits).toBe(0);
      expect(result.by_entry_type.WALLET_WITHDRAWAL.net).toBe(-5000);
    });

    test('calculates total_credits and total_debits across all entry types', async () => {
      // Setup: entry fee (debit), prize payout (credit), wallet withdrawal (debit)
      const entryRefId = randomUUID();
      const entryKeyId = `entry_fee:${contestId}:${userId1}`;
      const payoutRefId = randomUUID();
      const payoutKeyId = `payout:${contestId}:${userId1}`;
      const withdrawalKeyId = randomUUID();

      // Insert entry fee debit
      await pool.query(
        `INSERT INTO ledger (
          contest_instance_id, user_id, entry_type, direction, amount_cents,
          currency, reference_type, reference_id, idempotency_key, metadata_json, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          contestId, userId1, 'ENTRY_FEE', 'DEBIT', 1000,
          'USD', 'CONTEST', entryRefId, entryKeyId, JSON.stringify({})
        ]
      );

      // Insert prize payout credit
      await pool.query(
        `INSERT INTO ledger (
          contest_instance_id, user_id, entry_type, direction, amount_cents,
          currency, reference_type, reference_id, idempotency_key, metadata_json, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          contestId, userId1, 'PRIZE_PAYOUT', 'CREDIT', 2000,
          'USD', 'stripe_event', payoutRefId, payoutKeyId, JSON.stringify({})
        ]
      );

      // Insert wallet withdrawal debit
      await pool.query(
        `INSERT INTO ledger (
          user_id, entry_type, direction, amount_cents,
          currency, reference_type, reference_id, idempotency_key, metadata_json, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [
          userId1, 'WALLET_WITHDRAWAL', 'DEBIT', 500,
          'USD', 'WALLET', withdrawalKeyId, withdrawalKeyId, JSON.stringify({})
        ]
      );

      const result = await ledgerVerificationService.getLedgerVerification(pool);

      // Total debits: 1000 (entry fee) + 500 (wallet withdrawal) = 1500
      // Total credits: 2000 (payouts)
      // Net: 2000 - 1500 = 500
      expect(result.total_debits).toBe(1500);
      expect(result.total_credits).toBe(2000);
      expect(result.net).toBe(500);
    });

    test('verifies ledger balance: (total_credits - total_debits) === net', async () => {
      const result = await ledgerVerificationService.getLedgerVerification(pool);

      // This is the critical invariant: net should equal credits - debits
      const calculatedNet = result.total_credits - result.total_debits;
      expect(result.net).toBe(calculatedNet);
    });

    test('sets is_balanced to true when credits equal debits', async () => {
      // Insert balanced entries: refund (credit) and reversal (debit)
      const refundRefId = randomUUID();
      const reversalRefId = randomUUID();

      // Entry fee refund (credit)
      await pool.query(
        `INSERT INTO ledger (
          contest_instance_id, user_id, entry_type, direction, amount_cents,
          currency, reference_type, reference_id, idempotency_key, metadata_json, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          contestId, userId1, 'ENTRY_FEE_REFUND', 'CREDIT', 1000,
          'USD', 'CONTEST', refundRefId, `refund:${contestId}:${userId1}`, JSON.stringify({})
        ]
      );

      // Prize payout reversal (debit) - same amount
      await pool.query(
        `INSERT INTO ledger (
          contest_instance_id, user_id, entry_type, direction, amount_cents,
          currency, reference_type, reference_id, idempotency_key, metadata_json, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          contestId, userId1, 'PRIZE_PAYOUT_REVERSAL', 'DEBIT', 1000,
          'USD', 'stripe_event', reversalRefId, `reversal:${contestId}:${userId1}`, JSON.stringify({})
        ]
      );

      const result = await ledgerVerificationService.getLedgerVerification(pool);

      expect(result.is_balanced).toBe(true);
      expect(result.total_credits).toBe(result.total_debits);
    });

    test('handles entry type that has both credits and debits (reversals)', async () => {
      // Some entry types might have both directions (e.g., reversals)
      const reversalRefId1 = randomUUID();
      const reversalRefId2 = randomUUID();

      // Prize payout reversal - DEBIT
      await pool.query(
        `INSERT INTO ledger (
          contest_instance_id, user_id, entry_type, direction, amount_cents,
          currency, reference_type, reference_id, idempotency_key, metadata_json, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          contestId, userId1, 'PRIZE_PAYOUT_REVERSAL', 'DEBIT', 5000,
          'USD', 'stripe_event', reversalRefId1, `reversal:${contestId}:debit`, JSON.stringify({})
        ]
      );

      // Prize payout reversal - CREDIT (same type, different direction)
      await pool.query(
        `INSERT INTO ledger (
          contest_instance_id, user_id, entry_type, direction, amount_cents,
          currency, reference_type, reference_id, idempotency_key, metadata_json, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          contestId, userId1, 'PRIZE_PAYOUT_REVERSAL', 'CREDIT', 5000,
          'USD', 'stripe_event', reversalRefId2, `reversal:${contestId}:credit`, JSON.stringify({})
        ]
      );

      const result = await ledgerVerificationService.getLedgerVerification(pool);

      expect(result.by_entry_type.PRIZE_PAYOUT_REVERSAL).toBeDefined();
      expect(result.by_entry_type.PRIZE_PAYOUT_REVERSAL.debits).toBe(5000);
      expect(result.by_entry_type.PRIZE_PAYOUT_REVERSAL.credits).toBe(5000);
      expect(result.by_entry_type.PRIZE_PAYOUT_REVERSAL.net).toBe(0);
    });

    test('returns entry_type breakdown with net for each type', async () => {
      // Insert some varied entries
      const entryRefId = randomUUID();
      const payoutRefId = randomUUID();

      // Entry fee debit
      await pool.query(
        `INSERT INTO ledger (
          contest_instance_id, user_id, entry_type, direction, amount_cents,
          currency, reference_type, reference_id, idempotency_key, metadata_json, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          contestId, userId1, 'ENTRY_FEE', 'DEBIT', 1000,
          'USD', 'CONTEST', entryRefId, `entry:${contestId}:${userId1}`, JSON.stringify({})
        ]
      );

      // Prize payout credit
      await pool.query(
        `INSERT INTO ledger (
          contest_instance_id, user_id, entry_type, direction, amount_cents,
          currency, reference_type, reference_id, idempotency_key, metadata_json, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          contestId, userId1, 'PRIZE_PAYOUT', 'CREDIT', 5000,
          'USD', 'stripe_event', payoutRefId, `payout:${contestId}:${userId1}`, JSON.stringify({})
        ]
      );

      const result = await ledgerVerificationService.getLedgerVerification(pool);

      // Every entry in by_entry_type should have: debits, credits, net
      Object.entries(result.by_entry_type).forEach(([entryType, entry]) => {
        expect(entry).toHaveProperty('debits');
        expect(entry).toHaveProperty('credits');
        expect(entry).toHaveProperty('net');
        // Verify net is calculated correctly
        expect(entry.net).toBe(entry.credits - entry.debits);
      });
    });
  });
});
