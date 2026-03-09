/**
 * Ledger Direction Invariant Tests
 *
 * Pure SQL tests for schema constraints on ledger direction.
 *
 * Schema constraint (schema.snapshot.sql line 961):
 * CONSTRAINT ledger_entry_fee_direction CHECK ((NOT ((entry_type = 'ENTRY_FEE'::text) AND (direction <> 'DEBIT'::text))))
 *
 * Translation: IF entry_type='ENTRY_FEE', THEN direction MUST='DEBIT'
 */

const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

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

describe('Ledger Direction Invariant (Schema Constraints)', () => {
  let testUserId;
  let testContestId;

  beforeEach(async () => {
    testUserId = uuidv4();
    testContestId = uuidv4();

    // Insert minimal test data
    await pool.query(
      'INSERT INTO users (id, email, name, created_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (id) DO NOTHING',
      [testUserId, `test_${uuidv4()}@example.com`, 'Test User']
    );
  });

  describe('ENTRY_FEE with direction=DEBIT', () => {
    test('allows ENTRY_FEE with DEBIT direction', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query(
          `INSERT INTO ledger (
            user_id, entry_type, direction, amount_cents, currency, reference_type, reference_id,
            idempotency_key, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
           RETURNING id, entry_type, direction, amount_cents`,
          [testUserId, 'ENTRY_FEE', 'DEBIT', 5000, 'USD', 'CONTEST', testContestId,
           `entry_fee_test_${uuidv4()}`]
        );
        await client.query('ROLLBACK');

        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].entry_type).toBe('ENTRY_FEE');
        expect(result.rows[0].direction).toBe('DEBIT');
        expect(result.rows[0].amount_cents).toBe(5000);
      } finally {
        client.release();
      }
    });

    test('rejects ENTRY_FEE with CREDIT direction (CHECK constraint violation)', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        let error;
        try {
          await client.query(
            `INSERT INTO ledger (
              user_id, entry_type, direction, amount_cents, currency, reference_type, reference_id,
              idempotency_key, created_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
            [testUserId, 'ENTRY_FEE', 'CREDIT', 5000, 'USD', 'CONTEST', testContestId,
             `entry_fee_credit_${uuidv4()}`]
          );
        } catch (err) {
          error = err;
        }

        await client.query('ROLLBACK');

        expect(error).toBeDefined();
        expect(error.code).toBe('23514'); // PostgreSQL CHECK constraint violation
      } finally {
        client.release();
      }
    });

    test('rejects ENTRY_FEE with CREDIT is enforced on every insert', async () => {
      // Verify constraint is consistently enforced across multiple inserts
      const testCases = [
        { direction: 'CREDIT', shouldReject: true },
        { direction: 'DEBIT', shouldReject: false }
      ];

      for (const testCase of testCases) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          let error;
          try {
            await client.query(
              `INSERT INTO ledger (
                user_id, entry_type, direction, amount_cents, currency, reference_type, reference_id,
                idempotency_key, created_at
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
              [testUserId, 'ENTRY_FEE', testCase.direction, 5000, 'USD', 'CONTEST', testContestId,
               `constraint_test_${testCase.direction}_${uuidv4()}`]
            );
          } catch (err) {
            error = err;
          }

          await client.query('ROLLBACK');

          if (testCase.shouldReject) {
            expect(error).toBeDefined();
            expect(error.code).toBe('23514');
          } else {
            expect(error).toBeUndefined();
          }
        } finally {
          client.release();
        }
      }
    });
  });

  describe('ENTRY_FEE_REFUND with direction=CREDIT', () => {
    test('allows ENTRY_FEE_REFUND with CREDIT direction', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query(
          `INSERT INTO ledger (
            user_id, entry_type, direction, amount_cents, currency, reference_type, reference_id,
            idempotency_key, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
           RETURNING id, entry_type, direction, amount_cents`,
          [testUserId, 'ENTRY_FEE_REFUND', 'CREDIT', 5000, 'USD', 'CONTEST', testContestId,
           `refund_credit_${uuidv4()}`]
        );
        await client.query('ROLLBACK');

        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].entry_type).toBe('ENTRY_FEE_REFUND');
        expect(result.rows[0].direction).toBe('CREDIT');
        expect(result.rows[0].amount_cents).toBe(5000);
      } finally {
        client.release();
      }
    });
  });

  describe('Ledger direction constraint scope', () => {
    test('direction constraint only applies to ENTRY_FEE, not other entry types', async () => {
      const otherEntryTypes = [
        'ADJUSTMENT',
        'WALLET_DEPOSIT',
        'WALLET_DEBIT',
        'WALLET_WITHDRAWAL',
        'WALLET_WITHDRAWAL_REVERSAL'
      ];

      for (const entryType of otherEntryTypes) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          // These should NOT be constrained to DEBIT
          const result = await client.query(
            `INSERT INTO ledger (
              user_id, entry_type, direction, amount_cents, currency, reference_type, reference_id,
              idempotency_key, created_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
             RETURNING entry_type, direction`,
            [testUserId, entryType, 'CREDIT', 5000, 'USD', 'CONTEST', testContestId,
             `other_entry_${entryType}_${uuidv4()}`]
          );

          await client.query('ROLLBACK');

          expect(result.rows).toHaveLength(1);
          expect(result.rows[0].entry_type).toBe(entryType);
          expect(result.rows[0].direction).toBe('CREDIT');
        } finally {
          client.release();
        }
      }
    });
  });

  describe('Idempotency key prevents duplicate entries', () => {
    test('same idempotency_key prevents duplicate insert', async () => {
      const idempotencyKey = `dedup_test_${uuidv4()}`;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // First insert
        const result1 = await client.query(
          `INSERT INTO ledger (
            user_id, entry_type, direction, amount_cents, currency, reference_type, reference_id,
            idempotency_key, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
           RETURNING id, idempotency_key`,
          [testUserId, 'ENTRY_FEE', 'DEBIT', 5000, 'USD', 'CONTEST', testContestId, idempotencyKey]
        );
        expect(result1.rows).toHaveLength(1);

        // Second insert with same idempotency_key - should fail
        let error;
        try {
          await client.query(
            `INSERT INTO ledger (
              user_id, entry_type, direction, amount_cents, currency, reference_type, reference_id,
              idempotency_key, created_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
            [testUserId, 'ENTRY_FEE', 'DEBIT', 5000, 'USD', 'CONTEST', testContestId, idempotencyKey]
          );
        } catch (err) {
          error = err;
        }

        await client.query('ROLLBACK');

        expect(error).toBeDefined();
        expect(error.code).toBe('23505'); // UNIQUE constraint violation
      } finally {
        client.release();
      }
    });
  });
});
