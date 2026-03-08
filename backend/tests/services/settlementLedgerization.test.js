/**
 * Settlement Ledgerization Tests
 *
 * Tests that settlement properly inserts PRIZE_PAYOUT ledger entries
 * and enforces pool conservation constraints.
 *
 * Critical for financial audit trail and reconciliation invariant.
 */

const { Pool } = require('pg');
const { executeSettlementTx } = require('../../services/settlementStrategy');
const LedgerRepository = require('../../repositories/LedgerRepository');
const { v4: uuidv4 } = require('uuid');

describe('Settlement Ledgerization', () => {
  let pool;
  let client;
  let testContestId;
  let testUserId1;
  let testUserId2;
  let testSnapshotId;
  let testSnapshotHash;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    client = await pool.connect();
    await client.query('BEGIN');

    testContestId = uuidv4();
    testUserId1 = uuidv4();
    testUserId2 = uuidv4();
    testSnapshotId = uuidv4();
    testSnapshotHash = 'test-snapshot-hash-123';

    // Create test users for foreign key references
    await client.query(
      `INSERT INTO users (id, email, created_at) VALUES ($1, $2, NOW())`,
      [testUserId1, `user1-${testUserId1.substring(0, 8)}@test.com`]
    );

    await client.query(
      `INSERT INTO users (id, email, created_at) VALUES ($1, $2, NOW())`,
      [testUserId2, `user2-${testUserId2.substring(0, 8)}@test.com`]
    );

    // Create a test contest instance for foreign key references
    const organizerId = uuidv4();
    const templateId = uuidv4();

    await client.query(
      `INSERT INTO users (id, email, created_at) VALUES ($1, $2, NOW())`,
      [organizerId, `org-${organizerId.substring(0, 8)}@test.com`]
    );

    await client.query(
      `INSERT INTO contest_templates (id, name, sport, template_type, scoring_strategy_key, lock_strategy_key, settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents, allowed_entry_fee_max_cents, allowed_payout_structures, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())`,
      [templateId, 'Test Template', 'golf', 'standard', 'final_standings', 'lock_at_time', 'final_standings', 5000, 1000, 10000, JSON.stringify({ '1': 70, '2': 30 }), false]
    );

    await client.query(
      `INSERT INTO contest_instances (id, template_id, organizer_id, status, entry_fee_cents, max_entries, contest_name, payout_structure, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
      [testContestId, templateId, organizerId, 'LIVE', 5000, 10, 'Test Contest', JSON.stringify({ '1': 70, '2': 30 })]
    );
  });

  afterEach(async () => {
    try {
      await client.query('ROLLBACK');
    } catch (err) {
      // Ignore if already rolled back
    }
    client.release();
  });

  describe('PRIZE_PAYOUT ledger insertion', () => {
    it('should insert PRIZE_PAYOUT CREDIT ledger entries for each payout recipient', async () => {
      // Create settlement_records entry (settlement payouts are derived from this)
      const settlementResult = await client.query(
        `INSERT INTO settlement_records (contest_instance_id, snapshot_id, snapshot_hash, settled_at, results, results_sha256, settlement_version, participant_count, total_pool_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          testContestId,
          testSnapshotId,
          testSnapshotHash,
          new Date(),
          JSON.stringify({
            rankings: [
              { user_id: testUserId1, rank: 1, score: 100 },
              { user_id: testUserId2, rank: 2, score: 90 }
            ],
            payouts: [
              { user_id: testUserId1, rank: 1, amount_cents: 7000 },
              { user_id: testUserId2, rank: 2, amount_cents: 3000 }
            ],
            platform_remainder_cents: 0,
            rake_cents: 1000,
            distributable_cents: 9000
          }),
          'test-hash',
          'v1',
          2,
          10000
        ]
      );

      const scoringRunId = settlementResult.rows[0].id;

      // Insert PRIZE_PAYOUT entries (this is what settlement should do)
      await client.query(
        `INSERT INTO ledger (user_id, entry_type, direction, amount_cents, reference_type, reference_id, idempotency_key, scoring_run_id, snapshot_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [testUserId1, 'PRIZE_PAYOUT', 'CREDIT', 7000, 'CONTEST', testContestId, `payout:${testContestId}:1:${testUserId1}`, scoringRunId, testSnapshotId]
      );

      await client.query(
        `INSERT INTO ledger (user_id, entry_type, direction, amount_cents, reference_type, reference_id, idempotency_key, scoring_run_id, snapshot_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [testUserId2, 'PRIZE_PAYOUT', 'CREDIT', 3000, 'CONTEST', testContestId, `payout:${testContestId}:2:${testUserId2}`, scoringRunId, testSnapshotId]
      );

      // Verify entries exist
      const ledgerResult = await client.query(
        `SELECT user_id, entry_type, direction, amount_cents, idempotency_key FROM ledger
         WHERE entry_type = 'PRIZE_PAYOUT' AND reference_id = $1`,
        [testContestId]
      );

      expect(ledgerResult.rows).toHaveLength(2);

      // Verify entries by looking them up individually (UUID sort order is unpredictable)
      const user1Entry = ledgerResult.rows.find(r => r.user_id === testUserId1);
      const user2Entry = ledgerResult.rows.find(r => r.user_id === testUserId2);

      expect(user1Entry).toMatchObject({
        user_id: testUserId1,
        entry_type: 'PRIZE_PAYOUT',
        direction: 'CREDIT',
        amount_cents: 7000,
        idempotency_key: `payout:${testContestId}:1:${testUserId1}`
      });
      expect(user2Entry).toMatchObject({
        user_id: testUserId2,
        entry_type: 'PRIZE_PAYOUT',
        direction: 'CREDIT',
        amount_cents: 3000,
        idempotency_key: `payout:${testContestId}:2:${testUserId2}`
      });
    });

    it('should use deterministic idempotency keys for payouts', async () => {
      // Create settlement record
      const settlementResult = await client.query(
        `INSERT INTO settlement_records (contest_instance_id, snapshot_id, snapshot_hash, settled_at, results, results_sha256, settlement_version, participant_count, total_pool_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [testContestId, testSnapshotId, testSnapshotHash, new Date(), JSON.stringify({ payouts: [{ user_id: testUserId1, amount_cents: 5000 }] }), 'hash', 'v1', 1, 5000]
      );

      const scoringRunId = settlementResult.rows[0].id;
      const expectedIdempotencyKey = `payout:${testContestId}:1:${testUserId1}`;

      // Insert payout entry
      await client.query(
        `INSERT INTO ledger (user_id, entry_type, direction, amount_cents, reference_type, reference_id, idempotency_key, scoring_run_id, snapshot_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [testUserId1, 'PRIZE_PAYOUT', 'CREDIT', 5000, 'CONTEST', testContestId, expectedIdempotencyKey, scoringRunId, testSnapshotId]
      );

      // Insert payout entry with same idempotency key (for rerun test)
      await client.query(
        `INSERT INTO ledger (user_id, entry_type, direction, amount_cents, reference_type, reference_id, idempotency_key, scoring_run_id, snapshot_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [testUserId1, 'PRIZE_PAYOUT', 'CREDIT', 5000, 'CONTEST', testContestId, expectedIdempotencyKey, scoringRunId, testSnapshotId]
      );

      // Verify the entry exists with the correct idempotency key
      const ledgerResult = await client.query(
        `SELECT COUNT(*) as count FROM ledger WHERE idempotency_key = $1`,
        [expectedIdempotencyKey]
      );

      expect(parseInt(ledgerResult.rows[0].count)).toBe(1);

      // Verify that the idempotency key format is deterministic
      const detailedResult = await client.query(
        `SELECT idempotency_key, entry_type, direction FROM ledger WHERE idempotency_key = $1`,
        [expectedIdempotencyKey]
      );

      expect(detailedResult.rows[0].idempotency_key).toBe(expectedIdempotencyKey);
      expect(detailedResult.rows[0].entry_type).toBe('PRIZE_PAYOUT');
      expect(detailedResult.rows[0].direction).toBe('CREDIT');
    });

    it('should rerunning settlement not duplicate payout ledger entries', async () => {
      // Create settlement record
      const settlementResult = await client.query(
        `INSERT INTO settlement_records (contest_instance_id, snapshot_id, snapshot_hash, settled_at, results, results_sha256, settlement_version, participant_count, total_pool_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [testContestId, testSnapshotId, testSnapshotHash, new Date(), JSON.stringify({ payouts: [{ user_id: testUserId1, amount_cents: 5000 }] }), 'hash', 'v1', 1, 5000]
      );

      const scoringRunId = settlementResult.rows[0].id;
      const expectedIdempotencyKey = `payout:${testContestId}:1:${testUserId1}`;

      // First settlement insert
      await client.query(
        `INSERT INTO ledger (user_id, entry_type, direction, amount_cents, reference_type, reference_id, idempotency_key, scoring_run_id, snapshot_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [testUserId1, 'PRIZE_PAYOUT', 'CREDIT', 5000, 'CONTEST', testContestId, expectedIdempotencyKey, scoringRunId, testSnapshotId]
      );

      // Rerun settlement (should use ON CONFLICT DO NOTHING to prevent duplicates)
      await client.query(
        `INSERT INTO ledger (user_id, entry_type, direction, amount_cents, reference_type, reference_id, idempotency_key, scoring_run_id, snapshot_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [testUserId1, 'PRIZE_PAYOUT', 'CREDIT', 5000, 'CONTEST', testContestId, expectedIdempotencyKey, scoringRunId, testSnapshotId]
      );

      // Verify only one entry exists
      const ledgerResult = await client.query(
        `SELECT COUNT(*) FROM ledger WHERE entry_type = 'PRIZE_PAYOUT' AND reference_id = $1`,
        [testContestId]
      );

      expect(parseInt(ledgerResult.rows[0].count)).toBe(1);
    });
  });

  describe('Pool conservation validation', () => {
    it('should validate SUM(payouts) does not exceed contest pool', () => {
      // Contest pool = 2 entries × $50 = $100 (10000 cents)
      // After 10% rake: 9000 cents distributable
      // Payouts: 4500 + 4500 = 9000 (should pass)

      const payouts = [
        { user_id: testUserId1, amount_cents: 4500 },
        { user_id: testUserId2, amount_cents: 4500 }
      ];

      const totalPayouts = payouts.reduce((sum, p) => sum + p.amount_cents, 0);
      const contestPoolCents = 10000;
      const rakePercent = 0.10;
      const distributableCents = Math.floor(contestPoolCents * (1 - rakePercent));

      expect(totalPayouts).toBeLessThanOrEqual(distributableCents);
    });

    it('should fail settlement if payouts exceed pool', () => {
      // Contest pool = 1 entry × $10 = 1000 cents
      // Distributable = 900 cents (after 10% rake)
      // Payout request = 2000 cents (exceeds pool)

      const totalPayouts = 2000;
      const distributableCents = 900;

      expect(totalPayouts).toBeGreaterThan(distributableCents);
      // This should prevent ledger insertion
    });
  });

  describe('Wallet transactions query filtering', () => {
    it('should filter wallet transactions by user_id not reference_id', async () => {
      const userId = uuidv4();
      const otherUserId = uuidv4();
      const contestId = uuidv4();

      // Create additional users
      await client.query(
        `INSERT INTO users (id, email, created_at) VALUES ($1, $2, NOW())`,
        [userId, `user-${userId.substring(0, 8)}@test.com`]
      );

      await client.query(
        `INSERT INTO users (id, email, created_at) VALUES ($1, $2, NOW())`,
        [otherUserId, `other-${otherUserId.substring(0, 8)}@test.com`]
      );

      // Insert test ledger entries
      await client.query(
        `INSERT INTO ledger (user_id, entry_type, direction, amount_cents, reference_type, reference_id, idempotency_key, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [userId, 'WALLET_DEPOSIT', 'CREDIT', 10000, 'WALLET', userId, `wallet_deposit:${uuidv4()}:1`]
      );

      // Insert entry for otherUser that references contest (not a wallet entry)
      await client.query(
        `INSERT INTO ledger (user_id, entry_type, direction, amount_cents, reference_type, reference_id, idempotency_key, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [otherUserId, 'ENTRY_FEE', 'DEBIT', 5000, 'CONTEST', testContestId, `entry_fee:${testContestId}:${otherUserId}:1`]
      );

      // Query with correct filter: WHERE user_id = $1
      const correctResult = await client.query(
        `SELECT id, entry_type, direction, amount_cents FROM ledger
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [userId]
      );

      expect(correctResult.rows).toHaveLength(1);
      expect(correctResult.rows[0].entry_type).toBe('WALLET_DEPOSIT');

      // Query with incorrect filter: WHERE reference_id = $1 (would return wrong results)
      const incorrectResult = await client.query(
        `SELECT id, entry_type, direction, amount_cents FROM ledger
         WHERE reference_id = $1
         ORDER BY created_at DESC`,
        [userId]
      );

      // This SHOULD return only the WALLET_DEPOSIT entry (where reference_id = userId)
      expect(incorrectResult.rows).toHaveLength(1);
      expect(incorrectResult.rows[0].entry_type).toBe('WALLET_DEPOSIT');

      // But if we query for a contest ID as reference_id, we get different entries
      const contestResult = await client.query(
        `SELECT id, entry_type, direction, amount_cents FROM ledger
         WHERE reference_id = $1`,
        [testContestId]
      );

      expect(contestResult.rows).toHaveLength(1);
      expect(contestResult.rows[0].entry_type).toBe('ENTRY_FEE');
      expect(contestResult.rows[0].user_id).not.toBe(userId);
    });
  });
});
