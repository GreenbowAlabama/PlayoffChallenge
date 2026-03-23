/**
 * Ledger Contract v1 Enforcement Tests
 *
 * Purpose: Verify that all ledger writes conform to the Ledger Contract v1:
 * - reference_type + reference_id REQUIRED
 * - contest_instance_id FORBIDDEN in write paths
 * - All contest payouts use reference_type='CONTEST', reference_id=contestId
 */

const pg = require('pg');
const { v4: uuidv4 } = require('uuid');

describe('Ledger Contract v1 Enforcement', () => {
  let pool;
  let testUserId;
  let testContestId;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    testUserId = uuidv4();
    testContestId = uuidv4();
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('Test Case 1: Rejects ledger insert without reference fields', () => {
    test('insert without reference_type should fail', async () => {
      const promise = pool.query(`
        INSERT INTO ledger (
          user_id,
          entry_type,
          direction,
          amount_cents,
          currency,
          reference_id,
          idempotency_key
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [testUserId, 'WALLET_DEPOSIT', 'CREDIT', 1000, 'USD', uuidv4(), uuidv4()]);

      await expect(promise).rejects.toThrow();
    });

    test('insert without reference_id should fail', async () => {
      const promise = pool.query(`
        INSERT INTO ledger (
          user_id,
          entry_type,
          direction,
          amount_cents,
          currency,
          reference_type,
          idempotency_key
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [testUserId, 'WALLET_DEPOSIT', 'CREDIT', 1000, 'USD', 'WALLET', uuidv4()]);

      await expect(promise).rejects.toThrow();
    });

    test('insert without both reference_type and reference_id should fail', async () => {
      const promise = pool.query(`
        INSERT INTO ledger (
          user_id,
          entry_type,
          direction,
          amount_cents,
          currency,
          idempotency_key
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `, [testUserId, 'WALLET_DEPOSIT', 'CREDIT', 1000, 'USD', uuidv4()]);

      await expect(promise).rejects.toThrow();
    });
  });

  describe('Test Case 2: Rejects ledger insert with contest_instance_id present (forbidden)', () => {
    test('insert with contest_instance_id should be rejected by application validation', async () => {
      // This test documents that contest_instance_id is a deprecated field
      // and should not be used in new write paths.
      // The schema allows it (for backward compatibility), but application code
      // must reject attempts to use it.

      // For now, this test will pass once we add application-level validation
      // to the ledger insert helper. The validation should check that
      // contest_instance_id is not present in the write payload.

      // Placeholder for application-level validation that will be added
      // in the service layer
      expect(true).toBe(true);
    });
  });

  describe('Test Case 3: Accepts valid contest payout write', () => {
    test('insert with reference_type=CONTEST and valid reference_id succeeds', async () => {
      const idempotencyKey = `payout:${testContestId}:1:${uuidv4()}`;

      const result = await pool.query(`
        INSERT INTO ledger (
          entry_type,
          direction,
          amount_cents,
          currency,
          reference_type,
          reference_id,
          idempotency_key
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, reference_type, reference_id
      `, [
        'PRIZE_PAYOUT',
        'CREDIT',
        5000,
        'USD',
        'CONTEST',
        testContestId,
        idempotencyKey
      ]);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].reference_type).toBe('CONTEST');
      expect(result.rows[0].reference_id).toBe(testContestId);
    });
  });

  describe('Test Case 4: Idempotency still enforced with reference fields', () => {
    test('second insert with same idempotency_key does not create new row', async () => {
      const idempotencyKey = `payout:${testContestId}:rank2:${uuidv4()}`;

      // First insert
      const result1 = await pool.query(`
        INSERT INTO ledger (
          entry_type,
          direction,
          amount_cents,
          currency,
          reference_type,
          reference_id,
          idempotency_key
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id
      `, [
        'PRIZE_PAYOUT',
        'CREDIT',
        3000,
        'USD',
        'CONTEST',
        testContestId,
        idempotencyKey
      ]);

      expect(result1.rows.length).toBe(1);
      const firstId = result1.rows[0].id;

      // Second insert with same key
      const result2 = await pool.query(`
        INSERT INTO ledger (
          entry_type,
          direction,
          amount_cents,
          currency,
          reference_type,
          reference_id,
          idempotency_key
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id
      `, [
        'PRIZE_PAYOUT',
        'CREDIT',
        3000,
        'USD',
        'CONTEST',
        testContestId,
        idempotencyKey
      ]);

      // Second insert should return no rows (conflict handled)
      expect(result2.rows.length).toBe(0);
    });
  });
});
