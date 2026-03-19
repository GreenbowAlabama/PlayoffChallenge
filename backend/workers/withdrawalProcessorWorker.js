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
 * Get user-friendly error message for pre-Stripe check failure.
 * @private
 * @param {string} reason - Pre-Stripe failure reason code
 * @returns {string} User-friendly error message
 */
function getPreStripeErrorMessage(reason) {
  switch (reason) {
    case 'NO_STRIPE_ACCOUNT':
      return 'Stripe account not connected';
    case 'STRIPE_ACCOUNT_INCOMPLETE':
      return 'Stripe account setup incomplete (requires payouts enabled and details submitted)';
    case 'INSUFFICIENT_PLATFORM_BALANCE':
      return 'Platform insufficient balance (will retry when funds available)';
    default:
      return `Preflight check failed: ${reason}`;
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
             failure_reason = 'USER_NOT_FOUND',
             last_error_code = 'USER_NOT_FOUND',
             last_error_details_json = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify({ reason: 'User not found', errorType: 'permanent', errorCode: 'USER_NOT_FOUND', errorMessage: 'User account not found in system' }), withdrawal.id]
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

    // 3. Pre-Stripe checks (no early return - must fall through to reversal logic)
    let preStripeFailureReason = null;

    // Check 1: Stripe account connected
    if (!stripeConnectedAccountId) {
      preStripeFailureReason = 'NO_STRIPE_ACCOUNT';
    }

    // Check 2: Account fully onboarded (live Stripe call)
    if (!preStripeFailureReason) {
      try {
        const stripeInstance = StripeWithdrawalAdapter.getStripeInstance();
        const account = await stripeInstance.accounts.retrieve(stripeConnectedAccountId);

        if (!account.payouts_enabled || !account.details_submitted) {
          preStripeFailureReason = 'STRIPE_ACCOUNT_INCOMPLETE';
        }
      } catch (stripeErr) {
        // Stripe retrieve error - treat as retryable (don't block withdrawal)
        // Let the Stripe transfer attempt; if the account is truly broken, the transfer will fail
        console.log('[WithdrawalProcessor] Stripe account preflight check error', {
          withdrawal_id: withdrawal.id,
          error: stripeErr.message
        });
      }
    }

    // Check 3: Platform Stripe account has available balance (live Stripe call)
    if (!preStripeFailureReason) {
      try {
        const stripeInstance = StripeWithdrawalAdapter.getStripeInstance();
        const balance = await stripeInstance.balance.retrieve();

        // Check available balance (not pending balance)
        const availableCents = balance.available.reduce((sum, bal) => {
          return sum + (bal.currency === 'usd' ? bal.amount : 0);
        }, 0);

        console.log('[WithdrawalProcessor] Platform balance check', {
          withdrawal_id: withdrawal.id,
          withdrawal_amount: withdrawal.amount_cents,
          available_balance: availableCents
        });

        if (availableCents < withdrawal.amount_cents) {
          preStripeFailureReason = 'INSUFFICIENT_PLATFORM_BALANCE';
        }
      } catch (stripeErr) {
        // Balance check error - treat as retryable, let transfer attempt
        // Stripe will reject with proper error if balance is truly insufficient
        console.log('[WithdrawalProcessor] Platform balance check error', {
          withdrawal_id: withdrawal.id,
          error: stripeErr.message
        });
      }
    }

    // 4. Call Stripe Transfers API or create synthetic failure
    let stripeResult;
    if (preStripeFailureReason) {
      // Pre-Stripe check failed - create synthetic failure result
      // Classify: INSUFFICIENT_PLATFORM_BALANCE is retryable (funds may arrive later)
      // Other reasons are permanent
      const isRetryable = preStripeFailureReason === 'INSUFFICIENT_PLATFORM_BALANCE';

      stripeResult = {
        success: false,
        classification: isRetryable ? 'retryable' : 'permanent',
        reason: preStripeFailureReason,
        errorType: 'preflight_check',
        errorCode: preStripeFailureReason,
        errorMessage: getPreStripeErrorMessage(preStripeFailureReason)
      };
    } else {
      // Proceed to Stripe transfer (platform → connected account)
      stripeResult = await StripeWithdrawalAdapter.createTransfer({
        amountCents: withdrawal.amount_cents,
        destination: stripeConnectedAccountId,
        withdrawalId: withdrawal.id,
        userId: withdrawal.user_id,
        timeoutMs: 30000
      });
    }

    // 5. Handle result
    if (stripeResult.success) {
      // Success - write transfer ID and mark PAID
      await pool.query(
        `UPDATE wallet_withdrawals
         SET stripe_payout_id = $1,
             status = 'PAID',
             failure_reason = NULL,
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
        transfer_id: stripeResult.transferId
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
             failure_reason = $3,
             last_error_code = $4,
             last_error_details_json = $5,
             updated_at = NOW()
         WHERE id = $6`,
        [
          currentAttempt,
          nextAttemptAt,
          stripeResult.reason,
          stripeResult.errorCode,
          JSON.stringify({
            error: stripeResult.reason,
            errorType: stripeResult.errorType,
            errorCode: stripeResult.errorCode,
            errorMessage: stripeResult.errorMessage,
            classification: 'retryable',
            attempt: currentAttempt
          }),
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
    // CRITICAL: Insert reversal BEFORE marking FAILED (atomic transaction)
    // This guarantees DEBIT + REVERSAL pair and restores funds

    console.log('[WithdrawalProcessor] FAILURE PATH ENTERED', {
      withdrawal_id: withdrawal.id,
      attempt: currentAttempt,
      reason: stripeResult?.reason,
      classification: stripeResult?.classification
    });

    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');

      // 1. Insert reversal (idempotent)
      const reversalIdempotencyKey = `wallet_withdrawal_reversal:${withdrawal.id.toLowerCase()}`;

      console.log('[WithdrawalProcessor] REVERSAL INSERT ATTEMPT', {
        withdrawal_id: withdrawal.id,
        idempotency_key: reversalIdempotencyKey
      });

      await client.query(
        `INSERT INTO ledger (
           user_id, entry_type, direction, amount_cents, reference_type,
           reference_id, idempotency_key, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [withdrawal.user_id, 'WALLET_WITHDRAWAL_REVERSAL', 'CREDIT', withdrawal.amount_cents, 'WALLET', withdrawal.id, reversalIdempotencyKey]
      );

      // 2. VERIFY reversal exists (REQUIRED - financial invariant)
      const reversalCheck = await client.query(
        `SELECT id
         FROM ledger
         WHERE idempotency_key = $1`,
        [reversalIdempotencyKey]
      );

      if (reversalCheck.rows.length === 0) {
        console.error('[WithdrawalProcessor] REVERSAL VERIFICATION FAILED', {
          withdrawal_id: withdrawal.id
        });
        await client.query('ROLLBACK');
        throw new Error('INVARIANT_VIOLATION: reversal not created');
      }

      console.log('[WithdrawalProcessor] REVERSAL VERIFIED', {
        withdrawal_id: withdrawal.id
      });

      // 3. Hard guard: Verify reversal exists before marking FAILED
      const finalReversalCheck = await client.query(
        `SELECT COUNT(*)::int as count
         FROM ledger
         WHERE reference_id = $1
         AND entry_type = 'WALLET_WITHDRAWAL_REVERSAL'
         AND direction = 'CREDIT'`,
        [withdrawal.id]
      );

      if (finalReversalCheck.rows[0].count !== 1) {
        await client.query('ROLLBACK');
        throw new Error('INVARIANT_VIOLATION: final reversal count != 1');
      }

      // 4. Mark withdrawal failed (after reversal guaranteed AND verified)
      console.log('[WithdrawalProcessor] MARKING WITHDRAWAL FAILED', {
        withdrawal_id: withdrawal.id,
        reason: stripeResult.reason,
        errorType: stripeResult.errorType,
        errorCode: stripeResult.errorCode,
        errorMessage: stripeResult.errorMessage
      });

      await client.query(
        `UPDATE wallet_withdrawals
         SET status = 'FAILED',
             attempt_count = $1,
             failure_reason = $2,
             last_error_code = $3,
             last_error_details_json = $4,
             updated_at = NOW()
         WHERE id = $5`,
        [
          currentAttempt,
          stripeResult.reason,
          stripeResult.errorCode,
          JSON.stringify({
            error: stripeResult.reason,
            errorType: stripeResult.errorType,
            errorCode: stripeResult.errorCode,
            errorMessage: stripeResult.errorMessage,
            classification: stripeResult.classification,
            attempt: currentAttempt,
            maxAttempts: maxRetries
          }),
          withdrawal.id
        ]
      );

      await client.query('COMMIT');

      console.log('[WithdrawalProcessor] FAILURE PATH COMPLETE', {
        withdrawal_id: withdrawal.id
      });

    } catch (txnErr) {
      console.error('[WithdrawalProcessor] REVERSAL TXN ERROR', {
        withdrawal_id: withdrawal?.id,
        error: txnErr.message,
        stack: txnErr.stack
      });

      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackErr) {
          // Ignore rollback error
        }
      }
      throw txnErr;
    } finally {
      if (client) {
        client.release();
      }
    }

    return {
      success: false,
      withdrawal_id: withdrawal.id,
      retryable: false,
      reason: stripeResult.reason,
      permanent: true
    };
  } catch (err) {
    console.error('[WithdrawalProcessor] WITHDRAWAL PROCESSOR FATAL ERROR', {
      withdrawal_id: withdrawal?.id,
      error: err.message,
      stack: err.stack
    });

    // CRITICAL: DO NOT mutate ledger here
    // CRITICAL: DO NOT mark FAILED here
    // If error occurred in reversal transaction, the job must be retried
    // On retry, ledger UNIQUE constraint prevents duplicate reversal

    throw err;
  }
}

module.exports = {
  startWithdrawalProcessor,
  stopWithdrawalProcessor,
  // Export for testing - allows test harness to call worker logic directly
  _processWithdrawalForTests: processWithdrawal
};
