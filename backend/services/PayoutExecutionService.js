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

    // Step 3: Call Stripe with idempotency key
    // Idempotency key is deterministic: payout:<transfer_id>
    // TODO: Implement destination account lookup from user_stripe_accounts or similar
    const destination = getDestinationAccountFn
      ? await getDestinationAccountFn(pool, transfer.contest_id, transfer.user_id)
      : await getDestinationAccount(pool, transfer.contest_id, transfer.user_id);

    const stripeResult = await StripePayoutAdapter.createTransfer({
      amountCents: transfer.amount_cents,
      destination,
      idempotencyKey: `payout:${transferId}`
    });

    // Step 4: Handle Stripe result and update transfer state
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

    // Step 5: Create ledger entry for this attempt
    await LedgerRepository.insertLedgerEntry(client, {
      contest_instance_id: transfer.contest_id,
      user_id: transfer.user_id,
      entry_type: ledgerEntryType,
      direction: ledgerDirection,
      amount_cents: transfer.amount_cents,
      reference_type: 'PAYOUT_TRANSFER',
      reference_id: transferId,
      idempotency_key: `ledger:payout:${transferId}:${processingTransfer.attempt_count}`,
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
 * Placeholder for fetching connected Stripe account ID for a user.
 * In production, this would query user_stripe_accounts or similar table.
 *
 * @private
 * @param {Object} pool - Database connection pool
 * @param {string} contestId - UUID of contest
 * @param {string} userId - UUID of user
 * @returns {Promise<string>} Destination Stripe account ID
 * @throws {Error} If destination account not found
 */
async function getDestinationAccount(pool, contestId, userId) {
  // TODO: Implement in production
  // This should query a user_stripe_accounts or contest_connected_accounts table
  // For now, return placeholder that will cause Stripe error
  throw new Error('Destination account lookup not yet implemented');
}

module.exports = {
  executeTransfer
};
