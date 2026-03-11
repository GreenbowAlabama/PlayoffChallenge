/**
 * Withdrawal Pipeline Financial Ordering Test
 *
 * Tests for the bug: processWithdrawal() writes WALLET_WITHDRAWAL ledger DEBIT
 * before Stripe payout succeeds. This test proves the bug exists by asserting
 * that a failed payout should NOT have created a ledger debit.
 *
 * Expected FAILURE (proves bug exists): test expects 0 debits, finds 1
 */

const pg = require('pg');
const crypto = require('crypto');
const withdrawalService = require('../../services/withdrawalService');

describe('Withdrawal pipeline financial ordering', () => {
  let pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  test('failed payout does not create WALLET_WITHDRAWAL ledger debit', async () => {
    // Each test gets a unique user ID
    const userId = crypto.randomUUID();
    const withdrawalAmount = 30000;
    const initialBalance = 100000;

    // 1. Create user
    await pool.query(
      'INSERT INTO users (id, created_at) VALUES ($1, NOW()) ON CONFLICT (id) DO NOTHING',
      [userId]
    );

    // 2. Create wallet deposit ledger entry
    await pool.query(
      `INSERT INTO ledger (
         user_id, entry_type, direction, amount_cents, reference_type, reference_id, idempotency_key, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [userId, 'WALLET_DEPOSIT', 'CREDIT', initialBalance, 'WALLET', userId, `deposit_${userId}`]
    );

    // 3. Create withdrawal request (status = REQUESTED)
    const createResult = await withdrawalService.createWithdrawalRequest(
      pool,
      userId,
      {
        amount_cents: withdrawalAmount,
        method: 'standard',
        idempotency_key: `test-failed-payout-${crypto.randomUUID()}`
      },
      'sandbox'
    );

    if (!createResult.success) {
      console.error('createWithdrawalRequest failed:', createResult);
    }
    expect(createResult.success).toBe(true);
    const withdrawalId = createResult.withdrawal.id;

    // 4. Process withdrawal (moves to PROCESSING)
    const processResult = await withdrawalService.processWithdrawal(
      pool,
      withdrawalId,
      { bankAccountId: null }
    );

    expect(processResult.success).toBe(true);
    expect(processResult.withdrawal.status).toBe('PROCESSING');

    // 5. Update wallet_withdrawals to simulate Stripe transfer attempt
    const stripePayoutId = `tr_test_failed_${crypto.randomUUID()}`;
    await pool.query(
      'UPDATE wallet_withdrawals SET stripe_payout_id = $1 WHERE id = $2',
      [stripePayoutId, withdrawalId]
    );

    // 6. Simulate failed payout webhook
    const failResult = await withdrawalService.handlePayoutFailed(
      pool,
      { id: stripePayoutId, failure_reason: 'Insufficient funds', failure_code: 'insufficient_funds' }
    );

    expect(failResult.updated).toBe(true);

    // 7. Query ledger for WALLET_WITHDRAWAL DEBIT entries
    const result = await pool.query(
      `SELECT COUNT(*)::int as count
       FROM ledger
       WHERE user_id = $1
       AND entry_type = 'WALLET_WITHDRAWAL'
       AND direction = 'DEBIT'`,
      [userId]
    );

    // 8. Assert: Failed payout should have created ZERO debits
    // CURRENT BUG: processWithdrawal() writes debit before Stripe call
    // So this test will FAIL right now (finds 1, expects 0)
    // After fix, it will PASS
    expect(result.rows[0].count).toBe(0);
  });

  test('successful payout writes exactly one WALLET_WITHDRAWAL ledger debit', async () => {
    // Each test gets a unique user ID
    const userId = crypto.randomUUID();
    const withdrawalAmount = 25000;
    const initialBalance = 100000;

    // 1. Create user
    await pool.query(
      'INSERT INTO users (id, created_at) VALUES ($1, NOW()) ON CONFLICT (id) DO NOTHING',
      [userId]
    );

    // 2. Create wallet deposit ledger entry
    await pool.query(
      `INSERT INTO ledger (
         user_id, entry_type, direction, amount_cents, reference_type, reference_id, idempotency_key, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [userId, 'WALLET_DEPOSIT', 'CREDIT', initialBalance, 'WALLET', userId, `deposit_${userId}`]
    );

    // 3. Create withdrawal request
    const createResult = await withdrawalService.createWithdrawalRequest(
      pool,
      userId,
      {
        amount_cents: withdrawalAmount,
        method: 'standard',
        idempotency_key: `test-success-payout-${crypto.randomUUID()}`
      },
      'sandbox'
    );

    expect(createResult.success).toBe(true);
    const withdrawalId = createResult.withdrawal.id;

    // 4. Process withdrawal (moves to PROCESSING)
    const processResult = await withdrawalService.processWithdrawal(
      pool,
      withdrawalId,
      { bankAccountId: null }
    );

    expect(processResult.success).toBe(true);

    // 5. Verify NO ledger debit yet
    let debitCount = await pool.query(
      `SELECT COUNT(*)::int as count
       FROM ledger
       WHERE user_id = $1 AND entry_type = 'WALLET_WITHDRAWAL' AND direction = 'DEBIT'`,
      [userId]
    );
    expect(debitCount.rows[0].count).toBe(0);

    // 6. Simulate Stripe transfer attempt with stripe_payout_id
    const stripePayoutId = `tr_success_${crypto.randomUUID()}`;
    await pool.query(
      'UPDATE wallet_withdrawals SET stripe_payout_id = $1 WHERE id = $2',
      [stripePayoutId, withdrawalId]
    );

    // 7. Simulate successful payout webhook
    const successResult = await withdrawalService.handlePayoutPaid(
      pool,
      { id: stripePayoutId }
    );

    expect(successResult.updated).toBe(true);
    expect(successResult.withdrawal_id).toBe(withdrawalId);

    // 8. Query ledger for WALLET_WITHDRAWAL DEBIT entries
    debitCount = await pool.query(
      `SELECT COUNT(*)::int as count
       FROM ledger
       WHERE user_id = $1 AND entry_type = 'WALLET_WITHDRAWAL' AND direction = 'DEBIT'`,
      [userId]
    );

    // 9. Assert: Successful payout should have created EXACTLY ONE debit
    expect(debitCount.rows[0].count).toBe(1);

    // 10. Verify debit amount is correct
    const debitDetails = await pool.query(
      `SELECT amount_cents FROM ledger
       WHERE user_id = $1 AND entry_type = 'WALLET_WITHDRAWAL' AND direction = 'DEBIT'`,
      [userId]
    );
    expect(debitDetails.rows[0].amount_cents).toBe(withdrawalAmount);
  });

  test('webhook retry is idempotent (no duplicate ledger debits)', async () => {
    // Each test gets a unique user ID
    const userId = crypto.randomUUID();
    const withdrawalAmount = 20000;
    const initialBalance = 100000;

    // 1. Create user
    await pool.query(
      'INSERT INTO users (id, created_at) VALUES ($1, NOW()) ON CONFLICT (id) DO NOTHING',
      [userId]
    );

    // 2. Create wallet deposit ledger entry
    await pool.query(
      `INSERT INTO ledger (
         user_id, entry_type, direction, amount_cents, reference_type, reference_id, idempotency_key, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [userId, 'WALLET_DEPOSIT', 'CREDIT', initialBalance, 'WALLET', userId, `deposit_${userId}`]
    );

    // 3. Create withdrawal request
    const createResult = await withdrawalService.createWithdrawalRequest(
      pool,
      userId,
      {
        amount_cents: withdrawalAmount,
        method: 'standard',
        idempotency_key: `test-idempotent-webhook-${crypto.randomUUID()}`
      },
      'sandbox'
    );

    expect(createResult.success).toBe(true);
    const withdrawalId = createResult.withdrawal.id;

    // 4. Process withdrawal
    const processResult = await withdrawalService.processWithdrawal(
      pool,
      withdrawalId,
      { bankAccountId: null }
    );

    expect(processResult.success).toBe(true);

    // 5. Set stripe payout ID
    const stripePayoutId = `tr_idempotent_${crypto.randomUUID()}`;
    await pool.query(
      'UPDATE wallet_withdrawals SET stripe_payout_id = $1 WHERE id = $2',
      [stripePayoutId, withdrawalId]
    );

    // 6. First webhook call - handlePayoutPaid
    const firstResult = await withdrawalService.handlePayoutPaid(
      pool,
      { id: stripePayoutId }
    );

    expect(firstResult.updated).toBe(true);

    // 7. Check debit count after first webhook
    let debitCount = await pool.query(
      `SELECT COUNT(*)::int as count
       FROM ledger
       WHERE user_id = $1 AND entry_type = 'WALLET_WITHDRAWAL' AND direction = 'DEBIT'`,
      [userId]
    );
    expect(debitCount.rows[0].count).toBe(1);

    // 8. Second webhook call (simulating Stripe webhook retry) - should be idempotent
    const secondResult = await withdrawalService.handlePayoutPaid(
      pool,
      { id: stripePayoutId }
    );

    // Second call should fail because withdrawal is already PAID (not PROCESSING)
    expect(secondResult.updated).toBe(false);

    // 9. Check debit count after second webhook - should still be 1
    debitCount = await pool.query(
      `SELECT COUNT(*)::int as count
       FROM ledger
       WHERE user_id = $1 AND entry_type = 'WALLET_WITHDRAWAL' AND direction = 'DEBIT'`,
      [userId]
    );
    expect(debitCount.rows[0].count).toBe(1);

    // 10. Third webhook call (another retry) - idempotency maintained
    const thirdResult = await withdrawalService.handlePayoutPaid(
      pool,
      { id: stripePayoutId }
    );

    expect(thirdResult.updated).toBe(false);

    // 11. Final debit count should still be 1
    debitCount = await pool.query(
      `SELECT COUNT(*)::int as count
       FROM ledger
       WHERE user_id = $1 AND entry_type = 'WALLET_WITHDRAWAL' AND direction = 'DEBIT'`,
      [userId]
    );
    expect(debitCount.rows[0].count).toBe(1);
  });

  test('wallet balance updates only after payout success', async () => {
    // Each test gets a unique user ID
    const userId = crypto.randomUUID();
    const withdrawalAmount = 15000;
    const initialBalance = 100000;

    // 1. Create user
    await pool.query(
      'INSERT INTO users (id, created_at) VALUES ($1, NOW()) ON CONFLICT (id) DO NOTHING',
      [userId]
    );

    // 2. Create wallet deposit ledger entry
    await pool.query(
      `INSERT INTO ledger (
         user_id, entry_type, direction, amount_cents, reference_type, reference_id, idempotency_key, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [userId, 'WALLET_DEPOSIT', 'CREDIT', initialBalance, 'WALLET', userId, `deposit_${userId}`]
    );

    // 3. Verify initial balance
    let balanceResult = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents WHEN direction = 'DEBIT' THEN -amount_cents END), 0)::int as balance
       FROM ledger WHERE user_id = $1`,
      [userId]
    );
    expect(balanceResult.rows[0].balance).toBe(initialBalance);

    // 4. Create withdrawal request
    const createResult = await withdrawalService.createWithdrawalRequest(
      pool,
      userId,
      {
        amount_cents: withdrawalAmount,
        method: 'standard',
        idempotency_key: `test-balance-update-${crypto.randomUUID()}`
      },
      'sandbox'
    );

    expect(createResult.success).toBe(true);
    const withdrawalId = createResult.withdrawal.id;

    // 5. After create: balance should still be initial (funds frozen but not debited)
    balanceResult = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents WHEN direction = 'DEBIT' THEN -amount_cents END), 0)::int as balance
       FROM ledger WHERE user_id = $1`,
      [userId]
    );
    expect(balanceResult.rows[0].balance).toBe(initialBalance);

    // 6. Process withdrawal
    const processResult = await withdrawalService.processWithdrawal(
      pool,
      withdrawalId,
      { bankAccountId: null }
    );

    expect(processResult.success).toBe(true);

    // 7. After process: balance should still be initial (no ledger debit yet)
    balanceResult = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents WHEN direction = 'DEBIT' THEN -amount_cents END), 0)::int as balance
       FROM ledger WHERE user_id = $1`,
      [userId]
    );
    expect(balanceResult.rows[0].balance).toBe(initialBalance);

    // 8. Set stripe payout ID
    const stripePayoutId = `tr_balance_${crypto.randomUUID()}`;
    await pool.query(
      'UPDATE wallet_withdrawals SET stripe_payout_id = $1 WHERE id = $2',
      [stripePayoutId, withdrawalId]
    );

    // 9. Before webhook: balance should still be initial
    balanceResult = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents WHEN direction = 'DEBIT' THEN -amount_cents END), 0)::int as balance
       FROM ledger WHERE user_id = $1`,
      [userId]
    );
    expect(balanceResult.rows[0].balance).toBe(initialBalance);

    // 10. Successful payout webhook
    const successResult = await withdrawalService.handlePayoutPaid(
      pool,
      { id: stripePayoutId }
    );

    expect(successResult.updated).toBe(true);

    // 11. After successful payout: balance should decrease
    balanceResult = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents WHEN direction = 'DEBIT' THEN -amount_cents END), 0)::int as balance
       FROM ledger WHERE user_id = $1`,
      [userId]
    );
    expect(balanceResult.rows[0].balance).toBe(initialBalance - withdrawalAmount);
  });
});
