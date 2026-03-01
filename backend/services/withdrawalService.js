/**
 * Withdrawal Service
 *
 * Implements Phase 3 withdrawal engine with Stripe Payouts API.
 * All financial operations use ledger-backed balance with per-user locking.
 *
 * Critical invariants:
 * - Available balance = ledger credits - debits - pending withdrawals (REQUESTED + PROCESSING)
 * - Per-user SELECT...FOR UPDATE serializes all balance operations
 * - Ledger DEBIT inserted before Stripe API call (pessimistic reserve)
 * - Stripe call NEVER inside DB transaction
 * - Webhook idempotency via WHERE status = 'PROCESSING' gate
 */

const LedgerRepository = require('../repositories/LedgerRepository');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

const WITHDRAWAL_ERROR_CODES = {
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  AMOUNT_TOO_SMALL: 'AMOUNT_TOO_SMALL',
  AMOUNT_TOO_LARGE: 'AMOUNT_TOO_LARGE',
  WITHDRAWAL_PENDING: 'WITHDRAWAL_PENDING',
  CONFIG_NOT_FOUND: 'CONFIG_NOT_FOUND',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  WITHDRAWAL_NOT_FOUND: 'WITHDRAWAL_NOT_FOUND',
  WITHDRAWAL_NOT_CANCELLABLE: 'WITHDRAWAL_NOT_CANCELLABLE',
  DUPLICATE_REQUEST: 'DUPLICATE_REQUEST'
};

/**
 * Get withdrawal configuration for environment
 *
 * @param {Object} pool - Database connection pool
 * @param {string} environment - Environment name (sandbox, staging, production)
 * @returns {Promise<Object|null>} Withdrawal config or null if not found
 */
async function getWithdrawalConfig(pool, environment) {
  const result = await pool.query(
    `SELECT id, environment, min_withdrawal_cents, max_withdrawal_cents,
            daily_withdrawal_limit_cents, max_withdrawals_per_day,
            instant_enabled, instant_fee_percent, instant_fee_cents,
            standard_fee_cents, cooldown_seconds
     FROM withdrawal_config
     WHERE environment = $1`,
    [environment]
  );

  return result.rows[0] || null;
}

/**
 * Compute available balance for withdrawal
 *
 * Available = ledger balance - pending withdrawals (REQUESTED + PROCESSING)
 * This prevents concurrent withdrawals from over-draining wallet.
 *
 * Call AFTER user row is locked (SELECT...FOR UPDATE).
 *
 * @param {Object} client - Database transaction client
 * @param {string} userId - UUID of user
 * @returns {Promise<number>} Available balance in cents
 */
async function computeAvailableBalance(client, userId) {
  // 1. Get ledger-based balance
  const ledgerBalance = await LedgerRepository.computeWalletBalance(client, userId);

  // 2. Get frozen funds (pending withdrawals)
  const frozenResult = await client.query(
    `SELECT COALESCE(SUM(amount_cents), 0) as frozen_cents
     FROM wallet_withdrawals
     WHERE user_id = $1 AND status IN ('REQUESTED', 'PROCESSING')`,
    [userId]
  );

  const frozenCents = parseInt(frozenResult.rows[0].frozen_cents, 10);

  return ledgerBalance - frozenCents;
}

/**
 * Create withdrawal request (idempotent)
 *
 * Phase 1: Request creation only (no ledger debit).
 * Funds are frozen as REQUESTED to prevent concurrent withdrawals.
 * Process step handles ledger debit and Stripe API call.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} userId - UUID of user
 * @param {Object} input - Request input
 * @param {number} input.amount_cents - Amount to withdraw in cents
 * @param {string} input.method - 'standard' or 'instant'
 * @param {string} input.idempotency_key - Unique request identifier
 * @param {string} environment - Environment (sandbox, staging, production)
 * @returns {Promise<Object>} Withdrawal or error response
 */
