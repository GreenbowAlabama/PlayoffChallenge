/**
 * Payout Execution Service
 *
 * Executes individual payout transfers idempotently.
 *
 * Responsibilities:
 * - Claim transfer for processing (SELECT ... FOR UPDATE)
 * - Increment attempt_count exactly once
 * - Call Stripe transfer API with idempotency key
 * - Classify errors and transition state
 * - Insert ledger entries on completion

 * Does NOT:
 * - Create payouts
 * - Compute amounts
 * - Manage job state
 */

const StripePayoutAdapter = require('./StripePayoutAdapter');
const PayoutTransfersRepository = require('../repositories/PayoutTransfersRepository');
const LedgerRepository = require('../repositories/LedgerRepository');

/**
 * Execute a payout transfer.
 *
 * Atomic transaction:
 * 1. Claim transfer for processing (FOR UPDATE)
 * 2. Call Stripe (idempotent via idempotency key)
 * 3. Update transfer state
 * 4. Create ledger entry
 *
 * @param {Object} pool - Database connection pool
 * @param {string} transferId - UUID of payout transfer
 * @param {Function} [getDestinationAccountFn] - Optional function to resolve destination account (for testing)
 *
 * @returns {Promise<Object>} {
 *   transfer_id: UUID,
 *   status: 'completed' | 'retryable' | 'failed_terminal',
 *   stripe_transfer_id: string | null,
 *   failure_reason: string | null
 * }
 *
 * @throws {Error} Database or Stripe errors (transaction rolls back)
 */
