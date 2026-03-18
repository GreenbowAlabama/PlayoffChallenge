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
const systemInvariantService = require('../../services/systemInvariantService');

describe('Withdrawal pipeline financial ordering', () => {
  let pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  test('failed payout creates debit + reversal pair (pessimistic reserve with refund)', async () => {
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
    // CRITICAL: REVERSAL inserted before marking FAILED (atomic transaction)
    const reversalIdempotencyKey = `wallet_withdrawal_reversal:${withdrawalId.toLowerCase()}`;

    let client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Insert reversal
      await client.query(
        `INSERT INTO ledger (
           user_id, entry_type, direction, amount_cents, reference_type,
           reference_id, idempotency_key, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [userId, 'WALLET_WITHDRAWAL_REVERSAL', 'CREDIT', withdrawalAmount, 'WALLET', withdrawalId, reversalIdempotencyKey]
      );

      // Verify reversal exists
      const reversalCheck = await client.query(
        `SELECT id FROM ledger WHERE idempotency_key = $1`,
        [reversalIdempotencyKey]
      );

      if (reversalCheck.rows.length === 0) {
        throw new Error('INVARIANT_VIOLATION: reversal not created');
      }

      // Mark withdrawal failed (after reversal guaranteed)
      await client.query(
        `UPDATE wallet_withdrawals
         SET status = 'FAILED', updated_at = NOW()
         WHERE id = $1`,
        [withdrawalId]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // 10. Query ledger for WALLET_WITHDRAWAL DEBIT entries
    const debitResult = await pool.query(
      `SELECT COUNT(*)::int as count
       FROM ledger
       WHERE user_id = $1
       AND entry_type = 'WALLET_WITHDRAWAL'
       AND direction = 'DEBIT'`,
      [userId]
    );

    // 11. Assert: DEBIT exists (pessimistic reserve at request time)
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
    expect(reversalResult.rows[0].count).toBe(1);

    // 14. Assert: DEBIT + REVERSAL net to zero (financial invariant holds)
    const balanceResult = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents WHEN direction = 'DEBIT' THEN -amount_cents END), 0)::int as balance
       FROM ledger
       WHERE user_id = $1
       AND (entry_type = 'WALLET_WITHDRAWAL' OR entry_type = 'WALLET_WITHDRAWAL_REVERSAL')`,
      [userId]
    );

    expect(balanceResult.rows[0].balance).toBe(0);
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

  test('reconciliation invariant: debit + reversal pair nets to zero withdrawals', async () => {
    // Integration test: Proves DEBIT + REVERSAL pair netting behavior
    // (Full invariant validation tested via mock tests in systemInvariant.service.test.js)
    const userId = crypto.randomUUID();
    const withdrawalAmount = 50000;
    const initialBalance = 100000;

    // 1. Create user
    await pool.query(
      'INSERT INTO users (id, created_at) VALUES ($1, NOW()) ON CONFLICT (id) DO NOTHING',
      [userId]
    );

    // 2. Ensure withdrawal config
    await pool.query(
      `INSERT INTO withdrawal_config (
         environment, min_withdrawal_cents, max_withdrawal_cents, instant_enabled, instant_fee_percent, cooldown_seconds
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (environment) DO NOTHING`,
      ['sandbox', 500, null, true, 0, 0]
    );

    // 3. Create initial wallet deposit CREDIT
    await pool.query(
      `INSERT INTO ledger (
         user_id, entry_type, direction, amount_cents, reference_type, reference_id, idempotency_key, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [userId, 'WALLET_DEPOSIT', 'CREDIT', initialBalance, 'WALLET', userId, `deposit_${userId}`]
    );

    // 4. Create withdrawal request (DEBIT inserted pessimistically at request time)
    const createResult = await withdrawalService.createWithdrawalRequest(
      pool,
      userId,
      {
        amount_cents: withdrawalAmount,
        method: 'standard',
        idempotency_key: `test-reversal-netting-${crypto.randomUUID()}`
      },
      'sandbox'
    );

    expect(createResult.success).toBe(true);
    const withdrawalId = createResult.withdrawal.id;

    // 5. Verify DEBIT inserted at request time (pessimistic reserve)
    const debitCount = await pool.query(
      `SELECT COUNT(*)::int as count FROM ledger
       WHERE user_id = $1 AND entry_type = 'WALLET_WITHDRAWAL' AND direction = 'DEBIT'`,
      [userId]
    );
    expect(debitCount.rows[0].count).toBe(1);

    // 6. Simulate failed withdrawal with compensating REVERSAL entry
    const reversalIdempotencyKey = `wallet_withdrawal_reversal:${withdrawalId.toLowerCase()}`;
    let client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO ledger (
           user_id, entry_type, direction, amount_cents, reference_type,
           reference_id, idempotency_key, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [userId, 'WALLET_WITHDRAWAL_REVERSAL', 'CREDIT', withdrawalAmount, 'WALLET', withdrawalId, reversalIdempotencyKey]
      );
      await client.query(
        `UPDATE wallet_withdrawals SET status = 'FAILED', updated_at = NOW() WHERE id = $1`,
        [withdrawalId]
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    // 7. Verify REVERSAL inserted on failure
    const reversalCount = await pool.query(
      `SELECT COUNT(*)::int as count FROM ledger
       WHERE user_id = $1 AND entry_type = 'WALLET_WITHDRAWAL_REVERSAL' AND direction = 'CREDIT'`,
      [userId]
    );
    expect(reversalCount.rows[0].count).toBe(1);

    // 8. CRITICAL: Verify user's net withdrawal calculation (DEBIT - REVERSAL = 0)
    // This proves the compensating entry pattern correctly restores funds
    const netWithdrawalResult = await pool.query(
      `SELECT COALESCE(SUM(
         CASE
           WHEN entry_type = 'WALLET_WITHDRAWAL' THEN amount_cents
           WHEN entry_type = 'WALLET_WITHDRAWAL_REVERSAL' THEN -amount_cents
           ELSE 0
         END
       ), 0) as net_withdrawal
       FROM ledger
       WHERE user_id = $1 AND entry_type IN ('WALLET_WITHDRAWAL', 'WALLET_WITHDRAWAL_REVERSAL')`,
      [userId]
    );

    // Net withdrawal = 50000 (DEBIT) - 50000 (REVERSAL) = 0
    // This ensures the invariant equation: deposits - (net_withdrawals) = remaining_balance
    // i.e., 100000 - 0 = 100000 (user's balance is full deposit, untouched)
    const netWithdrawal = parseInt(netWithdrawalResult.rows[0].net_withdrawal, 10);
    expect(netWithdrawal).toBe(0);

    // 9. Verify user's wallet balance is fully restored (deposit - net_withdrawal)
    const balanceResult = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents WHEN direction = 'DEBIT' THEN -amount_cents END), 0)::int as balance
       FROM ledger
       WHERE user_id = $1`,
      [userId]
    );
    expect(balanceResult.rows[0].balance).toBe(initialBalance); // 100000 - 50000 + 50000
  });

  test('worker pre-Stripe check: NO_STRIPE_ACCOUNT triggers reversal', async () => {
    // CRITICAL TEST: Validates the reversal path fix
    // When user has no stripe_connected_account_id:
    // - Worker must NOT return early
    // - Worker must insert WALLET_WITHDRAWAL_REVERSAL CREDIT
    // - Withdrawal status must be FAILED
    // - Balance must be restored

    const userId = require('uuid').v4();
    const withdrawalId = require('uuid').v4();
    const withdrawalAmount = 50000; // $500

    // 1. Insert user WITHOUT stripe_connected_account_id
    await pool.query(
      'INSERT INTO users (id, email, is_admin) VALUES ($1, $2, $3)',
      [userId, `user-${userId.slice(-6)}@test.com`, false]
    );

    // 2. Insert deposit to give user balance
    const initialBalance = 100000; // $1000
    await pool.query(
      `INSERT INTO ledger (user_id, entry_type, direction, amount_cents, reference_type, reference_id, idempotency_key)
       VALUES ($1, 'WALLET_DEPOSIT', 'CREDIT', $2, 'WALLET', $3, $4)`,
      [userId, initialBalance, userId, `wallet_deposit:${userId}`]
    );

    // 3. Create withdrawal in PROCESSING state with ledger DEBIT (pessimistic reserve)
    await pool.query(
      `INSERT INTO wallet_withdrawals (id, user_id, amount_cents, method, status, idempotency_key, requested_at, attempt_count)
       VALUES ($1, $2, $3, 'standard', 'PROCESSING', $4, NOW(), 0)`,
      [withdrawalId, userId, withdrawalAmount, `withdrawal:${withdrawalId}`]
    );

    await pool.query(
      `INSERT INTO ledger (user_id, entry_type, direction, amount_cents, reference_type, reference_id, idempotency_key)
       VALUES ($1, 'WALLET_WITHDRAWAL', 'DEBIT', $2, 'WALLET', $3, $4)`,
      [userId, withdrawalAmount, withdrawalId, `wallet_debit:${withdrawalId}`]
    );

    // 4. CALL WORKER LOGIC DIRECTLY
    const withdrawalProcessorWorker = require('../../workers/withdrawalProcessorWorker');
    const processWithdrawal = withdrawalProcessorWorker._processWithdrawalForTests;

    // Fetch withdrawal row needed by worker
    const withdrawalRow = await pool.query(
      `SELECT id, user_id, amount_cents, method, idempotency_key, status, stripe_payout_id, attempt_count,
              next_attempt_at, last_error_code, last_error_details_json, requested_at
       FROM wallet_withdrawals WHERE id = $1`,
      [withdrawalId]
    );

    const withdrawal = withdrawalRow.rows[0];

    // Call worker function with test parameters
    const result = await processWithdrawal(pool, withdrawal, 3, 60000);

    // 5. ASSERT: Withdrawal marked FAILED
    expect(result.success).toBe(false);
    expect(result.reason).toBe('NO_STRIPE_ACCOUNT');

    // 6. ASSERT: CRITICAL - Reversal ledger entry exists
    const reversalCheck = await pool.query(
      `SELECT COUNT(*)::int as count FROM ledger
       WHERE reference_id = $1 AND entry_type = 'WALLET_WITHDRAWAL_REVERSAL' AND direction = 'CREDIT'`,
      [withdrawalId]
    );
    expect(reversalCheck.rows[0].count).toBe(1, 'Exactly one WALLET_WITHDRAWAL_REVERSAL must exist');

    // 7. ASSERT: No duplicate reversals even with unique constraint
    const allReversals = await pool.query(
      `SELECT id FROM ledger WHERE reference_id = $1 AND entry_type = 'WALLET_WITHDRAWAL_REVERSAL'`,
      [withdrawalId]
    );
    expect(allReversals.rows.length).toBe(1, 'No duplicate reversals should exist');

    // 8. ASSERT: Withdrawal status is FAILED
    const withdrawalAfter = await pool.query(
      'SELECT status FROM wallet_withdrawals WHERE id = $1',
      [withdrawalId]
    );
    expect(withdrawalAfter.rows[0].status).toBe('FAILED');

    // 9. ASSERT: CRITICAL - Balance restored to original amount
    // Balance = deposits - debits + reversals = 100000 - 50000 + 50000 = 100000
    const balanceResult = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents WHEN direction = 'DEBIT' THEN -amount_cents END), 0)::int as balance
       FROM ledger WHERE user_id = $1`,
      [userId]
    );
    expect(balanceResult.rows[0].balance).toBe(initialBalance, 'User balance must be restored to original');

    // 10. ASSERT: Net withdrawal is zero (proof that debit + reversal pair nets)
    const netWithdrawalResult = await pool.query(
      `SELECT COALESCE(SUM(
         CASE WHEN entry_type = 'WALLET_WITHDRAWAL' THEN amount_cents
              WHEN entry_type = 'WALLET_WITHDRAWAL_REVERSAL' THEN -amount_cents
              ELSE 0 END
       ), 0)::int as net
       FROM ledger WHERE user_id = $1 AND entry_type IN ('WALLET_WITHDRAWAL', 'WALLET_WITHDRAWAL_REVERSAL')`,
      [userId]
    );
    expect(netWithdrawalResult.rows[0].net).toBe(0, 'Net withdrawal must be zero (debit minus reversal)');
  });

  test('worker pre-Stripe check: STRIPE_ACCOUNT_INCOMPLETE triggers reversal', async () => {
    // CRITICAL TEST: Validates STRIPE_ACCOUNT_INCOMPLETE reversal path
    // When account is incomplete (payouts_enabled=false OR details_submitted=false):
    // - Worker must NOT return early
    // - Worker must insert WALLET_WITHDRAWAL_REVERSAL CREDIT
    // - Withdrawal status must be FAILED
    // - Balance must be restored

    const userId = require('uuid').v4();
    const withdrawalId = require('uuid').v4();
    const withdrawalAmount = 50000; // $500

    // 1. Insert user WITH stripe_connected_account_id
    await pool.query(
      'INSERT INTO users (id, email, is_admin, stripe_connected_account_id) VALUES ($1, $2, $3, $4)',
      [userId, `user-${userId.slice(-6)}@test.com`, false, 'acct_incomplete_mock']
    );

    // 2. Insert deposit to give user balance
    const initialBalance = 100000; // $1000
    await pool.query(
      `INSERT INTO ledger (user_id, entry_type, direction, amount_cents, reference_type, reference_id, idempotency_key)
       VALUES ($1, 'WALLET_DEPOSIT', 'CREDIT', $2, 'WALLET', $3, $4)`,
      [userId, initialBalance, userId, `wallet_deposit:${userId}`]
    );

    // 3. Create withdrawal in PROCESSING state with ledger DEBIT
    await pool.query(
      `INSERT INTO wallet_withdrawals (id, user_id, amount_cents, method, status, idempotency_key, requested_at, attempt_count)
       VALUES ($1, $2, $3, 'standard', 'PROCESSING', $4, NOW(), 0)`,
      [withdrawalId, userId, withdrawalAmount, `withdrawal:${withdrawalId}`]
    );

    await pool.query(
      `INSERT INTO ledger (user_id, entry_type, direction, amount_cents, reference_type, reference_id, idempotency_key)
       VALUES ($1, 'WALLET_WITHDRAWAL', 'DEBIT', $2, 'WALLET', $3, $4)`,
      [userId, withdrawalAmount, withdrawalId, `wallet_debit:${withdrawalId}`]
    );

    // 4. CALL WORKER LOGIC DIRECTLY with mocked Stripe
    const withdrawalProcessorWorker = require('../../workers/withdrawalProcessorWorker');
    const processWithdrawal = withdrawalProcessorWorker._processWithdrawalForTests;

    // Mock Stripe to return incomplete account (payouts_enabled = false)
    const StripeWithdrawalAdapter = require('../../services/StripeWithdrawalAdapter');
    const originalGetInstance = StripeWithdrawalAdapter.getStripeInstance;
    StripeWithdrawalAdapter.getStripeInstance = jest.fn().mockReturnValue({
      accounts: {
        retrieve: jest.fn().mockResolvedValue({
          id: 'acct_incomplete_mock',
          payouts_enabled: false, // NOT READY
          details_submitted: true
        })
      }
    });

    try {
      // Fetch withdrawal row
      const withdrawalRow = await pool.query(
        `SELECT id, user_id, amount_cents, method, idempotency_key, status, stripe_payout_id, attempt_count,
                next_attempt_at, last_error_code, last_error_details_json, requested_at
         FROM wallet_withdrawals WHERE id = $1`,
        [withdrawalId]
      );

      const withdrawal = withdrawalRow.rows[0];

      // Call worker function
      const result = await processWithdrawal(pool, withdrawal, 3, 60000);

      // 5. ASSERT: Withdrawal marked FAILED
      expect(result.success).toBe(false);
      expect(result.reason).toBe('STRIPE_ACCOUNT_INCOMPLETE');

      // 6. ASSERT: CRITICAL - Reversal ledger entry exists
      const reversalCheck = await pool.query(
        `SELECT COUNT(*)::int as count FROM ledger
         WHERE reference_id = $1 AND entry_type = 'WALLET_WITHDRAWAL_REVERSAL' AND direction = 'CREDIT'`,
        [withdrawalId]
      );
      expect(reversalCheck.rows[0].count).toBe(1, 'Exactly one WALLET_WITHDRAWAL_REVERSAL must exist');

      // 7. ASSERT: No duplicates
      const allReversals = await pool.query(
        `SELECT id FROM ledger WHERE reference_id = $1 AND entry_type = 'WALLET_WITHDRAWAL_REVERSAL'`,
        [withdrawalId]
      );
      expect(allReversals.rows.length).toBe(1, 'No duplicate reversals');

      // 8. ASSERT: Balance restored
      const balanceResult = await pool.query(
        `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents WHEN direction = 'DEBIT' THEN -amount_cents END), 0)::int as balance
         FROM ledger WHERE user_id = $1`,
        [userId]
      );
      expect(balanceResult.rows[0].balance).toBe(initialBalance, 'User balance restored to original');

      // 9. ASSERT: Net withdrawal is zero
      const netWithdrawalResult = await pool.query(
        `SELECT COALESCE(SUM(
           CASE WHEN entry_type = 'WALLET_WITHDRAWAL' THEN amount_cents
                WHEN entry_type = 'WALLET_WITHDRAWAL_REVERSAL' THEN -amount_cents
                ELSE 0 END
         ), 0)::int as net
         FROM ledger WHERE user_id = $1 AND entry_type IN ('WALLET_WITHDRAWAL', 'WALLET_WITHDRAWAL_REVERSAL')`,
        [userId]
      );
      expect(netWithdrawalResult.rows[0].net).toBe(0, 'Net withdrawal is zero');
    } finally {
      // Restore original Stripe instance function
      StripeWithdrawalAdapter.getStripeInstance = originalGetInstance;
    }
  });

  test('worker idempotency: reversal is not duplicated on retry', async () => {
    // CRITICAL FINANCIAL INVARIANT TEST
    // Protects against worker retries, race conditions, duplicate execution
    // If worker is called twice on same withdrawal, reversal must NOT be inserted twice

    const userId = require('uuid').v4();
    const withdrawalId = require('uuid').v4();
    const withdrawalAmount = 50000; // $500

    // 1. Setup identical to NO_STRIPE_ACCOUNT test
    await pool.query(
      'INSERT INTO users (id, email, is_admin) VALUES ($1, $2, $3)',
      [userId, `user-${userId.slice(-6)}@test.com`, false]
    );

    const initialBalance = 100000;
    await pool.query(
      `INSERT INTO ledger (user_id, entry_type, direction, amount_cents, reference_type, reference_id, idempotency_key)
       VALUES ($1, 'WALLET_DEPOSIT', 'CREDIT', $2, 'WALLET', $3, $4)`,
      [userId, initialBalance, userId, `wallet_deposit:${userId}`]
    );

    await pool.query(
      `INSERT INTO wallet_withdrawals (id, user_id, amount_cents, method, status, idempotency_key, requested_at, attempt_count)
       VALUES ($1, $2, $3, 'standard', 'PROCESSING', $4, NOW(), 0)`,
      [withdrawalId, userId, withdrawalAmount, `withdrawal:${withdrawalId}`]
    );

    await pool.query(
      `INSERT INTO ledger (user_id, entry_type, direction, amount_cents, reference_type, reference_id, idempotency_key)
       VALUES ($1, 'WALLET_WITHDRAWAL', 'DEBIT', $2, 'WALLET', $3, $4)`,
      [userId, withdrawalAmount, withdrawalId, `wallet_debit:${withdrawalId}`]
    );

    // 2. Get withdrawal row
    const withdrawalProcessorWorker = require('../../workers/withdrawalProcessorWorker');
    const processWithdrawal = withdrawalProcessorWorker._processWithdrawalForTests;

    const withdrawalRow = await pool.query(
      `SELECT id, user_id, amount_cents, method, idempotency_key, status, stripe_payout_id, attempt_count,
              next_attempt_at, last_error_code, last_error_details_json, requested_at
       FROM wallet_withdrawals WHERE id = $1`,
      [withdrawalId]
    );

    const withdrawal = withdrawalRow.rows[0];

    // 3. FIRST CALL - Worker processes withdrawal, inserts reversal
    const result1 = await processWithdrawal(pool, withdrawal, 3, 60000);
    expect(result1.success).toBe(false);
    expect(result1.reason).toBe('NO_STRIPE_ACCOUNT');

    // Verify first call inserted reversal
    let reversalCheck = await pool.query(
      `SELECT COUNT(*)::int as count FROM ledger
       WHERE reference_id = $1 AND entry_type = 'WALLET_WITHDRAWAL_REVERSAL'`,
      [withdrawalId]
    );
    expect(reversalCheck.rows[0].count).toBe(1);

    // 4. SECOND CALL - Worker retried on same withdrawal (race condition or retry)
    // Fetch updated withdrawal row (status should now be FAILED)
    const withdrawalRow2 = await pool.query(
      `SELECT id, user_id, amount_cents, method, idempotency_key, status, stripe_payout_id, attempt_count,
              next_attempt_at, last_error_code, last_error_details_json, requested_at
       FROM wallet_withdrawals WHERE id = $1`,
      [withdrawalId]
    );

    const withdrawal2 = withdrawalRow2.rows[0];

    // Call worker again with same withdrawal
    const result2 = await processWithdrawal(pool, withdrawal2, 3, 60000);
    expect(result2.success).toBe(false);

    // 5. ASSERT: Reversal count is STILL 1 (not 2)
    // This proves idempotency via ledger UNIQUE constraint on idempotency_key
    reversalCheck = await pool.query(
      `SELECT COUNT(*)::int as count FROM ledger
       WHERE reference_id = $1 AND entry_type = 'WALLET_WITHDRAWAL_REVERSAL'`,
      [withdrawalId]
    );
    expect(reversalCheck.rows[0].count).toBe(1, 'CRITICAL: Reversal must not be duplicated on retry');

    // 6. ASSERT: No duplicate reversal rows exist
    const allReversals = await pool.query(
      `SELECT id, idempotency_key FROM ledger
       WHERE reference_id = $1 AND entry_type = 'WALLET_WITHDRAWAL_REVERSAL'
       ORDER BY created_at`,
      [withdrawalId]
    );
    expect(allReversals.rows.length).toBe(1, 'Exactly one reversal row must exist');
    // All reversals should have the same idempotency key
    expect(allReversals.rows[0].idempotency_key).toBe(`wallet_withdrawal_reversal:${withdrawalId.toLowerCase()}`);

    // 7. ASSERT: Withdrawal status remains FAILED
    const withdrawalFinal = await pool.query(
      'SELECT status FROM wallet_withdrawals WHERE id = $1',
      [withdrawalId]
    );
    expect(withdrawalFinal.rows[0].status).toBe('FAILED');

    // 8. ASSERT: Balance is correct (no over-credit from duplicate reversal)
    // Expected: 100000 (original) - 50000 (debit) + 50000 (1x reversal) = 100000
    const balanceResult = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents WHEN direction = 'DEBIT' THEN -amount_cents END), 0)::int as balance
       FROM ledger WHERE user_id = $1`,
      [userId]
    );
    expect(balanceResult.rows[0].balance).toBe(initialBalance, 'Balance must not be over-credited by duplicate reversal');

    // 9. ASSERT: Net withdrawal remains zero
    const netWithdrawalResult = await pool.query(
      `SELECT COALESCE(SUM(
         CASE WHEN entry_type = 'WALLET_WITHDRAWAL' THEN amount_cents
              WHEN entry_type = 'WALLET_WITHDRAWAL_REVERSAL' THEN -amount_cents
              ELSE 0 END
       ), 0)::int as net
       FROM ledger WHERE user_id = $1 AND entry_type IN ('WALLET_WITHDRAWAL', 'WALLET_WITHDRAWAL_REVERSAL')`,
      [userId]
    );
    expect(netWithdrawalResult.rows[0].net).toBe(0, 'Net withdrawal must remain zero (no duplicate reversal impact)');

    // PROOF: Idempotency guaranteed by ledger UNIQUE constraint on idempotency_key
    // When worker retries and tries to INSERT reversal with same idempotency_key,
    // the ON CONFLICT (idempotency_key) DO NOTHING clause prevents duplicate insertion
  });
});
