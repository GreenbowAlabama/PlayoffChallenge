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

    // 2. Ensure withdrawal config exists for sandbox
    await pool.query(
      `INSERT INTO withdrawal_config (
         environment, min_withdrawal_cents, max_withdrawal_cents, instant_enabled, instant_fee_percent, cooldown_seconds
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (environment) DO NOTHING`,
      ['sandbox', 500, null, true, 0, 0]
    );

    // 3. Create wallet deposit ledger entry
    await pool.query(
      `INSERT INTO ledger (
         user_id, entry_type, direction, amount_cents, reference_type, reference_id, idempotency_key, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [userId, 'WALLET_DEPOSIT', 'CREDIT', initialBalance, 'WALLET', userId, `deposit_${userId}`]
    );

    // 4. Create withdrawal request (status = REQUESTED)
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

    // 5. Process withdrawal (moves to PROCESSING)
    const processResult = await withdrawalService.processWithdrawal(
      pool,
      withdrawalId,
      { bankAccountId: null }
    );

    expect(processResult.success).toBe(true);
    expect(processResult.withdrawal.status).toBe('PROCESSING');

    // 6. Update wallet_withdrawals to simulate Stripe transfer attempt
    const stripePayoutId = `tr_test_failed_${crypto.randomUUID()}`;
    await pool.query(
      'UPDATE wallet_withdrawals SET stripe_payout_id = $1 WHERE id = $2',
      [stripePayoutId, withdrawalId]
    );

    // 7. Simulate failed payout webhook
    const failResult = await withdrawalService.handlePayoutFailed(
      pool,
      { id: stripePayoutId, failure_reason: 'Insufficient funds', failure_code: 'insufficient_funds' }
    );

    expect(failResult.updated).toBe(true);

    // 8. Query ledger for WALLET_WITHDRAWAL DEBIT entries
    const result = await pool.query(
      `SELECT COUNT(*)::int as count
       FROM ledger
       WHERE user_id = $1
       AND entry_type = 'WALLET_WITHDRAWAL'
       AND direction = 'DEBIT'`,
      [userId]
    );

    // 9. Assert: Failed payout should have created ZERO debits
    // Ledger debit only written in handlePayoutPaid() on successful payout
    // Failed payouts do not create ledger entries
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

    // 2. Ensure withdrawal config exists for sandbox
    await pool.query(
      `INSERT INTO withdrawal_config (
         environment, min_withdrawal_cents, max_withdrawal_cents, instant_enabled, instant_fee_percent, cooldown_seconds
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (environment) DO NOTHING`,
      ['sandbox', 500, null, true, 0, 0]
    );

    // 3. Create wallet deposit ledger entry
    await pool.query(
      `INSERT INTO ledger (
         user_id, entry_type, direction, amount_cents, reference_type, reference_id, idempotency_key, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [userId, 'WALLET_DEPOSIT', 'CREDIT', initialBalance, 'WALLET', userId, `deposit_${userId}`]
    );

    // 4. Create withdrawal request
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

    // 5. Process withdrawal (moves to PROCESSING)
    const processResult = await withdrawalService.processWithdrawal(
      pool,
      withdrawalId,
      { bankAccountId: null }
    );

    expect(processResult.success).toBe(true);

    // 6. Verify NO ledger debit yet (debit only on successful payout)
    let debitCount = await pool.query(
      `SELECT COUNT(*)::int as count
       FROM ledger
       WHERE user_id = $1 AND entry_type = 'WALLET_WITHDRAWAL' AND direction = 'DEBIT'`,
      [userId]
    );
    expect(debitCount.rows[0].count).toBe(0);

    // 7. Simulate Stripe transfer attempt with stripe_payout_id
    const stripePayoutId = `tr_success_${crypto.randomUUID()}`;
    await pool.query(
      'UPDATE wallet_withdrawals SET stripe_payout_id = $1 WHERE id = $2',
      [stripePayoutId, withdrawalId]
    );

    // 8. Simulate successful payout webhook (this writes the ledger debit)
    const successResult = await withdrawalService.handlePayoutPaid(
      pool,
      { id: stripePayoutId }
    );

    expect(successResult.updated).toBe(true);
    expect(successResult.withdrawal_id).toBe(withdrawalId);

    // 9. Query ledger for WALLET_WITHDRAWAL DEBIT entries
    debitCount = await pool.query(
      `SELECT COUNT(*)::int as count
       FROM ledger
       WHERE user_id = $1 AND entry_type = 'WALLET_WITHDRAWAL' AND direction = 'DEBIT'`,
      [userId]
    );

    // 10. Assert: Successful payout should have created EXACTLY ONE debit
    expect(debitCount.rows[0].count).toBe(1);

    // 11. Verify debit amount is correct
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

    // 2. Ensure withdrawal config exists for sandbox
    await pool.query(
      `INSERT INTO withdrawal_config (
         environment, min_withdrawal_cents, max_withdrawal_cents, instant_enabled, instant_fee_percent, cooldown_seconds
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (environment) DO NOTHING`,
      ['sandbox', 500, null, true, 0, 0]
    );

    // 3. Create wallet deposit ledger entry
    await pool.query(
      `INSERT INTO ledger (
         user_id, entry_type, direction, amount_cents, reference_type, reference_id, idempotency_key, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [userId, 'WALLET_DEPOSIT', 'CREDIT', initialBalance, 'WALLET', userId, `deposit_${userId}`]
    );

    // 4. Create withdrawal request
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

    // 5. Process withdrawal
    const processResult = await withdrawalService.processWithdrawal(
      pool,
      withdrawalId,
      { bankAccountId: null }
    );

    expect(processResult.success).toBe(true);

    // 6. Set stripe payout ID
    const stripePayoutId = `tr_idempotent_${crypto.randomUUID()}`;
    await pool.query(
      'UPDATE wallet_withdrawals SET stripe_payout_id = $1 WHERE id = $2',
      [stripePayoutId, withdrawalId]
    );

    // 7. First webhook call - handlePayoutPaid
    const firstResult = await withdrawalService.handlePayoutPaid(
      pool,
      { id: stripePayoutId }
    );

    expect(firstResult.updated).toBe(true);

    // 8. Check debit count after first webhook
    let debitCount = await pool.query(
      `SELECT COUNT(*)::int as count
       FROM ledger
       WHERE user_id = $1 AND entry_type = 'WALLET_WITHDRAWAL' AND direction = 'DEBIT'`,
      [userId]
    );
    expect(debitCount.rows[0].count).toBe(1);

    // 9. Second webhook call (simulating Stripe webhook retry) - should be idempotent
    const secondResult = await withdrawalService.handlePayoutPaid(
      pool,
      { id: stripePayoutId }
    );

    // Second call should fail because withdrawal is already PAID (not PROCESSING)
    expect(secondResult.updated).toBe(false);

    // 10. Check debit count after second webhook - should still be 1 (idempotent)
    debitCount = await pool.query(
      `SELECT COUNT(*)::int as count
       FROM ledger
       WHERE user_id = $1 AND entry_type = 'WALLET_WITHDRAWAL' AND direction = 'DEBIT'`,
      [userId]
    );
    expect(debitCount.rows[0].count).toBe(1);

    // 11. Third webhook call (another retry) - idempotency maintained
    const thirdResult = await withdrawalService.handlePayoutPaid(
      pool,
      { id: stripePayoutId }
    );

    expect(thirdResult.updated).toBe(false);

    // 12. Final debit count should still be 1
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

    // 2. Ensure withdrawal config exists for sandbox
    await pool.query(
      `INSERT INTO withdrawal_config (
         environment, min_withdrawal_cents, max_withdrawal_cents, instant_enabled, instant_fee_percent, cooldown_seconds
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (environment) DO NOTHING`,
      ['sandbox', 500, null, true, 0, 0]
    );

    // 3. Create wallet deposit ledger entry
    await pool.query(
      `INSERT INTO ledger (
         user_id, entry_type, direction, amount_cents, reference_type, reference_id, idempotency_key, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [userId, 'WALLET_DEPOSIT', 'CREDIT', initialBalance, 'WALLET', userId, `deposit_${userId}`]
    );

    // 4. Verify initial balance
    let balanceResult = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents WHEN direction = 'DEBIT' THEN -amount_cents END), 0)::int as balance
       FROM ledger WHERE user_id = $1`,
      [userId]
    );
    expect(balanceResult.rows[0].balance).toBe(initialBalance);

    // 5. Create withdrawal request
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

    // 6. After create: balance should still be initial (funds frozen but not debited)
    balanceResult = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents WHEN direction = 'DEBIT' THEN -amount_cents END), 0)::int as balance
       FROM ledger WHERE user_id = $1`,
      [userId]
    );
    expect(balanceResult.rows[0].balance).toBe(initialBalance);

    // 7. Process withdrawal
    const processResult = await withdrawalService.processWithdrawal(
      pool,
      withdrawalId,
      { bankAccountId: null }
    );

    expect(processResult.success).toBe(true);

    // 8. After process: balance should still be initial (no ledger debit yet)
    balanceResult = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents WHEN direction = 'DEBIT' THEN -amount_cents END), 0)::int as balance
       FROM ledger WHERE user_id = $1`,
      [userId]
    );
    expect(balanceResult.rows[0].balance).toBe(initialBalance);

    // 9. Set stripe payout ID
    const stripePayoutId = `tr_balance_${crypto.randomUUID()}`;
    await pool.query(
      'UPDATE wallet_withdrawals SET stripe_payout_id = $1 WHERE id = $2',
      [stripePayoutId, withdrawalId]
    );

    // 10. Before webhook: balance should still be initial
    balanceResult = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents WHEN direction = 'DEBIT' THEN -amount_cents END), 0)::int as balance
       FROM ledger WHERE user_id = $1`,
      [userId]
    );
    expect(balanceResult.rows[0].balance).toBe(initialBalance);

    // 11. Successful payout webhook (ledger debit written here)
    const successResult = await withdrawalService.handlePayoutPaid(
      pool,
      { id: stripePayoutId }
    );

    expect(successResult.updated).toBe(true);

    // 12. After successful payout: balance should decrease by withdrawal amount
    balanceResult = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents WHEN direction = 'DEBIT' THEN -amount_cents END), 0)::int as balance
       FROM ledger WHERE user_id = $1`,
      [userId]
    );
    expect(balanceResult.rows[0].balance).toBe(initialBalance - withdrawalAmount);
  });
});