async function createWithdrawalRequest(pool, userId, input, environment) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock user row (serialize all balance operations)
    const userResult = await client.query(
      'SELECT id FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );

    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error_code: WITHDRAWAL_ERROR_CODES.USER_NOT_FOUND,
        reason: 'User not found'
      };
    }

    // 2. Get withdrawal config
    const configResult = await client.query(
      `SELECT min_withdrawal_cents, max_withdrawal_cents, instant_enabled
       FROM withdrawal_config WHERE environment = $1`,
      [environment]
    );

    if (configResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error_code: WITHDRAWAL_ERROR_CODES.CONFIG_NOT_FOUND,
        reason: 'Withdrawal configuration not found'
      };
    }

    const config = configResult.rows[0];

    // 3. Validate amount constraints
    if (input.amount_cents < config.min_withdrawal_cents) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error_code: WITHDRAWAL_ERROR_CODES.AMOUNT_TOO_SMALL,
        reason: `Minimum withdrawal is ${config.min_withdrawal_cents} cents`,
        minimum_withdrawal_cents: config.min_withdrawal_cents
      };
    }

    if (config.max_withdrawal_cents !== null && input.amount_cents > config.max_withdrawal_cents) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error_code: WITHDRAWAL_ERROR_CODES.AMOUNT_TOO_LARGE,
        reason: `Maximum withdrawal is ${config.max_withdrawal_cents} cents`,
        maximum_withdrawal_cents: config.max_withdrawal_cents
      };
    }

    // 4. Validate instant method if requested
    if (input.method === 'instant' && !config.instant_enabled) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error_code: WITHDRAWAL_ERROR_CODES.AMOUNT_TOO_SMALL,
        reason: 'Instant withdrawal is not enabled'
      };
    }

    // 5. Check idempotency: if same key exists, return existing withdrawal
    const existingResult = await client.query(
      `SELECT id, user_id, amount_cents, method, status, instant_fee_cents,
              stripe_payout_id, requested_at, processed_at
       FROM wallet_withdrawals
       WHERE idempotency_key = $1`,
      [input.idempotency_key]
    );

    if (existingResult.rows.length > 0) {
      const existing = existingResult.rows[0];
      await client.query('COMMIT');

      // If existing is REQUESTED or PROCESSING, return success (idempotent)
      if (['REQUESTED', 'PROCESSING'].includes(existing.status)) {
        return { success: true, withdrawal: existing };
      }

      // If existing is PAID or FAILED, return conflict (user must use new key)
      return {
        success: false,
        error_code: WITHDRAWAL_ERROR_CODES.DUPLICATE_REQUEST,
        reason: 'A withdrawal with this idempotency key already exists',
        existing_withdrawal: existing
      };
    }

    // 6. Compute available balance
    const availableBalance = await computeAvailableBalance(client, userId);

    if (availableBalance < input.amount_cents) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error_code: WITHDRAWAL_ERROR_CODES.INSUFFICIENT_BALANCE,
        reason: 'Insufficient wallet balance',
        available_balance_cents: availableBalance,
        requested_amount_cents: input.amount_cents
      };
    }

    // 7. Compute instant fee (if applicable)
    let instantFeeCents = 0;
    if (input.method === 'instant' && config.instant_fee_percent > 0) {
      // Fee = amount * (percent / 100)
      instantFeeCents = Math.ceil(input.amount_cents * (config.instant_fee_percent / 100));
    }

    // 8. Insert withdrawal request (status = REQUESTED, funds frozen)
    const insertResult = await client.query(
      `INSERT INTO wallet_withdrawals (
         user_id, amount_cents, method, instant_fee_cents, status, idempotency_key, requested_at
       ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING id, user_id, amount_cents, method, instant_fee_cents, status,
                 stripe_payout_id, idempotency_key, requested_at, processed_at, updated_at`,
      [userId, input.amount_cents, input.method, instantFeeCents, 'REQUESTED', input.idempotency_key]
    );

    const withdrawal = insertResult.rows[0];

    await client.query('COMMIT');

    return { success: true, withdrawal };

  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      // Ignore rollback error
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Process withdrawal (REQUESTED -> PROCESSING)
 *
 * Phase 2: Insert ledger debit and transition to PROCESSING.
 * Ledger DEBIT inserted before Stripe API call.
 * If Stripe call fails, withdrawal remains in PROCESSING (webhook will complete or fail it).
 *
 * @param {Object} pool - Database connection pool
 * @param {string} withdrawalId - UUID of withdrawal
 * @param {Object} stripeAccount - Stripe account config { bankAccountId, customerId }
 * @returns {Promise<Object>} { success, withdrawal, stripe_payout_id } or error
 */
