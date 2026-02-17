/**
 * PayoutTransfersRepository Tests
 *
 * Unit tests for PayoutTransfersRepository methods.
 * Tests type coercion and boundary conditions.
 */

const PayoutTransfersRepository = require('../../repositories/PayoutTransfersRepository');
const { createMockPool } = require('../mocks/mockPool');

describe('PayoutTransfersRepository', () => {
  let mockPool;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPool = createMockPool();
  });

  describe('countTerminalByJobId', () => {
    it('should return numeric types for all counts', async () => {
      // Simulate PostgreSQL returning aggregates as strings
      const mockResult = {
        rows: [
          {
            completed: '1',  // PostgreSQL returns string
            failed: '1',     // PostgreSQL returns string
            total: '2'       // PostgreSQL returns string
          }
        ]
      };

      mockPool.query.mockResolvedValueOnce(mockResult);

      const result = await PayoutTransfersRepository.countTerminalByJobId(
        mockPool,
        'job-uuid-1'
      );

      // All fields must be numbers, not strings
      expect(typeof result.completed).toBe('number');
      expect(typeof result.failed).toBe('number');
      expect(typeof result.total).toBe('number');

      // Values should be correctly coerced
      expect(result.completed).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.total).toBe(2);
    });

    it('should default to 0 when aggregates are null', async () => {
      const mockResult = {
        rows: [
          {
            completed: null,
            failed: null,
            total: null
          }
        ]
      };

      mockPool.query.mockResolvedValueOnce(mockResult);

      const result = await PayoutTransfersRepository.countTerminalByJobId(
        mockPool,
        'job-uuid-1'
      );

      expect(result.completed).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.total).toBe(0);
    });

    it('should handle empty result set', async () => {
      const mockResult = {
        rows: []
      };

      mockPool.query.mockResolvedValueOnce(mockResult);

      const result = await PayoutTransfersRepository.countTerminalByJobId(
        mockPool,
        'job-uuid-1'
      );

      expect(result.completed).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.total).toBe(0);
    });

    it('should pass correct SQL parameters', async () => {
      const mockResult = {
        rows: [{ completed: '0', failed: '0', total: '0' }]
      };

      mockPool.query.mockResolvedValueOnce(mockResult);

      const jobId = 'test-job-uuid';
      await PayoutTransfersRepository.countTerminalByJobId(mockPool, jobId);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('COUNT(*)'),
        [jobId]
      );
    });
  });
});
