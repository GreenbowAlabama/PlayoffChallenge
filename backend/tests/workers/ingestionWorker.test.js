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

  describe('Status filtering', () => {
    it('should filter contests by status (LOCKED, LIVE) in query', (done) => {
      mockPool.query.mockResolvedValue({
        rows: []
      });

      startIngestionWorker(mockPool, {
        intervalMs: 100
      });

      setTimeout(() => {
        const queryCall = mockPool.query.mock.calls[0];
        const query = queryCall[0];
        expect(query).toContain('contest_instances ci');
        expect(query).toContain('JOIN tournament_configs tc');
        expect(query).toContain("ci.status IN ('LOCKED','LIVE')");
        expect(query).toContain('provider_event_id IS NOT NULL');
        stopIngestionWorker();
        done();
      }, 150);
    });

    it('should only process LOCKED or LIVE contests', (done) => {
      mockPool.query.mockResolvedValue({
        rows: [
          { id: 'ci-locked' },
          { id: 'ci-live' }
        ]
      });

      startIngestionWorker(mockPool, {
        intervalMs: 100
      });

      setTimeout(() => {
        expect(ingestionService.run).toHaveBeenCalledWith('ci-locked', mockPool);
        expect(ingestionService.run).toHaveBeenCalledWith('ci-live', mockPool);
        expect(ingestionService.run).toHaveBeenCalledTimes(2);
        stopIngestionWorker();
        done();
      }, 150);
    });

    it('should not query SCHEDULED contests', (done) => {
      mockPool.query.mockResolvedValue({
        rows: []
      });

      startIngestionWorker(mockPool, {
        intervalMs: 100
      });

      setTimeout(() => {
        const queryCall = mockPool.query.mock.calls[0];
        const query = queryCall[0];
        // Verify SCHEDULED is not in the status filter
        expect(query).not.toContain("'SCHEDULED'");
        stopIngestionWorker();
        done();
      }, 150);
    });
  });

  describe('Tournament-driven discovery', () => {
    it('should discover contests via tournament_configs with provider_event_id', (done) => {
      mockPool.query.mockResolvedValue({
        rows: []
      });

      startIngestionWorker(mockPool, {
        intervalMs: 100
      });

      setTimeout(() => {
        const queryCall = mockPool.query.mock.calls[0];
        expect(queryCall[0]).toContain('tournament_configs');
        expect(queryCall[0]).toContain('provider_event_id IS NOT NULL');
        stopIngestionWorker();
        done();
      }, 150);
    });

    it('should run ingestion when provider_event_id exists', (done) => {
      mockPool.query.mockResolvedValue({
        rows: [{ id: 'ci-tournament-1' }]
      });

      startIngestionWorker(mockPool, {
        intervalMs: 100
      });

      setTimeout(() => {
        expect(ingestionService.run).toHaveBeenCalledWith('ci-tournament-1', mockPool);
        stopIngestionWorker();
        done();
      }, 150);
    });

    it('should skip ingestion when no tournament_configs exist', (done) => {
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

    it('should process multiple contests from tournament_configs', (done) => {
      mockPool.query.mockResolvedValue({
        rows: [
          { id: 'ci-tournament-1' },
          { id: 'ci-tournament-2' }
        ]
      });

      startIngestionWorker(mockPool, {
        intervalMs: 100
      });

      setTimeout(() => {
        expect(ingestionService.run).toHaveBeenCalledWith('ci-tournament-1', mockPool);
        expect(ingestionService.run).toHaveBeenCalledWith('ci-tournament-2', mockPool);
        stopIngestionWorker();
        done();
      }, 150);
    });
  });
});
