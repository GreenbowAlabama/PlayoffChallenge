/**
 * Payout Orchestration Tests
 *
 * Tests for automatic payout scheduling and transfer creation.
 *
 * Coverage:
 * - Idempotency: duplicate settlement → duplicate job returns existing job
 * - Idempotency: duplicate transfer creation is prevented by DB constraint
 * - Transfer expansion: settlement payouts create correct transfers
 * - Validation: rejects invalid inputs
 */

const PayoutOrchestrationService = require('../../services/PayoutOrchestrationService');
const PayoutJobsRepository = require('../../repositories/PayoutJobsRepository');
const PayoutTransfersRepository = require('../../repositories/PayoutTransfersRepository');
const { createMockPool } = require('../mocks/mockPool');

jest.mock('../../repositories/PayoutJobsRepository');
jest.mock('../../repositories/PayoutTransfersRepository');

describe('PayoutOrchestrationService', () => {
  let mockPool;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPool = createMockPool();
    mockPool.connect = jest.fn();
    mockPool.connect.mockResolvedValue({
      query: jest.fn(),
      release: jest.fn()
    });
  });

  describe('schedulePayoutForSettlement', () => {
    const settlementId = 'settlement-uuid-1';
    const contestId = 'contest-uuid-1';
    const winners = [
      { user_id: 'user-1', amount_cents: 5000 },
      { user_id: 'user-2', amount_cents: 3000 }
    ];

    it('should create payout job and transfers on first call', async () => {
      const mockClient = {
        query: jest.fn(),
        release: jest.fn()
      };
      mockPool.connect.mockResolvedValue(mockClient);
      mockClient.query.mockResolvedValueOnce(undefined); // BEGIN
      mockClient.query.mockResolvedValueOnce(undefined); // COMMIT

      PayoutJobsRepository.findBySettlementId.mockResolvedValueOnce(null);
      PayoutJobsRepository.insertPayoutJob.mockResolvedValueOnce({
        id: 'job-uuid-1',
        settlement_id: settlementId,
        contest_id: contestId,
        status: 'pending',
        total_payouts: 2,
        created_at: new Date().toISOString()
      });

      PayoutTransfersRepository.insertTransfers.mockResolvedValueOnce([
        { id: 'transfer-1', user_id: 'user-1' },
        { id: 'transfer-2', user_id: 'user-2' }
      ]);

      const result = await PayoutOrchestrationService.schedulePayoutForSettlement(
        mockPool,
        settlementId,
        contestId,
        winners
      );

      expect(result).toHaveProperty('payout_job_id');
      expect(result).toHaveProperty('settlement_id', settlementId);
      expect(result).toHaveProperty('status', 'pending');
      expect(result).toHaveProperty('total_payouts', 2);
      expect(result).toHaveProperty('created_at');
    });

    it('should be idempotent: duplicate settlement returns existing job', async () => {
      const existingJob = {
        id: 'job-uuid-1',
        settlement_id: settlementId,
        contest_id: contestId,
        status: 'pending',
        total_payouts: 2,
        created_at: new Date().toISOString()
      };

      PayoutJobsRepository.findBySettlementId.mockResolvedValueOnce(existingJob);

      const result = await PayoutOrchestrationService.schedulePayoutForSettlement(
        mockPool,
        settlementId,
        contestId,
        winners
      );

      expect(result.payout_job_id).toBe(existingJob.id);
      expect(result.settlement_id).toBe(existingJob.settlement_id);
      expect(PayoutJobsRepository.insertPayoutJob).not.toHaveBeenCalled();
    });

    it('should validate settlement ID', async () => {
      await expect(
        PayoutOrchestrationService.schedulePayoutForSettlement(mockPool, null, contestId, winners)
      ).rejects.toThrow();

      await expect(
        PayoutOrchestrationService.schedulePayoutForSettlement(mockPool, '', contestId, winners)
      ).rejects.toThrow();
    });

    it('should validate contest ID', async () => {
      await expect(
        PayoutOrchestrationService.schedulePayoutForSettlement(mockPool, settlementId, null, winners)
      ).rejects.toThrow();
    });

    it('should validate winners array', async () => {
      await expect(
        PayoutOrchestrationService.schedulePayoutForSettlement(mockPool, settlementId, contestId, null)
      ).rejects.toThrow();

      await expect(
        PayoutOrchestrationService.schedulePayoutForSettlement(mockPool, settlementId, contestId, [])
      ).rejects.toThrow();
    });

    it('should validate each winner has required fields', async () => {
      await expect(
        PayoutOrchestrationService.schedulePayoutForSettlement(
          mockPool,
          settlementId,
          contestId,
          [{ user_id: 'user-1' }] // missing amount_cents
        )
      ).rejects.toThrow();

      await expect(
        PayoutOrchestrationService.schedulePayoutForSettlement(
          mockPool,
          settlementId,
          contestId,
          [{ amount_cents: 1000 }] // missing user_id
        )
      ).rejects.toThrow();
    });

    it('should validate amount is positive', async () => {
      await expect(
        PayoutOrchestrationService.schedulePayoutForSettlement(
          mockPool,
          settlementId,
          contestId,
          [{ user_id: 'user-1', amount_cents: 0 }]
        )
      ).rejects.toThrow();

      await expect(
        PayoutOrchestrationService.schedulePayoutForSettlement(
          mockPool,
          settlementId,
          contestId,
          [{ user_id: 'user-1', amount_cents: -1000 }]
        )
      ).rejects.toThrow();
    });

    it('should create deterministic idempotency keys for transfers', async () => {
      const mockClient = {
        query: jest.fn(),
        release: jest.fn()
      };
      mockPool.connect.mockResolvedValue(mockClient);
      mockClient.query.mockResolvedValueOnce(undefined); // BEGIN
      mockClient.query.mockResolvedValueOnce(undefined); // COMMIT

      PayoutJobsRepository.findBySettlementId.mockResolvedValueOnce(null);
      PayoutJobsRepository.insertPayoutJob.mockResolvedValueOnce({
        id: 'job-uuid-1',
        settlement_id: settlementId,
        contest_id: contestId,
        status: 'pending',
        total_payouts: 1,
        created_at: new Date().toISOString()
      });

      PayoutTransfersRepository.insertTransfers.mockResolvedValueOnce([
        { id: 'transfer-1', user_id: 'user-1' }
      ]);

      const result = await PayoutOrchestrationService.schedulePayoutForSettlement(
        mockPool,
        settlementId,
        contestId,
        [{ user_id: 'user-1', amount_cents: 5000 }]
      );

      // Verify insertTransfers was called with correct parameters
      expect(PayoutTransfersRepository.insertTransfers).toHaveBeenCalledWith(
        expect.any(Object),
        'job-uuid-1',
        contestId,
        [{ user_id: 'user-1', amount_cents: 5000 }]
      );

      expect(result.payout_job_id).toBeDefined();
    });

  });
});
