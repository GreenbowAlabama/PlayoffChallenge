/**
 * Ingestion Service Production Fixes
 *
 * Tests for:
 * 1. FOR UPDATE on LEFT JOIN (PostgreSQL error fix)
 * 2. providerEventId injection into work units
 */

'use strict';

describe('Ingestion Service — Production Fixes', () => {
  const ingestionService = require('../../services/ingestionService');
  const ingestionRegistry = require('../../services/ingestionRegistry');

  let mockClient;
  let mockPool;
  let mockAdapter;

  beforeEach(() => {
    mockClient = {
      query: jest.fn(),
      release: jest.fn()
    };

    mockPool = {
      connect: jest.fn().mockResolvedValue(mockClient)
    };

    mockAdapter = {
      computeIngestionKey: jest.fn(),
      ingestWorkUnit: jest.fn(),
      upsertScores: jest.fn(),
      getWorkUnits: jest.fn()
    };

    jest.spyOn(ingestionRegistry, 'getIngestionStrategy').mockReturnValue(mockAdapter);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Issue #1: FOR UPDATE syntax on LEFT JOIN', () => {
    it('should use FOR UPDATE OF ci to lock only contest_instances', async () => {
      const contestId = 'test-contest-123';
      const providerEventId = 'espn_event_456';

      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [
            {
              id: contestId,
              status: 'LIVE',
              sport: 'GOLF',
              template_id: 'template-1',
              provider_event_id: providerEventId,
              scoring_strategy_key: 'pga_standard',
              settlement_strategy_key: 'pga_settlement'
            }
          ]
        }) // SELECT ... FOR UPDATE OF ci
        .mockResolvedValueOnce({ rows: [] }) // INSERT ingestion_runs (ON CONFLICT)
        .mockResolvedValueOnce({}) // COMMIT
        .mockResolvedValueOnce({}); // Additional query for adapter

      mockAdapter.getWorkUnits.mockResolvedValue([]);

      await ingestionService.run(contestId, mockPool);

      // Verify the query used FOR UPDATE OF ci (not bare FOR UPDATE)
      const selectQuery = mockClient.query.mock.calls[1][0];
      expect(selectQuery).toContain('FOR UPDATE OF ci');
      expect(selectQuery).not.toMatch(/FOR UPDATE\s*$/m); // Not bare FOR UPDATE
    });
  });

  describe('Issue #2: providerEventId injection into work units', () => {
    it('should inject providerEventId from context when work units lack it', async () => {
      const contestId = 'test-contest-456';
      const providerEventId = 'espn_event_789';

      // Incoming work unit WITHOUT providerEventId
      const incomingUnit = {
        providerData: { events: [] }
      };

      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [
            {
              id: contestId,
              status: 'LIVE',
              sport: 'GOLF',
              template_id: 'template-1',
              provider_event_id: providerEventId,
              scoring_strategy_key: 'pga_standard',
              settlement_strategy_key: 'pga_settlement'
            }
          ]
        }) // SELECT ... FOR UPDATE OF ci
        .mockResolvedValueOnce({ rows: [{ id: 'run-1' }] }) // INSERT ingestion_runs
        .mockResolvedValueOnce({}) // UPDATE ingestion_runs status
        .mockResolvedValueOnce({}) // COMMIT
        .mockResolvedValueOnce({}); // Additional queries

      mockAdapter.computeIngestionKey.mockReturnValue('pga_espn:test:hash123');
      mockAdapter.ingestWorkUnit.mockResolvedValue([]);
      mockAdapter.upsertScores.mockResolvedValue({});

      // Pass work units that lack providerEventId
      await ingestionService.run(contestId, mockPool, [incomingUnit]);

      // Verify that computeIngestionKey was called with an enriched unit
      // that includes the providerEventId from context
      const unitPassedToCompute = mockAdapter.computeIngestionKey.mock.calls[0][1];
      expect(unitPassedToCompute).toBeDefined();
      expect(unitPassedToCompute.providerEventId).toBe(providerEventId);
      expect(unitPassedToCompute.providerData).toBeDefined();
    });

    it('should preserve providerEventId if already present in work unit', async () => {
      const contestId = 'test-contest-789';
      const dbEventId = 'espn_from_db';
      const unitEventId = 'espn_from_unit';

      // Incoming work unit WITH its own providerEventId
      const incomingUnit = {
        providerEventId: unitEventId,
        providerData: { events: [] }
      };

      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [
            {
              id: contestId,
              status: 'LIVE',
              sport: 'GOLF',
              template_id: 'template-1',
              provider_event_id: dbEventId,
              scoring_strategy_key: 'pga_standard',
              settlement_strategy_key: 'pga_settlement'
            }
          ]
        }) // SELECT ... FOR UPDATE OF ci
        .mockResolvedValueOnce({ rows: [{ id: 'run-2' }] }) // INSERT ingestion_runs
        .mockResolvedValueOnce({}) // UPDATE ingestion_runs status
        .mockResolvedValueOnce({}) // COMMIT
        .mockResolvedValueOnce({}); // Additional queries

      mockAdapter.computeIngestionKey.mockReturnValue('pga_espn:test:hash456');
      mockAdapter.ingestWorkUnit.mockResolvedValue([]);
      mockAdapter.upsertScores.mockResolvedValue({});

      await ingestionService.run(contestId, mockPool, [incomingUnit]);

      // Verify that the unit's own providerEventId is preserved
      const unitPassedToCompute = mockAdapter.computeIngestionKey.mock.calls[0][1];
      expect(unitPassedToCompute.providerEventId).toBe(unitEventId);
    });

    it('should fail if no providerEventId available (context or unit)', async () => {
      const contestId = 'test-contest-no-event';

      // Work unit without providerEventId
      const incomingUnit = {
        providerData: { events: [] }
      };

      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [
            {
              id: contestId,
              status: 'LIVE',
              sport: 'GOLF',
              template_id: 'template-1',
              provider_event_id: null, // NO provider_event_id in DB
              scoring_strategy_key: 'pga_standard',
              settlement_strategy_key: 'pga_settlement'
            }
          ]
        }) // SELECT ... FOR UPDATE OF ci
        .mockResolvedValueOnce({}); // ROLLBACK

      // Should throw because provider_event_id is missing
      await expect(
        ingestionService.run(contestId, mockPool, [incomingUnit])
      ).rejects.toThrow(/provider_event_id missing/);
    });
  });

  describe('Orchestrator integration: pgaEspnPollingOrchestrator workUnits', () => {
    it('should pass through workUnits with all required fields', async () => {
      const contestId = 'test-pga-orch';
      const providerEventId = 'espn_pga_123456';

      // Orchestrator provides pre-built work units with all fields
      const orchestratorUnits = [
        {
          providerEventId,
          providerData: {
            events: [
              {
                id: '123',
                status: { type: { name: 'STATUS_FINAL' } },
                competitions: [
                  {
                    competitors: [
                      {
                        id: 'player1',
                        linescores: [
                          {
                            period: 1,
                            linescores: Array(18).fill({ value: 4, period: 1 })
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        }
      ];

      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [
            {
              id: contestId,
              status: 'LIVE',
              sport: 'GOLF',
              template_id: 'template-1',
              provider_event_id: providerEventId,
              scoring_strategy_key: 'pga_standard',
              settlement_strategy_key: 'pga_settlement'
            }
          ]
        }) // SELECT ... FOR UPDATE OF ci
        .mockResolvedValueOnce({ rows: [{ id: 'run-3' }] }) // INSERT ingestion_runs
        .mockResolvedValueOnce({}) // UPDATE ingestion_runs status
        .mockResolvedValueOnce({}) // COMMIT
        .mockResolvedValueOnce({}); // Additional queries

      mockAdapter.computeIngestionKey.mockReturnValue('pga_espn:test:hash789');
      mockAdapter.ingestWorkUnit.mockResolvedValue([]);
      mockAdapter.upsertScores.mockResolvedValue({});

      // Orchestrator passes pre-built units
      await ingestionService.run(contestId, mockPool, orchestratorUnits);

      // Verify computeIngestionKey receives the unit as-is
      const unitArg = mockAdapter.computeIngestionKey.mock.calls[0][1];
      expect(unitArg.providerEventId).toBe(providerEventId);
      expect(unitArg.providerData).toBeDefined();
    });
  });
});
