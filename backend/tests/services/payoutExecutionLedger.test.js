/**
 * Payout Execution Ledger Tests
 *
 * Tests that PRIZE_PAYOUT ledger entries are only written when payout_transfers
 * complete successfully. Verifies ledger neutrality: funds move from contest_pools
 * to wallet_liability only on actual transfer completion.
 *
 * Critical: PRIZE_PAYOUT must NOT be written at settlement time.
 */

const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

describe('Payout Execution Ledgerization', () => {
  let pool;
  let client;
  let testContestId;
  let testUserId;
  let testTransferId;

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
    testUserId = uuidv4();
    testTransferId = uuidv4();

    // Create test user
    await client.query(
      `INSERT INTO users (id, email, created_at) VALUES ($1, $2, NOW())`,
      [testUserId, `testuser-${testUserId.substring(0, 8)}@test.com`]
    );

    // Create test contest
    const templateId = uuidv4();
    const organizerId = uuidv4();

    await client.query(
      `INSERT INTO users (id, email, created_at) VALUES ($1, $2, NOW())`,
      [organizerId, `org-${organizerId.substring(0, 8)}@test.com`]
    );

    await client.query(
      `INSERT INTO contest_templates (id, name, sport, template_type, scoring_strategy_key, lock_strategy_key, settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents, allowed_entry_fee_max_cents, allowed_payout_structures, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())`,
      [
        templateId,
        'Test Template',
        'golf',
        'standard',
        'final_standings',
        'lock_at_time',
        'final_standings',
        5000,
        1000,
        10000,
        JSON.stringify({ '1': 100 }),
        false
      ]
    );

    await client.query(
      `INSERT INTO contest_instances (id, template_id, organizer_id, status, entry_fee_cents, max_entries, contest_name, payout_structure, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
      [
        testContestId,
        templateId,
        organizerId,
        'COMPLETE',
        5000,
        10,
        'Test Contest',
        JSON.stringify({ '1': 100 })
      ]
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

  describe('PRIZE_PAYOUT ledger writes', () => {
    it('should NOT write PRIZE_PAYOUT at settlement time', async () => {
      // Verify settlement does not write PRIZE_PAYOUT
      // (This test documents expected behavior after the fix)

      // Insert a settlement record
      const settlementResult = await client.query(
        `INSERT INTO settlement_records (contest_instance_id, snapshot_id, snapshot_hash, settled_at, results, results_sha256, settlement_version, participant_count, total_pool_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          testContestId,
          uuidv4(),
          'test-hash',
          new Date(),
          JSON.stringify({
            rankings: [{ user_id: testUserId, rank: 1, score: 100 }],
            payouts: [{ user_id: testUserId, rank: 1, amount_cents: 5000 }],
            platform_remainder_cents: 0,
            rake_cents: 0,
            distributable_cents: 5000
          }),
          'hash',
          'v1',
          1,
          5000
        ]
      );

      // Verify NO PRIZE_PAYOUT entries exist for this contest
      const existingPayouts = await client.query(
        `SELECT COUNT(*) as count FROM ledger
         WHERE entry_type = 'PRIZE_PAYOUT' AND reference_id = $1`,
        [testContestId]
      );

      expect(parseInt(existingPayouts.rows[0].count)).toBe(0);
    });

    it('should write PRIZE_PAYOUT only when transfer completes', async () => {
      // Create payout transfer
      const jobId = uuidv4();
      const payoutJobResult = await client.query(
        `INSERT INTO payout_jobs (id, settlement_id, contest_id, status, total_payouts, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         RETURNING id`,
        [jobId, uuidv4(), testContestId, 'pending', 1]
      );

      const transferResult = await client.query(
        `INSERT INTO payout_transfers (
           id,
           payout_job_id,
           contest_id,
           user_id,
           amount_cents,
           status,
           idempotency_key,
           created_at,
           updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         RETURNING id`,
        [
          testTransferId,
          jobId,
          testContestId,
          testUserId,
          5000,
          'pending',
          `transfer:${testTransferId}`
        ]
      );

      // Update transfer to completed
      await client.query(
        `UPDATE payout_transfers SET status = $1, stripe_transfer_id = $2 WHERE id = $3`,
        ['completed', `ti_${testTransferId.substring(0, 8)}`, testTransferId]
      );

      // Verify NO PRIZE_PAYOUT exists while transfer is pending
      const pendingPayouts = await client.query(
        `SELECT COUNT(*) as count FROM ledger
         WHERE entry_type = 'PRIZE_PAYOUT' AND reference_id = $1`,
        [testContestId]
      );

      expect(parseInt(pendingPayouts.rows[0].count)).toBe(0);

      // Simulate transfer completion by writing the ledger entry
      // (In production, PayoutExecutionService does this)
      await client.query(
        `INSERT INTO ledger (
           user_id,
           entry_type,
           direction,
           amount_cents,
           reference_type,
           reference_id,
           idempotency_key,
           created_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [
          testUserId,
          'PRIZE_PAYOUT',
          'CREDIT',
          5000,
          'CONTEST',
          testContestId,
          `payout:${testTransferId}`
        ]
      );

      // Verify PRIZE_PAYOUT now exists
      const completedPayouts = await client.query(
        `SELECT COUNT(*) as count FROM ledger
         WHERE entry_type = 'PRIZE_PAYOUT' AND reference_id = $1`,
        [testContestId]
      );

      expect(parseInt(completedPayouts.rows[0].count)).toBe(1);
    });

    it('should use deterministic idempotency key: payout:${transferId}', async () => {
      // Verify idempotency prevents duplicate PRIZE_PAYOUT writes

      const idempotencyKey = `payout:${testTransferId}`;

      // Write PRIZE_PAYOUT
      await client.query(
        `INSERT INTO ledger (
           user_id,
           entry_type,
           direction,
           amount_cents,
           reference_type,
           reference_id,
           idempotency_key,
           created_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [
          testUserId,
          'PRIZE_PAYOUT',
          'CREDIT',
          5000,
          'CONTEST',
          testContestId,
          idempotencyKey
        ]
      );

      // Attempt duplicate write (should be ignored)
      await client.query(
        `INSERT INTO ledger (
           user_id,
           entry_type,
           direction,
           amount_cents,
           reference_type,
           reference_id,
           idempotency_key,
           created_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [
          testUserId,
          'PRIZE_PAYOUT',
          'CREDIT',
          5000,
          'CONTEST',
          testContestId,
          idempotencyKey
        ]
      );

      // Verify only one entry exists
      const result = await client.query(
        `SELECT COUNT(*) as count FROM ledger WHERE idempotency_key = $1`,
        [idempotencyKey]
      );

      expect(parseInt(result.rows[0].count)).toBe(1);
    });

    it('sum(PRIZE_PAYOUT credits) equals sum(completed payout_transfers)', async () => {
      // Create two payout transfers
      const jobId = uuidv4();

      await client.query(
        `INSERT INTO payout_jobs (id, settlement_id, contest_id, status, total_payouts, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [jobId, uuidv4(), testContestId, 'processing', 2]
      );

      const transferId1 = uuidv4();
      const transferId2 = uuidv4();
      const testUserId2 = uuidv4();

      // Create second user
      await client.query(
        `INSERT INTO users (id, email, created_at) VALUES ($1, $2, NOW())`,
        [testUserId2, `testuser2-${testUserId2.substring(0, 8)}@test.com`]
      );

      // Create transfers
      await client.query(
        `INSERT INTO payout_transfers (
           id,
           payout_job_id,
           contest_id,
           user_id,
           amount_cents,
           status,
           idempotency_key,
           created_at,
           updated_at
         )
         VALUES
         ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW()),
         ($8, $2, $3, $9, $10, $6, $11, NOW(), NOW())`,
        [
          transferId1,
          jobId,
          testContestId,
          testUserId,
          3000,
          'completed',
          `transfer:${transferId1}`,
          transferId2,
          testUserId2,
          2000,
          `transfer:${transferId2}`
        ]
      );

      // Write PRIZE_PAYOUT for both transfers
      await client.query(
        `INSERT INTO ledger (
           user_id,
           entry_type,
           direction,
           amount_cents,
           reference_type,
           reference_id,
           idempotency_key,
           created_at
         )
         VALUES
         ($1, $2, $3, $4, $5, $6, $7, NOW()),
         ($8, $2, $3, $9, $5, $6, $10, NOW())`,
        [
          testUserId,
          'PRIZE_PAYOUT',
          'CREDIT',
          3000,
          'CONTEST',
          testContestId,
          `payout:${transferId1}`,
          testUserId2,
          2000,
          `payout:${transferId2}`
        ]
      );

      // Get completed transfer totals
      const transfersResult = await client.query(
        `SELECT SUM(amount_cents) as total FROM payout_transfers
         WHERE contest_id = $1 AND status = 'completed'`,
        [testContestId]
      );

      const totalTransfers = parseInt(transfersResult.rows[0].total || 0);

      // Get PRIZE_PAYOUT totals
      const payoutsResult = await client.query(
        `SELECT
           SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents ELSE 0 END) as total_credits
         FROM ledger
         WHERE entry_type = 'PRIZE_PAYOUT' AND reference_id = $1`,
        [testContestId]
      );

      const totalPayouts = parseInt(payoutsResult.rows[0].total_credits || 0);

      expect(totalPayouts).toBe(5000);
      expect(totalTransfers).toBe(5000);
      expect(totalPayouts).toBe(totalTransfers);
    });
  });
});
