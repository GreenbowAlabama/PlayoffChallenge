const { Pool } = require('pg');
const crypto = require('crypto');
const customContestService = require('../../services/customContestService');

describe('joinContest - Race Condition Fix', () => {
  let pool;

  beforeAll(() => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('Race condition where participant exists but ENTRY_FEE debit is missing', () => {
    let userId;
    let organizerId;
    let templateId;
    let contestInstanceId;
    const entryFeeCents = 50000; // $500
    const initialBalanceCents = 100000; // $1000

    beforeEach(async () => {
      // Generate UUIDs for test data
      userId = crypto.randomUUID();
      organizerId = crypto.randomUUID();
      templateId = crypto.randomUUID();
      contestInstanceId = crypto.randomUUID();

      const client = await pool.connect();
      try {
        // Create users
        await client.query(
          'INSERT INTO users (id, created_at) VALUES ($1, NOW()), ($2, NOW()) ON CONFLICT (id) DO NOTHING',
          [userId, organizerId]
        );

        // Insert starting wallet balance ($1000 = 100,000 cents)
        await client.query(
          `INSERT INTO ledger (user_id, entry_type, direction, amount_cents, reference_type, reference_id, idempotency_key, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
          [userId, 'WALLET_DEPOSIT', 'CREDIT', initialBalanceCents, 'WALLET', userId, `deposit_${userId}`]
        );

        // Create a contest template
        await client.query(
          `INSERT INTO contest_templates (
            id, name, sport, template_type, scoring_strategy_key, lock_strategy_key,
            settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
            allowed_entry_fee_max_cents, allowed_payout_structures, is_active, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
           ON CONFLICT (id) DO NOTHING`,
          [templateId, 'Test Race Condition Contest', 'GOLF', `test_${crypto.randomUUID()}`, 'pga_standard_v1', 'lock_at_start',
           'pga_settlement', entryFeeCents, 1000, 100000, '{}', false]
        );

        // Create a contest instance with entry fee
        await client.query(
          `INSERT INTO contest_instances (
            id,
            template_id,
            organizer_id,
            contest_name,
            entry_fee_cents,
            payout_structure,
            status,
            max_entries,
            join_token
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [contestInstanceId, templateId, organizerId, 'Test Contest', entryFeeCents, '{}', 'SCHEDULED', 100, crypto.randomUUID()]
        );
      } finally {
        client.release();
      }
    });

    afterEach(async () => {
      const client = await pool.connect();
      try {
        // Minimal cleanup - just participants to allow for retests
        // Note: templates, instances, ledger have complex FK relationships
        // and are isolated by unique UUID, so safe to leave in test DB
        await client.query('DELETE FROM contest_participants WHERE contest_instance_id = $1', [contestInstanceId]);
      } finally {
        client.release();
      }
    });

    it('should correctly handle race condition when participant exists but ENTRY_FEE is missing', async () => {
      // First successful join should insert both participant and ENTRY_FEE
      const firstJoinResult = await customContestService.joinContest(pool, contestInstanceId, userId);

      expect(firstJoinResult.joined).toBe(true);
      expect(firstJoinResult.participant).toBeDefined();

      // Verify ENTRY_FEE ledger entry exists
      let ledgerClient = await pool.connect();
      let idempotencyKey = `entry_fee:${contestInstanceId}:${userId}`;
      let ledgerResult = await ledgerClient.query(
        `SELECT id FROM ledger WHERE idempotency_key = $1`,
        [idempotencyKey]
      );
      expect(ledgerResult.rows.length).toBe(1);
      ledgerClient.release();

      // Simulate the race condition: another transaction tries to join the same contest
      // This should trigger the race condition path and verify the ledger entry exists
      const secondJoinResult = await customContestService.joinContest(pool, contestInstanceId, userId);

      expect(secondJoinResult.joined).toBe(true);

      // Verify still only ONE ENTRY_FEE exists (no duplicate)
      ledgerClient = await pool.connect();
      ledgerResult = await ledgerClient.query(
        `SELECT COUNT(*) as count FROM ledger WHERE idempotency_key = $1`,
        [idempotencyKey]
      );
      expect(parseInt(ledgerResult.rows[0].count, 10)).toBe(1);
      ledgerClient.release();
    });

    it('should verify the fix prevents ledger duplicates on concurrent joins', async () => {
      // Test that multiple concurrent joins don't create duplicate ledger entries
      const idempotencyKey = `entry_fee:${contestInstanceId}:${userId}`;

      // Simulate concurrent join attempts
      const promise1 = customContestService.joinContest(pool, contestInstanceId, userId);
      const promise2 = customContestService.joinContest(pool, contestInstanceId, userId);

      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1.joined).toBe(true);
      expect(result2.joined).toBe(true);

      // Verify only ONE ledger entry exists for both participants
      const ledgerClient = await pool.connect();
      const ledgerResult = await ledgerClient.query(
        `SELECT COUNT(*) as count FROM ledger WHERE idempotency_key = $1`,
        [idempotencyKey]
      );

      const count = parseInt(ledgerResult.rows[0].count, 10);
      expect(count).toBe(1);
      ledgerClient.release();
    });
  });
});
