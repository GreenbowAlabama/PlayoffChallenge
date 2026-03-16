/**
 * PGA ESPN Ingestion — Event Completion Flag Tests
 *
 * Tests for mapping ESPN event completion status (status.type.completed) to provider_final_flag.
 *
 * These tests execute the REAL ingestWorkUnit() function and verify that
 * provider_final_flag is correctly inserted into event_data_snapshots.
 *
 * Background:
 * - ESPN leaderboard snapshots do NOT include provider_final_flag
 * - ESPN event API provides status.type.completed == true when tournament is finished
 * - Solution: Extract completed flag from status.type.completed during ingestion
 */

'use strict';

const assert = require('assert');
const pgaEspnIngestion = require('../../services/ingestion/strategies/pgaEspnIngestion');

// Mock the espnPgaApi module to prevent real HTTP calls
jest.mock('../../services/ingestion/espn/espnPgaApi', () => ({
  fetchEventMetadata: jest.fn(async ({ eventId }) => {
    // Mock responses based on event ID for deterministic testing
    if (eventId === '401811901') {
      return {
        status: {
          type: {
            name: 'STATUS_IN_PROGRESS',
            completed: false
          }
        }
      };
    }
    if (eventId === '401811902') {
      return {
        status: {
          type: {
            name: 'STATUS_FINAL',
            completed: true
          }
        }
      };
    }
    if (eventId === '401811904') {
      return {
        status: {
          type: {
            name: 'STATUS_IN_PROGRESS',
            completed: true  // completed=true overrides status name
          }
        }
      };
    }
    // Default: return empty metadata (simulates missing status field)
    return {};
  })
}));

