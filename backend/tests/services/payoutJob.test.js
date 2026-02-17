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
              error: expect.stringContaining('processJob failed: DB error')
            })
          ])
        })
      );
    });
  });

  describe('Job Finalization (BLOCKER FIX)', () => {
    it('BLOCKER FIX: should finalize job when all transfers already terminal from previous run', async () => {
      // Scenario: Scheduler runs, finds job in 'pending' status with all transfers already 'completed' or 'failed_terminal'
      // This was the observed blocker: job stayed in 'pending' with completed_count=0, failed_count=0
      const processingJob = { ...mockJob, status: 'processing' };

      PayoutJobsRepository.findById.mockResolvedValueOnce(processingJob);
      PayoutJobsRepository.updateStatus.mockResolvedValueOnce({ status: 'processing' });

      // CRITICAL: No pending/retryable transfers (all already terminal)
      PayoutTransfersRepository.findPendingByJobId.mockResolvedValueOnce([]);

      // CRITICAL: Terminal check shows all transfers are done (1 completed, 1 failed_terminal)
      PayoutTransfersRepository.countTerminalByJobId.mockResolvedValueOnce({
        completed: 1,
        failed: 1,
        total: 2
      });

      PayoutJobsRepository.updateCounts.mockResolvedValueOnce({
        id: jobId,
        completed_count: 1,
        failed_count: 1,
        status: 'complete'
      });

      const result = await PayoutJobService.processJob(mockPool, jobId);

      // MUST finalize the job even though no transfers were processed in this execution
      expect(result).toEqual(
        expect.objectContaining({
          job_id: jobId,
          status: 'complete',
          transfers_processed: 0,
          transfers_completed: 0,
          transfers_failed: 0,
          errors: []
        })
      );

      // MUST call updateCounts to set completed_count, failed_count, and transition to 'complete'
      expect(PayoutJobsRepository.updateCounts).toHaveBeenCalledWith(
        expect.any(Object),
        jobId,
        1, // completed
        1  // failed
      );
    });

    it('should finalize job with mixed terminal states (1 completed, 1 failed_terminal)', async () => {
      const processingJob = { ...mockJob, status: 'processing' };

      PayoutJobsRepository.findById.mockResolvedValueOnce(processingJob);
      PayoutJobsRepository.updateStatus.mockResolvedValueOnce({ status: 'processing' });
      PayoutTransfersRepository.findPendingByJobId.mockResolvedValueOnce([]);
      PayoutTransfersRepository.countTerminalByJobId.mockResolvedValueOnce({
        completed: 1,
        failed: 1,
        total: 2
      });
      PayoutJobsRepository.updateCounts.mockResolvedValueOnce({
        id: jobId,
        completed_count: 1,
        failed_count: 1,
        status: 'complete'
      });

      const result = await PayoutJobService.processJob(mockPool, jobId);

      expect(result.status).toBe('complete');
      expect(PayoutJobsRepository.updateCounts).toHaveBeenCalledWith(
        expect.any(Object),
        jobId,
        1, // completed
        1  // failed
      );
    });

    it('should NOT finalize job if transfers are still in non-terminal state', async () => {
      const processingJob = { ...mockJob, status: 'processing' };

      PayoutJobsRepository.findById.mockResolvedValueOnce(processingJob);
      PayoutJobsRepository.updateStatus.mockResolvedValueOnce({ status: 'processing' });
      PayoutTransfersRepository.findPendingByJobId.mockResolvedValueOnce([]);

      // NOT all terminal: 1 completed, 1 retryable (will retry later)
      PayoutTransfersRepository.countTerminalByJobId.mockResolvedValueOnce({
        completed: 1,
        failed: 0,
        total: 2
      });

      const result = await PayoutJobService.processJob(mockPool, jobId);

      expect(result.status).toBe('processing');
      expect(PayoutJobsRepository.updateCounts).not.toHaveBeenCalled();
    });

    it('BLOCKER FIX: should be idempotent when called multiple times with all terminals', async () => {
      // First call
      const processingJob = { ...mockJob, status: 'processing' };
      PayoutJobsRepository.findById.mockResolvedValueOnce(processingJob);
      PayoutJobsRepository.updateStatus.mockResolvedValueOnce({ status: 'processing' });
      PayoutTransfersRepository.findPendingByJobId.mockResolvedValueOnce([]);
      PayoutTransfersRepository.countTerminalByJobId.mockResolvedValueOnce({
        completed: 1,
        failed: 1,
        total: 2
      });
      PayoutJobsRepository.updateCounts.mockResolvedValueOnce({
        id: jobId,
        completed_count: 1,
        failed_count: 1,
        status: 'complete'
      });

      const result1 = await PayoutJobService.processJob(mockPool, jobId);
      expect(result1.status).toBe('complete');

      // Second call (should be no-op - job already complete)
      const completeJob = { ...mockJob, status: 'complete' };
      PayoutJobsRepository.findById.mockResolvedValueOnce(completeJob);

      const result2 = await PayoutJobService.processJob(mockPool, jobId);

      expect(result2).toEqual({
        job_id: jobId,
        status: 'complete',
        transfers_processed: 0,
        transfers_completed: 0,
        transfers_failed: 0,
        transfers_retryable: 0,
        errors: []
      });

      // updateCounts called only once (not on second call)
      expect(PayoutJobsRepository.updateCounts).toHaveBeenCalledTimes(1);
    });

    it('should throw explicit error if terminal count is invalid', async () => {
      PayoutJobsRepository.findById.mockResolvedValueOnce(mockJob);
      PayoutJobsRepository.updateStatus.mockResolvedValueOnce({ status: 'processing' });
      PayoutTransfersRepository.findPendingByJobId.mockResolvedValueOnce([]);

      // Invalid terminal count (total is null/undefined)
      PayoutTransfersRepository.countTerminalByJobId.mockResolvedValueOnce({
        completed: 1,
        failed: 1,
        total: null
      });

      await expect(PayoutJobService.processJob(mockPool, jobId)).rejects.toThrow(
        /Invalid terminal count/
      );
    });

    it('should NOT silently swallow finalization errors', async () => {
      PayoutJobsRepository.findById.mockResolvedValueOnce(mockJob);
      PayoutJobsRepository.updateStatus.mockResolvedValueOnce({ status: 'processing' });
      PayoutTransfersRepository.findPendingByJobId.mockResolvedValueOnce([]);
      PayoutTransfersRepository.countTerminalByJobId.mockResolvedValueOnce({
        completed: 1,
        failed: 1,
        total: 2
      });

      // updateCounts fails
      PayoutJobsRepository.updateCounts.mockRejectedValueOnce(
        new Error('Database constraint violation')
      );

      const result = await PayoutJobService.processJob(mockPool, jobId);

      // Should return error in errors array (not throw)
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].error).toContain('Failed to finalize job');
      expect(result.errors[0].error).toContain('Database constraint violation');

      // Job status should NOT be 'complete' (finalization failed)
      expect(result.status).toBe('processing');
    });
  });

  describe('Error Propagation & Instrumentation', () => {
    it('should propagate job selection errors with full context', async () => {
      const selectionError = new Error('Connection timeout');

      PayoutJobsRepository.findPendingOrProcessing.mockRejectedValueOnce(selectionError);

      await expect(PayoutJobService.processPendingJobs(mockPool)).rejects.toThrow(
        /CRITICAL.*Failed to select pending\/processing jobs.*Connection timeout/
      );
    });

    it('should handle error objects without message property gracefully', async () => {
      // This tests that we fallback to String(error) if error.message is undefined
      const badError = new Error('DB connection lost');
      delete badError.message; // Simulate error without message property

      PayoutJobsRepository.findPendingOrProcessing.mockRejectedValueOnce(badError);

      await expect(PayoutJobService.processPendingJobs(mockPool)).rejects.toThrow(/CRITICAL.*Failed to select/);
    });

    it('should capture per-job errors without swallowing them', async () => {
      const jobs = [mockJob];

      PayoutJobsRepository.findPendingOrProcessing.mockResolvedValueOnce(jobs);
      PayoutJobsRepository.findById.mockRejectedValueOnce(new Error('DB error occurred'));

      const result = await PayoutJobService.processPendingJobs(mockPool);

      expect(result.jobs_processed).toBe(1);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].error).toContain('processJob failed');
      expect(result.errors[0].error).toContain('DB error occurred');
    });
  });

  describe('Stuck Jobs (Processing State Recovery)', () => {
    it('should process job that is stuck in processing state with all terminals', async () => {
      // Scenario: Job is in 'processing' state (from previous scheduler run)
      // but finalization didn't complete. Scheduler runs again and should finalize it.
      const stuckProcessingJob = { ...mockJob, status: 'processing', started_at: new Date().toISOString() };

      PayoutJobsRepository.findById.mockResolvedValueOnce(stuckProcessingJob);
      PayoutJobsRepository.updateStatus.mockResolvedValueOnce({ status: 'processing' });

      // No pending transfers (all already terminal from previous run)
      PayoutTransfersRepository.findPendingByJobId.mockResolvedValueOnce([]);

      // All transfers are terminal
      PayoutTransfersRepository.countTerminalByJobId.mockResolvedValueOnce({
        completed: 1,
        failed: 1,
        total: 2
      });

      PayoutJobsRepository.updateCounts.mockResolvedValueOnce({
        id: jobId,
        completed_count: 1,
        failed_count: 1,
        status: 'complete'
      });

      const result = await PayoutJobService.processJob(mockPool, jobId);

      // MUST finalize stuck job even though it's not in 'pending' state
      expect(result.status).toBe('complete');
      expect(PayoutJobsRepository.updateCounts).toHaveBeenCalledWith(
        expect.any(Object),
        jobId,
        1, // completed
        1  // failed
      );
    });

    it('should select and process jobs in processing state via processPendingJobs', async () => {
      // Scenario: processPendingJobs should select jobs with status IN ('pending', 'processing')
      // and ensure they are finalized
      const stuckJob = { ...mockJob, id: 'stuck-job-1', status: 'processing' };

      PayoutJobsRepository.findPendingOrProcessing.mockResolvedValueOnce([stuckJob]);
      PayoutJobsRepository.findById.mockResolvedValueOnce(stuckJob);
      PayoutJobsRepository.updateStatus.mockResolvedValueOnce({ status: 'processing' });
      PayoutTransfersRepository.findPendingByJobId.mockResolvedValueOnce([]);
      PayoutTransfersRepository.countTerminalByJobId.mockResolvedValueOnce({
        completed: 1,
        failed: 1,
        total: 2
      });
      PayoutJobsRepository.updateCounts.mockResolvedValueOnce({ status: 'complete' });

      const result = await PayoutJobService.processPendingJobs(mockPool);

      expect(result).toEqual(
        expect.objectContaining({
          jobs_processed: 1,
          jobs_completed: 1,
          total_transfers_processed: 0,
          errors: []
        })
      );

      expect(PayoutJobsRepository.findPendingOrProcessing).toHaveBeenCalledWith(mockPool, 10);
    });

    it('should provide full error context if job selection fails', async () => {
      PayoutJobsRepository.findPendingOrProcessing.mockRejectedValueOnce(
        new Error('Connection timeout')
      );

      await expect(PayoutJobService.processPendingJobs(mockPool)).rejects.toThrow(
        /CRITICAL.*Failed to select pending\/processing jobs.*Connection timeout/
      );
    });

    it('should capture full error message when processJob throws', async () => {
      const jobs = [mockJob];

      PayoutJobsRepository.findPendingOrProcessing.mockResolvedValueOnce(jobs);
      PayoutJobsRepository.findById.mockRejectedValueOnce(new Error('DB connection lost'));

      const result = await PayoutJobService.processPendingJobs(mockPool);

      expect(result).toEqual(
        expect.objectContaining({
          jobs_processed: 1,
          jobs_completed: 0,
          errors: expect.arrayContaining([
            expect.objectContaining({
              job_id: jobId,
              error: expect.stringContaining('processJob failed')
            })
          ])
        })
      );
    });
  });
});