async function processWithdrawal(pool, withdrawalId, stripeAccount) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock user row
    // Note: We need to fetch the withdrawal first to get the user_id
    const withdrawalResult = await client.query(
      `SELECT id, user_id, amount_cents, method, status, idempotency_key,
              instant_fee_cents
       FROM wallet_withdrawals
       WHERE id = $1 FOR UPDATE`,
      [withdrawalId]
    );

    if (withdrawalResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error_code: WITHDRAWAL_ERROR_CODES.WITHDRAWAL_NOT_FOUND,
        reason: 'Withdrawal not found'
      };
    }

    const withdrawal = withdrawalResult.rows[0];
    const userId = withdrawal.user_id;

    // 2. Check status is REQUESTED
    if (withdrawal.status !== 'REQUESTED') {
      await client.query('ROLLBACK');
      return {
        success: false,
        reason: `Withdrawal is in '${withdrawal.status}' state, cannot process`,
        withdrawal
      };
    }

    // 3. Lock user row for balance check
    const userResult = await client.query(
      'SELECT id FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );

    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error_code: WITHDRAWAL_ERROR_CODES.USER_NOT_FOUND,
        reason: 'User not found'
      };
    }

    // 4. Paranoia check: re-validate balance before debit
    const ledgerBalance = await LedgerRepository.computeWalletBalance(client, userId);

    if (ledgerBalance < withdrawal.amount_cents) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error_code: WITHDRAWAL_ERROR_CODES.INSUFFICIENT_BALANCE,
        reason: 'Insufficient wallet balance (paranoia check failed)',
        current_balance_cents: ledgerBalance,
        withdrawal_amount_cents: withdrawal.amount_cents
      };
    }

    // 5. Insert ledger DEBIT (atomic with status update)
    const idempotencyKey = `wallet_debit:${withdrawalId}:${userId}`;

    const debitResult = await client.query(
      `INSERT INTO ledger (
         user_id, entry_type, direction, amount_cents, reference_type,
         reference_id, idempotency_key, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id, entry_type, direction, amount_cents`,
      [userId, 'WALLET_DEBIT', 'DEBIT', withdrawal.amount_cents, 'WITHDRAWAL', withdrawalId, idempotencyKey]
    );

    // If debit was inserted, rowCount > 0
    // If debit already exists (idempotent), rowCount = 0
    if (debitResult.rowCount === 0) {
      // Verify existing debit matches expected values
      const existingDebitResult = await client.query(
        `SELECT entry_type, direction, amount_cents, reference_type, reference_id
         FROM ledger WHERE idempotency_key = $1`,
        [idempotencyKey]
      );

      if (existingDebitResult.rows.length === 0) {
        await client.query('ROLLBACK');
        throw new Error(`Invariant violation: debit with idempotency_key ${idempotencyKey} was reported as conflicted but not found`);
      }

      const existingDebit = existingDebitResult.rows[0];

      // Verify fields match
      const fieldsMatch = (
        existingDebit.entry_type === 'WALLET_DEBIT' &&
        existingDebit.direction === 'DEBIT' &&
        parseInt(existingDebit.amount_cents, 10) === withdrawal.amount_cents &&
        existingDebit.reference_type === 'WITHDRAWAL' &&
        existingDebit.reference_id === withdrawalId
      );

      if (!fieldsMatch) {
        await client.query('ROLLBACK');
        throw new Error(
          `Invariant violation: WALLET_DEBIT with idempotency_key ${idempotencyKey} exists but fields mismatch. ` +
          `Expected: WALLET_DEBIT, DEBIT, ${withdrawal.amount_cents}, WITHDRAWAL, ${withdrawalId}. ` +
          `Found: ${JSON.stringify(existingDebit)}`
        );
      }
    }

    // 6. Update status to PROCESSING
    const updateResult = await client.query(
      `UPDATE wallet_withdrawals
       SET status = 'PROCESSING', processed_at = NOW(), updated_at = NOW()
       WHERE id = $1
       RETURNING id, user_id, amount_cents, method, status, instant_fee_cents,
                 stripe_payout_id, idempotency_key, requested_at, processed_at`,
      [withdrawalId]
    );

    const updatedWithdrawal = updateResult.rows[0];

    await client.query('COMMIT');

    return { success: true, withdrawal: updatedWithdrawal, ledger_debit_inserted: debitResult.rowCount > 0 };

  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      // Ignore rollback error
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Call Stripe Payout API and update withdrawal status
 *
 * This function is called AFTER processWithdrawal commits.
 * If Stripe call fails, withdrawal remains in PROCESSING.
 * Retry logic will be handled by caller or async job.
 *
 * @param {Object} pool - Database connection pool
 * @param {string} withdrawalId - UUID of withdrawal
 * @param {Object} stripeAccount - Stripe account config
 * @returns {Promise<Object>} { success, payout_id } or error details
 */
async function callStripePayout(pool, withdrawalId, stripeAccount) {
  // 1. Fetch withdrawal to get details
  const withdrawalResult = await pool.query(
    `SELECT id, user_id, amount_cents, method, idempotency_key, status
     FROM wallet_withdrawals WHERE id = $1`,
    [withdrawalId]
  );

  if (withdrawalResult.rows.length === 0) {
    return {
      success: false,
      reason: 'Withdrawal not found'
    };
  }

  const withdrawal = withdrawalResult.rows[0];

  // 2. Verify status is PROCESSING
  if (withdrawal.status !== 'PROCESSING') {
    return {
      success: false,
      reason: `Withdrawal is in '${withdrawal.status}' state, Stripe call not needed`
    };
  }

  try {
    // 3. Create Stripe payout (using Payouts API)
    const payout = await stripe.payouts.create(
      {
        amount: withdrawal.amount_cents,
        currency: 'usd',
        method: withdrawal.method === 'instant' ? 'instant' : 'standard',
        destination: stripeAccount.bankAccountId || 'default'
      },
      {
        idempotencyKey: withdrawal.idempotency_key
      }
    );

    // 4. Update withdrawal with stripe_payout_id
    const updateResult = await pool.query(
      `UPDATE wallet_withdrawals
       SET stripe_payout_id = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, stripe_payout_id, status`,
      [payout.id, withdrawalId]
    );

    return {
      success: true,
      payout_id: payout.id,
      status: payout.status
    };

  } catch (stripeErr) {
    return {
      success: false,
      reason: stripeErr.message,
      stripe_error_code: stripeErr.code,
      stripe_error_type: stripeErr.type
    };
  }
}

