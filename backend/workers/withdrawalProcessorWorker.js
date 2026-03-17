/**
 * Withdrawal Processor Worker
 *
 * Background worker that processes wallet_withdrawals stuck in PROCESSING state.
 * Calls Stripe Transfers API to move funds to user's connected account.
 *
 * Responsibilities:
 * - Poll wallet_withdrawals WHERE status = 'PROCESSING'
 * - Fetch user's stripe_connected_account_id
 * - Call Stripe Transfers API (idempotent via idempotency key)
 * - Write stripe_transfer_id immediately on success
 * - Update attempt_count and retry schedule on failure
 * - Classify errors as retryable or permanent
 *
 * Execution:
 * - Interval-based polling (configurable, default 30s)
 * - Guarded by ENABLE_WITHDRAWAL_PROCESSOR=true environment variable
 * - Logs minimal info (counts, errors)
 * - Errors do NOT block other withdrawals
 *
 * CONSTRAINT: SINGLE INSTANCE ONLY
 * - Worker must run in exactly ONE instance
 * - Multi-instance coordination NOT supported in Phase 1
 * - Running multiple instances will cause race conditions on withdrawal state
 * - Coordinate via deployment/orchestration (e.g., Kubernetes pod, single EC2 instance)
 *
 * Production Requirement:
 * - In production (NODE_ENV === 'production'), ENABLE_WITHDRAWAL_PROCESSOR must be 'true'
 * - Failure to enable in production is a fatal error
 * - Worker will exit process if requirement not met
 *
 * Financial Invariant:
 * - Ledger DEBIT happens BEFORE Stripe call (in processWithdrawal endpoint)
 * - This worker only executes the Stripe transfer
 * - Webhook (transfer.created or manual polling) marks withdrawal as PAID
 */

const StripeWithdrawalAdapter = require('../services/StripeWithdrawalAdapter');

let isRunning = false;
let intervalHandle = null;

/**
 * Start withdrawal processor worker
 *
 * CONSTRAINT: SINGLE INSTANCE ONLY
 * - Must run in exactly one instance
 * - Multi-instance coordination not supported
 *
 * Production Requirement:
 * - In NODE_ENV === 'production', ENABLE_WITHDRAWAL_PROCESSOR must be 'true'
 * - Throws fatal error and exits if requirement not met
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} options - Worker options
 * @param {number} [options.intervalMs] - Polling interval in milliseconds (default: 30000)
 * @param {number} [options.maxConcurrent] - Max concurrent Stripe calls (default: 5)
 * @param {number} [options.maxRetries] - Max Stripe call attempts per withdrawal (default: 3)
 * @param {number} [options.retryDelayMs] - Delay between retries in milliseconds (default: 60000)
 * @returns {void}
 * @throws {Error} Fatal error if production requirement not met
 */
function startWithdrawalProcessor(pool, options = {}) {
  try {
    const intervalMs = options.intervalMs || 30000; // 30 seconds default
    const maxConcurrent = options.maxConcurrent || 5;
    const maxRetries = options.maxRetries || 3;
    const retryDelayMs = options.retryDelayMs || 60000; // 1 minute between retries

    if (isRunning) {
      console.log('[WithdrawalProcessor] Already running, skipping start');
      return;
    }

    // PRODUCTION REQUIREMENT: enforce ENABLE_WITHDRAWAL_PROCESSOR=true in production
    if (process.env.NODE_ENV === 'production' && process.env.ENABLE_WITHDRAWAL_PROCESSOR !== 'true') {
      const errorMsg = 'FATAL: In production, ENABLE_WITHDRAWAL_PROCESSOR must be explicitly set to "true". Worker cannot start without this requirement.';
      console.error(`[WithdrawalProcessor] ${errorMsg}`);
      process.exit(1);
    }

    // Check if explicitly enabled (development can gracefully skip)
    if (process.env.ENABLE_WITHDRAWAL_PROCESSOR !== 'true') {
      console.log('[WithdrawalProcessor] Not enabled (ENABLE_WITHDRAWAL_PROCESSOR !== true)');
      return;
    }

    isRunning = true;
    console.log(`[WithdrawalProcessor] Started (interval: ${intervalMs}ms, max concurrent: ${maxConcurrent}, max retries: ${maxRetries})`);

    // Initial run
    processWithdrawals(pool, maxConcurrent, maxRetries, retryDelayMs);

    // Schedule recurring runs
    intervalHandle = setInterval(() => {
      processWithdrawals(pool, maxConcurrent, maxRetries, retryDelayMs);
    }, intervalMs);
  } catch (err) {
    const errorMsg = `[WithdrawalProcessor] FATAL ERROR during startup: ${err.message}`;
    console.error(errorMsg);
    console.error(err.stack);
    process.exit(1);
  }
}

/**
 * Stop withdrawal processor worker
 * @returns {void}
 */
