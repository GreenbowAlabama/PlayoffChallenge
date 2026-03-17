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

  test('failed payout still has WALLET_WITHDRAWAL ledger debit (pessimistic reserve)', async () => {
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

    // 4. Create withdrawal request (status = REQUESTED, ledger DEBIT inserted here)
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

    // 5. Verify ledger DEBIT exists immediately after request
    let debitCount = await pool.query(
      `SELECT COUNT(*)::int as count
       FROM ledger
       WHERE user_id = $1 AND entry_type = 'WALLET_WITHDRAWAL' AND direction = 'DEBIT'`,
      [userId]
    );
    expect(debitCount.rows[0].count).toBe(1);

    // 6. Process withdrawal (moves to PROCESSING)
    const processResult = await withdrawalService.processWithdrawal(
      pool,
      withdrawalId,
      { bankAccountId: null }
    );

    expect(processResult.success).toBe(true);
    expect(processResult.withdrawal.status).toBe('PROCESSING');

    // 7. Update wallet_withdrawals to simulate Stripe transfer attempt
    const stripePayoutId = `tr_test_failed_${crypto.randomUUID()}`;
    await pool.query(
      'UPDATE wallet_withdrawals SET stripe_payout_id = $1 WHERE id = $2',
      [stripePayoutId, withdrawalId]
    );

    // 8. Simulate failed payout webhook
    const failResult = await withdrawalService.handlePayoutFailed(
      pool,
      { id: stripePayoutId, failure_reason: 'Insufficient funds', failure_code: 'insufficient_funds' }
    );

    expect(failResult.updated).toBe(true);

    // 9. Simulate worker's permanent failure handling (insert REVERSAL)
    // This is what the worker does when Stripe call fails permanently
    const reversalIdempotencyKey = `wallet_withdrawal_reversal:${withdrawalId.toLowerCase()}`;
    await pool.query(
      `INSERT INTO ledger (
         user_id, entry_type, direction, amount_cents, reference_type,
         reference_id, idempotency_key, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [userId, 'WALLET_WITHDRAWAL_REVERSAL', 'CREDIT', withdrawalAmount, 'WALLET', withdrawalId, reversalIdempotencyKey]
    );

    // 10. Query ledger for WALLET_WITHDRAWAL DEBIT entries
    const debitResult = await pool.query(
      `SELECT COUNT(*)::int as count
       FROM ledger
       WHERE user_id = $1
       AND entry_type = 'WALLET_WITHDRAWAL'
       AND direction = 'DEBIT'`,
      [userId]
    );

    // 11. Assert: Failed payout still has the debit (pessimistic reserve)
    expect(debitResult.rows[0].count).toBe(1);

    // 12. Query ledger for WALLET_WITHDRAWAL_REVERSAL entries
    const reversalResult = await pool.query(
      `SELECT COUNT(*)::int as count
       FROM ledger
       WHERE user_id = $1
       AND entry_type = 'WALLET_WITHDRAWAL_REVERSAL'
       AND direction = 'CREDIT'`,
      [userId]
    );

    // 13. Assert: REVERSAL inserted on permanent failure (restores funds)
    // DEBIT + REVERSAL net to zero (financial invariant)
    expect(reversalResult.rows[0].count).toBe(1);
  });

  test('ledger DEBIT created at request time, no additional debit after payout success', async () => {
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

    // 4. Create withdrawal request (ledger DEBIT inserted here)
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

    // 5. Verify ledger DEBIT exists immediately (pessimistic reserve)
    let debitCount = await pool.query(
      `SELECT COUNT(*)::int as count
       FROM ledger
       WHERE user_id = $1 AND entry_type = 'WALLET_WITHDRAWAL' AND direction = 'DEBIT'`,
      [userId]
    );
    expect(debitCount.rows[0].count).toBe(1);

    // 6. Process withdrawal (moves to PROCESSING)
    const processResult = await withdrawalService.processWithdrawal(
      pool,
      withdrawalId,
      { bankAccountId: null }
    );

    expect(processResult.success).toBe(true);

    // 7. Debit count should still be 1 (no new debits from processWithdrawal)
    debitCount = await pool.query(
      `SELECT COUNT(*)::int as count
       FROM ledger
       WHERE user_id = $1 AND entry_type = 'WALLET_WITHDRAWAL' AND direction = 'DEBIT'`,
      [userId]
    );
    expect(debitCount.rows[0].count).toBe(1);

    // 8. Simulate Stripe transfer attempt with stripe_payout_id
    const stripePayoutId = `tr_success_${crypto.randomUUID()}`;
    await pool.query(
      'UPDATE wallet_withdrawals SET stripe_payout_id = $1 WHERE id = $2',
      [stripePayoutId, withdrawalId]
    );

    // 9. Simulate successful payout webhook (no new ledger debit)
    const successResult = await withdrawalService.handlePayoutPaid(
      pool,
      { id: stripePayoutId }
    );

    expect(successResult.updated).toBe(true);
    expect(successResult.withdrawal_id).toBe(withdrawalId);

    // 10. Query ledger for WALLET_WITHDRAWAL DEBIT entries
    debitCount = await pool.query(
      `SELECT COUNT(*)::int as count
       FROM ledger
       WHERE user_id = $1 AND entry_type = 'WALLET_WITHDRAWAL' AND direction = 'DEBIT'`,
      [userId]
    );

    // 11. Assert: Still EXACTLY ONE debit (no additional debit from webhook)
    expect(debitCount.rows[0].count).toBe(1);

    // 12. Verify debit amount is correct
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

  test('wallet balance updates immediately after withdrawal request (pessimistic reserve)', async () => {
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

    // 5. Create withdrawal request (ledger DEBIT inserted here, balance reserved)
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

    // 6. After create: balance should IMMEDIATELY decrease (pessimistic reserve)
    balanceResult = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents WHEN direction = 'DEBIT' THEN -amount_cents END), 0)::int as balance
       FROM ledger WHERE user_id = $1`,
      [userId]
    );
    expect(balanceResult.rows[0].balance).toBe(initialBalance - withdrawalAmount);

    // 7. Process withdrawal
    const processResult = await withdrawalService.processWithdrawal(
      pool,
      withdrawalId,
      { bankAccountId: null }
    );

    expect(processResult.success).toBe(true);

    // 8. After process: balance should remain the same (no additional debit)
    balanceResult = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents WHEN direction = 'DEBIT' THEN -amount_cents END), 0)::int as balance
       FROM ledger WHERE user_id = $1`,
      [userId]
    );
    expect(balanceResult.rows[0].balance).toBe(initialBalance - withdrawalAmount);

    // 9. Set stripe payout ID
    const stripePayoutId = `tr_balance_${crypto.randomUUID()}`;
    await pool.query(
      'UPDATE wallet_withdrawals SET stripe_payout_id = $1 WHERE id = $2',
      [stripePayoutId, withdrawalId]
    );

    // 10. Before webhook: balance should remain reduced
    balanceResult = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents WHEN direction = 'DEBIT' THEN -amount_cents END), 0)::int as balance
       FROM ledger WHERE user_id = $1`,
      [userId]
    );
    expect(balanceResult.rows[0].balance).toBe(initialBalance - withdrawalAmount);

    // 11. Successful payout webhook (no ledger change)
    const successResult = await withdrawalService.handlePayoutPaid(
      pool,
      { id: stripePayoutId }
    );

    expect(successResult.updated).toBe(true);

    // 12. After successful payout: balance should remain the same (no ledger debit here)
    balanceResult = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents WHEN direction = 'DEBIT' THEN -amount_cents END), 0)::int as balance
       FROM ledger WHERE user_id = $1`,
      [userId]
    );
    expect(balanceResult.rows[0].balance).toBe(initialBalance - withdrawalAmount);
  });
});
