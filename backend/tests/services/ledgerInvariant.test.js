const pg = require('pg');
const { v4: uuidv4 } = require('uuid');

describe('Ledger Invariant Enforcement', () => {
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

  describe('ENTRY_FEE direction invariant', () => {
    test('ENTRY_FEE with DEBIT direction should succeed', async () => {
      const result = await pool.query(`
        INSERT INTO ledger (
          entry_type,
          direction,
          amount_cents,
          currency,
          idempotency_key
        ) VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `, ['ENTRY_FEE', 'DEBIT', 1000, 'USD', uuidv4()]);

      expect(result.rows.length).toBe(1);
    });

    test('ENTRY_FEE with CREDIT direction should fail', async () => {
      const promise = pool.query(`
        INSERT INTO ledger (
          entry_type,
          direction,
          amount_cents,
          currency,
          idempotency_key
        ) VALUES ($1, $2, $3, $4, $5)
      `, ['ENTRY_FEE', 'CREDIT', 1000, 'USD', uuidv4()]);

      await expect(promise).rejects.toThrow('must have direction=DEBIT');
    });

    test('WALLET_DEPOSIT with CREDIT direction should succeed', async () => {
      const result = await pool.query(`
        INSERT INTO ledger (
          entry_type,
          direction,
          amount_cents,
          currency,
          reference_type,
          idempotency_key
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `, ['WALLET_DEPOSIT', 'CREDIT', 1000, 'USD', 'WALLET', uuidv4()]);

      expect(result.rows.length).toBe(1);
    });
  });
});
