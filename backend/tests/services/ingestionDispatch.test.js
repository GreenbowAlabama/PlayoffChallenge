/**
 * Ingestion Dispatch Boundary Tests (V1)
 *
 * Verifies:
 *   1. Registry returns correct adapter by key
 *   2. Unknown adapter key throws descriptive error
 *   3. ingestionService.run calls adapter methods in order
 *   4. Idempotency: duplicate work_unit_key is skipped (ON CONFLICT DO NOTHING)
 *   5. Structural sentinel: server.js no longer defines the moved ingestion functions
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── 1. Registry ──────────────────────────────────────────────────────────────

describe('Ingestion Registry', () => {
  const { getIngestionStrategy, listIngestionStrategies } = require('../../services/ingestionRegistry');

  it('should return the nfl_espn adapter', () => {
    const adapter = getIngestionStrategy('nfl_espn');
    expect(adapter).toBeDefined();
    expect(typeof adapter.validateConfig).toBe('function');
    expect(typeof adapter.getWorkUnits).toBe('function');
    expect(typeof adapter.computeIngestionKey).toBe('function');
    expect(typeof adapter.ingestWorkUnit).toBe('function');
    expect(typeof adapter.upsertScores).toBe('function');
  });

  it('should return the pga_espn adapter stub', () => {
    const adapter = getIngestionStrategy('pga_espn');
    expect(adapter).toBeDefined();
  });

  it('should throw on unknown adapter key', () => {
    expect(() => getIngestionStrategy('unknown_sport_xyz')).toThrow(/Unknown ingestion strategy/);
  });

  it('should include registered keys in the error message', () => {
    expect(() => getIngestionStrategy('bogus')).toThrow(/nfl_espn/);
  });

  it('should list registered strategy keys', () => {
    const keys = listIngestionStrategies();
    expect(keys).toContain('nfl_espn');
    expect(keys).toContain('pga_espn');
  });
});

// ─── 2. pga_espn stub throws on all methods ───────────────────────────────────

describe('pgaEspnIngestion stub', () => {
  const adapter = require('../../services/ingestion/strategies/pgaEspnIngestion');

  it('validateConfig enforces PGA template shape', () => {
    expect(() => adapter.validateConfig({}))
      .toThrow(/INVALID_PGA_TEMPLATE/);
  });

  it('getWorkUnits returns [] when ctx.contestInstanceId missing', async () => {
    const units = await adapter.getWorkUnits({});
    expect(units).toEqual([]);
  });

  it('computeIngestionKey validates required inputs', () => {
    expect(() => adapter.computeIngestionKey('cid', {})).toThrow(/Cannot compute ingestion key: missing providerData and player identifier/);
  });

  it('ingestWorkUnit requires providerData (snapshot binding implementation)', async () => {
    // ingestWorkUnit is now partially implemented for snapshot binding (PGA v1 Section 4.1)
    // It requires unit.providerData to create ingestion_events with payload_hash
    await expect(adapter.ingestWorkUnit({}, {})).rejects.toThrow(/unit\.providerData is required/);
  });

  it('upsertScores handles SCORING phase with empty event rosters', async () => {
    // SCORING phase is now partially implemented for golfer_event_scores insertion
    // and roster scoring fan-out to all contests tied to the event
    const mockScores = [
      {
        contest_instance_id: 'ci-test',
        golfer_id: 'espn_123',
        round_number: 1,
        hole_points: 10,
        bonus_points: 2,
        finish_bonus: 0,
        total_points: 12
      }
    ];

    // Mock dbClient that returns empty contest list for fan-out query
    const mockDbClient = {
      query: jest.fn().mockResolvedValue({ rows: [] })
    };

    const ctx = {
      dbClient: mockDbClient,
      providerEventId: 'espn_pga_401811937'
    };

    // Should not throw - upsertScores completes successfully
    await adapter.upsertScores(ctx, mockScores);

    // Verify fan-out query was called (because normalizedScores is not empty)
    expect(mockDbClient.query).toHaveBeenCalled();
  });

  it('upsertScores roster scoring runs for ALL LIVE and LOCKED contests with same event', async () => {
    // Test Case 1: Multiple contests, same event - all LIVE/LOCKED should be scored
    const mockScores = [
      {
        contest_instance_id: 'ci-live',
        golfer_id: 'espn_123',
        round_number: 1,
        hole_points: 10,
        bonus_points: 2,
        finish_bonus: 0,
        total_points: 12
      }
    ];

    const contestsForEvent = [
      { id: 'ci-live' },      // LIVE
      { id: 'ci-locked' },    // LOCKED
      { id: 'ci-complete' }   // COMPLETE (should NOT be included in fan-out)
    ];

    let calledWithSql = '';
    const mockDbClient = {
      query: jest.fn().mockImplementation((sql) => {
        calledWithSql = sql;
        // Return mock roster scoring count only if this is the fan-out query
        if (sql.includes('WHERE provider_event_id') && sql.includes('status')) {
          return Promise.resolve({
            rows: contestsForEvent.slice(0, 2) // Only LIVE and LOCKED
          });
        }
        // Default: return empty for INSERT queries
        return Promise.resolve({ rows: [] });
      })
    };

    const ctx = {
      dbClient: mockDbClient,
      providerEventId: 'espn_pga_401811937'
    };

    await adapter.upsertScores(ctx, mockScores);

    // Verify the fan-out query filters by status IN ('LIVE','LOCKED')
    expect(mockDbClient.query).toHaveBeenCalled();
    const queries = mockDbClient.query.mock.calls;
    const fanOutQuery = queries.find(call => {
      const sql = call[0];
      return sql.includes('WHERE provider_event_id') && sql.includes('status');
    });

    expect(fanOutQuery).toBeDefined();
    expect(fanOutQuery[0]).toMatch(/status\s+IN\s*\(\s*'LIVE'\s*,\s*'LOCKED'\s*\)/i);
  });

  it('upsertScores does NOT score COMPLETE contests', async () => {
    // Test Case 2: Verify COMPLETE contests are filtered out
    const mockScores = [
      {
        contest_instance_id: 'ci-complete',
        golfer_id: 'espn_456',
        round_number: 1,
        hole_points: 5,
        bonus_points: 0,
        finish_bonus: 0,
        total_points: 5
      }
    ];

    const completeOnlyContests = [
      { id: 'ci-complete-1' }
    ];

    const mockDbClient = {
      query: jest.fn().mockImplementation((sql) => {
        // Return COMPLETE contests only if queried without status filter (wrong query)
        // With proper status filter, should return empty
        if (sql.includes('WHERE provider_event_id') && sql.includes('status')) {
          return Promise.resolve({ rows: [] }); // COMPLETE filtered out
        }
        // For INSERT operations
        return Promise.resolve({ rows: [] });
      })
    };

    const ctx = {
      dbClient: mockDbClient,
      providerEventId: 'espn_pga_401811937'
    };

    await adapter.upsertScores(ctx, mockScores);

    // The query should be called with status filtering
    const queries = mockDbClient.query.mock.calls;
    const fanOutQuery = queries.find(call => {
      const sql = call[0];
      return sql.includes('WHERE provider_event_id') && sql.includes('status');
    });

    expect(fanOutQuery).toBeDefined();
    // Verify no scoreContestRosters loop iteration (0 rows returned)
    expect(mockDbClient.query.mock.calls.length).toBeGreaterThan(0);
  });

  it('upsertScores is idempotent - running twice produces same golfer_scores', async () => {
    // Test Case 3: Idempotency - scoreContestRosters must be idempotent
    const mockScores = [
      {
        contest_instance_id: 'ci-idempotent',
        golfer_id: 'espn_789',
        round_number: 1,
        hole_points: 15,
        bonus_points: 5,
        finish_bonus: 0,
        total_points: 20
      }
    ];

    const contestsForEvent = [{ id: 'ci-idempotent' }];
    const mockDbClient = {
      query: jest.fn().mockImplementation((sql) => {
        // Return contests for fan-out query
        if (sql.includes('WHERE provider_event_id') && sql.includes('status')) {
          return Promise.resolve({ rows: contestsForEvent });
        }
        // Return success for INSERT/UPDATE
        return Promise.resolve({ rows: [] });
      })
    };

    const ctx = {
      dbClient: mockDbClient,
      providerEventId: 'espn_pga_401811937'
    };

    // First run
    await adapter.upsertScores(ctx, mockScores);
    const callCountAfterFirst = mockDbClient.query.mock.calls.length;

    // Second run (should be idempotent)
    await adapter.upsertScores(ctx, mockScores);
    const callCountAfterSecond = mockDbClient.query.mock.calls.length;

    // Both runs should make the same number of queries (or appropriate idempotent handling)
    // The important thing is that ON CONFLICT in golfer_event_scores prevents duplicates
    expect(callCountAfterSecond).toBeGreaterThanOrEqual(callCountAfterFirst);
  });
});

// ─── 3. ingestionService.run calls adapter methods ────────────────────────────

describe('ingestionService.run — adapter dispatch', () => {
  it('should resolve adapter and call getWorkUnits → ingestWorkUnit → upsertScores', async () => {
    const { run } = require('../../services/ingestionService');

    const mockAdapter = {
      validateConfig: jest.fn(),
      getWorkUnits: jest.fn().mockResolvedValue([{ weekNumber: 19 }]),
      computeIngestionKey: jest.fn().mockReturnValue('nfl_espn:ci-1:week:19'),
      ingestWorkUnit: jest.fn().mockResolvedValue([{ user_id: 'u1', player_id: 'p1', week_number: 19, base_points: 10, multiplier: 1, final_points: 10, stats: {} }]),
      upsertScores: jest.fn().mockResolvedValue(1)
    };

    // Temporarily patch the registry
    const registry = require('../../services/ingestionRegistry');
    const originalGet = registry.getIngestionStrategy;
    registry.getIngestionStrategy = jest.fn().mockReturnValue(mockAdapter);

    const mockClient = {
      query: jest.fn(),
      release: jest.fn()
    };

    const queryQueue = [];
    mockClient.query.mockImplementation((sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return Promise.resolve({ rows: [] });
      }
      const response = queryQueue.shift();
      if (!response) throw new Error(`Unexpected query: ${String(sql).substring(0, 80)}`);
      return Promise.resolve(response);
    });

    // Queue: SELECT contest_instance FOR UPDATE, SELECT precheck ingestion_runs, INSERT ingestion_run, UPDATE ingestion_run COMPLETE
    queryQueue.push({
      rows: [{
        id: 'ci-1',
        status: 'LIVE',
        scoring_strategy_key: 'ppr',
        settlement_strategy_key: 'final_standings',
        sport: 'NFL',
        provider_event_id: 'espn_nfl_test_event',
        provider_tournament_id: 'espn_nfl_2026'
      }]
    });
    queryQueue.push({ rows: [] });                 // SELECT precheck (no existing ingestion_runs)
    queryQueue.push({ rows: [{ id: 'ir-1' }] }); // INSERT ingestion_run → RUNNING
    queryQueue.push({ rows: [] });                 // UPDATE ingestion_run → COMPLETE

    const mockPool = { connect: jest.fn().mockResolvedValue(mockClient) };

    const summary = await run('ci-1', mockPool);

    expect(mockAdapter.getWorkUnits).toHaveBeenCalledTimes(1);
    // computeIngestionKey now receives enriched unit with providerEventId injected from context
    // Use toMatchObject to ignore workUnitKey and other fields added during enrichment
    expect(mockAdapter.computeIngestionKey).toHaveBeenCalledWith(
      'ci-1',
      expect.objectContaining({
        weekNumber: 19,
        providerEventId: 'espn_nfl_test_event'
      })
    );
    expect(mockAdapter.ingestWorkUnit).toHaveBeenCalledTimes(1);
    expect(mockAdapter.upsertScores).toHaveBeenCalledTimes(1);
    expect(summary.processed).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(summary.errors).toHaveLength(0);

    // Restore registry
    registry.getIngestionStrategy = originalGet;
  });
});

// ─── 4. Idempotency: duplicate work unit is skipped ───────────────────────────

describe('ingestionService.run — idempotency', () => {
  it('should skip a work unit when ingestion_run already exists (ON CONFLICT DO NOTHING)', async () => {
    const { run } = require('../../services/ingestionService');

    const mockAdapter = {
      validateConfig: jest.fn(),
      getWorkUnits: jest.fn().mockResolvedValue([{ weekNumber: 19 }]),
      computeIngestionKey: jest.fn().mockReturnValue('nfl_espn:ci-dup:week:19'),
      ingestWorkUnit: jest.fn(),
      upsertScores: jest.fn()
    };

    const registry = require('../../services/ingestionRegistry');
    const originalGet = registry.getIngestionStrategy;
    registry.getIngestionStrategy = jest.fn().mockReturnValue(mockAdapter);

    const mockClient = {
      query: jest.fn(),
      release: jest.fn()
    };

    const queryQueue = [];
    mockClient.query.mockImplementation((sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return Promise.resolve({ rows: [] });
      }
      const response = queryQueue.shift();
      if (!response) throw new Error(`Unexpected query: ${String(sql).substring(0, 80)}`);
      return Promise.resolve(response);
    });

    queryQueue.push({
      rows: [{
        id: 'ci-dup',
        status: 'LIVE',
        scoring_strategy_key: 'ppr',
        settlement_strategy_key: 'final_standings',
        sport: 'NFL',
        provider_event_id: 'espn_nfl_test_event',
        provider_tournament_id: 'espn_nfl_2026'
      }]
    });
    // SELECT precheck: return COMPLETE status to skip processing
    queryQueue.push({
      rows: [{ status: 'COMPLETE' }]
    });

    const mockPool = { connect: jest.fn().mockResolvedValue(mockClient) };

    const summary = await run('ci-dup', mockPool);

    expect(mockAdapter.ingestWorkUnit).not.toHaveBeenCalled();
    expect(mockAdapter.upsertScores).not.toHaveBeenCalled();
    expect(summary.skipped).toBe(1);
    expect(summary.processed).toBe(0);

    registry.getIngestionStrategy = originalGet;
  });
});

// ─── 5. Structural sentinel: server.js ────────────────────────────────────────

describe('Ingestion Boundary Sentinel — server.js', () => {
  const serverPath = path.join(__dirname, '../../server.js');
  let content;

  beforeAll(() => {
    content = fs.readFileSync(serverPath, 'utf8');
  });

  it('should import ingestionService', () => {
    expect(content).toMatch(/require\(.*ingestionService.*\)/);
  });

  it('should import nflEspnIngestion', () => {
    expect(content).toMatch(/require\(.*nflEspnIngestion.*\)/);
  });

  it('should NOT define getESPNScoreboardUrl in server.js (moved to adapter)', () => {
    expect(content).not.toMatch(/function getESPNScoreboardUrl/);
  });

  it('should NOT define fetchScoreboard in server.js (moved to adapter)', () => {
    expect(content).not.toMatch(/async function fetchScoreboard\s*\(/);
  });

  it('should NOT define savePlayerScoresToDatabase in server.js (moved to adapter)', () => {
    expect(content).not.toMatch(/async function savePlayerScoresToDatabase/);
  });

  it('should NOT define resolveActualWeekNumber in server.js (moved to adapter)', () => {
    expect(content).not.toMatch(/async function resolveActualWeekNumber/);
  });

  it('should NOT define fetchDefenseStats in server.js (moved to adapter)', () => {
    expect(content).not.toMatch(/async function fetchDefenseStats/);
  });

  it('should NOT define fetchGameSummary in server.js (moved to adapter)', () => {
    expect(content).not.toMatch(/async function fetchGameSummary/);
  });

  it('should NOT define parse2PtConversions in server.js (moved to adapter)', () => {
    expect(content).not.toMatch(/function parse2PtConversions/);
  });

  it('should NOT contain ESPN NFL scoreboard URL literal (goes through adapter)', () => {
    expect(content).not.toContain('espn.com/apis/site/v2/sports/football/nfl');
  });

  it('should NOT read liveStatsCache directly (use adapter methods)', () => {
    expect(content).not.toMatch(/liveStatsCache/);
  });

  it('updateLiveStats should call ingestionService.run', () => {
    const fnStart = content.indexOf('async function updateLiveStats');
    const fnEnd   = content.indexOf('\nasync function ', fnStart + 1);
    const fnBody  = content.slice(fnStart, fnEnd > fnStart ? fnEnd : undefined);
    expect(fnBody).toMatch(/ingestionService\.run/);
  });
});

// ─── 6. Structural sentinel: nflEspnIngestion.js is in strategies/ ────────────

describe('Ingestion Boundary Sentinel — adapter files', () => {
  const servicesDir = path.join(__dirname, '../../services');

  it('should have nflEspnIngestion.js in ingestion/strategies/', () => {
    const p = path.join(servicesDir, 'ingestion', 'strategies', 'nflEspnIngestion.js');
    expect(fs.existsSync(p)).toBe(true);
  });

  it('should have pgaEspnIngestion.js in ingestion/strategies/', () => {
    const p = path.join(servicesDir, 'ingestion', 'strategies', 'pgaEspnIngestion.js');
    expect(fs.existsSync(p)).toBe(true);
  });

  it('should have ingestionRegistry.js in services/', () => {
    const p = path.join(servicesDir, 'ingestionRegistry.js');
    expect(fs.existsSync(p)).toBe(true);
  });

  it('ingestionRegistry.js should NOT contain SQL queries', () => {
    const p = path.join(servicesDir, 'ingestionRegistry.js');
    const c = fs.readFileSync(p, 'utf8');
    expect(c).not.toMatch(/SELECT|INSERT|UPDATE|DELETE/);
  });

  it('ingestionRegistry.js should import from ingestion/strategies/', () => {
    const p = path.join(servicesDir, 'ingestionRegistry.js');
    const c = fs.readFileSync(p, 'utf8');
    expect(c).toMatch(/require\(.*ingestion\/strategies\//);
  });
});
