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
    expect(() => adapter.computeIngestionKey('cid', {})).toThrow(/unit\.providerEventId is required/);
  });

  it('ingestWorkUnit requires providerData (snapshot binding implementation)', async () => {
    // ingestWorkUnit is now partially implemented for snapshot binding (PGA v1 Section 4.1)
    // It requires unit.providerData to create ingestion_events with payload_hash
    await expect(adapter.ingestWorkUnit({}, {})).rejects.toThrow(/unit\.providerData is required/);
  });

  it('upsertScores throws not-implemented', async () => {
    await expect(adapter.upsertScores({}, [])).rejects.toThrow(/pga_espn.*not yet implemented/i);
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

    // Queue: SELECT contest_instance FOR UPDATE, INSERT ingestion_run, UPDATE ingestion_run COMPLETE
    queryQueue.push({
      rows: [{
        id: 'ci-1',
        status: 'LIVE',
        scoring_strategy_key: 'ppr',
        settlement_strategy_key: 'final_standings',
        ingestion_strategy_key: 'nfl_espn'
      }]
    });
    queryQueue.push({ rows: [{ id: 'ir-1' }] }); // INSERT ingestion_run → RUNNING
    queryQueue.push({ rows: [] });                 // UPDATE ingestion_run → COMPLETE

    const mockPool = { connect: jest.fn().mockResolvedValue(mockClient) };

    const summary = await run('ci-1', mockPool);

    expect(mockAdapter.getWorkUnits).toHaveBeenCalledTimes(1);
    expect(mockAdapter.computeIngestionKey).toHaveBeenCalledWith('ci-1', { weekNumber: 19 });
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
        ingestion_strategy_key: 'nfl_espn'
      }]
    });
    // ON CONFLICT DO NOTHING → returns 0 rows (record already existed)
    queryQueue.push({ rows: [] });

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
