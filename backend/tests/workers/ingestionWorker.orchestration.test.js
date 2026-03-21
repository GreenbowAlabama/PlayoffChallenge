/**
 * Ingestion Worker — Orchestration Tests
 *
 * Tests for worker's 2-phase orchestration logic:
 * - SCHEDULED: runPlayerPool only
 * - LOCKED: runPlayerPool + runScoring
 * - LIVE: runPlayerPool + runScoring
 *
 * These tests verify worker decision-making, not DB transaction internals.
 */

'use strict';

describe('Ingestion Worker — Phase Orchestration', () => {
  let runCycle;
  let mockRunPlayerPool;
  let mockRunScoring;
  let mockPool;

  beforeEach(() => {
    // Clear module cache to ensure fresh imports
    jest.resetModules();

    // Mock ingestionService before importing worker
    const mockIngestionService = {
      runPlayerPool: jest.fn().mockResolvedValue({
        phase: 'PLAYER_POOL',
        status: 'OK',
        processed: 0,
        skipped: 0,
        errors: []
      }),
      runScoring: jest.fn().mockResolvedValue({
        phase: 'SCORING',
        status: 'OK',
        processed: 0,
        skipped: 0,
        errors: []
      }),
      resetCycleCache: jest.fn()
    };

    jest.doMock('../../services/ingestionService', () => mockIngestionService);

    // Now import worker after mock is in place
    const worker = require('../../workers/ingestionWorker');
    runCycle = worker.runCycle;
    mockRunPlayerPool = mockIngestionService.runPlayerPool;
    mockRunScoring = mockIngestionService.runScoring;

    // Mock pool.query to return contests with different statuses
    mockPool = {
      query: jest.fn()
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.unmock('../../services/ingestionService');
  });

  it('SCHEDULED contest: calls runPlayerPool only, not runScoring', async () => {
    mockPool.query.mockResolvedValue({
      rows: [
        { id: 'ci-scheduled', status: 'SCHEDULED' }
      ]
    });

    await runCycle(mockPool);

    expect(mockRunPlayerPool).toHaveBeenCalledWith('ci-scheduled', mockPool);
    expect(mockRunScoring).not.toHaveBeenCalled();
  });

  it('LOCKED contest: calls both runPlayerPool and runScoring', async () => {
    mockPool.query.mockResolvedValue({
      rows: [
        { id: 'ci-locked', status: 'LOCKED' }
      ]
    });

    await runCycle(mockPool);

    expect(mockRunPlayerPool).toHaveBeenCalledWith('ci-locked', mockPool);
    expect(mockRunScoring).toHaveBeenCalledWith('ci-locked', mockPool);
  });

  it('LIVE contest: calls both runPlayerPool and runScoring', async () => {
    mockPool.query.mockResolvedValue({
      rows: [
        { id: 'ci-live', status: 'LIVE' }
      ]
    });

    await runCycle(mockPool);

    expect(mockRunPlayerPool).toHaveBeenCalledWith('ci-live', mockPool);
    expect(mockRunScoring).toHaveBeenCalledWith('ci-live', mockPool);
  });

  it('mixed statuses: orchestrates each contest correctly', async () => {
    mockPool.query.mockResolvedValue({
      rows: [
        { id: 'ci-scheduled', status: 'SCHEDULED' },
        { id: 'ci-locked', status: 'LOCKED' },
        { id: 'ci-live', status: 'LIVE' }
      ]
    });

    await runCycle(mockPool);

    // SCHEDULED: only PLAYER_POOL
    expect(mockRunPlayerPool).toHaveBeenCalledWith('ci-scheduled', mockPool);

    // LOCKED: both phases
    expect(mockRunPlayerPool).toHaveBeenCalledWith('ci-locked', mockPool);
    expect(mockRunScoring).toHaveBeenCalledWith('ci-locked', mockPool);

    // LIVE: both phases
    expect(mockRunPlayerPool).toHaveBeenCalledWith('ci-live', mockPool);
    expect(mockRunScoring).toHaveBeenCalledWith('ci-live', mockPool);

    // SCORING never called for SCHEDULED
    const scoringCalls = mockRunScoring.mock.calls;
    const scheduledCalls = scoringCalls.filter(call => call[0] === 'ci-scheduled');
    expect(scheduledCalls).toHaveLength(0);
  });

  it('empty result: returns 0 phases', async () => {
    mockPool.query.mockResolvedValue({
      rows: []
    });

    const result = await runCycle(mockPool);

    expect(result.contests).toBe(0);
    expect(mockRunPlayerPool).not.toHaveBeenCalled();
    expect(mockRunScoring).not.toHaveBeenCalled();
  });

  it('runPlayerPool rejection: still calls runScoring for LOCKED', async () => {
    mockRunPlayerPool.mockResolvedValue({
      phase: 'PLAYER_POOL',
      status: 'REJECTED',
      reason: 'NO_PROVIDER_EVENT_ID',
      processed: 0,
      skipped: 0,
      errors: 0
    });

    mockPool.query.mockResolvedValue({
      rows: [
        { id: 'ci-locked', status: 'LOCKED' }
      ]
    });

    await runCycle(mockPool);

    // Both phases are called even if PLAYER_POOL rejected
    expect(mockRunPlayerPool).toHaveBeenCalledWith('ci-locked', mockPool);
    expect(mockRunScoring).toHaveBeenCalledWith('ci-locked', mockPool);
  });

  it('runScoring rejection for SCHEDULED: logged and not called', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    mockPool.query.mockResolvedValue({
      rows: [
        { id: 'ci-scheduled', status: 'SCHEDULED' }
      ]
    });

    await runCycle(mockPool);

    // Verify SCORING not called at all
    expect(mockRunScoring).not.toHaveBeenCalled();

    // Verify log message for SCHEDULED_STATUS_NO_SCORING
    const logMessages = consoleSpy.mock.calls
      .map(call => call[0])
      .filter(msg => msg && msg.includes('SCHEDULED_STATUS_NO_SCORING'));
    expect(logMessages.length).toBeGreaterThan(0);

    consoleSpy.mockRestore();
  });

  it('returns cycle summary with phase counts', async () => {
    mockPool.query.mockResolvedValue({
      rows: [
        { id: 'ci-scheduled', status: 'SCHEDULED' },
        { id: 'ci-locked', status: 'LOCKED' }
      ]
    });

    const result = await runCycle(mockPool);

    expect(result.contests).toBe(2);
    // SCHEDULED: 1 phase (PLAYER_POOL)
    // LOCKED: 2 phases (PLAYER_POOL + SCORING)
    // Total: 3 phases run
    expect(result.phasesRun).toBe(3);
  });

  it('handles phase function errors without crashing', async () => {
    mockRunPlayerPool.mockRejectedValue(new Error('DB connection failed'));

    mockPool.query.mockResolvedValue({
      rows: [
        { id: 'ci-locked', status: 'LOCKED' }
      ]
    });

    const result = await runCycle(mockPool);

    // Cycle completes with error count
    expect(result.failed).toBe(1);
  });

  it('query filters to SCHEDULED + LOCKED + LIVE only', async () => {
    mockPool.query.mockResolvedValue({
      rows: []
    });

    await runCycle(mockPool);

    const queryCall = mockPool.query.mock.calls[0][0];
    expect(queryCall).toContain("status IN ('SCHEDULED','LOCKED','LIVE')");
    expect(queryCall).toContain('provider_event_id IS NOT NULL');
  });
});
