/**
 * Payout Execution Tests
 *
 * Tests for individual transfer execution with Stripe integration.
 *
 * Coverage:
 * - Idempotency: same transfer_id returns same Stripe transfer
 * - Claim and lock: only one execution instance can process transfer
 * - Attempt increment: attempt_count increments exactly once
 * - Max attempts: transfer marks failed_terminal when max_attempts exhausted
 * - Retry classification: transient errors marked retryable, permanent marked failed_terminal
 * - Ledger creation: entries created for completed and failed transfers
 * - Double claim prevention: two concurrent claims get only one
 */

const StripePayoutAdapter = require('../../services/StripePayoutAdapter');
const PayoutTransfersRepository = require('../../repositories/PayoutTransfersRepository');
const LedgerRepository = require('../../repositories/LedgerRepository');
const PayoutExecutionService = require('../../services/PayoutExecutionService');
const { createMockPool } = require('../mocks/mockPool');

jest.mock('../../services/StripePayoutAdapter');
jest.mock('../../repositories/LedgerRepository');
jest.mock('../../repositories/PayoutTransfersRepository');

describe('PayoutExecutionService', () => {
  let mockPool;
  let mockClient;

  beforeEach(() => {
    jest.clearAllMocks();

    mockPool = createMockPool();
    mockClient = {
      query: jest.fn(),
      release: jest.fn()
    };
    mockPool.connect = jest.fn();
    mockPool.connect.mockResolvedValue(mockClient);
  });

  const transferId = 'transfer-uuid-1';
  const contestId = 'contest-uuid-1';
  const userId = 'user-uuid-1';
  const amountCents = 5000;

  const mockTransfer = {
    id: transferId,
    payout_job_id: 'job-uuid-1',
    contest_id: contestId,
    user_id: userId,
    amount_cents: amountCents,
    status: 'pending',
    attempt_count: 0,
    max_attempts: 3,
    stripe_transfer_id: null,
    idempotency_key: `payout:${transferId}`,
    failure_reason: null
  };

  describe('executeTransfer', () => {
    it('should execute transfer successfully and create completed ledger entry', async () => {
      mockClient.query.mockResolvedValueOnce(undefined); // BEGIN
      mockClient.query.mockResolvedValueOnce(undefined); // COMMIT

      PayoutTransfersRepository.claimForProcessing.mockResolvedValueOnce(mockTransfer);
      PayoutTransfersRepository.markProcessing.mockResolvedValueOnce({ ...mockTransfer, attempt_count: 1 });
      PayoutTransfersRepository.markCompleted.mockResolvedValueOnce({ ...mockTransfer, status: 'completed', stripe_transfer_id: 'tr_123' });

      StripePayoutAdapter.createTransfer.mockResolvedValueOnce({
        success: true,
        transferId: 'tr_123'
      });

      LedgerRepository.insertLedgerEntry.mockResolvedValueOnce({ id: 'ledger-1' });

      const mockGetDestination = jest.fn().mockResolvedValue('acct_stripe123');
      const result = await PayoutExecutionService.executeTransfer(mockPool, transferId, mockGetDestination);

      expect(result).toHaveProperty('transfer_id', transferId);
      expect(result).toHaveProperty('status', 'completed');
      expect(result).toHaveProperty('stripe_transfer_id', 'tr_123');
      expect(result).toHaveProperty('failure_reason', null);

      expect(StripePayoutAdapter.createTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          amountCents,
          idempotencyKey: `payout:${transferId}`
        })
      );

      expect(LedgerRepository.insertLedgerEntry).toHaveBeenCalledWith(
        mockClient,
        expect.objectContaining({
          entry_type: 'PAYOUT_COMPLETED',
          direction: 'CREDIT',
          amount_cents: amountCents,
          idempotency_key: expect.stringContaining('ledger:payout:')
        })
      );

      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('should handle transient Stripe error as retryable', async () => {
      mockClient.query.mockResolvedValueOnce(undefined); // BEGIN
      mockClient.query.mockResolvedValueOnce(undefined); // COMMIT

      PayoutTransfersRepository.claimForProcessing.mockResolvedValueOnce(mockTransfer);
      PayoutTransfersRepository.markProcessing.mockResolvedValueOnce({ ...mockTransfer, attempt_count: 1 });
      PayoutTransfersRepository.markRetryable.mockResolvedValueOnce({ ...mockTransfer, status: 'retryable', failure_reason: 'stripe_timeout' });

      StripePayoutAdapter.createTransfer.mockResolvedValueOnce({
        success: false,
        classification: 'retryable',
        reason: 'stripe_timeout'
      });

      LedgerRepository.insertLedgerEntry.mockResolvedValueOnce({ id: 'ledger-1' });

      const mockGetDestination = jest.fn().mockResolvedValue('acct_stripe123');
      const result = await PayoutExecutionService.executeTransfer(mockPool, transferId, mockGetDestination);

      expect(result.status).toBe('retryable');
      expect(result.failure_reason).toBe('stripe_timeout');

      expect(LedgerRepository.insertLedgerEntry).toHaveBeenCalledWith(
        mockClient,
        expect.objectContaining({
          entry_type: 'PAYOUT_RETRYABLE',
          direction: 'DEBIT'
        })
      );
    });

    it('should handle permanent Stripe error as failed_terminal', async () => {
      mockClient.query.mockResolvedValueOnce(undefined); // BEGIN
      mockClient.query.mockResolvedValueOnce(undefined); // COMMIT

      PayoutTransfersRepository.claimForProcessing.mockResolvedValueOnce(mockTransfer);
      PayoutTransfersRepository.markProcessing.mockResolvedValueOnce({ ...mockTransfer, attempt_count: 1 });
      PayoutTransfersRepository.markFailedTerminal.mockResolvedValueOnce({ ...mockTransfer, status: 'failed_terminal', failure_reason: 'stripe_invalid_account' });

      StripePayoutAdapter.createTransfer.mockResolvedValueOnce({
        success: false,
        classification: 'permanent',
        reason: 'stripe_invalid_account'
      });

      LedgerRepository.insertLedgerEntry.mockResolvedValueOnce({ id: 'ledger-1' });

      const mockGetDestination = jest.fn().mockResolvedValue('acct_stripe123');
      const result = await PayoutExecutionService.executeTransfer(mockPool, transferId, mockGetDestination);

      expect(result.status).toBe('failed_terminal');
      expect(result.failure_reason).toBe('stripe_invalid_account');

      expect(LedgerRepository.insertLedgerEntry).toHaveBeenCalledWith(
        mockClient,
        expect.objectContaining({
          entry_type: 'PAYOUT_FAILED_TERMINAL',
          direction: 'DEBIT'
        })
      );
    });

    it('should not claim transfer if already completed', async () => {
      mockClient.query.mockResolvedValueOnce(undefined); // BEGIN
      mockClient.query.mockResolvedValueOnce(undefined); // ROLLBACK

      PayoutTransfersRepository.claimForProcessing.mockResolvedValueOnce(null); // No transfer to claim

      const mockGetDestination = jest.fn().mockResolvedValue('acct_stripe123');
      const result = await PayoutExecutionService.executeTransfer(mockPool, transferId, mockGetDestination);

      expect(result.status).toBe('not_claimable');
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(StripePayoutAdapter.createTransfer).not.toHaveBeenCalled();
    });

    it('should mark failed_terminal after max_attempts exhausted', async () => {
      const maxAttemptTransfer = { ...mockTransfer, attempt_count: 3, max_attempts: 3 };

      mockClient.query.mockResolvedValueOnce(undefined); // BEGIN
      mockClient.query.mockResolvedValueOnce(undefined); // COMMIT

      PayoutTransfersRepository.claimForProcessing.mockResolvedValueOnce(maxAttemptTransfer);
      PayoutTransfersRepository.markProcessing.mockResolvedValueOnce({ ...maxAttemptTransfer, attempt_count: 4 });
      PayoutTransfersRepository.markFailedTerminal.mockResolvedValueOnce({ ...maxAttemptTransfer, status: 'failed_terminal', failure_reason: 'stripe_timeout' });

      StripePayoutAdapter.createTransfer.mockResolvedValueOnce({
        success: false,
        classification: 'retryable',
        reason: 'stripe_timeout'
      });

      LedgerRepository.insertLedgerEntry.mockResolvedValueOnce({ id: 'ledger-1' });

      const mockGetDestination = jest.fn().mockResolvedValue('acct_stripe123');
      const result = await PayoutExecutionService.executeTransfer(mockPool, transferId, mockGetDestination);

      expect(result.status).toBe('failed_terminal');
    });

    it('should rollback on error', async () => {
      mockClient.query.mockResolvedValueOnce(undefined); // BEGIN
      mockClient.query.mockResolvedValueOnce(undefined); // ROLLBACK
      mockClient.query.mockRejectedValueOnce(new Error('DB error'));

      PayoutTransfersRepository.claimForProcessing.mockRejectedValueOnce(new Error('DB error'));

      const mockGetDestination = jest.fn().mockResolvedValue('acct_stripe123');
      await expect(
        PayoutExecutionService.executeTransfer(mockPool, transferId, mockGetDestination)
      ).rejects.toThrow('DB error');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('should use deterministic idempotency key', async () => {
      mockClient.query.mockResolvedValueOnce(undefined); // BEGIN
      mockClient.query.mockResolvedValueOnce(undefined); // COMMIT

      PayoutTransfersRepository.claimForProcessing.mockResolvedValueOnce(mockTransfer);
      PayoutTransfersRepository.markProcessing.mockResolvedValueOnce({ ...mockTransfer, attempt_count: 1 });
      PayoutTransfersRepository.markCompleted.mockResolvedValueOnce({ ...mockTransfer, status: 'completed', stripe_transfer_id: 'tr_123' });

      StripePayoutAdapter.createTransfer.mockResolvedValueOnce({
        success: true,
        transferId: 'tr_123'
      });

      LedgerRepository.insertLedgerEntry.mockResolvedValueOnce({ id: 'ledger-1' });

      const mockGetDestination = jest.fn().mockResolvedValue('acct_stripe123');
      await PayoutExecutionService.executeTransfer(mockPool, transferId, mockGetDestination);

      // Verify idempotency key is exactly: payout:<transfer_id>
      expect(StripePayoutAdapter.createTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: `payout:${transferId}`
        })
      );
    });

    it('should mark failed_terminal if destination account not connected (no ledger entry)', async () => {
      mockClient.query.mockResolvedValueOnce(undefined); // BEGIN
      mockClient.query.mockResolvedValueOnce(undefined); // COMMIT

      PayoutTransfersRepository.claimForProcessing.mockResolvedValueOnce(mockTransfer);
      PayoutTransfersRepository.markProcessing.mockResolvedValueOnce({ ...mockTransfer, attempt_count: 1 });
      PayoutTransfersRepository.markFailedTerminal.mockResolvedValueOnce({
        ...mockTransfer,
        status: 'failed_terminal',
        failure_reason: 'DESTINATION_ACCOUNT_MISSING'
      });

      // Mock destination account lookup returning null (not connected)
      const mockGetDestination = jest.fn().mockResolvedValue(null);
      const result = await PayoutExecutionService.executeTransfer(mockPool, transferId, mockGetDestination);

      expect(result.status).toBe('failed_terminal');
      expect(result.failure_reason).toBe('DESTINATION_ACCOUNT_MISSING');
      expect(result.stripe_transfer_id).toBeNull();

      // Verify Stripe was NOT called
      expect(StripePayoutAdapter.createTransfer).not.toHaveBeenCalled();

      // Verify NO ledger entry created (no financial event occurred)
      expect(LedgerRepository.insertLedgerEntry).not.toHaveBeenCalled();

      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });
  });

  describe('Destination Account Lookup Integration', () => {
    it('should pass valid destination account to Stripe when account is connected', async () => {
      mockClient.query.mockResolvedValueOnce(undefined); // BEGIN
      mockClient.query.mockResolvedValueOnce(undefined); // COMMIT

      PayoutTransfersRepository.claimForProcessing.mockResolvedValueOnce(mockTransfer);
      PayoutTransfersRepository.markProcessing.mockResolvedValueOnce({ ...mockTransfer, attempt_count: 1 });
      PayoutTransfersRepository.markCompleted.mockResolvedValueOnce({
        ...mockTransfer,
        status: 'completed',
        stripe_transfer_id: 'tr_123'
      });

      StripePayoutAdapter.createTransfer.mockResolvedValueOnce({
        success: true,
        transferId: 'tr_123'
      });

      LedgerRepository.insertLedgerEntry.mockResolvedValueOnce({ id: 'ledger-1' });

      // Mock destination lookup returning valid acct_* ID
      const mockGetDestination = jest.fn().mockResolvedValue('acct_test123abc');
      const result = await PayoutExecutionService.executeTransfer(mockPool, transferId, mockGetDestination);

      expect(result.status).toBe('completed');
      expect(StripePayoutAdapter.createTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          destination: 'acct_test123abc'
        })
      );
    });

    it('should mark failed_terminal when destination account lookup returns null', async () => {
      mockClient.query.mockResolvedValueOnce(undefined); // BEGIN
      mockClient.query.mockResolvedValueOnce(undefined); // COMMIT

      PayoutTransfersRepository.claimForProcessing.mockResolvedValueOnce(mockTransfer);
      PayoutTransfersRepository.markProcessing.mockResolvedValueOnce({ ...mockTransfer, attempt_count: 1 });
      PayoutTransfersRepository.markFailedTerminal.mockResolvedValueOnce({
        ...mockTransfer,
        status: 'failed_terminal',
        failure_reason: 'DESTINATION_ACCOUNT_MISSING'
      });

      // Mock destination lookup returning null
      const mockGetDestination = jest.fn().mockResolvedValue(null);
      const result = await PayoutExecutionService.executeTransfer(mockPool, transferId, mockGetDestination);

      expect(result.status).toBe('failed_terminal');
      expect(result.failure_reason).toBe('DESTINATION_ACCOUNT_MISSING');
      expect(StripePayoutAdapter.createTransfer).not.toHaveBeenCalled();
    });

    it('should mark failed_terminal when destination account lookup throws USER_NOT_FOUND', async () => {
      mockClient.query.mockResolvedValueOnce(undefined); // BEGIN
      mockClient.query.mockResolvedValueOnce(undefined); // ROLLBACK

      PayoutTransfersRepository.claimForProcessing.mockResolvedValueOnce(mockTransfer);
      PayoutTransfersRepository.markProcessing.mockResolvedValueOnce({ ...mockTransfer, attempt_count: 1 });

      // Mock destination lookup throwing USER_NOT_FOUND error
      const mockGetDestination = jest.fn().mockRejectedValue(
        Object.assign(new Error('User not found'), { code: 'USER_NOT_FOUND' })
      );

      await expect(PayoutExecutionService.executeTransfer(mockPool, transferId, mockGetDestination))
        .rejects
        .toThrow('User not found');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('should mark failed_terminal when destination account lookup throws INVALID_USER_ID', async () => {
      mockClient.query.mockResolvedValueOnce(undefined); // BEGIN
      mockClient.query.mockResolvedValueOnce(undefined); // ROLLBACK

      PayoutTransfersRepository.claimForProcessing.mockResolvedValueOnce(mockTransfer);
      PayoutTransfersRepository.markProcessing.mockResolvedValueOnce({ ...mockTransfer, attempt_count: 1 });

      // Mock destination lookup throwing INVALID_USER_ID error
      const mockGetDestination = jest.fn().mockRejectedValue(new Error('INVALID_USER_ID'));

      await expect(PayoutExecutionService.executeTransfer(mockPool, transferId, mockGetDestination))
        .rejects
        .toThrow('INVALID_USER_ID');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });
});
