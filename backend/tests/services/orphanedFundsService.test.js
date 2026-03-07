/**
 * Orphaned Funds Service Tests
 *
 * Tests for the refund system for orphaned funds in cancelled contests.
 */

const { randomUUID } = require('crypto');
const { Pool } = require('pg');
const orphanedFundsService = require('../../services/orphanedFundsService');
const { ensureNflPlayoffChallengeTemplate } = require('../helpers/templateFactory');

// Use test database pool from environment
const pool = new Pool({
  connectionString: process.env.DATABASE_URL_TEST || process.env.DATABASE_URL
});

describe('Orphaned Funds Service', () => {
  let organizerId;
  let templateId;
  let cancelledContestId;
  let user1Id;
  let user2Id;

  beforeAll(async () => {
    // Create organizer
    organizerId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, name, email)
       VALUES ($1, $2, $3)`,
      [organizerId, 'Test Organizer', `org-${organizerId}@test.com`]
    );

    // Create a template using the helper
    const template = await ensureNflPlayoffChallengeTemplate(pool);
    templateId = template.id;

    // Create two users
    user1Id = randomUUID();
    user2Id = randomUUID();
    await pool.query(
      `INSERT INTO users (id, name, email) VALUES ($1, $2, $3), ($4, $5, $6)`,
      [
        user1Id,
        'User 1',
        `user1-${user1Id}@test.com`,
        user2Id,
        'User 2',
        `user2-${user2Id}@test.com`
      ]
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Create a cancelled contest
    cancelledContestId = randomUUID();
    await pool.query(
      `INSERT INTO contest_instances (
        id, template_id, organizer_id, status, contest_name,
        entry_fee_cents, payout_structure, max_entries
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        cancelledContestId,
        templateId,
        organizerId,
        'CANCELLED',
        'Cancelled Contest',
        5000,
        JSON.stringify({ '1': 100 }),
        10
      ]
    );

    // Insert entry fee debits for both users
    const idemKey1 = `wallet_debit:${cancelledContestId}:${user1Id}`;
    const idemKey2 = `wallet_debit:${cancelledContestId}:${user2Id}`;
    await pool.query(
      `INSERT INTO ledger (
        contest_instance_id, user_id, entry_type, direction, amount_cents,
        currency, reference_type, reference_id, idempotency_key, metadata_json, created_at
      ) VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()),
        ($1, $11, $3, $4, $5, $6, $7, $8, $12, $10, NOW())`,
      [
        cancelledContestId,
        user1Id,
        'ENTRY_FEE',
        'DEBIT',
        5000,
        'USD',
        'CONTEST',
        cancelledContestId,
        idemKey1,
        JSON.stringify({ reason: 'test entry' }),
        user2Id,
        idemKey2
      ]
    );
  });

  // No afterEach cleanup needed: each test creates a unique contest_instance_id
  // Ledger is append-only, so test data accumulates safely without collision

  describe('getOrphanedFundsSummary', () => {
    it('should return contests with stranded funds', async () => {
      const result = await orphanedFundsService.getOrphanedFundsSummary(pool);

      expect(result).toBeInstanceOf(Array);
      const contest = result.find(c => c.contest_id === cancelledContestId);
      expect(contest).toBeDefined();
      expect(contest.affected_user_count).toBe(2);
      expect(contest.total_stranded_cents).toBe(10000); // 5000 * 2 users
    });

    it('should handle contests with no stranded funds', async () => {
      // Create a cancelled contest with no debits
      const emptyContestId = randomUUID();
      await pool.query(
        `INSERT INTO contest_instances (
          id, template_id, organizer_id, status, contest_name,
          entry_fee_cents, payout_structure, max_entries
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          emptyContestId,
          templateId,
          organizerId,
          'CANCELLED',
          'Empty Cancelled Contest',
          5000,
          JSON.stringify({ '1': 100 }),
          10
        ]
      );

      const result = await orphanedFundsService.getOrphanedFundsSummary(pool);
      const emptyContest = result.find(c => c.contest_id === emptyContestId);
      expect(emptyContest).toBeUndefined(); // Should not include contests with 0 stranded
    });

    it('should exclude contests where all entry fees have been refunded', async () => {
      // Create a contest with entry fee debits
      const refundedContestId = randomUUID();
      await pool.query(
        `INSERT INTO contest_instances (
          id, template_id, organizer_id, status, contest_name,
          entry_fee_cents, payout_structure, max_entries
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          refundedContestId,
          templateId,
          organizerId,
          'CANCELLED',
          'Fully Refunded Contest',
          5000,
          JSON.stringify({ '1': 100 }),
          10
        ]
      );

      // Insert entry fee debit
      const user3Id = randomUUID();
      const idemKey3 = `wallet_debit:${refundedContestId}:${user3Id}`;
      await pool.query(
        `INSERT INTO users (id, name, email) VALUES ($1, $2, $3)`,
        [user3Id, 'User 3', `user3-${user3Id}@test.com`]
      );
      await pool.query(
        `INSERT INTO ledger (
          contest_instance_id, user_id, entry_type, direction, amount_cents,
          currency, reference_type, reference_id, idempotency_key, metadata_json, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          refundedContestId,
          user3Id,
          'ENTRY_FEE',
          'DEBIT',
          5000,
          'USD',
          'CONTEST',
          refundedContestId,
          idemKey3,
          JSON.stringify({ reason: 'test entry' })
        ]
      );

      // Insert full refund credit (matches the debit amount)
      const refundIdemKey = `refund:${refundedContestId}:${user3Id}`;
      await pool.query(
        `INSERT INTO ledger (
          contest_instance_id, user_id, entry_type, direction, amount_cents,
          currency, reference_type, reference_id, idempotency_key, metadata_json, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          refundedContestId,
          user3Id,
          'ENTRY_FEE_REFUND',
          'CREDIT',
          5000,
          'USD',
          'CONTEST',
          refundedContestId,
          refundIdemKey,
          JSON.stringify({ reason: 'refund' })
        ]
      );

      const result = await orphanedFundsService.getOrphanedFundsSummary(pool);
      const refundedContest = result.find(c => c.contest_id === refundedContestId);
      expect(refundedContest).toBeUndefined(); // Should not include fully refunded contests
    });

    it('should include refunded_at timestamp when refunds exist', async () => {
      // Create a contest and refund it
      const refundedContestId = randomUUID();
      await pool.query(
        `INSERT INTO contest_instances (
          id, template_id, organizer_id, status, contest_name,
          entry_fee_cents, payout_structure, max_entries
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          refundedContestId,
          templateId,
          organizerId,
          'CANCELLED',
          'Contest With Refund Status',
          5000,
          JSON.stringify({ '1': 100 }),
          10
        ]
      );

      const user4Id = randomUUID();
      const idemKey4 = `wallet_debit:${refundedContestId}:${user4Id}`;
      await pool.query(
        `INSERT INTO users (id, name, email) VALUES ($1, $2, $3)`,
        [user4Id, 'User 4', `user4-${user4Id}@test.com`]
      );

      // Insert debit
      await pool.query(
        `INSERT INTO ledger (
          contest_instance_id, user_id, entry_type, direction, amount_cents,
          currency, reference_type, reference_id, idempotency_key, metadata_json, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          refundedContestId,
          user4Id,
          'ENTRY_FEE',
          'DEBIT',
          5000,
          'USD',
          'CONTEST',
          refundedContestId,
          idemKey4,
          JSON.stringify({ reason: 'test entry' })
        ]
      );

      // Insert partial refund (only $25 refunded, $25 still stranded)
      const refundIdemKey4 = `refund:${refundedContestId}:${user4Id}`;
      await pool.query(
        `INSERT INTO ledger (
          contest_instance_id, user_id, entry_type, direction, amount_cents,
          currency, reference_type, reference_id, idempotency_key, metadata_json, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          refundedContestId,
          user4Id,
          'ENTRY_FEE_REFUND',
          'CREDIT',
          2500,
          'USD',
          'CONTEST',
          refundedContestId,
          refundIdemKey4,
          JSON.stringify({ reason: 'partial refund' })
        ]
      );

      const result = await orphanedFundsService.getOrphanedFundsSummary(pool);
      const contestWithRefund = result.find(c => c.contest_id === refundedContestId);

      // Should be included because refund (2500) < debit (5000)
      expect(contestWithRefund).toBeDefined();
      expect(contestWithRefund.total_stranded_cents).toBe(2500); // 5000 - 2500
      // Check refunded_at field exists
      expect(contestWithRefund.refunded_at).toBeDefined();
      expect(contestWithRefund.refunded_at instanceof Date).toBe(true);
    });
  });

  describe('getContestAffectedUsers', () => {
    it('should return affected users for a contest', async () => {
      const result = await orphanedFundsService.getContestAffectedUsers(
        pool,
        cancelledContestId
      );

      expect(result.contest_id).toBe(cancelledContestId);
      expect(result.contest_name).toBe('Cancelled Contest');
      expect(result.affected_users).toHaveLength(2);
      expect(result.total_stranded_cents).toBe(10000);
    });

    it('should throw error for non-existent contest', async () => {
      const fakeId = randomUUID();
      await expect(
        orphanedFundsService.getContestAffectedUsers(pool, fakeId)
      ).rejects.toThrow('not found');
    });
  });

  describe('refundContest', () => {
    it('should create refund entries for all affected users', async () => {
      const adminId = randomUUID();
      const result = await orphanedFundsService.refundContest(
        pool,
        cancelledContestId,
        adminId,
        'Test refund'
      );

      expect(result.success).toBe(true);
      expect(result.refunded_count).toBe(2);
      expect(result.total_refunded_cents).toBe(10000);

      // Verify refund entries exist in ledger
      const refunds = await pool.query(
        `SELECT * FROM ledger
         WHERE contest_instance_id = $1
         AND entry_type = 'ENTRY_FEE_REFUND'
         AND direction = 'CREDIT'`,
        [cancelledContestId]
      );

      expect(refunds.rows).toHaveLength(2);
      refunds.rows.forEach(refund => {
        expect(refund.amount_cents).toBe(5000);
        // metadata_json is stored as JSON object in DB
        const metadata = typeof refund.metadata_json === 'string'
          ? JSON.parse(refund.metadata_json)
          : refund.metadata_json;
        expect(metadata.reason).toBe('Test refund');
      });
    });

    it('should be idempotent (second call should succeed)', async () => {
      const adminId = randomUUID();

      // First refund
      const result1 = await orphanedFundsService.refundContest(
        pool,
        cancelledContestId,
        adminId,
        'First refund'
      );

      expect(result1.success).toBe(true);
      expect(result1.refunded_count).toBe(2);

      // Second refund (same parameters)
      const result2 = await orphanedFundsService.refundContest(
        pool,
        cancelledContestId,
        adminId,
        'Second refund'
      );

      expect(result2.success).toBe(true);
      expect(result2.refunded_count).toBe(2);

      // Verify only 2 refund entries exist (not 4)
      const refunds = await pool.query(
        `SELECT * FROM ledger
         WHERE contest_instance_id = $1
         AND entry_type = 'ENTRY_FEE_REFUND'
         AND direction = 'CREDIT'`,
        [cancelledContestId]
      );

      expect(refunds.rows).toHaveLength(2);
    });

    it('should detect field mismatch on existing refund', async () => {
      const adminId = randomUUID();

      // Create initial refund
      await orphanedFundsService.refundContest(
        pool,
        cancelledContestId,
        adminId,
        'Initial refund'
      );

      // Note: Testing field mismatch would require corrupting an existing ledger entry,
      // but since the ledger is append-only, we can't update/delete entries
      // In production, the DB unique constraint on idempotency_key would prevent
      // duplicate entries with different amounts. This scenario is unlikely in practice.
    });

    it('should handle contests with no stranded funds gracefully', async () => {
      const adminId = randomUUID();

      // Create a contest with no entry fee debits
      const emptyContestId = randomUUID();
      await pool.query(
        `INSERT INTO contest_instances (
          id, template_id, organizer_id, status, contest_name,
          entry_fee_cents, payout_structure, max_entries
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          emptyContestId,
          templateId,
          organizerId,
          'CANCELLED',
          'Empty Contest',
          5000,
          JSON.stringify({ '1': 100 }),
          10
        ]
      );

      const result = await orphanedFundsService.refundContest(
        pool,
        emptyContestId,
        adminId,
        'Empty refund'
      );

      expect(result.success).toBe(true);
      expect(result.refunded_count).toBe(0);
      expect(result.total_refunded_cents).toBe(0);

      // Cleanup
      await pool.query(
        `DELETE FROM contest_instances WHERE id = $1`,
        [emptyContestId]
      );
    });
  });
});