function stopWithdrawalProcessor() {
  if (!isRunning) {
    console.log('[WithdrawalProcessor] Not running, skipping stop');
    return;
  }

  isRunning = false;
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }

  console.log('[WithdrawalProcessor] Stopped');
}

/**
 * Process all PROCESSING withdrawals ready for retry
 *
 * Polls database for PROCESSING withdrawals where next_attempt_at <= NOW,
 * calls Stripe for each, and updates state based on result.
 *
 * @private
 * @param {Object} pool - Database connection pool
 * @param {number} maxConcurrent - Max concurrent Stripe calls
 * @param {number} maxRetries - Max Stripe call attempts
 * @param {number} retryDelayMs - Delay between retries
 * @returns {Promise<void>}
 */
async function processWithdrawals(pool, maxConcurrent, maxRetries, retryDelayMs) {
  try {
    // Fetch REQUESTED (fallback) and PROCESSING withdrawals ready for retry
    const result = await pool.query(
      `SELECT id, user_id, amount_cents, method, idempotency_key, status,
              processed_at, stripe_payout_id, attempt_count, next_attempt_at,
              last_error_code, last_error_details_json, requested_at
       FROM wallet_withdrawals
       WHERE
       (
         status = 'REQUESTED'
         OR (
           status = 'PROCESSING'
           AND stripe_payout_id IS NULL
           AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
         )
       )
       AND attempt_count < $1
       ORDER BY requested_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $2`,
      [maxRetries, maxConcurrent]
    );

    if (result.rows.length === 0) {
      return; // No withdrawals to process
    }

    const withdrawals = result.rows;
    const processResults = [];

    // Process each withdrawal sequentially (to avoid overwhelming Stripe)
    for (const withdrawal of withdrawals) {
      try {
        const outcome = await processWithdrawal(pool, withdrawal, maxRetries, retryDelayMs);
        processResults.push(outcome);
      } catch (err) {
        console.error('[WithdrawalProcessor] Unhandled error processing withdrawal', {
          withdrawal_id: withdrawal.id,
          error: err.message
        });
      }
    }

    // Log summary
    const succeeded = processResults.filter(r => r.success).length;
    const retryable = processResults.filter(r => !r.success && r.retryable).length;
    const failed = processResults.filter(r => !r.success && !r.retryable).length;

    if (succeeded > 0 || retryable > 0 || failed > 0) {
      console.log('[WithdrawalProcessor] Batch complete', {
        total: processResults.length,
        succeeded,
        retryable,
        failed
      });
    }
  } catch (err) {
    console.error('[WithdrawalProcessor] Batch error', {
      error: err.message
    });
  }
}

/**
 * Process a single withdrawal
 *
 * 1. Fetch user's Stripe connected account
 * 2. Call Stripe Transfers API
 * 3. Update withdrawal state based on result
 * 4. Schedule retry if transient error
 *
 * @private
 * @param {Object} pool - Database connection pool
 * @param {Object} withdrawal - Withdrawal row
 * @param {number} maxRetries - Max attempt count
 * @param {number} retryDelayMs - Delay between retries
 * @returns {Promise<Object>} { success, withdrawal_id, retryable? }
 */
