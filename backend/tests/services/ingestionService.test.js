/**
 * Ingestion Service Core Tests
 *
 * Tests for:
 * - Post-COMPLETE hard guard (rejects further ingestion)
 * - Lifecycle safety boundaries
 */

'use strict';

describe('Ingestion Service Post-COMPLETE Guard', () => {
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

  it('should return REJECTED status when contest is COMPLETE', async () => {
    mockClient.query
      .mockResolvedValueOnce() // BEGIN
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'ci-complete',
            status: 'COMPLETE',
            ingestion_strategy_key: 'pga_espn'
          }
        ]
      }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({}); // ROLLBACK

    const result = await ingestionService.run('ci-complete', mockPool);

    expect(result.status).toBe('REJECTED');
    expect(result.reason).toBe('POST_COMPLETE_REJECTION');
    expect(result.contestInstanceId).toBe('ci-complete');
  });

  it('should NOT call getIngestionStrategy when contest is COMPLETE', async () => {
    mockClient.query
      .mockResolvedValueOnce() // BEGIN
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'ci-complete',
            status: 'COMPLETE',
            ingestion_strategy_key: 'pga_espn'
          }
        ]
      }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({}); // ROLLBACK

    await ingestionService.run('ci-complete', mockPool);

    expect(ingestionRegistry.getIngestionStrategy).not.toHaveBeenCalled();
  });

  it('should ROLLBACK without creating ingestion_runs INSERT for COMPLETE contests', async () => {
    mockClient.query
      .mockResolvedValueOnce() // BEGIN
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'ci-complete',
            status: 'COMPLETE',
            ingestion_strategy_key: 'pga_espn'
          }
        ]
      }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({}); // ROLLBACK

    await ingestionService.run('ci-complete', mockPool);

    // Verify calls: BEGIN, SELECT, ROLLBACK (exactly 3, no ingestion_runs INSERT)
    expect(mockClient.query).toHaveBeenCalledTimes(3);
    expect(mockClient.query.mock.calls[0][0]).toBe('BEGIN');
    expect(mockClient.query.mock.calls[2][0]).toBe('ROLLBACK');

    // Verify no INSERT INTO ingestion_runs
    const calls = mockClient.query.mock.calls.map(c => c[0]);
    expect(calls.some(sql => sql.includes('INSERT INTO ingestion_runs'))).toBe(false);
  });
});
