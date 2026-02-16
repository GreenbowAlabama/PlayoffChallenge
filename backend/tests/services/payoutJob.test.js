/**
 * Payout Job Service Tests
 *
 * Tests for job lifecycle management and batch transfer processing.
 *
 * Coverage:
 * - Job status transitions (pending → processing → complete)
 * - Batch transfer processing
 * - Terminal detection (job complete when all transfers terminal)
 * - Job completion when all transfers done
 * - Idempotency: processing same job multiple times is safe
 */

const PayoutJobService = require('../../services/PayoutJobService');
const PayoutJobsRepository = require('../../repositories/PayoutJobsRepository');
const PayoutTransfersRepository = require('../../repositories/PayoutTransfersRepository');
const PayoutExecutionService = require('../../services/PayoutExecutionService');
const { createMockPool } = require('../mocks/mockPool');

jest.mock('../../repositories/PayoutJobsRepository');
jest.mock('../../repositories/PayoutTransfersRepository');
jest.mock('../../services/PayoutExecutionService');

describe('PayoutJobService', () => {
  let mockPool;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPool = createMockPool();
  });

  const jobId = 'job-uuid-1';
  const contestId = 'contest-uuid-1';

  const mockJob = {
    id: jobId,
    settlement_id: 'settlement-uuid-1',
    contest_id: contestId,
    status: 'pending',
    total_payouts: 2,
    completed_count: 0,
    failed_count: 0,
    created_at: new Date().toISOString()
  };

  const mockTransfers = [
    {
      id: 'transfer-1',
      payout_job_id: jobId,
      contest_id: contestId,
      user_id: 'user-1',
      amount_cents: 5000,
      status: 'pending',
      attempt_count: 0,
      max_attempts: 3
    },
    {
      id: 'transfer-2',
      payout_job_id: jobId,
      contest_id: contestId,
      user_id: 'user-2',
      amount_cents: 3000,
      status: 'pending',
      attempt_count: 0,
      max_attempts: 3
    }
  ];

  describe('processJob', () => {
    it('should process all pending transfers in job', async () => {
      PayoutJobsRepository.findById.mockResolvedValueOnce(mockJob);
      PayoutJobsRepository.updateStatus.mockResolvedValueOnce({ status: 'processing' });
      PayoutTransfersRepository.findPendingByJobId.mockResolvedValueOnce(mockTransfers);
      PayoutTransfersRepository.countTerminalByJobId.mockResolvedValueOnce({
        completed: 2,
        failed: 0,
        total: 2
      });
      PayoutJobsRepository.updateCounts.mockResolvedValueOnce({ status: 'complete' });

      PayoutExecutionService.executeTransfer.mockResolvedValueOnce({
        status: 'completed',
        transfer_id: 'transfer-1'
      });

      PayoutExecutionService.executeTransfer.mockResolvedValueOnce({
        status: 'completed',
        transfer_id: 'transfer-2'
      });

      const result = await PayoutJobService.processJob(mockPool, jobId);

      expect(result).toHaveProperty('job_id', jobId);
      expect(result).toHaveProperty('transfers_processed', 2);
      expect(result).toHaveProperty('transfers_completed', 2);
      expect(result).toHaveProperty('transfers_failed', 0);

      expect(PayoutExecutionService.executeTransfer).toHaveBeenCalledTimes(2);
    });

    it('should mark job as processing on first run', async () => {
      PayoutJobsRepository.findById.mockResolvedValueOnce(mockJob);
      PayoutJobsRepository.updateStatus.mockResolvedValueOnce({ status: 'processing' });
      PayoutTransfersRepository.findPendingByJobId.mockResolvedValueOnce([]);
      PayoutTransfersRepository.countTerminalByJobId.mockResolvedValueOnce({
        completed: 0,
        failed: 0,
        total: 2
      });

      await PayoutJobService.processJob(mockPool, jobId);

      expect(PayoutJobsRepository.updateStatus).toHaveBeenCalledWith(
        expect.any(Object),
        jobId,
        'processing',
        true // setStartedAt
      );
    });

    it('should return no-op for complete jobs', async () => {
      const completeJob = { ...mockJob, status: 'complete' };
      PayoutJobsRepository.findById.mockResolvedValueOnce(completeJob);

      const result = await PayoutJobService.processJob(mockPool, jobId);

      expect(result).toEqual({
        job_id: jobId,
        status: 'complete',
        transfers_processed: 0,
        transfers_completed: 0,
        transfers_failed: 0,
        transfers_retryable: 0,
        errors: []
      });

      expect(PayoutTransfersRepository.findPendingByJobId).not.toHaveBeenCalled();
    });

    it('should mark job complete when all transfers terminal', async () => {
      PayoutJobsRepository.findById.mockResolvedValueOnce(mockJob);
      PayoutJobsRepository.updateStatus.mockResolvedValueOnce({ status: 'processing' });
      PayoutTransfersRepository.findPendingByJobId.mockResolvedValueOnce(mockTransfers);
      PayoutTransfersRepository.countTerminalByJobId.mockResolvedValueOnce({
        completed: 2,
        failed: 0,
        total: 2
      });
      PayoutJobsRepository.updateCounts.mockResolvedValueOnce({ status: 'complete' });

      PayoutExecutionService.executeTransfer.mockResolvedValue({ status: 'completed' });

      await PayoutJobService.processJob(mockPool, jobId);

      expect(PayoutJobsRepository.updateCounts).toHaveBeenCalledWith(
        expect.any(Object),
        jobId,
        2, // completed_count
        0  // failed_count
      );
    });

    it('should handle mixed completed and failed transfers', async () => {
      const mixedTransfers = [
        { ...mockTransfers[0] },
        { ...mockTransfers[1] }
      ];

      PayoutJobsRepository.findById.mockResolvedValueOnce(mockJob);
      PayoutJobsRepository.updateStatus.mockResolvedValueOnce({ status: 'processing' });
      PayoutTransfersRepository.findPendingByJobId.mockResolvedValueOnce(mixedTransfers);
      PayoutTransfersRepository.countTerminalByJobId.mockResolvedValueOnce({
        completed: 1,
        failed: 1,
        total: 2
      });
      PayoutJobsRepository.updateCounts.mockResolvedValueOnce({ status: 'complete' });

      PayoutExecutionService.executeTransfer.mockResolvedValueOnce({ status: 'completed' });
      PayoutExecutionService.executeTransfer.mockResolvedValueOnce({ status: 'failed_terminal' });

      const result = await PayoutJobService.processJob(mockPool, jobId);

      expect(result.transfers_completed).toBe(1);
      expect(result.transfers_failed).toBe(1);

      expect(PayoutJobsRepository.updateCounts).toHaveBeenCalledWith(
        expect.any(Object),
        jobId,
        1,
        1
      );
    });

    it('should respect transfer batch size limit', async () => {
      const manyTransfers = Array.from({ length: 100 }, (_, i) => ({
        ...mockTransfers[0],
        id: `transfer-${i}`
      }));

      PayoutJobsRepository.findById.mockResolvedValueOnce(mockJob);
      PayoutJobsRepository.updateStatus.mockResolvedValueOnce({ status: 'processing' });
      PayoutTransfersRepository.findPendingByJobId.mockResolvedValueOnce(manyTransfers.slice(0, 50));
      PayoutTransfersRepository.countTerminalByJobId.mockResolvedValueOnce({
        completed: 0,
        failed: 0,
        total: 100
      });

      PayoutExecutionService.executeTransfer.mockResolvedValue({ status: 'completed' });

      await PayoutJobService.processJob(mockPool, jobId, { transferBatchSize: 50 });

      expect(PayoutTransfersRepository.findPendingByJobId).toHaveBeenCalledWith(
        mockPool,
        jobId,
        50
      );

      expect(PayoutExecutionService.executeTransfer).toHaveBeenCalledTimes(50);
    });

    it('should handle execution errors and continue processing', async () => {
      PayoutJobsRepository.findById.mockResolvedValueOnce(mockJob);
      PayoutJobsRepository.updateStatus.mockResolvedValueOnce({ status: 'processing' });
      PayoutTransfersRepository.findPendingByJobId.mockResolvedValueOnce(mockTransfers);
      PayoutTransfersRepository.countTerminalByJobId.mockResolvedValueOnce({
        completed: 0,
        failed: 0,
        total: 2
      });

      PayoutExecutionService.executeTransfer.mockRejectedValueOnce(new Error('DB error'));
      PayoutExecutionService.executeTransfer.mockResolvedValueOnce({ status: 'completed' });

      const result = await PayoutJobService.processJob(mockPool, jobId);

      expect(result.transfers_processed).toBe(2);
      expect(result.transfers_failed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toHaveProperty('error', 'DB error');
    });

    it('should throw if job not found', async () => {
      PayoutJobsRepository.findById.mockResolvedValueOnce(null);

      await expect(
        PayoutJobService.processJob(mockPool, jobId)
      ).rejects.toThrow(`Payout job not found: ${jobId}`);
    });
  });

  describe('processPendingJobs', () => {
    it('should process multiple pending jobs', async () => {
      const jobs = [
        { ...mockJob, id: 'job-1' },
        { ...mockJob, id: 'job-2' }
      ];

      PayoutJobsRepository.findPendingOrProcessing.mockResolvedValueOnce(jobs);

      PayoutJobsRepository.findById.mockResolvedValueOnce(jobs[0]);
      PayoutJobsRepository.updateStatus.mockResolvedValueOnce({ status: 'processing' });
      PayoutTransfersRepository.findPendingByJobId.mockResolvedValueOnce([]);
      PayoutTransfersRepository.countTerminalByJobId.mockResolvedValueOnce({
        completed: 0,
        failed: 0,
        total: 0
      });

      PayoutJobsRepository.findById.mockResolvedValueOnce(jobs[1]);
      PayoutJobsRepository.updateStatus.mockResolvedValueOnce({ status: 'processing' });
      PayoutTransfersRepository.findPendingByJobId.mockResolvedValueOnce([]);
      PayoutTransfersRepository.countTerminalByJobId.mockResolvedValueOnce({
        completed: 0,
        failed: 0,
        total: 0
      });

      const result = await PayoutJobService.processPendingJobs(mockPool);

      expect(result).toHaveProperty('jobs_processed', 2);
      expect(PayoutJobsRepository.findPendingOrProcessing).toHaveBeenCalledWith(mockPool, 10);
    });

    it('should respect job batch size limit', async () => {
      const jobs = Array.from({ length: 50 }, (_, i) => ({ ...mockJob, id: `job-${i}` }));

      PayoutJobsRepository.findPendingOrProcessing.mockResolvedValueOnce(jobs.slice(0, 25));

      await PayoutJobService.processPendingJobs(mockPool, { jobBatchSize: 25 });

      expect(PayoutJobsRepository.findPendingOrProcessing).toHaveBeenCalledWith(mockPool, 25);
    });

    it('should aggregate results from all jobs', async () => {
      const jobs = [
        { ...mockJob, id: 'job-1' },
        { ...mockJob, id: 'job-2' }
      ];

      PayoutJobsRepository.findPendingOrProcessing.mockResolvedValueOnce(jobs);

      // Mock job 1: 2 transfers processed
      PayoutJobsRepository.findById.mockResolvedValueOnce(jobs[0]);
      PayoutJobsRepository.updateStatus.mockResolvedValueOnce({ status: 'processing' });
      PayoutTransfersRepository.findPendingByJobId.mockResolvedValueOnce(mockTransfers);
      PayoutTransfersRepository.countTerminalByJobId.mockResolvedValueOnce({
        completed: 2,
        failed: 0,
        total: 2
      });
      PayoutJobsRepository.updateCounts.mockResolvedValueOnce({ status: 'complete' });
      PayoutExecutionService.executeTransfer.mockResolvedValue({ status: 'completed' });

      // Mock job 2: 0 transfers
      PayoutJobsRepository.findById.mockResolvedValueOnce(jobs[1]);
      PayoutJobsRepository.updateStatus.mockResolvedValueOnce({ status: 'processing' });
      PayoutTransfersRepository.findPendingByJobId.mockResolvedValueOnce([]);
      PayoutTransfersRepository.countTerminalByJobId.mockResolvedValueOnce({
        completed: 0,
        failed: 0,
        total: 0
      });

      const result = await PayoutJobService.processPendingJobs(mockPool);

      expect(result).toEqual(
        expect.objectContaining({
          jobs_processed: 2,
          jobs_completed: 1,
          total_transfers_processed: 2
        })
      );
    });

    it('should handle job processing errors gracefully', async () => {
      const jobs = [{ ...mockJob, id: 'job-1' }];

      PayoutJobsRepository.findPendingOrProcessing.mockResolvedValueOnce(jobs);
      PayoutJobsRepository.findById.mockRejectedValueOnce(new Error('DB error'));

      const result = await PayoutJobService.processPendingJobs(mockPool);

      expect(result).toEqual(
        expect.objectContaining({
          jobs_processed: 1,
          jobs_completed: 0,
          errors: expect.arrayContaining([
            expect.objectContaining({
              job_id: 'job-1',
              error: 'DB error'
            })
          ])
        })
      );
    });
  });
});