async function processWithdrawal(pool, withdrawal, maxRetries, retryDelayMs) {
  try {
    // 1. Fetch user's Stripe connected account
    const userResult = await pool.query(
      'SELECT id, stripe_connected_account_id FROM users WHERE id = $1',
      [withdrawal.user_id]
    );

    if (userResult.rows.length === 0) {
      // User not found - mark withdrawal as FAILED
      await pool.query(
        `UPDATE wallet_withdrawals
         SET status = 'FAILED',
             last_error_code = 'USER_NOT_FOUND',
             last_error_details_json = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify({ reason: 'User not found' }), withdrawal.id]
      );

      return {
        success: false,
        withdrawal_id: withdrawal.id,
        retryable: false,
        reason: 'USER_NOT_FOUND'
      };
    }

    const user = userResult.rows[0];
    const stripeConnectedAccountId = user.stripe_connected_account_id;

    // 2. If REQUESTED, transition to PROCESSING (debit already inserted at request time)
    if (withdrawal.status === 'REQUESTED') {
      // Ledger DEBIT already inserted by createWithdrawalRequest() (pessimistic reserve)
      // This worker only transitions state to PROCESSING for Stripe API call
      await pool.query(
        `UPDATE wallet_withdrawals
         SET status = 'PROCESSING', processed_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [withdrawal.id]
      );

      // Update local withdrawal object status
      withdrawal.status = 'PROCESSING';
    }

    // 3. Check if user has connected Stripe account
    if (!stripeConnectedAccountId) {
      // No Stripe account connected - mark as FAILED (permanent)
      await pool.query(
        `UPDATE wallet_withdrawals
         SET status = 'FAILED',
             last_error_code = 'NO_STRIPE_ACCOUNT',
             last_error_details_json = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify({ reason: 'User has not connected Stripe account' }), withdrawal.id]
      );

      return {
        success: false,
        withdrawal_id: withdrawal.id,
        retryable: false,
        reason: 'NO_STRIPE_ACCOUNT'
      };
    }

    // 4. Call Stripe Transfers API
    const stripeResult = await StripeWithdrawalAdapter.createTransfer({
      amountCents: withdrawal.amount_cents,
      destination: stripeConnectedAccountId,
      withdrawalId: withdrawal.id,
      userId: withdrawal.user_id,
      timeoutMs: 30000
    });

    // 5. Handle result
    if (stripeResult.success) {
      // Success - write transfer ID and mark PAID
      await pool.query(
        `UPDATE wallet_withdrawals
         SET stripe_payout_id = $1,
             status = 'PAID',
             processed_at = NOW(),
             last_error_code = NULL,
             last_error_details_json = NULL,
             updated_at = NOW()
         WHERE id = $2`,
        [stripeResult.transferId, withdrawal.id]
      );

      return {
        success: true,
        withdrawal_id: withdrawal.id,
        payout_id: stripeResult.transferId
      };
    }

    // Stripe call failed - decide if retryable
    const currentAttempt = (withdrawal.attempt_count || 0) + 1;
    const isRetryable = stripeResult.classification === 'retryable';
    const isMaxedOut = currentAttempt >= maxRetries;

    if (isRetryable && !isMaxedOut) {
      // Schedule next retry
      const nextAttemptAt = new Date(Date.now() + retryDelayMs);

      await pool.query(
        `UPDATE wallet_withdrawals
         SET attempt_count = $1,
             next_attempt_at = $2,
             last_error_code = $3,
             last_error_details_json = $4,
             updated_at = NOW()
         WHERE id = $5`,
        [
          currentAttempt,
          nextAttemptAt,
          stripeResult.reason,
          JSON.stringify({ error: stripeResult.reason, classification: 'retryable' }),
          withdrawal.id
        ]
      );

      return {
        success: false,
        withdrawal_id: withdrawal.id,
        retryable: true,
        reason: stripeResult.reason,
        attempt: currentAttempt
      };
    }

    // Permanent error OR max retries exhausted
    // Insert reversal to return funds to wallet (normalize UUID to lowercase)
    const reversalIdempotencyKey = `wallet_withdrawal_reversal:${withdrawal.id.toLowerCase()}`;

    await pool.query(
      `INSERT INTO ledger (
         user_id, entry_type, direction, amount_cents, reference_type,
         reference_id, idempotency_key, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [withdrawal.user_id, 'WALLET_WITHDRAWAL_REVERSAL', 'CREDIT', withdrawal.amount_cents, 'WALLET', withdrawal.id, reversalIdempotencyKey]
    );

    // Mark withdrawal as FAILED
    await pool.query(
      `UPDATE wallet_withdrawals
       SET status = 'FAILED',
           attempt_count = $1,
           last_error_code = $2,
           last_error_details_json = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [
        currentAttempt,
        stripeResult.reason,
        JSON.stringify({
          error: stripeResult.reason,
          classification: stripeResult.classification,
          attempt: currentAttempt,
          maxAttempts: maxRetries
        }),
        withdrawal.id
      ]
    );

    return {
      success: false,
      withdrawal_id: withdrawal.id,
      retryable: false,
      reason: stripeResult.reason,
      permanent: true
    };
  } catch (err) {
    console.error('[WithdrawalProcessor] Unhandled error', {
      withdrawal_id: withdrawal.id,
      error: err.message,
      stack: err.stack
    });

    // Mark as failed due to unexpected error (treat as retryable just in case)
    const currentAttempt = (withdrawal.attempt_count || 0) + 1;
    const nextAttemptAt = new Date(Date.now() + (60000 * 5)); // Try again in 5 minutes

    try {
      await pool.query(
        `UPDATE wallet_withdrawals
         SET attempt_count = $1,
             next_attempt_at = $2,
             last_error_code = 'WORKER_ERROR',
             last_error_details_json = $3,
             updated_at = NOW()
         WHERE id = $4`,
        [
          currentAttempt,
          nextAttemptAt,
          JSON.stringify({ error: err.message, type: 'worker_unhandled' }),
          withdrawal.id
        ]
      );
    } catch (updateErr) {
      console.error('[WithdrawalProcessor] Failed to update withdrawal after error', {
        withdrawal_id: withdrawal.id,
        error: updateErr.message
      });
    }

    return {
      success: false,
      withdrawal_id: withdrawal.id,
      retryable: true,
      reason: 'WORKER_ERROR'
    };
  }
}

module.exports = {
  startWithdrawalProcessor,
  stopWithdrawalProcessor
};