/**
 * Webhook handler: payout.paid event
 *
 * Idempotent: UPDATE only if status = 'PROCESSING'
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} payout - Stripe payout object
 * @returns {Promise<Object>} { updated: true/false }
 */
async function handlePayoutPaid(pool, payout) {
  const result = await pool.query(
    `UPDATE wallet_withdrawals
     SET status = 'PAID', stripe_payout_id = $1, updated_at = NOW()
     WHERE stripe_payout_id = $1 AND status = 'PROCESSING'
     RETURNING id, status`,
    [payout.id]
  );

  return {
    updated: result.rowCount > 0,
    withdrawal_id: result.rows[0]?.id || null
  };
}

/**
 * Webhook handler: payout.failed event
 *
 * Idempotent: UPDATE only if status = 'PROCESSING'
 * No ledger reversal in Phase 1 (funds remain debited).
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} payout - Stripe payout object
 * @returns {Promise<Object>} { updated: true/false }
 */
async function handlePayoutFailed(pool, payout) {
  const failureReason = payout.failure_reason || payout.failure_code || 'Unknown failure';

  const result = await pool.query(
    `UPDATE wallet_withdrawals
     SET status = 'FAILED', failure_reason = $2, stripe_payout_id = $1, updated_at = NOW()
     WHERE stripe_payout_id = $1 AND status = 'PROCESSING'
     RETURNING id, status`,
    [payout.id, failureReason]
  );

  return {
    updated: result.rowCount > 0,
    withdrawal_id: result.rows[0]?.id || null
  };
}

/**
 * Cancel withdrawal
 *
 * Only REQUESTED withdrawals can be cancelled (funds not yet debited).
 *
 * @param {Object} pool - Database connection pool
 * @param {string} withdrawalId - UUID of withdrawal
 * @param {string} userId - UUID of user (ownership check)
 * @returns {Promise<Object>} { success, withdrawal } or error
 */
async function cancelWithdrawal(pool, withdrawalId, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock user row
    const userResult = await client.query(
      'SELECT id FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );

    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error_code: WITHDRAWAL_ERROR_CODES.USER_NOT_FOUND,
        reason: 'User not found'
      };
    }

    // 2. Lock and fetch withdrawal
    const withdrawalResult = await client.query(
      `SELECT id, user_id, status
       FROM wallet_withdrawals
       WHERE id = $1 FOR UPDATE`,
      [withdrawalId]
    );

    if (withdrawalResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error_code: WITHDRAWAL_ERROR_CODES.WITHDRAWAL_NOT_FOUND,
        reason: 'Withdrawal not found'
      };
    }

    const withdrawal = withdrawalResult.rows[0];

    // 3. Verify ownership
    if (withdrawal.user_id !== userId) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error_code: WITHDRAWAL_ERROR_CODES.WITHDRAWAL_NOT_FOUND,
        reason: 'Withdrawal not found'
      };
    }

    // 4. Check status is REQUESTED
    if (withdrawal.status !== 'REQUESTED') {
      await client.query('ROLLBACK');
      return {
        success: false,
        error_code: WITHDRAWAL_ERROR_CODES.WITHDRAWAL_NOT_CANCELLABLE,
        reason: `Cannot cancel withdrawal in '${withdrawal.status}' state`,
        status: withdrawal.status
      };
    }

    // 5. Update status to CANCELLED
    const updateResult = await client.query(
      `UPDATE wallet_withdrawals
       SET status = 'CANCELLED', updated_at = NOW()
       WHERE id = $1
       RETURNING id, user_id, amount_cents, method, status, requested_at, updated_at`,
      [withdrawalId]
    );

    await client.query('COMMIT');

    return { success: true, withdrawal: updateResult.rows[0] };

  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      // Ignore rollback error
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  WITHDRAWAL_ERROR_CODES,
  getWithdrawalConfig,
  computeAvailableBalance,
  createWithdrawalRequest,
  processWithdrawal,
  callStripePayout,
  handlePayoutPaid,
  handlePayoutFailed,
  cancelWithdrawal
};
