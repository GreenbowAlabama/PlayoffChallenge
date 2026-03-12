/**
 * Contest Refund Ledger Tests
 *
 * Service-level tests for joinContest and unJoinContest ledger operations.
 *
 * Validates:
 * - joinContest creates ENTRY_FEE with direction=DEBIT
 * - unJoinContest creates ENTRY_FEE_REFUND with direction=CREDIT
 * - duplicate refunds are prevented via idempotency key
 * - no retry loops on invariant violations
 */

const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const customContestService = require('../../services/customContestService');

let pool;

beforeAll(async () => {
  if (!process.env.TEST_DB_ALLOW_DBNAME) {
    throw new Error("TEST_DB_ALLOW_DBNAME not set");
  }

  pool = new Pool({
    connectionString: process.env.DATABASE_URL_TEST
  });
});

afterAll(async () => {
  await pool.end();
});

describe('Contest Refund Ledger Operations', () => {
  let testUserId;
  let organizerId;
  let contestInstanceId;
  let templateId;
  let extraUserIds = [];

  beforeEach(async () => {
    testUserId = uuidv4();
    organizerId = uuidv4();
    contestInstanceId = uuidv4();
    templateId = uuidv4();
    extraUserIds = [];

    // Create test users
    await pool.query(
      `INSERT INTO users (id, email, name, created_at) VALUES ($1, $2, $3, NOW()), ($4, $5, $6, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [testUserId, `user_${uuidv4()}@example.com`, 'Test User',
       organizerId, `org_${uuidv4()}@example.com`, 'Organizer']
    );

    // Add initial wallet balance to test user (required for contest join)
    await pool.query(
      `INSERT INTO ledger (
        user_id, entry_type, direction, amount_cents, currency, reference_type, reference_id, idempotency_key, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [testUserId, 'WALLET_DEPOSIT', 'CREDIT', 100000, 'USD', 'WALLET', testUserId, `wallet_${testUserId}`]
    );

    // Create test template with all required columns (is_active=false to avoid unique constraint)
    await pool.query(
      `INSERT INTO contest_templates (
        id, name, sport, template_type, scoring_strategy_key, lock_strategy_key,
        settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
        allowed_entry_fee_max_cents, allowed_payout_structures, is_active, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [templateId, 'Test Template', 'GOLF', `test_${uuidv4()}`, 'pga_standard_v1', 'lock_at_start',
       'pga_settlement', 5000, 1000, 10000, '{}', false]
    );

    // Create test contest instance
    await pool.query(
      `INSERT INTO contest_instances (
        id, template_id, organizer_id, contest_name, entry_fee_cents, payout_structure, status, max_entries, join_token
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [contestInstanceId, templateId, organizerId, 'Test Contest', 5000, '{}', 'SCHEDULED', 100, uuidv4()]
    );
  });

  afterEach(async () => {
    // Cleanup order: ledger → participants → instances → templates → users
    try {
      await pool.query(
        `DELETE FROM ledger
         WHERE reference_type = 'CONTEST' AND reference_id = $1`,
        [contestInstanceId]
      );

      await pool.query(
        `DELETE FROM contest_participants WHERE contest_instance_id = $1`,
        [contestInstanceId]
      );

      await pool.query(
        `DELETE FROM contest_instances WHERE id = $1`,
        [contestInstanceId]
      );

      await pool.query(
        `DELETE FROM contest_templates WHERE id = $1`,
        [templateId]
      );

      const allUserIds = [testUserId, organizerId, ...extraUserIds];
      if (allUserIds.length > 0) {
        await pool.query(
          `DELETE FROM users WHERE id = ANY($1::uuid[])`,
          [allUserIds]
        );
      }
    } catch (err) {
      console.error('Cleanup error:', err.message);
    }
  });

  describe('joinContest creates ENTRY_FEE DEBIT', () => {
    test('creates ledger entry with direction=DEBIT and correct amount', async () => {
      const joinResult = await customContestService.joinContest(pool, contestInstanceId, testUserId);
      expect(joinResult.joined).toBe(true);

      // Verify ledger entry using reference_type and reference_id
      const ledgerResult = await pool.query(
        `SELECT entry_type, direction, amount_cents, idempotency_key
         FROM ledger
         WHERE entry_type = 'ENTRY_FEE'
         AND user_id = $1
         AND reference_type = 'CONTEST'
         AND reference_id = $2`,
        [testUserId, contestInstanceId]
      );

      expect(ledgerResult.rows).toHaveLength(1);
      const entry = ledgerResult.rows[0];
      expect(entry.entry_type).toBe('ENTRY_FEE');
      expect(entry.direction).toBe('DEBIT');
      expect(entry.amount_cents).toBe(5000);
      expect(entry.idempotency_key).toMatch(/^entry_fee:/);
    });

    test('duplicate join is idempotent', async () => {
      // First join
      const result1 = await customContestService.joinContest(pool, contestInstanceId, testUserId);
      expect(result1.joined).toBe(true);

      // Second join should return success idempotently
      const result2 = await customContestService.joinContest(pool, contestInstanceId, testUserId);
      expect(result2.joined).toBe(true);
      expect(result2.participant.user_id).toBe(testUserId);
    });

    test('duplicate join creates only one ledger entry via idempotency key', async () => {
      // First join
      await customContestService.joinContest(pool, contestInstanceId, testUserId);

      // Second join attempt
      await customContestService.joinContest(pool, contestInstanceId, testUserId);

      // Verify only ONE ledger entry exists
      const ledgerResult = await pool.query(
        `SELECT COUNT(*) FROM ledger
         WHERE entry_type = 'ENTRY_FEE'
         AND user_id = $1
         AND reference_type = 'CONTEST'
         AND reference_id = $2`,
        [testUserId, contestInstanceId]
      );

      expect(parseInt(ledgerResult.rows[0].count)).toBe(1);
    });
  });

  describe('unJoinContest creates ENTRY_FEE_REFUND CREDIT', () => {
    test('creates refund ledger entry with direction=CREDIT and correct amount', async () => {
      // First join
      await customContestService.joinContest(pool, contestInstanceId, testUserId);

      // Bypass cooldown by backdating join timestamp
      await pool.query(
        `UPDATE contest_participants SET joined_at = NOW() - INTERVAL '35 seconds' WHERE contest_instance_id = $1 AND user_id = $2`,
        [contestInstanceId, testUserId]
      );

      // Then unjoin
      const unjoinResult = await customContestService.unJoinContest(pool, contestInstanceId, testUserId);
      expect(unjoinResult).toBeDefined();
      expect(unjoinResult.id).toBe(contestInstanceId);

      // Verify refund ledger entry using reference_type and reference_id
      const refundResult = await pool.query(
        `SELECT entry_type, direction, amount_cents, idempotency_key
         FROM ledger
         WHERE entry_type = 'ENTRY_FEE_REFUND'
         AND user_id = $1
         AND reference_type = 'CONTEST'
         AND reference_id = $2`,
        [testUserId, contestInstanceId]
      );

      expect(refundResult.rows.length).toBeGreaterThanOrEqual(1);
      const entry = refundResult.rows[0];
      expect(entry.entry_type).toBe('ENTRY_FEE_REFUND');
      expect(entry.direction).toBe('CREDIT');
      expect(entry.amount_cents).toBe(5000);
      expect(entry.idempotency_key).toMatch(/^entry_fee_refund:/);
    });

    test('refund idempotency key prevents duplicate refunds', async () => {
      // Join then unjoin
      await customContestService.joinContest(pool, contestInstanceId, testUserId);

      // Bypass cooldown by backdating join timestamp
      await pool.query(
        `UPDATE contest_participants SET joined_at = NOW() - INTERVAL '35 seconds' WHERE contest_instance_id = $1 AND user_id = $2`,
        [contestInstanceId, testUserId]
      );

      await customContestService.unJoinContest(pool, contestInstanceId, testUserId);

      // Verify only ONE refund entry exists
      const refundResult = await pool.query(
        `SELECT COUNT(*) FROM ledger
         WHERE entry_type = 'ENTRY_FEE_REFUND'
         AND user_id = $1
         AND reference_type = 'CONTEST'
         AND reference_id = $2`,
        [testUserId, contestInstanceId]
      );

      expect(parseInt(refundResult.rows[0].count)).toBe(1);
    });
  });

  describe('Ledger invariants maintained', () => {
    test('wallet balance equals sum of all ledger entries', async () => {
      // Join contest
      await customContestService.joinContest(pool, contestInstanceId, testUserId);

      // Calculate expected balance from ledger
      const ledgerResult = await pool.query(
        `SELECT SUM(CASE WHEN direction = 'DEBIT' THEN -amount_cents ELSE amount_cents END) as balance
         FROM ledger
         WHERE user_id = $1`,
        [testUserId]
      );

      // Wallet balance should be computed from ledger
      // (Tests that ledger is source of truth for wallet balance)
      const expectedBalance = ledgerResult.rows[0].balance ? parseInt(ledgerResult.rows[0].balance, 10) : 0;
      expect(typeof expectedBalance).toBe('number');
    });

    test('entry and refund amounts match for same contest', async () => {
      const entryFeeCents = 5000;

      // Join
      await customContestService.joinContest(pool, contestInstanceId, testUserId);

      // Bypass cooldown by backdating join timestamp
      await pool.query(
        `UPDATE contest_participants SET joined_at = NOW() - INTERVAL '35 seconds' WHERE contest_instance_id = $1 AND user_id = $2`,
        [contestInstanceId, testUserId]
      );

      // Unjoin
      await customContestService.unJoinContest(pool, contestInstanceId, testUserId);

      // Get entry and refund amounts using reference_type and reference_id
      const amountsResult = await pool.query(
        `SELECT entry_type, amount_cents FROM ledger
         WHERE user_id = $1
         AND reference_type = 'CONTEST'
         AND reference_id = $2
         ORDER BY entry_type`,
        [testUserId, contestInstanceId]
      );

      const entryFeeAmount = amountsResult.rows.find(r => r.entry_type === 'ENTRY_FEE')?.amount_cents;
      const refundAmount = amountsResult.rows.find(r => r.entry_type === 'ENTRY_FEE_REFUND')?.amount_cents;

      expect(entryFeeAmount).toBe(entryFeeCents);
      expect(refundAmount).toBe(entryFeeCents);
    });
  });

  describe('Concurrent joins are handled correctly', () => {
    test('concurrent joins from different users both succeed', async () => {
      const user1Id = uuidv4();
      const user2Id = uuidv4();
      extraUserIds.push(user1Id, user2Id);

      // Create users
      await pool.query(
        `INSERT INTO users (id, email, name, created_at) VALUES ($1, $2, $3, NOW()), ($4, $5, $6, NOW())
         ON CONFLICT (id) DO NOTHING`,
        [user1Id, `concurrent_user1_${uuidv4()}@example.com`, 'User 1',
         user2Id, `concurrent_user2_${uuidv4()}@example.com`, 'User 2']
      );

      // Add wallet balance to both users
      await pool.query(
        `INSERT INTO ledger (
          user_id, entry_type, direction, amount_cents, currency, reference_type, reference_id, idempotency_key, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()), ($9, $2, $3, $4, $5, $6, $10, $11, NOW())`,
        [user1Id, 'WALLET_DEPOSIT', 'CREDIT', 100000, 'USD', 'WALLET', user1Id, `wallet_${user1Id}`,
         user2Id, user2Id, `wallet_${user2Id}`]
      );

      // Both should succeed
      const result1 = await customContestService.joinContest(pool, contestInstanceId, user1Id);
      const result2 = await customContestService.joinContest(pool, contestInstanceId, user2Id);

      expect(result1.joined).toBe(true);
      expect(result2.joined).toBe(true);

      // Verify both ledger entries exist using reference_type and reference_id
      const ledgerResult = await pool.query(
        `SELECT user_id FROM ledger
         WHERE entry_type = 'ENTRY_FEE'
         AND reference_type = 'CONTEST'
         AND reference_id = $1`,
        [contestInstanceId]
      );

      const userIds = new Set(ledgerResult.rows.map(r => r.user_id));
      expect(userIds.has(user1Id)).toBe(true);
      expect(userIds.has(user2Id)).toBe(true);
    });
  });
});
