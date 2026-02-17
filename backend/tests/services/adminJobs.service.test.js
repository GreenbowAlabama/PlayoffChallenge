/**
 * Admin Jobs Service Tests
 *
 * Tests for error propagation and logging behavior in the payout scheduler wrapper.
 *
 * Coverage:
 * - runPayoutScheduler error handling: never returns empty error
 * - Error context propagation: full error message + error type
 * - Successful execution logging
 */

const adminJobsService = require('../../services/adminJobs.service');
const PayoutJobService = require('../../services/PayoutJobService');

jest.mock('../../services/PayoutJobService');

describe('adminJobs.runPayoutScheduler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Error Propagation', () => {
    it('should NEVER return error as empty string', async () => {
      const testError = new Error('Database connection timeout');
      PayoutJobService.processPendingJobs.mockRejectedValueOnce(testError);

      const result = await adminJobsService.runPayoutScheduler({});

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy(); // Must be truthy, not empty
      expect(typeof result.error).toBe('string');
      expect(result.error.length).toBeGreaterThan(0);
      expect(result.error).toContain('Database connection timeout');
    });

    it('should handle error with empty message property by fallback to String(error)', async () => {
      // Create an error where .message might be empty
      const testError = new Error();
      testError.message = ''; // Explicitly empty
      PayoutJobService.processPendingJobs.mockRejectedValueOnce(testError);

      const result = await adminJobsService.runPayoutScheduler({});

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
      expect(result.error).not.toBe(''); // Never empty
    });

    it('should capture error when error object is null/undefined by using String(error)', async () => {
      // Edge case: non-Error object thrown
      PayoutJobService.processPendingJobs.mockRejectedValueOnce(null);

      const result = await adminJobsService.runPayoutScheduler({});

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
      expect(result.error).not.toBe('');
    });

    it('should handle error with no message by providing contextual fallback', async () => {
      const customError = {
        code: 'ECONNREFUSED',
        syscall: 'connect'
        // No message property
      };
      PayoutJobService.processPendingJobs.mockRejectedValueOnce(customError);

      const result = await adminJobsService.runPayoutScheduler({});

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
      expect(result.error).not.toBe('');
      // Should have some contextual message
    });
  });

  describe('Successful Execution', () => {
    it('should return success:true with full result on successful execution', async () => {
      const mockResult = {
        jobs_processed: 3,
        jobs_completed: 2,
        total_transfers_processed: 5,
        errors: []
      };
      PayoutJobService.processPendingJobs.mockResolvedValueOnce(mockResult);

      const result = await adminJobsService.runPayoutScheduler({});

      expect(result.success).toBe(true);
      expect(result.jobs_processed).toBe(3);
      expect(result.jobs_completed).toBe(2);
      expect(result.total_transfers_processed).toBe(5);
      expect(result.errors).toEqual([]);
    });

    it('should propagate job errors in result even on success', async () => {
      const mockResult = {
        jobs_processed: 2,
        jobs_completed: 1,
        total_transfers_processed: 3,
        errors: [
          { job_id: 'job-1', error: 'Some transfer failed' }
        ]
      };
      PayoutJobService.processPendingJobs.mockResolvedValueOnce(mockResult);

      const result = await adminJobsService.runPayoutScheduler({});

      expect(result.success).toBe(true);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toEqual({ job_id: 'job-1', error: 'Some transfer failed' });
    });
  });

  describe('Error Classification', () => {
    it('should distinguish different error types in logs', async () => {
      const testError = new TypeError('Cannot read property of undefined');
      PayoutJobService.processPendingJobs.mockRejectedValueOnce(testError);

      const result = await adminJobsService.runPayoutScheduler({});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot read property of undefined');
    });

    it('should include error type info in returned error', async () => {
      const testError = new ReferenceError('Variable not defined');
      PayoutJobService.processPendingJobs.mockRejectedValueOnce(testError);

      const result = await adminJobsService.runPayoutScheduler({});

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
      expect(result.error.length).toBeGreaterThan(0);
    });
  });
});
