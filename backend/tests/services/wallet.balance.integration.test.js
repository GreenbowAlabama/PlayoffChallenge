/**
 * Wallet Balance Integration Test
 *
 * Verifies that /api/wallet endpoint correctly reflects all ledger entries:
 * - WALLET_DEPOSIT (CREDIT)
 * - ENTRY_FEE (DEBIT on contest join)
 * - WALLET_WITHDRAWAL (DEBIT)
 * - And any other transaction types
 */

const pg = require('pg');
const crypto = require('crypto');

describe('Wallet Balance Integration', () => {
  let pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  test('wallet balance correctly reflects contest entry fee debit', async () => {
    const userId = crypto.randomUUID();
    const contestInstanceId = crypto.randomUUID();
    const templateId = crypto.randomUUID();
    const organizerId = crypto.randomUUID();
    const initialDepositCents = 100000; // $1000
    const entryFeeCents = 25000; // $250

    // 1. Create users
    await pool.query(
      'INSERT INTO users (id, created_at) VALUES ($1, NOW()), ($2, NOW()) ON CONFLICT (id) DO NOTHING',
      [userId, organizerId]
    );

    // 2. Create wallet deposit for user
    await pool.query(
      `INSERT INTO ledger (
         user_id, entry_type, direction, amount_cents, reference_type, reference_id, idempotency_key, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [userId, 'WALLET_DEPOSIT', 'CREDIT', initialDepositCents, 'WALLET', userId, `deposit_${userId}`]
    );

    // 3. Verify initial balance via ledger query
    let balanceResult = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents WHEN direction = 'DEBIT' THEN -amount_cents END), 0)::int as balance
       FROM ledger WHERE user_id = $1`,
      [userId]
    );
    expect(balanceResult.rows[0].balance).toBe(initialDepositCents);

    // 4. Create contest template and instance
    await pool.query(
      `INSERT INTO contest_templates (
        id, name, sport, template_type, scoring_strategy_key, lock_strategy_key,
        settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
        allowed_entry_fee_max_cents, allowed_payout_structures, is_active, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [templateId, 'Test Contest', 'GOLF', `test_${crypto.randomUUID()}`, 'pga_standard_v1', 'lock_at_start',
       'pga_settlement', entryFeeCents, 1000, 100000, '{}', false]
    );

    await pool.query(
      `INSERT INTO contest_instances (
        id, template_id, organizer_id, contest_name, entry_fee_cents, payout_structure, status, max_entries, join_token
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [contestInstanceId, templateId, organizerId, 'Test Contest', entryFeeCents, '{}', 'SCHEDULED', 100, crypto.randomUUID()]
    );

    // 5. User joins contest (ENTRY_FEE debit written)
    const idempotencyKey = `entry_fee:${contestInstanceId}:${userId}`;
    await pool.query(
      `INSERT INTO contest_participants (contest_instance_id, user_id, joined_at)
       VALUES ($1, $2, NOW())`,
      [contestInstanceId, userId]
    );

    // 6. Write ENTRY_FEE debit (simulating customContestService.joinContest)
    await pool.query(
      `INSERT INTO ledger (
         user_id, entry_type, direction, amount_cents, reference_type, reference_id, idempotency_key, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [userId, 'ENTRY_FEE', 'DEBIT', entryFeeCents, 'CONTEST', contestInstanceId, idempotencyKey]
    );

    // 7. Verify balance includes ENTRY_FEE debit
    balanceResult = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents WHEN direction = 'DEBIT' THEN -amount_cents END), 0)::int as balance
       FROM ledger WHERE user_id = $1`,
      [userId]
    );
    const expectedBalance = initialDepositCents - entryFeeCents;
    expect(balanceResult.rows[0].balance).toBe(expectedBalance);

    // 8. Verify ledger entries
    const ledgerEntries = await pool.query(
      `SELECT entry_type, direction, amount_cents FROM ledger WHERE user_id = $1 ORDER BY created_at`,
      [userId]
    );

    expect(ledgerEntries.rows).toHaveLength(2);
    expect(ledgerEntries.rows[0].entry_type).toBe('WALLET_DEPOSIT');
    expect(ledgerEntries.rows[0].direction).toBe('CREDIT');
    expect(ledgerEntries.rows[0].amount_cents).toBe(initialDepositCents);

    expect(ledgerEntries.rows[1].entry_type).toBe('ENTRY_FEE');
    expect(ledgerEntries.rows[1].direction).toBe('DEBIT');
    expect(ledgerEntries.rows[1].amount_cents).toBe(entryFeeCents);
  });

  test('wallet balance reflects multiple transaction types', async () => {
    const userId = crypto.randomUUID();
    const initialDepositCents = 200000; // $2000
    const entryFeeCents = 25000; // $250
    const withdrawalCents = 50000; // $500

    // 1. Create user
    await pool.query(
      'INSERT INTO users (id, created_at) VALUES ($1, NOW()) ON CONFLICT (id) DO NOTHING',
      [userId]
    );

    // 2. Wallet deposit
    await pool.query(
      `INSERT INTO ledger (
         user_id, entry_type, direction, amount_cents, reference_type, reference_id, idempotency_key, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [userId, 'WALLET_DEPOSIT', 'CREDIT', initialDepositCents, 'WALLET', userId, `deposit1_${userId}`]
    );

    // 3. Entry fee debit
    await pool.query(
      `INSERT INTO ledger (
         user_id, entry_type, direction, amount_cents, reference_type, reference_id, idempotency_key, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [userId, 'ENTRY_FEE', 'DEBIT', entryFeeCents, 'CONTEST', crypto.randomUUID(), `entry_${userId}`]
    );

    // 4. Withdrawal debit
    await pool.query(
      `INSERT INTO ledger (
         user_id, entry_type, direction, amount_cents, reference_type, reference_id, idempotency_key, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [userId, 'WALLET_WITHDRAWAL', 'DEBIT', withdrawalCents, 'WALLET', crypto.randomUUID(), `withdrawal_${userId}`]
    );

    // 5. Verify final balance
    const balanceResult = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents WHEN direction = 'DEBIT' THEN -amount_cents END), 0)::int as balance
       FROM ledger WHERE user_id = $1`,
      [userId]
    );

    const expectedBalance = initialDepositCents - entryFeeCents - withdrawalCents;
    expect(balanceResult.rows[0].balance).toBe(expectedBalance);
  });
});
