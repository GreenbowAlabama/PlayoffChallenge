/**
 * Player Data Ops Service - Lag Calculation Tests
 *
 * Validates that lag calculation falls back to worker heartbeat
 * when ingestion_runs are stale (field already fully ingested).
 *
 * This prevents false lag signals when the player field has not changed
 * but the ingestion worker is still healthy.
 */

'use strict';

const playerDataOpsService = require('../../services/playerDataOpsService');

describe('playerDataOpsService - Lag Calculation', () => {
  let mockClient;

  const serverTime = new Date('2026-03-09T12:00:00Z');
  const fiveMinutesAgo = new Date(serverTime.getTime() - 5 * 60 * 1000);
  const thirtyMinutesAgo = new Date(serverTime.getTime() - 30 * 60 * 1000);
  const twoHoursAgo = new Date(serverTime.getTime() - 2 * 60 * 60 * 1000);

  beforeEach(() => {
    mockClient = {
      query: jest.fn(),
      release: jest.fn()
    };
  });

  test('Case 1: Recent ingestion_runs exist → lag based on completed_at', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ server_time: serverTime }] }) // NOW()
      .mockResolvedValueOnce({
        rows: [{
          work_unit_key: 'player_pool:12345',
          status: 'COMPLETE',
          started_at: fiveMinutesAgo,
          completed_at: fiveMinutesAgo,
          error_message: null
        }]
      }) // Latest ingestion runs
      .mockResolvedValueOnce({ rows: [{ tournaments_with_pool: 5 }] }) // Pool coverage
      .mockResolvedValueOnce({ rows: [{ missing_count: 0 }] }) // Missing pools
      .mockResolvedValueOnce({ rows: [{ total_snapshots: 10, latest_snapshot: fiveMinutesAgo }] }) // Snapshots
      .mockResolvedValueOnce({ rows: [{ missing_count: 0 }] }) // Missing snapshots
      .mockResolvedValueOnce({ rows: [{ error_count: 0 }] }) // Errors last hour
      .mockResolvedValueOnce({
        rows: [{
          worker_name: 'ingestion_worker',
          status: 'HEALTHY',
          last_run_at: fiveMinutesAgo,
          error_count: 0
        }]
      }); // Workers

    const snapshot = await playerDataOpsService.getPlayerDataOpsSnapshot(mockClient, {
      useProvidedClient: true
    });

    // Verify lag is based on ingestion_runs.completed_at (5 minutes = 300 seconds)
    expect(snapshot.ingestion.lag_seconds).toBe(300);
    expect(snapshot.ingestion.last_success).toEqual(fiveMinutesAgo);
  });

  test('Case 2: Ingestion_runs stale, worker heartbeat recent → lag based on heartbeat', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ server_time: serverTime }] }) // NOW()
      .mockResolvedValueOnce({
        rows: [{
          work_unit_key: 'player_pool:12345',
          status: 'COMPLETE',
          started_at: thirtyMinutesAgo,
          completed_at: thirtyMinutesAgo, // Stale: 30 minutes ago
          error_message: null
        }]
      }) // Latest ingestion runs (stale)
      .mockResolvedValueOnce({ rows: [{ tournaments_with_pool: 5 }] }) // Pool coverage
      .mockResolvedValueOnce({ rows: [{ missing_count: 0 }] }) // Missing pools
      .mockResolvedValueOnce({ rows: [{ total_snapshots: 10, latest_snapshot: thirtyMinutesAgo }] }) // Snapshots
      .mockResolvedValueOnce({ rows: [{ missing_count: 0 }] }) // Missing snapshots
      .mockResolvedValueOnce({ rows: [{ error_count: 0 }] }) // Errors last hour
      .mockResolvedValueOnce({
        rows: [{
          worker_name: 'ingestion_worker',
          status: 'HEALTHY',
          last_run_at: fiveMinutesAgo, // Recent heartbeat
          error_count: 0
        }]
      }); // Workers

    const snapshot = await playerDataOpsService.getPlayerDataOpsSnapshot(mockClient, {
      useProvidedClient: true
    });

    // Verify lag falls back to worker heartbeat (5 minutes = 300 seconds)
    // Not 30 minutes from stale ingestion_runs
    expect(snapshot.ingestion.lag_seconds).toBe(300);
    expect(snapshot.workers[0].last_run_at).toEqual(fiveMinutesAgo);
  });

  test('Case 3: Worker heartbeat stale → tower shows DEGRADED or ERROR status', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ server_time: serverTime }] }) // NOW()
      .mockResolvedValueOnce({
        rows: [{
          work_unit_key: 'player_pool:12345',
          status: 'COMPLETE',
          started_at: twoHoursAgo,
          completed_at: twoHoursAgo, // Very stale
          error_message: null
        }]
      }) // Latest ingestion runs (very stale)
      .mockResolvedValueOnce({ rows: [{ tournaments_with_pool: 5 }] }) // Pool coverage
      .mockResolvedValueOnce({ rows: [{ missing_count: 0 }] }) // Missing pools
      .mockResolvedValueOnce({ rows: [{ total_snapshots: 10, latest_snapshot: twoHoursAgo }] }) // Snapshots
      .mockResolvedValueOnce({ rows: [{ missing_count: 0 }] }) // Missing snapshots
      .mockResolvedValueOnce({ rows: [{ error_count: 0 }] }) // Errors last hour
      .mockResolvedValueOnce({
        rows: [{
          worker_name: 'ingestion_worker',
          status: 'DEGRADED', // Worker is DEGRADED
          last_run_at: twoHoursAgo, // Very old heartbeat
          error_count: 5
        }]
      }); // Workers

    const snapshot = await playerDataOpsService.getPlayerDataOpsSnapshot(mockClient, {
      useProvidedClient: true
    });

    // Verify lag shows 2 hours (worker is stale)
    const twoHoursSeconds = 2 * 60 * 60;
    expect(snapshot.ingestion.lag_seconds).toBe(twoHoursSeconds);

    // Verify worker status is DEGRADED
    expect(snapshot.workers[0].status).toBe('DEGRADED');
    expect(snapshot.workers[0].error_count).toBeGreaterThan(0);
  });

  test('Lag calculation includes fallback logic from heartbeat', async () => {
    // Helper test to verify the fallback logic is actually in place
    // When ingestion_runs.completed_at is NULL or missing, use worker heartbeat
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ server_time: serverTime }] }) // NOW()
      .mockResolvedValueOnce({
        rows: [] // No ingestion runs at all
      }) // Latest ingestion runs (empty)
      .mockResolvedValueOnce({ rows: [{ tournaments_with_pool: 5 }] }) // Pool coverage
      .mockResolvedValueOnce({ rows: [{ missing_count: 0 }] }) // Missing pools
      .mockResolvedValueOnce({ rows: [{ total_snapshots: 10, latest_snapshot: fiveMinutesAgo }] }) // Snapshots
      .mockResolvedValueOnce({ rows: [{ missing_count: 0 }] }) // Missing snapshots
      .mockResolvedValueOnce({ rows: [{ error_count: 0 }] }) // Errors last hour
      .mockResolvedValueOnce({
        rows: [{
          worker_name: 'ingestion_worker',
          status: 'HEALTHY',
          last_run_at: fiveMinutesAgo, // Worker is recent
          error_count: 0
        }]
      }); // Workers

    const snapshot = await playerDataOpsService.getPlayerDataOpsSnapshot(mockClient, {
      useProvidedClient: true
    });

    // With no ingestion_runs, lag should fall back to worker heartbeat
    expect(snapshot.ingestion.lag_seconds).toBe(300);
    expect(snapshot.workers[0].last_run_at).toEqual(fiveMinutesAgo);
  });

  test('Threshold: ingestion_runs within 20 min window → use completed_at', async () => {
    const twentyMinutesAgo = new Date(serverTime.getTime() - 20 * 60 * 1000);

    mockClient.query
      .mockResolvedValueOnce({ rows: [{ server_time: serverTime }] }) // NOW()
      .mockResolvedValueOnce({
        rows: [{
          work_unit_key: 'player_pool:12345',
          status: 'COMPLETE',
          started_at: twentyMinutesAgo,
          completed_at: twentyMinutesAgo, // Within window
          error_message: null
        }]
      }) // Latest ingestion runs
      .mockResolvedValueOnce({ rows: [{ tournaments_with_pool: 5 }] }) // Pool coverage
      .mockResolvedValueOnce({ rows: [{ missing_count: 0 }] }) // Missing pools
      .mockResolvedValueOnce({ rows: [{ total_snapshots: 10, latest_snapshot: twentyMinutesAgo }] }) // Snapshots
      .mockResolvedValueOnce({ rows: [{ missing_count: 0 }] }) // Missing snapshots
      .mockResolvedValueOnce({ rows: [{ error_count: 0 }] }) // Errors last hour
      .mockResolvedValueOnce({
        rows: [{
          worker_name: 'ingestion_worker',
          status: 'HEALTHY',
          last_run_at: fiveMinutesAgo,
          error_count: 0
        }]
      }); // Workers

    const snapshot = await playerDataOpsService.getPlayerDataOpsSnapshot(mockClient, {
      useProvidedClient: true
    });

    // Within 20-minute window → use ingestion_runs (20 minutes = 1200 seconds)
    expect(snapshot.ingestion.lag_seconds).toBe(20 * 60);
  });

  test('Threshold: ingestion_runs beyond 20 min window → use worker heartbeat', async () => {
    const twentyFiveMinutesAgo = new Date(serverTime.getTime() - 25 * 60 * 1000);

    mockClient.query
      .mockResolvedValueOnce({ rows: [{ server_time: serverTime }] }) // NOW()
      .mockResolvedValueOnce({
        rows: [{
          work_unit_key: 'player_pool:12345',
          status: 'COMPLETE',
          started_at: twentyFiveMinutesAgo,
          completed_at: twentyFiveMinutesAgo, // Beyond window (25 > 20)
          error_message: null
        }]
      }) // Latest ingestion runs
      .mockResolvedValueOnce({ rows: [{ tournaments_with_pool: 5 }] }) // Pool coverage
      .mockResolvedValueOnce({ rows: [{ missing_count: 0 }] }) // Missing pools
      .mockResolvedValueOnce({ rows: [{ total_snapshots: 10, latest_snapshot: twentyFiveMinutesAgo }] }) // Snapshots
      .mockResolvedValueOnce({ rows: [{ missing_count: 0 }] }) // Missing snapshots
      .mockResolvedValueOnce({ rows: [{ error_count: 0 }] }) // Errors last hour
      .mockResolvedValueOnce({
        rows: [{
          worker_name: 'ingestion_worker',
          status: 'HEALTHY',
          last_run_at: fiveMinutesAgo, // Recent heartbeat
          error_count: 0
        }]
      }); // Workers

    const snapshot = await playerDataOpsService.getPlayerDataOpsSnapshot(mockClient, {
      useProvidedClient: true
    });

    // Beyond 20-minute window → use worker heartbeat (5 minutes = 300 seconds)
    // Not 25 minutes from stale ingestion_runs
    expect(snapshot.ingestion.lag_seconds).toBe(5 * 60);
  });
});
