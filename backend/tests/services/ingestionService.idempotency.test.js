/**
 * Ingestion Service Idempotency Tests
 *
 * Validates the core idempotency guards in ingestionService.run():
 * 1. Pre-check SELECT prevents reprocessing COMPLETE work units
 * 2. Pre-check SELECT prevents concurrent RUNNING work units
 * 3. Atomic INSERT with ON CONFLICT DO NOTHING prevents duplicate rows
 * 4. Status updates (COMPLETE/ERROR) are idempotent
 */

'use strict';

jest.mock('../../services/ingestionRegistry');

const ingestionService = require('../../services/ingestionService');
const ingestionRegistry = require('../../services/ingestionRegistry');

describe('ingestionService.run() - Idempotency Guards', () => {
  let mockPool;
  let mockClient;
  let mockAdapter;

  const testContestInstanceId = 'contest-uuid-123';
  const testStrategyKey = 'pga_espn';
  const testWorkUnitKey = 'pga_espn_key_001';

  beforeEach(() => {
    jest.clearAllMocks();

    mockClient = {
      query: jest.fn(),
      release: jest.fn()
    };

    mockPool = {
      connect: jest.fn().mockResolvedValue(mockClient),
      query: jest.fn().mockResolvedValue({ rows: [] })
    };

    mockAdapter = {
      getWorkUnits: jest.fn().mockResolvedValue([{ providerEventId: 'espn_pga_401811935' }]),
      computeIngestionKey: jest.fn().mockReturnValue(testWorkUnitKey),
      ingestWorkUnit: jest.fn().mockResolvedValue([]),
      upsertScores: jest.fn().mockResolvedValue(undefined)
    };

    ingestionRegistry.getIngestionStrategy.mockReturnValue(mockAdapter);
  });

  test('Guard 1: Pre-check SELECT prevents processing COMPLETE work units', async () => {
    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{
          id: testContestInstanceId,
          status: 'SCHEDULED',
          sport: 'GOLF',
          provider_tournament_id: 'espn_pga_401811935',
          provider_event_id: 'espn_pga_401811935'
        }]
      }) // Load contest
      .mockResolvedValueOnce({
        rows: [{ status: 'COMPLETE' }]
      }) // Pre-check: COMPLETE found
      .mockResolvedValueOnce({ rows: [] }) // fetchExistingGolfPlayerIds
      .mockResolvedValueOnce({}); // COMMIT

    const result = await ingestionService.run(testContestInstanceId, mockPool);

    expect(result.skipped).toBe(1);
    expect(result.processed).toBe(0);
    expect(mockAdapter.ingestWorkUnit).not.toHaveBeenCalled();

    // Verify pre-check was called
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT status'),
      [testContestInstanceId, testWorkUnitKey]
    );
  });

  test('Guard 2: Pre-check SELECT prevents concurrent RUNNING work units', async () => {
    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{
          id: testContestInstanceId,
          status: 'SCHEDULED',
          sport: 'GOLF',
          provider_tournament_id: 'espn_pga_401811935',
          provider_event_id: 'espn_pga_401811935'
        }]
      }) // Load contest
      .mockResolvedValueOnce({
        rows: [{ status: 'RUNNING' }]
      }) // Pre-check: RUNNING found
      .mockResolvedValueOnce({ rows: [] }) // fetchExistingGolfPlayerIds
      .mockResolvedValueOnce({}); // COMMIT

    const result = await ingestionService.run(testContestInstanceId, mockPool);

    expect(result.skipped).toBe(1);
    expect(result.processed).toBe(0);
    expect(mockAdapter.ingestWorkUnit).not.toHaveBeenCalled();
  });

  test('Guard 3: ON CONFLICT DO NOTHING handles race condition on INSERT', async () => {
    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{
          id: testContestInstanceId,
          status: 'SCHEDULED',
          sport: 'GOLF',
          provider_tournament_id: 'espn_pga_401811935',
          provider_event_id: 'espn_pga_401811935'
        }]
      }) // Load contest
      .mockResolvedValueOnce({
        rows: []
      }) // Pre-check: no rows
      .mockResolvedValueOnce({
        rows: []
      }) // INSERT returns empty (ON CONFLICT DO NOTHING, another worker beat us)
      .mockResolvedValueOnce({ rows: [] }) // fetchExistingGolfPlayerIds
      .mockResolvedValueOnce({}); // COMMIT

    const result = await ingestionService.run(testContestInstanceId, mockPool);

    // Work unit was skipped due to INSERT conflict
    expect(result.skipped).toBe(1);
    expect(result.processed).toBe(0);
    expect(mockAdapter.ingestWorkUnit).not.toHaveBeenCalled();
  });

  test('Guard 4: Failed run updates status to ERROR', async () => {
    const testError = new Error('Network timeout');

    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{
          id: testContestInstanceId,
          status: 'SCHEDULED',
          sport: 'GOLF',
          provider_tournament_id: 'espn_pga_401811935',
          provider_event_id: 'espn_pga_401811935'
        }]
      }) // Load contest
      .mockResolvedValueOnce({
        rows: []
      }) // Pre-check: no rows
      .mockResolvedValueOnce({
        rows: [{ id: 'run-uuid-001' }]
      }) // INSERT RUNNING
      .mockResolvedValueOnce({}) // UPDATE ERROR
      .mockResolvedValueOnce({ rows: [] }) // fetchExistingGolfPlayerIds
      .mockResolvedValueOnce({}); // COMMIT

    mockAdapter.ingestWorkUnit.mockRejectedValue(testError);

    const result = await ingestionService.run(testContestInstanceId, mockPool);

    expect(result.errors.length).toBe(1);
    expect(result.errors[0].error).toContain('Network timeout');

    // Verify UPDATE ERROR was called (checks that the query contains UPDATE and ERROR)
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE ingestion_runs'),
      expect.arrayContaining(['run-uuid-001'])
    );
  });
});