async function executeTransfer(pool, transferId, getDestinationAccountFn) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Step 1: Claim transfer for processing
    const transfer = await PayoutTransfersRepository.claimForProcessing(client, transferId);

    if (!transfer) {
      // Transfer is not claimable (already claimed, completed, failed, or max attempts reached)
      await client.query('ROLLBACK');
      return {
        transfer_id: transferId,
        status: 'not_claimable'
      };
    }

    // Step 2: Mark as processing and increment attempt_count
    const processingTransfer = await PayoutTransfersRepository.markProcessing(client, transferId);

    // Step 3: Lookup destination Stripe account
    // Idempotency key is deterministic: payout:<transfer_id>
    const destination = getDestinationAccountFn
      ? await getDestinationAccountFn(pool, transfer.contest_id, transfer.user_id)
      : await getDestinationAccount(pool, transfer.contest_id, transfer.user_id);

    // If destination account not connected, mark as failed_terminal immediately
    // Do NOT call Stripe - account connectivity is a permanent, non-retryable issue
    // Do NOT create ledger entry - no financial event occurred (Stripe was never contacted)
    if (!destination) {
      await PayoutTransfersRepository.markFailedTerminal(
        client,
        transferId,
        'DESTINATION_ACCOUNT_MISSING'
      );

      await client.query('COMMIT');

      return {
        transfer_id: transferId,
        status: 'failed_terminal',
        stripe_transfer_id: null,
        failure_reason: 'DESTINATION_ACCOUNT_MISSING'
      };
    }

    // Step 4: Call Stripe with idempotency key (account is connected)
    const stripeResult = await StripePayoutAdapter.createTransfer({
      amountCents: transfer.amount_cents,
      destination,
      idempotencyKey: `payout:${transferId}`
    });

    // Step 5: Handle Stripe result and update transfer state
    let updatedTransfer;
    let ledgerEntryType;
    let ledgerDirection;

    if (stripeResult.success) {
      // Successful transfer
      updatedTransfer = await PayoutTransfersRepository.markCompleted(
        client,
        transferId,
        stripeResult.transferId
      );

      ledgerEntryType = 'PAYOUT_COMPLETED';
      ledgerDirection = 'CREDIT';
    } else if (processingTransfer.attempt_count >= transfer.max_attempts) {
      // Max attempts exhausted - mark as failed_terminal regardless of error classification
      updatedTransfer = await PayoutTransfersRepository.markFailedTerminal(
        client,
        transferId,
        stripeResult.reason
      );

      ledgerEntryType = 'PAYOUT_FAILED_TERMINAL';
      ledgerDirection = 'DEBIT';
    } else if (stripeResult.classification === 'retryable') {
      // Transient error - mark as retryable for automatic retry
      updatedTransfer = await PayoutTransfersRepository.markRetryable(
        client,
        transferId,
        stripeResult.reason
      );

      ledgerEntryType = 'PAYOUT_RETRYABLE';
      ledgerDirection = 'DEBIT'; // Tentative debit, not final
    } else if (stripeResult.classification === 'permanent') {
      // Permanent error - mark as failed_terminal
      updatedTransfer = await PayoutTransfersRepository.markFailedTerminal(
        client,
        transferId,
        stripeResult.reason
      );

      ledgerEntryType = 'PAYOUT_FAILED_TERMINAL';
      ledgerDirection = 'DEBIT';
    } else {
      // Should not reach here - classify error should always return a valid classification
      throw new Error(`Invalid error classification: ${stripeResult.classification}`);
    }

    // Step 6: Fetch settlement snapshot binding for ledger audit trail (PGA v1 Section 4.1)
    const settlementResult = await client.query(
      `SELECT id, snapshot_id, snapshot_hash, scoring_run_id FROM settlement_records
       WHERE contest_instance_id = $1`,
      [transfer.contest_id]
    );
    const settlement = settlementResult.rows && settlementResult.rows.length > 0 ? settlementResult.rows[0] : null;

    // Create ledger entry for this attempt with snapshot binding
    await LedgerRepository.insertLedgerEntry(client, {
      contest_instance_id: transfer.contest_id,
      user_id: transfer.user_id,
      entry_type: ledgerEntryType,
      direction: ledgerDirection,
      amount_cents: transfer.amount_cents,
      reference_type: 'PAYOUT_TRANSFER',
      reference_id: transferId,
      idempotency_key: `ledger:payout:${transferId}:${processingTransfer.attempt_count}`,
      snapshot_id: settlement?.snapshot_id || null,
      snapshot_hash: settlement?.snapshot_hash || null,
      scoring_run_id: settlement?.scoring_run_id || null,
      metadata_json: {
        stripe_transfer_id: stripeResult.transferId || null,
        failure_reason: stripeResult.reason || null,
        attempt_number: processingTransfer.attempt_count,
        max_attempts: transfer.max_attempts
      }
    });

    await client.query('COMMIT');

    return {
      transfer_id: transferId,
      status: updatedTransfer.status,
      stripe_transfer_id: updatedTransfer.stripe_transfer_id || null,
      failure_reason: updatedTransfer.failure_reason || null
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get destination Stripe account for user payout.
 *
 * Performs lookup only; does NOT modify state or transition payout status.
 * State transitions (failed_terminal for missing account) happen in executeTransfer().
 *
 * Queries users.stripe_connected_account_id (Stripe connected account ID in acct_* format).
 * Returns null if user has not connected their Stripe account.
 * Throws if user not found (data consistency error).
 *
 * @private
 * @param {Object} pool - Database connection pool
 * @param {string} contestId - UUID of contest (unused, kept for interface consistency)
 * @param {string} userId - UUID of user
 * @returns {Promise<string|null>} Destination Stripe account ID (acct_*) or null if not connected
 * @throws {Error} USER_NOT_FOUND if user does not exist in database
 * @throws {Error} INVALID_USER_ID if userId is falsy
 */
async function getDestinationAccount(pool, contestId, userId) {
  // Defensive guard: userId must be provided
  if (!userId) {
    throw new Error('INVALID_USER_ID');
  }

  const result = await pool.query(
    `SELECT stripe_connected_account_id FROM users WHERE id = $1`,
    [userId]
  );

  // User not found - DB referential integrity error
  if (result.rows.length === 0) {
    const error = new Error(`User not found: ${userId}`);
    error.code = 'USER_NOT_FOUND';
    throw error;
  }

  const stripeConnectedAccountId = result.rows[0].stripe_connected_account_id;

  // If null (user hasn't connected Stripe account), return null for caller to handle
  if (!stripeConnectedAccountId) {
    return null;
  }

  // Validate format: must be Stripe connected account ID (acct_*)
  // If invalid format, treat as not connected (return null, not error)
  // This prevents corrupt data from blocking all payouts
  if (typeof stripeConnectedAccountId !== 'string' || !stripeConnectedAccountId.startsWith('acct_')) {
    return null;
  }

  return stripeConnectedAccountId;
}

module.exports = {
  executeTransfer
};
