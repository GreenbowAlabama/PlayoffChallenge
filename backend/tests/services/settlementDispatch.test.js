/**
 * Settlement Dispatch Boundary Tests (Phase 0)
 *
 * Tests the dispatch mechanism in settlementStrategy.executeSettlement:
 * - Registry contains all template settlement_strategy_key values
 * - Score aggregation flows through strategy function
 * - Unknown key throws
 * - executeSettlement end-to-end still works with dispatch
 */

describe('Settlement Dispatch Boundary', () => {
  describe('Registry contents match template keys', () => {
    it('should have all template settlement_strategy_key values registered', () => {
      const { listSettlementStrategies } = require('../../services/settlementRegistry');
      const { VALID_SETTLEMENT_STRATEGIES } = require('../../services/customContestTemplateService');

      const registered = listSettlementStrategies();
      for (const key of VALID_SETTLEMENT_STRATEGIES) {
        expect(registered).toContain(key);
      }
    });

    it('should return a function for final_standings', () => {
      const { getSettlementStrategy } = require('../../services/settlementRegistry');
      const fn = getSettlementStrategy('final_standings');
      expect(typeof fn).toBe('function');
    });

    it('should throw on unknown strategy key', () => {
      const { getSettlementStrategy } = require('../../services/settlementRegistry');
      expect(() => getSettlementStrategy('nonexistent')).toThrow(/Unknown settlement strategy/);
    });

    it('should include registered keys in error message', () => {
      const { getSettlementStrategy } = require('../../services/settlementRegistry');
      expect(() => getSettlementStrategy('bogus')).toThrow(/final_standings/);
    });
  });

  describe('nflSettlementFn contract', () => {
    it('should query game_settings and aggregate scores', async () => {
      const { nflSettlementFn } = require('../../services/strategies/nflSettlement');

      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [{ playoff_start_week: 19 }] })
          .mockResolvedValueOnce({
            rows: [
              { user_id: 'user1', total_score: 100 },
              { user_id: 'user2', total_score: 90 }
            ]
          })
      };

      const result = await nflSettlementFn('contest-123', mockClient);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ user_id: 'user1', total_score: 100 });
      expect(result[1]).toEqual({ user_id: 'user2', total_score: 90 });

      // Verify it queried game_settings
      expect(mockClient.query.mock.calls[0][0]).toMatch(/game_settings/);

      // Verify it aggregated scores with correct week range (19 to 22)
      const scoreCall = mockClient.query.mock.calls[1];
      expect(scoreCall[1]).toEqual(['contest-123', 19, 22]);
    });

    it('should default playoff_start_week to 19 when not set', async () => {
      const { nflSettlementFn } = require('../../services/strategies/nflSettlement');

      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [{}] })
          .mockResolvedValueOnce({ rows: [] })
      };

      await nflSettlementFn('contest-123', mockClient);

      const scoreCall = mockClient.query.mock.calls[1];
      expect(scoreCall[1]).toEqual(['contest-123', 19, 22]);
    });
  });

  describe('Phase 2 — Template-driven settlement_strategy_key dispatch', () => {
    let mockPool;
    let mockClient;

    beforeEach(() => {
      mockClient = {
        query: jest.fn(),
        release: jest.fn()
      };
      mockPool = { connect: jest.fn().mockResolvedValue(mockClient) };

      const queryQueue = [];
      mockClient.query.mockImplementation((sql) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return Promise.resolve({ rows: [] });
        }
        const response = queryQueue.shift();
        if (!response) throw new Error(`Unexpected query: ${sql.substring(0, 80)}`);
        return Promise.resolve(response);
      });
      mockClient._queueResponse = (r) => { queryQueue.push(r); return mockClient; };
    });

    it('should load settlement_strategy_key from template after lock', async () => {
      const { executeSettlement } = require('../../services/settlementStrategy');

      const contestInstance = { id: 'ci-1', entry_fee_cents: 500, payout_structure: { '1': 100 } };

      mockClient
        ._queueResponse({ rows: [{ id: 'ci-1', status: 'LIVE', entry_fee_cents: 500, payout_structure: { '1': 100 }, settle_time: null }] }) // lock
        ._queueResponse({ rows: [] }) // no existing settlement
        ._queueResponse({ rows: [{ settlement_strategy_key: 'final_standings' }] }) // template query
        ._queueResponse({ rows: [{ playoff_start_week: 19 }] }) // game_settings
        ._queueResponse({ rows: [{ user_id: 'u1', total_score: 80 }] }) // scores
        ._queueResponse({ rows: [{ id: 'sr-1' }] }) // insert settlement
        ._queueResponse({ rows: [] }) // update scoring_run_id
        ._queueResponse({ rows: [] }) // update settle_time
        ._queueResponse({ rows: [] }); // audit

      const result = await executeSettlement(contestInstance, mockPool, 'snap-id', 'hash');
      expect(result).toEqual({ id: 'sr-1' });
    });

    it('should throw if no template found for contest instance', async () => {
      const { executeSettlement } = require('../../services/settlementStrategy');

      const contestInstance = { id: 'ci-missing', entry_fee_cents: 500, payout_structure: {} };

      mockClient
        ._queueResponse({ rows: [{ id: 'ci-missing', status: 'LIVE', entry_fee_cents: 500, payout_structure: {}, settle_time: null }] }) // lock
        ._queueResponse({ rows: [] }) // no existing settlement
        ._queueResponse({ rows: [] }); // template query returns nothing

      await expect(executeSettlement(contestInstance, mockPool)).rejects.toThrow(/No template found/);
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('should throw for unknown settlement_strategy_key from template', async () => {
      const { executeSettlement } = require('../../services/settlementStrategy');

      const contestInstance = { id: 'ci-bad-key', entry_fee_cents: 500, payout_structure: {} };

      mockClient
        ._queueResponse({ rows: [{ id: 'ci-bad-key', status: 'LIVE', entry_fee_cents: 500, payout_structure: {}, settle_time: null }] }) // lock
        ._queueResponse({ rows: [] }) // no existing settlement
        ._queueResponse({ rows: [{ settlement_strategy_key: 'nonexistent_strategy' }] }); // template with bad key

      await expect(executeSettlement(contestInstance, mockPool)).rejects.toThrow(/Unknown settlement strategy/);
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('executeSettlement end-to-end with dispatch', () => {
    let mockPool;
    let mockClient;

    beforeEach(() => {
      mockClient = {
        query: jest.fn(),
        release: jest.fn()
      };

      mockPool = {
        connect: jest.fn().mockResolvedValue(mockClient)
      };

      const queryQueue = [];

      mockClient.query.mockImplementation((sql, params) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return Promise.resolve({ rows: [] });
        }
        const response = queryQueue.shift();
        if (!response) {
          throw new Error(`Unexpected query: ${sql.substring(0, 80)}`);
        }
        return Promise.resolve(response);
      });

      mockClient._queueResponse = (response) => {
        queryQueue.push(response);
        return mockClient;
      };
    });

    it('should produce settlement record using dispatched strategy', async () => {
      const settlementStrategy = require('../../services/settlementStrategy');

      const contestInstance = {
        id: 'contest-id',
        entry_fee_cents: 1000,
        payout_structure: { '1': 100 }
      };

      mockClient
        ._queueResponse({
          rows: [{
            id: 'contest-id',
            status: 'LIVE',
            entry_fee_cents: 1000,
            payout_structure: { '1': 100 },
            settle_time: null
          }]
        }) // lock
        ._queueResponse({ rows: [] }) // no existing settlement
        ._queueResponse({ rows: [{ settlement_strategy_key: 'final_standings' }] }) // template query
        ._queueResponse({ rows: [{ playoff_start_week: 19 }] }) // game_settings (via strategy)
        ._queueResponse({
          rows: [{ user_id: 'user1', total_score: 100 }]
        }) // scores (via strategy)
        ._queueResponse({ rows: [{ id: 'settlement-id' }] }) // insert settlement
        ._queueResponse({ rows: [] }) // update scoring_run_id
        ._queueResponse({ rows: [] }) // update settle_time
        ._queueResponse({ rows: [] }); // audit

      const result = await settlementStrategy.executeSettlement(contestInstance, mockPool, 'snap-id', 'hash');

      expect(result).toEqual({ id: 'settlement-id' });
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });
  });
});
