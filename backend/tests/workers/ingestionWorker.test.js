/**
 * Ingestion Worker Tests
 *
 * Tests for the background ingestion worker that periodically
 * discovers active contest instances and triggers ingestion.
 */

'use strict';

describe('Ingestion Worker', () => {
  const { startIngestionWorker, stopIngestionWorker } = require('../../workers/ingestionWorker');
  const ingestionService = require('../../services/ingestionService');

  let mockPool;
  let mockQueryResult;

  beforeEach(() => {
    // Mock pool
    mockPool = {
      query: jest.fn()
    };

    // Clear any existing intervals
    stopIngestionWorker();

    // Mock ingestionService.run
    jest.spyOn(ingestionService, 'run').mockResolvedValue({
      processed: 1,
      skipped: 0,
      errors: []
    });
  });

  afterEach(() => {
    stopIngestionWorker();
    jest.restoreAllMocks();
  });

  describe('startIngestionWorker', () => {
    it('should start when called from non-test environment without explicit options', (done) => {
      mockPool.query.mockResolvedValue({
        rows: [{ id: 'ci-1' }]
      });

      // Set short interval for testing, simulating server.js call with minimal options
      startIngestionWorker(mockPool, { intervalMs: 100 });

      // Wait for at least one cycle
      setTimeout(() => {
        expect(mockPool.query).toHaveBeenCalled();
        expect(ingestionService.run).toHaveBeenCalledWith('ci-1', mockPool);
        stopIngestionWorker();
        done();
      }, 150);
    });

    it('should start with default settings', (done) => {
      mockPool.query.mockResolvedValue({
        rows: [{ id: 'ci-1' }]
      });

      startIngestionWorker(mockPool, {
        intervalMs: 100 // Short interval for testing
      });

      // Wait for at least one cycle
      setTimeout(() => {
        expect(mockPool.query).toHaveBeenCalled();
        expect(ingestionService.run).toHaveBeenCalledWith('ci-1', mockPool);
        stopIngestionWorker();
        done();
      }, 150);
    });

    it('should process multiple active contest instances', (done) => {
      mockPool.query.mockResolvedValue({
        rows: [{ id: 'ci-1' }, { id: 'ci-2' }]
      });

      startIngestionWorker(mockPool, {
        intervalMs: 100
      });

      setTimeout(() => {
        expect(ingestionService.run).toHaveBeenCalledWith('ci-1', mockPool);
        expect(ingestionService.run).toHaveBeenCalledWith('ci-2', mockPool);
        stopIngestionWorker();
        done();
      }, 150);
    });

    it('should handle database query errors gracefully', (done) => {
      mockPool.query.mockRejectedValue(new Error('DB connection failed'));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      startIngestionWorker(mockPool, {
        intervalMs: 100
      });

      setTimeout(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('[Ingestion Worker]')
        );
        expect(ingestionService.run).not.toHaveBeenCalled();
        stopIngestionWorker();
        consoleSpy.mockRestore();
        done();
      }, 150);
    });

    it('should handle ingestion errors gracefully', (done) => {
      mockPool.query.mockResolvedValue({
        rows: [{ id: 'ci-1' }]
      });

      ingestionService.run.mockRejectedValue(new Error('Ingestion failed'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      startIngestionWorker(mockPool, {
        intervalMs: 100
      });

      setTimeout(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('[Ingestion Worker]')
        );
        stopIngestionWorker();
        consoleSpy.mockRestore();
        done();
      }, 150);
    });

    it('should not start if already running', () => {
      mockPool.query.mockResolvedValue({
        rows: [{ id: 'ci-1' }]
      });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      startIngestionWorker(mockPool, { enabled: true, intervalMs: 100 });
      startIngestionWorker(mockPool, { enabled: true, intervalMs: 100 });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('already running')
      );

      stopIngestionWorker();
      consoleSpy.mockRestore();
    });

    it('should accept custom interval', (done) => {
      mockPool.query.mockResolvedValue({
        rows: [{ id: 'ci-1' }]
      });

      const customInterval = 50;
      startIngestionWorker(mockPool, {
        intervalMs: customInterval
      });

      // Wait for 2 cycles
      setTimeout(() => {
        expect(ingestionService.run.mock.calls.length).toBeGreaterThanOrEqual(2);
        stopIngestionWorker();
        done();
      }, 150);
    });
  });

  describe('stopIngestionWorker', () => {
    it('should stop the worker', (done) => {
      mockPool.query.mockResolvedValue({
        rows: [{ id: 'ci-1' }]
      });

      startIngestionWorker(mockPool, {
        intervalMs: 50
      });

      setTimeout(() => {
        const callCountBefore = ingestionService.run.mock.calls.length;
        stopIngestionWorker();

        setTimeout(() => {
          const callCountAfter = ingestionService.run.mock.calls.length;
          // Should not have additional calls after stop
          expect(callCountAfter).toBe(callCountBefore);
          done();
        }, 100);
      }, 100);
    });
  });

  describe('Query for active contest instances', () => {
    it('should query for OPEN, LOCKED, and LIVE contests', (done) => {
      mockPool.query.mockResolvedValue({
        rows: []
      });

      startIngestionWorker(mockPool, {
        intervalMs: 100
      });

      setTimeout(() => {
        const queryCall = mockPool.query.mock.calls[0];
        expect(queryCall[0]).toContain("status IN ('OPEN', 'LOCKED', 'LIVE')");
        stopIngestionWorker();
        done();
      }, 150);
    });

    it('should skip ingestion when no active contests exist', (done) => {
      mockPool.query.mockResolvedValue({
        rows: []
      });

      startIngestionWorker(mockPool, {
        intervalMs: 100
      });

      setTimeout(() => {
        expect(ingestionService.run).not.toHaveBeenCalled();
        stopIngestionWorker();
        done();
      }, 150);
    });
  });
});
