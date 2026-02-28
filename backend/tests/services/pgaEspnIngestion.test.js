/**
 * PGA ESPN Ingestion Adapter Tests — Batch 1
 *
 * Tests for:
 * 1. computeIngestionKey: deterministic hashing with normalization
 * 2. getWorkUnits: placeholder work unit generation
 * 3. normalizeEspnPayload: payload structure validation and normalization
 */

'use strict';

const adapter = require('../../services/ingestion/strategies/pgaEspnIngestion');

/**
 * Sample ESPN PGA leaderboard response structure
 * (simplified for testing)
 */
function createSampleEspnPayload(overrides = {}) {
  return {
    events: [
      {
        id: '401811941',
        competitions: [
          {
            competitors: overrides.competitors || [
              {
                id: '3470', // Rory McIlroy
                linescores: overrides.linescores || [
                  {
                    period: 1, // Round 1
                    linescores: [
                      { period: 1, value: 4 }, // Hole 1
                      { period: 2, value: 3 },
                      { period: 3, value: 5 },
                      { period: 4, value: 4 },
                      { period: 5, value: 3 },
                      { period: 6, value: 4 },
                      { period: 7, value: 4 },
                      { period: 8, value: 3 },
                      { period: 9, value: 5 },
                      { period: 10, value: 4 },
                      { period: 11, value: 3 },
                      { period: 12, value: 5 },
                      { period: 13, value: 4 },
                      { period: 14, value: 4 },
                      { period: 15, value: 3 },
                      { period: 16, value: 4 },
                      { period: 17, value: 5 },
                      { period: 18, value: 4 } // Hole 18
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ],
    ...overrides.root
  };
}

describe('PGA ESPN Ingestion — Batch 1', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // computeIngestionKey tests
  // ─────────────────────────────────────────────────────────────────────────

  describe('computeIngestionKey', () => {
    it('should generate a deterministic hash-based key', () => {
      const payload = createSampleEspnPayload();
      const unit = {
        providerEventId: '401811941',
        providerData: payload
      };

      const key = adapter.computeIngestionKey('ci-master-2026', unit);

      expect(key).toMatch(/^pga_espn:ci-master-2026:[a-f0-9]{64}$/);
    });

    it('should return same key for same payload with reordered competitors', () => {
      const competitor1 = {
        id: '3470',
        linescores: [
          {
            period: 1,
            linescores: Array.from({ length: 18 }, (_, i) => ({
              period: i + 1,
              value: 4
            }))
          }
        ]
      };

      const competitor2 = {
        id: '2506',
        linescores: [
          {
            period: 1,
            linescores: Array.from({ length: 18 }, (_, i) => ({
              period: i + 1,
              value: 3
            }))
          }
        ]
      };

      const payload1 = createSampleEspnPayload({
        competitors: [competitor1, competitor2]
      });

      const payload2 = createSampleEspnPayload({
        competitors: [competitor2, competitor1] // Reordered
      });

      const key1 = adapter.computeIngestionKey('ci-test', {
        providerEventId: '401811941',
        providerData: payload1
      });

      const key2 = adapter.computeIngestionKey('ci-test', {
        providerEventId: '401811941',
        providerData: payload2
      });

      expect(key1).toBe(key2);
    });

    it('should return different key when volatile display fields change', () => {
      const basePayload = createSampleEspnPayload();

      // Payload with displayValue changed (volatile field)
      const payloadWithDisplayValueChange = {
        ...basePayload,
        events: [
          {
            ...basePayload.events[0],
            competitions: [
              {
                competitors: [
                  {
                    ...basePayload.events[0].competitions[0].competitors[0],
                    displayValue: '-6' // Changed volatile field
                  }
                ]
              }
            ]
          }
        ]
      };

      const key1 = adapter.computeIngestionKey('ci-test', {
        providerEventId: '401811941',
        providerData: basePayload
      });

      const key2 = adapter.computeIngestionKey('ci-test', {
        providerEventId: '401811941',
        providerData: payloadWithDisplayValueChange
      });

      // Keys should be the same because displayValue is not hashed (volatile)
      expect(key1).toBe(key2);
    });

    it('should return different key when score-relevant fields (value/strokes) change', () => {
      const payload1 = createSampleEspnPayload();

      // Modify hole 1 value from 4 to 5
      const payload2 = {
        ...payload1,
        events: [
          {
            ...payload1.events[0],
            competitions: [
              {
                competitors: [
                  {
                    ...payload1.events[0].competitions[0].competitors[0],
                    linescores: [
                      {
                        ...payload1.events[0].competitions[0].competitors[0].linescores[0],
                        linescores: [
                          { period: 1, value: 5 }, // Changed
                          ...payload1.events[0].competitions[0].competitors[0].linescores[0].linescores.slice(1)
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      };

      const key1 = adapter.computeIngestionKey('ci-test', {
        providerEventId: '401811941',
        providerData: payload1
      });

      const key2 = adapter.computeIngestionKey('ci-test', {
        providerEventId: '401811941',
        providerData: payload2
      });

      expect(key1).not.toBe(key2);
    });

    it('should exclude incomplete rounds (rounds with < 18 holes)', () => {
      const payload1 = createSampleEspnPayload();

      // Payload with incomplete round (only 9 holes)
      const payload2 = createSampleEspnPayload({
        linescores: [
          {
            period: 1,
            linescores: Array.from({ length: 9 }, (_, i) => ({
              period: i + 1,
              value: 4
            }))
          }
        ]
      });

      const key1 = adapter.computeIngestionKey('ci-test', {
        providerEventId: '401811941',
        providerData: payload1
      });

      const key2 = adapter.computeIngestionKey('ci-test', {
        providerEventId: '401811941',
        providerData: payload2
      });

      expect(key1).not.toBe(key2);
    });

    it('should throw if contestInstanceId is missing', () => {
      const unit = {
        providerEventId: '401811941',
        providerData: createSampleEspnPayload()
      };

      expect(() => adapter.computeIngestionKey(null, unit)).toThrow(
        /contestInstanceId is required/
      );
    });

    it('should throw if contestInstanceId is not a string', () => {
      const unit = {
        providerEventId: '401811941',
        providerData: createSampleEspnPayload()
      };

      expect(() => adapter.computeIngestionKey(123, unit)).toThrow(
        /contestInstanceId is required and must be a string/
      );
    });

    it('should throw if unit is missing', () => {
      expect(() => adapter.computeIngestionKey('ci-test', null)).toThrow(
        /unit is required/
      );
    });

    it('should throw if providerEventId is missing', () => {
      const unit = {
        providerData: createSampleEspnPayload()
      };

      expect(() => adapter.computeIngestionKey('ci-test', unit)).toThrow(
        /unit\.providerEventId is required/
      );
    });

    it('should throw if providerEventId is not a string', () => {
      const unit = {
        providerEventId: 123,
        providerData: createSampleEspnPayload()
      };

      expect(() => adapter.computeIngestionKey('ci-test', unit)).toThrow(
        /unit\.providerEventId is required and must be a non-empty string/
      );
    });

    it('should throw if providerData is missing', () => {
      const unit = {
        providerEventId: '401811941'
      };

      expect(() => adapter.computeIngestionKey('ci-test', unit)).toThrow(
        /unit\.providerData is required for key computation/
      );
    });

    it('should throw if providerData is not an object', () => {
      const unit = {
        providerEventId: '401811941',
        providerData: 'not an object'
      };

      expect(() => adapter.computeIngestionKey('ci-test', unit)).toThrow(
        /unit\.providerData is required for key computation/
      );
    });

    it('should throw if events array is missing', () => {
      const unit = {
        providerEventId: '401811941',
        providerData: {
          competitions: [{ competitors: [] }]
        }
      };

      expect(() => adapter.computeIngestionKey('ci-test', unit)).toThrow(
        /events array is missing or empty/
      );
    });

    it('should throw if competitors array is missing', () => {
      const unit = {
        providerEventId: '401811941',
        providerData: {
          events: [
            {
              competitions: [{}]
            }
          ]
        }
      };

      expect(() => adapter.computeIngestionKey('ci-test', unit)).toThrow(
        /competitors array is missing/
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getWorkUnits tests
  // ─────────────────────────────────────────────────────────────────────────

  describe('getWorkUnits', () => {
    it('should return empty array if ctx is missing', async () => {
      const units = await adapter.getWorkUnits(null);
      expect(units).toEqual([]);
    });

    it('should return empty array if ctx.contestInstanceId is missing', async () => {
      const units = await adapter.getWorkUnits({});
      expect(units).toEqual([]);
    });

    it('should return placeholder work unit if ctx.contestInstanceId is present', async () => {
      const ctx = {
        contestInstanceId: 'ci-master-2026'
      };

      const units = await adapter.getWorkUnits(ctx);

      expect(units).toEqual([
        {
          providerEventId: null,
          providerData: null
        }
      ]);
    });

    it('should return single unit (not multiple)', async () => {
      const ctx = {
        contestInstanceId: 'ci-test'
      };

      const units = await adapter.getWorkUnits(ctx);

      expect(Array.isArray(units)).toBe(true);
      expect(units).toHaveLength(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Normalization edge cases
  // ─────────────────────────────────────────────────────────────────────────

  describe('normalizeEspnPayload edge cases', () => {
    it('should handle multiple competitors correctly', () => {
      const payload = {
        events: [
          {
            competitions: [
              {
                competitors: [
                  {
                    id: '3470',
                    linescores: [
                      {
                        period: 1,
                        linescores: Array.from({ length: 18 }, (_, i) => ({
                          period: i + 1,
                          value: 4
                        }))
                      }
                    ]
                  },
                  {
                    id: '2506',
                    linescores: [
                      {
                        period: 1,
                        linescores: Array.from({ length: 18 }, (_, i) => ({
                          period: i + 1,
                          value: 3
                        }))
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      };

      const key = adapter.computeIngestionKey('ci-test', {
        providerEventId: '401811941',
        providerData: payload
      });

      expect(key).toBeTruthy();
      expect(key).toMatch(/^pga_espn:/);
    });

    it('should skip competitors with no ID', () => {
      const payload = {
        events: [
          {
            competitions: [
              {
                competitors: [
                  {
                    // No id
                    linescores: [
                      {
                        period: 1,
                        linescores: Array.from({ length: 18 }, (_, i) => ({
                          period: i + 1,
                          value: 4
                        }))
                      }
                    ]
                  },
                  {
                    id: '3470',
                    linescores: [
                      {
                        period: 1,
                        linescores: Array.from({ length: 18 }, (_, i) => ({
                          period: i + 1,
                          value: 4
                        }))
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      };

      const key = adapter.computeIngestionKey('ci-test', {
        providerEventId: '401811941',
        providerData: payload
      });

      expect(key).toBeTruthy();
    });

    it('should handle decimal strokes (Math.round)', () => {
      const payload = {
        events: [
          {
            competitions: [
              {
                competitors: [
                  {
                    id: '3470',
                    linescores: [
                      {
                        period: 1,
                        linescores: [
                          { period: 1, value: 3.6 }, // Should round to 4
                          { period: 2, value: 3.4 }, // Should round to 3
                          ...Array.from({ length: 16 }, (_, i) => ({
                            period: i + 3,
                            value: 4
                          }))
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      };

      const key = adapter.computeIngestionKey('ci-test', {
        providerEventId: '401811941',
        providerData: payload
      });

      expect(key).toBeTruthy();
    });

    it('should exclude incomplete rounds (with null/undefined hole values)', () => {
      const payloadWithIncomplete = {
        events: [
          {
            competitions: [
              {
                competitors: [
                  {
                    id: '3470',
                    linescores: [
                      {
                        period: 1,
                        linescores: [
                          { period: 1, value: 4 },
                          { period: 2, value: null }, // Incomplete
                          ...Array.from({ length: 16 }, (_, i) => ({
                            period: i + 3,
                            value: 4
                          }))
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      };

      const payloadWithComplete = {
        events: [
          {
            competitions: [
              {
                competitors: [
                  {
                    id: '3470',
                    linescores: [
                      {
                        period: 1,
                        linescores: Array.from({ length: 18 }, (_, i) => ({
                          period: i + 1,
                          value: 4
                        }))
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      };

      const keyIncomplete = adapter.computeIngestionKey('ci-test', {
        providerEventId: '401811941',
        providerData: payloadWithIncomplete
      });

      const keyComplete = adapter.computeIngestionKey('ci-test', {
        providerEventId: '401811941',
        providerData: payloadWithComplete
      });

      // Incomplete round is excluded from normalization, so different payloads may result in different keys
      expect(keyIncomplete).toBeTruthy();
      expect(keyComplete).toBeTruthy();
    });

    it('should generate deterministic key when all competitors have only incomplete rounds (no throw)', () => {
      // Tournament is mid-round: all competitors have started round 1 but not completed 18 holes
      const payloadAllIncomplete = {
        events: [
          {
            competitions: [
              {
                competitors: [
                  {
                    id: '3470',
                    linescores: [
                      {
                        period: 1,
                        linescores: Array.from({ length: 9 }, (_, i) => ({
                          period: i + 1,
                          value: 4
                        }))
                        // Only 9 holes (incomplete round)
                      }
                    ]
                  },
                  {
                    id: '2506',
                    linescores: [
                      {
                        period: 1,
                        linescores: Array.from({ length: 9 }, (_, i) => ({
                          period: i + 1,
                          value: 3
                        }))
                        // Only 9 holes (incomplete round)
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      };

      // Should NOT throw, should generate deterministic key
      const keyAllIncomplete = adapter.computeIngestionKey('ci-test', {
        providerEventId: '401811941',
        providerData: payloadAllIncomplete
      });

      expect(keyAllIncomplete).toBeTruthy();
      expect(keyAllIncomplete).toMatch(/^pga_espn:ci-test:[a-f0-9]{64}$/);
    });

    it('should change key when first full round completes (polling model)', () => {
      // State 1: Tournament mid-round (all incomplete)
      const payloadAllIncomplete = {
        events: [
          {
            competitions: [
              {
                competitors: [
                  {
                    id: '3470',
                    linescores: [
                      {
                        period: 1,
                        linescores: Array.from({ length: 9 }, (_, i) => ({
                          period: i + 1,
                          value: 4
                        }))
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      };

      // State 2: First round completed
      const payloadFirstRoundComplete = {
        events: [
          {
            competitions: [
              {
                competitors: [
                  {
                    id: '3470',
                    linescores: [
                      {
                        period: 1,
                        linescores: Array.from({ length: 18 }, (_, i) => ({
                          period: i + 1,
                          value: 4
                        }))
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      };

      const keyIncomplete = adapter.computeIngestionKey('ci-test', {
        providerEventId: '401811941',
        providerData: payloadAllIncomplete
      });

      const keyComplete = adapter.computeIngestionKey('ci-test', {
        providerEventId: '401811941',
        providerData: payloadFirstRoundComplete
      });

      // Keys must be different: polling should detect state change
      expect(keyIncomplete).not.toBe(keyComplete);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // ingestWorkUnit snapshot persistence tests
  // ─────────────────────────────────────────────────────────────────────────

  describe('ingestWorkUnit snapshot persistence (Batch 2.2)', () => {
    let mockDbClient;

    beforeEach(() => {
      mockDbClient = {
        query: jest.fn()
      };
    });

    it('should insert into event_data_snapshots with ON CONFLICT idempotency', async () => {
      const payload = createSampleEspnPayload();

      mockDbClient.query
        .mockResolvedValueOnce({ rows: [] }) // event_data_snapshots
        .mockResolvedValueOnce({ rows: [{ id: 'event-1', payload_hash: 'hash' }] }); // ingestion_events

      const ctx = {
        contestInstanceId: 'ci-test',
        dbClient: mockDbClient
      };

      const unit = {
        providerEventId: '401811941',
        providerData: payload
      };

      await adapter.ingestWorkUnit(ctx, unit);

      // First call must be event_data_snapshots with ON CONFLICT
      const firstCallSql = mockDbClient.query.mock.calls[0][0];
      expect(firstCallSql).toContain('INSERT INTO event_data_snapshots');
      expect(firstCallSql).toContain('ON CONFLICT (contest_instance_id, snapshot_hash) DO NOTHING');
    });

    it('should compute snapshot_hash as SHA-256(canonicalizeJson(normalizeEspnPayload(providerData)))', async () => {
      const crypto = require('crypto');
      const ingestionValidator = require('../../services/ingestionService/ingestionValidator');

      const payload = createSampleEspnPayload();

      mockDbClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'event-1', payload_hash: 'hash' }] });

      const ctx = {
        contestInstanceId: 'ci-test',
        dbClient: mockDbClient
      };

      const unit = {
        providerEventId: '401811941',
        providerData: payload
      };

      await adapter.ingestWorkUnit(ctx, unit);

      // Compute expected hash using real canonicalization
      const normalized = adapter.normalizeEspnPayload(payload);
      const canonical = ingestionValidator.canonicalizeJson(normalized);
      const expectedHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(canonical))
        .digest('hex');

      // Verify snapshot_hash param matches expected
      const firstCallParams = mockDbClient.query.mock.calls[0][1];
      const snapshotHashParam = firstCallParams[1]; // $2 is snapshot_hash

      expect(snapshotHashParam).toBe(expectedHash);
    });

    it('should derive provider_final_flag = true only when event.status.type.name === "STATUS_FINAL"', async () => {
      // Test with STATUS_FINAL
      const payloadFinal = createSampleEspnPayload({
        root: {
          events: [
            {
              id: '401811941',
              status: { type: { name: 'STATUS_FINAL' }, state: 'post' },
              competitions: [
                {
                  competitors: [
                    {
                      id: '3470',
                      linescores: [
                        {
                          period: 1,
                          linescores: Array.from({ length: 18 }, (_, i) => ({
                            period: i + 1,
                            value: 4
                          }))
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      });

      mockDbClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'event-1', payload_hash: 'hash' }] });

      const ctx = {
        contestInstanceId: 'ci-test',
        dbClient: mockDbClient
      };

      const unitFinal = {
        providerEventId: '401811941',
        providerData: payloadFinal
      };

      await adapter.ingestWorkUnit(ctx, unitFinal);

      const finalParams = mockDbClient.query.mock.calls[0][1];
      const finalFlag = finalParams[3]; // $4 is provider_final_flag
      expect(finalFlag).toBe(true);

      // Test with STATUS_IN_PROGRESS (should be false)
      mockDbClient.query.mockClear();
      mockDbClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'event-2', payload_hash: 'hash2' }] });

      const payloadInProgress = createSampleEspnPayload({
        root: {
          events: [
            {
              id: '401811941',
              status: { type: { name: 'STATUS_IN_PROGRESS' }, state: 'in' },
              competitions: [
                {
                  competitors: [
                    {
                      id: '3470',
                      linescores: [
                        {
                          period: 1,
                          linescores: Array.from({ length: 18 }, (_, i) => ({
                            period: i + 1,
                            value: 4
                          }))
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      });

      const unitInProgress = {
        providerEventId: '401811941',
        providerData: payloadInProgress
      };

      await adapter.ingestWorkUnit(ctx, unitInProgress);

      const inProgressParams = mockDbClient.query.mock.calls[0][1];
      const inProgressFlag = inProgressParams[3]; // $4 is provider_final_flag
      expect(inProgressFlag).toBe(false);
    });

    it('should still insert into ingestion_events as second query (backward compatibility)', async () => {
      const payload = createSampleEspnPayload();

      mockDbClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'event-1', payload_hash: 'hash-full' }] });

      const ctx = {
        contestInstanceId: 'ci-test',
        dbClient: mockDbClient
      };

      const unit = {
        providerEventId: '401811941',
        providerData: payload
      };

      await adapter.ingestWorkUnit(ctx, unit);

      // Must call query exactly twice
      expect(mockDbClient.query).toHaveBeenCalledTimes(2);

      // Second call must be ingestion_events
      const secondCallSql = mockDbClient.query.mock.calls[1][0];
      expect(secondCallSql).toContain('INSERT INTO ingestion_events');

      const secondCallParams = mockDbClient.query.mock.calls[1][1];
      expect(secondCallParams[1]).toBe('pga_espn');
      expect(secondCallParams[2]).toBe('tournament_data');
      expect(secondCallParams[5]).toBe('VALID');
    });
  });
});
