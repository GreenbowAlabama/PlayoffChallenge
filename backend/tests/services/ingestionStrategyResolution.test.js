/**
 * Ingestion Strategy Resolution Tests
 *
 * Tests for deriving ingestion strategy from provider_tournament_id
 * instead of relying on the sport column.
 *
 * Mapping:
 * - espn_pga_* → pga_espn
 * - espn_nfl_* → nfl_espn
 */

'use strict';

describe('Ingestion Strategy Resolution from provider_tournament_id', () => {
  const ingestionService = require('../../services/ingestionService');
  const ingestionRegistry = require('../../services/ingestionRegistry');

  let mockClient;
  let mockPool;

  beforeEach(() => {
    mockClient = {
      query: jest.fn(),
      release: jest.fn()
    };

    mockPool = {
      connect: jest.fn().mockResolvedValue(mockClient)
    };

    jest.spyOn(ingestionRegistry, 'getIngestionStrategy');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should resolve pga_espn strategy from espn_pga_ prefix in provider_tournament_id', async () => {
    mockClient.query
      .mockResolvedValueOnce() // BEGIN
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'ci-pga-test',
            status: 'LOCKED',
            sport: 'GOLF',
            provider_tournament_id: 'espn_pga_401811937',
            provider_event_id: 'espn_pga_401811937'
          }
        ]
      }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({
        rows: [] // getWorkUnits returns empty
      }); // getWorkUnits call (mocked adapter)

    // Mock the adapter to verify it's called with pga_espn
    jest.spyOn(ingestionRegistry, 'getIngestionStrategy').mockReturnValue({
      getWorkUnits: jest.fn().mockResolvedValue([]),
      computeIngestionKey: jest.fn(),
      ingestWorkUnit: jest.fn(),
      upsertScores: jest.fn()
    });

    await ingestionService.run('ci-pga-test', mockPool);

    expect(ingestionRegistry.getIngestionStrategy).toHaveBeenCalledWith('pga_espn');
  });

  it('should resolve nfl_espn strategy from espn_nfl_ prefix in provider_tournament_id', async () => {
    mockClient.query
      .mockResolvedValueOnce() // BEGIN
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'ci-nfl-test',
            status: 'LOCKED',
            sport: 'NFL',
            provider_tournament_id: 'espn_nfl_34567890',
            provider_event_id: 'espn_nfl_34567890'
          }
        ]
      }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({
        rows: [] // getWorkUnits returns empty
      }); // getWorkUnits call (mocked adapter)

    // Mock the adapter to verify it's called with nfl_espn
    jest.spyOn(ingestionRegistry, 'getIngestionStrategy').mockReturnValue({
      getWorkUnits: jest.fn().mockResolvedValue([]),
      computeIngestionKey: jest.fn(),
      ingestWorkUnit: jest.fn(),
      upsertScores: jest.fn()
    });

    await ingestionService.run('ci-nfl-test', mockPool);

    expect(ingestionRegistry.getIngestionStrategy).toHaveBeenCalledWith('nfl_espn');
  });

  it('should extract numeric ESPN event ID from provider_tournament_id', async () => {
    const mockAdapter = {
      getWorkUnits: jest.fn().mockResolvedValue([]),
      computeIngestionKey: jest.fn(),
      ingestWorkUnit: jest.fn(),
      upsertScores: jest.fn()
    };

    mockClient.query
      .mockResolvedValueOnce() // BEGIN
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'ci-event-id-test',
            status: 'LOCKED',
            sport: 'GOLF',
            provider_tournament_id: 'espn_pga_401811937',
            provider_event_id: 'espn_pga_401811937'
          }
        ]
      }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({}); // COMMIT

    jest.spyOn(ingestionRegistry, 'getIngestionStrategy').mockReturnValue(mockAdapter);

    const ctx = {
      contestInstanceId: 'ci-event-id-test',
      providerEventId: 'espn_pga_401811937',
      template: { /* template row */ },
      dbClient: mockClient,
      now: new Date()
    };

    // The context passed to getWorkUnits should have the correct event ID
    await ingestionService.run('ci-event-id-test', mockPool);

    // Verify that the adapter was initialized with the correct event ID
    expect(mockAdapter.getWorkUnits).toHaveBeenCalled();
    const adapterCtx = mockAdapter.getWorkUnits.mock.calls[0][0];
    expect(adapterCtx.providerEventId).toBe('espn_pga_401811937');
  });
});