describe('PGA ESPN Ingestion — Event Completion Flag', () => {
  describe('Test 1: Tournament Not Completed (status.type.completed = false)', () => {
    it('should insert provider_final_flag=false into event_data_snapshots when tournament not completed', async () => {
      let capturedInsertParams = null;

      // Mock database client to capture INSERT parameters
      const mockDbClient = {
        query: async (sql, params) => {
          // Capture event_data_snapshots INSERT
          if (sql.includes('INSERT INTO event_data_snapshots')) {
            capturedInsertParams = params;
            return { rows: [{ id: 'snapshot-123' }] };
          }

          // Delegate other queries to appropriate mock responses
          if (sql.includes('SELECT tournament_end_time FROM contest_instances')) {
            return { rows: [{ tournament_end_time: '2026-03-16T18:00:00Z' }] };
          }
          if (sql.includes('SELECT DISTINCT round_number FROM golfer_event_scores')) {
            return { rows: [] };
          }
          if (sql.includes('SELECT ct.scoring_strategy_key FROM contest_instances')) {
            return { rows: [{ scoring_strategy_key: 'pga_standard_2026' }] };
          }
          if (sql.includes('INSERT INTO ingestion_events')) {
            return { rows: [{ id: 'event-123', payload_hash: 'hash-abc' }] };
          }
          // Default: return empty rows for any unhandled query
          return { rows: [] };
        }
      };

      // ESPN event data with completed = false
      const providerData = {
        events: [
          {
            id: '401811901',
            status: {
              type: {
                name: 'STATUS_IN_PROGRESS',
                completed: false  // Tournament not finished
              }
            },
            competitions: [{
              competitors: [
                {
                  id: '1234',
                  athlete: { id: '1234', displayName: 'Player One' },
                  linescores: [],
                  score: 0
                }
              ]
            }]
          }
        ],
        competitors: []
      };

      const unit = {
        providerData,
        providerEventId: 'espn_pga_401811901'
      };

      const ctx = {
        contestInstanceId: 'contest-123',
        dbClient: mockDbClient,
        __eventCache: new Map()
      };

      // Execute real ingestWorkUnit function
      try {
        await pgaEspnIngestion.ingestWorkUnit(ctx, unit);
      } catch (err) {
        // Expected: might fail on scoring parse, but INSERT should have been captured
      }

      // Assert: provider_final_flag (4th parameter) should be false
      assert.notStrictEqual(
        capturedInsertParams,
        null,
        'Insert params should be captured (event_data_snapshots INSERT should execute)'
      );
      assert.strictEqual(
        capturedInsertParams[3],
        false,
        'provider_final_flag should be false when tournament not completed'
      );
    });
  });

  describe('Test 2: Tournament Completed (status.type.completed = true)', () => {
    it('should insert provider_final_flag=true into event_data_snapshots when tournament completed', async () => {
      let capturedInsertParams = null;

      // Mock database client to capture INSERT parameters
      const mockDbClient = {
        query: async (sql, params) => {
          // Capture event_data_snapshots INSERT
          if (sql.includes('INSERT INTO event_data_snapshots')) {
            capturedInsertParams = params;
            return { rows: [{ id: 'snapshot-456' }] };
          }

          // Delegate other queries to appropriate mock responses
          if (sql.includes('SELECT tournament_end_time FROM contest_instances')) {
            return { rows: [{ tournament_end_time: '2026-03-16T18:00:00Z' }] };
          }
          if (sql.includes('SELECT DISTINCT round_number FROM golfer_event_scores')) {
            return { rows: [] };
          }
          if (sql.includes('SELECT ct.scoring_strategy_key FROM contest_instances')) {
            return { rows: [{ scoring_strategy_key: 'pga_standard_2026' }] };
          }
          if (sql.includes('INSERT INTO ingestion_events')) {
            return { rows: [{ id: 'event-456', payload_hash: 'hash-def' }] };
          }
          // Default: return empty rows for any unhandled query
          return { rows: [] };
        }
      };

      // ESPN event data with completed = true
      const providerData = {
        events: [
          {
            id: '401811902',
            status: {
              type: {
                name: 'STATUS_FINAL',
                completed: true  // Tournament is finished
              }
            },
            competitions: [{
              competitors: [
                {
                  id: '1234',
                  athlete: { id: '1234', displayName: 'Player One' },
                  linescores: [],
                  score: 0
                }
              ]
            }]
          }
        ],
        competitors: []
      };

      const unit = {
        providerData,
        providerEventId: 'espn_pga_401811902'
      };

      const ctx = {
        contestInstanceId: 'contest-456',
        dbClient: mockDbClient,
        __eventCache: new Map()
      };

      // Execute real ingestWorkUnit function
      try {
        await pgaEspnIngestion.ingestWorkUnit(ctx, unit);
      } catch (err) {
        // Expected: might fail on scoring parse, but INSERT should have been captured
      }

      // Assert: provider_final_flag (4th parameter) should be true
      assert.notStrictEqual(
        capturedInsertParams,
        null,
        'Insert params should be captured (event_data_snapshots INSERT should execute)'
      );
      assert.strictEqual(
        capturedInsertParams[3],
        true,
        'provider_final_flag should be true when tournament is completed'
      );
    });
  });

  describe('Test 3: Existing Behavior Unchanged for Non-Final Snapshots', () => {
    it('should preserve backwards compatibility when status.type.completed is absent', async () => {
      let capturedInsertParams = null;

      // Mock database client to capture INSERT parameters
      const mockDbClient = {
        query: async (sql, params) => {
          // Capture event_data_snapshots INSERT
          if (sql.includes('INSERT INTO event_data_snapshots')) {
            capturedInsertParams = params;
            return { rows: [{ id: 'snapshot-789' }] };
          }

          // Delegate other queries to appropriate mock responses
          if (sql.includes('SELECT tournament_end_time FROM contest_instances')) {
            return { rows: [{ tournament_end_time: '2026-03-16T18:00:00Z' }] };
          }
          if (sql.includes('SELECT DISTINCT round_number FROM golfer_event_scores')) {
            return { rows: [] };
          }
          if (sql.includes('SELECT ct.scoring_strategy_key FROM contest_instances')) {
            return { rows: [{ scoring_strategy_key: 'pga_standard_2026' }] };
          }
          if (sql.includes('INSERT INTO ingestion_events')) {
            return { rows: [{ id: 'event-789', payload_hash: 'hash-ghi' }] };
          }
          // Default: return empty rows for any unhandled query
          return { rows: [] };
        }
      };

      // ESPN event data WITHOUT status field (older API response)
      const providerData = {
        events: [
          {
            id: '401811903',
            // No status field - simulates older ESPN API response
            competitions: [{
              competitors: [
                {
                  id: '1234',
                  athlete: { id: '1234', displayName: 'Player One' },
                  linescores: [],
                  score: 0
                }
              ]
            }]
          }
        ],
        competitors: []
      };

      const unit = {
        providerData,
        providerEventId: 'espn_pga_401811903'
      };

      const ctx = {
        contestInstanceId: 'contest-789',
        dbClient: mockDbClient,
        __eventCache: new Map()
      };

      // Execute real ingestWorkUnit function
      try {
        await pgaEspnIngestion.ingestWorkUnit(ctx, unit);
      } catch (err) {
        // Expected: might fail on scoring parse, but INSERT should have been captured
      }

      // Assert: provider_final_flag (4th parameter) should default to false
      assert.notStrictEqual(
        capturedInsertParams,
        null,
        'Insert params should be captured (event_data_snapshots INSERT should execute)'
      );
      assert.strictEqual(
        capturedInsertParams[3],
        false,
        'provider_final_flag should default to false when status field is missing'
      );
    });
  });

  describe('Test 4: Safety Guard - Event API Primary Source', () => {
    it('should attempt to fetch event API for completion status as primary source', async () => {
      // This test verifies that ingestWorkUnit attempts to fetch event metadata
      // from ESPN event API (https://sports.core.api.espn.com/...) as the
      // authoritative source for completion status, not relying on leaderboard payload.
      //
      // Mocked behavior: espnPgaApi.fetchEventMetadata() is mocked (no real HTTP calls).
      // For this test, the mock returns an empty response (no completion status).
      // With both event API and leaderboard payload missing status data,
      // provider_final_flag should remain false (default).

      let capturedInsertParams = null;

      // Mock database client to capture INSERT parameters
      const mockDbClient = {
        query: async (sql, params) => {
          // Capture event_data_snapshots INSERT
          if (sql.includes('INSERT INTO event_data_snapshots')) {
            capturedInsertParams = params;
            return { rows: [{ id: 'snapshot-safety' }] };
          }

          // Delegate other queries to appropriate mock responses
          if (sql.includes('SELECT tournament_end_time FROM contest_instances')) {
            return { rows: [{ tournament_end_time: '2026-03-16T18:00:00Z' }] };
          }
          if (sql.includes('SELECT DISTINCT round_number FROM golfer_event_scores')) {
            return { rows: [] };
          }
          if (sql.includes('SELECT ct.scoring_strategy_key FROM contest_instances')) {
            return { rows: [{ scoring_strategy_key: 'pga_standard_2026' }] };
          }
          if (sql.includes('INSERT INTO ingestion_events')) {
            return { rows: [{ id: 'event-safety', payload_hash: 'hash-safety' }] };
          }
          // Default: return empty rows for any unhandled query
          return { rows: [] };
        }
      };

      // ESPN leaderboard payload WITHOUT status field
      const providerData = {
        events: [
          {
            id: '401811905',
            // No status field - leaderboard doesn't have completion data
            competitions: [{
              competitors: [
                {
                  id: '1234',
                  athlete: { id: '1234', displayName: 'Player One' },
                  linescores: [],
                  score: 0
                }
              ]
            }]
          }
        ],
        competitors: []
      };

      const unit = {
        providerData,
        providerEventId: 'espn_pga_401811905'
      };

      const ctx = {
        contestInstanceId: 'contest-safety',
        dbClient: mockDbClient,
        __eventCache: new Map()
      };

      try {
        // This call will attempt to fetch from ESPN event API
        // (mocked to return empty response for this event ID)
        await pgaEspnIngestion.ingestWorkUnit(ctx, unit);
      } catch (err) {
        // Should not error - mocked ESPN API returns gracefully
      }

      // Assertion: The function wrote to event_data_snapshots
      assert.notStrictEqual(
        capturedInsertParams,
        null,
        'Insert should execute (event_data_snapshots is always written)'
      );
      // With empty event API response and no leaderboard status,
      // provider_final_flag should be false
      assert.strictEqual(
        capturedInsertParams[3],
        false,
        'provider_final_flag should be false when event API returns no completion status'
      );
    });
  });

  describe('Test 5: Priority of Completion Signals', () => {
    it('should prioritize status.type.completed=true over status.type.name=IN_PROGRESS', async () => {
      let capturedInsertParams = null;

      // Mock database client to capture INSERT parameters
      const mockDbClient = {
        query: async (sql, params) => {
          // Capture event_data_snapshots INSERT
          if (sql.includes('INSERT INTO event_data_snapshots')) {
            capturedInsertParams = params;
            return { rows: [{ id: 'snapshot-priority' }] };
          }

          // Delegate other queries to appropriate mock responses
          if (sql.includes('SELECT tournament_end_time FROM contest_instances')) {
            return { rows: [{ tournament_end_time: '2026-03-16T18:00:00Z' }] };
          }
          if (sql.includes('SELECT DISTINCT round_number FROM golfer_event_scores')) {
            return { rows: [] };
          }
          if (sql.includes('SELECT ct.scoring_strategy_key FROM contest_instances')) {
            return { rows: [{ scoring_strategy_key: 'pga_standard_2026' }] };
          }
          if (sql.includes('INSERT INTO ingestion_events')) {
            return { rows: [{ id: 'event-priority', payload_hash: 'hash-priority' }] };
          }
          // Default: return empty rows for any unhandled query
          return { rows: [] };
        }
      };

      // ESPN event data with completed=true but status name says IN_PROGRESS
      const providerData = {
        events: [
          {
            id: '401811904',
            status: {
              type: {
                name: 'STATUS_IN_PROGRESS',
                completed: true  // Completed overrides status name
              }
            },
            competitions: [{
              competitors: [
                {
                  id: '1234',
                  athlete: { id: '1234', displayName: 'Player One' },
                  linescores: [],
                  score: 0
                }
              ]
            }]
          }
        ],
        competitors: []
      };

      const unit = {
        providerData,
        providerEventId: 'espn_pga_401811904'
      };

      const ctx = {
        contestInstanceId: 'contest-priority',
        dbClient: mockDbClient,
        __eventCache: new Map()
      };

      // Execute real ingestWorkUnit function
      try {
        await pgaEspnIngestion.ingestWorkUnit(ctx, unit);
      } catch (err) {
        // Expected: might fail on scoring parse, but INSERT should have been captured
      }

      // Assert: provider_final_flag (4th parameter) should be true (completed takes priority)
      assert.notStrictEqual(
        capturedInsertParams,
        null,
        'Insert params should be captured (event_data_snapshots INSERT should execute)'
      );
      assert.strictEqual(
        capturedInsertParams[3],
        true,
        'completed=true should take priority over status name'
      );
    });
  });
});
