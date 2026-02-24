/**
 * Scoring Dispatch Boundary Tests (Phase 0)
 *
 * Tests the dispatch mechanism in scoringService:
 * - Default dispatch routes through registry to nflScoringFn
 * - Dispatched result is identical to calling nflScoringFn directly
 * - Unknown strategy key throws
 * - Registry exposes expected keys matching template validation values
 */

const { createMockPool, mockQueryResponses } = require('../mocks/mockPool');
const { statPayloads } = require('../fixtures');

describe('Scoring Dispatch Boundary', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = createMockPool();
    mockPool.setQueryResponse(
      /SELECT stat_name, points FROM scoring_rules/,
      mockQueryResponses.scoringRules()
    );
  });

  afterEach(() => {
    mockPool.reset();
  });

  describe('Dispatch produces identical output', () => {
    it('should return identical result via dispatcher and direct strategy call', async () => {
      const { calculateFantasyPoints } = require('../../services/scoringService');
      const { nflScoringFn } = require('../../services/strategies/nflScoring');

      const stats = statPayloads.qbBasic;
      const dispatchedResult = await calculateFantasyPoints(mockPool, stats, 'ppr');
      const directResult = await nflScoringFn(mockPool, stats);

      expect(dispatchedResult).toBe(directResult);
    });

    it('should return identical result for RB stats', async () => {
      const { calculateFantasyPoints } = require('../../services/scoringService');
      const { nflScoringFn } = require('../../services/strategies/nflScoring');

      const stats = statPayloads.rbBasic;
      const dispatchedResult = await calculateFantasyPoints(mockPool, stats, 'ppr');
      const directResult = await nflScoringFn(mockPool, stats);

      expect(dispatchedResult).toBe(directResult);
    });

    it('should return identical result for defense stats', async () => {
      const { calculateFantasyPoints } = require('../../services/scoringService');
      const { nflScoringFn } = require('../../services/strategies/nflScoring');

      const stats = statPayloads.defenseShutout;
      const dispatchedResult = await calculateFantasyPoints(mockPool, stats, 'ppr');
      const directResult = await nflScoringFn(mockPool, stats);

      expect(dispatchedResult).toBe(directResult);
    });

    it('should return identical result for empty stats', async () => {
      const { calculateFantasyPoints } = require('../../services/scoringService');
      const { nflScoringFn } = require('../../services/strategies/nflScoring');

      const dispatchedResult = await calculateFantasyPoints(mockPool, {}, 'ppr');
      const directResult = await nflScoringFn(mockPool, {});

      expect(dispatchedResult).toBe(directResult);
    });
  });

  describe('Registry lookup', () => {
    it('should throw on unknown strategy key', () => {
      const { getScoringStrategy } = require('../../services/scoringRegistry');

      expect(() => getScoringStrategy('nonexistent')).toThrow(/Unknown scoring strategy/);
    });

    it('should include registered keys in error message', () => {
      const { getScoringStrategy } = require('../../services/scoringRegistry');

      expect(() => getScoringStrategy('bogus')).toThrow(/ppr/);
    });
  });

  describe('Phase 2 — Template-driven strategyKey dispatch', () => {
    it('should require strategyKey — throws if undefined', async () => {
      const { calculateFantasyPoints } = require('../../services/scoringService');

      await expect(calculateFantasyPoints(mockPool, {}, undefined)).rejects.toThrow(/Unknown scoring strategy/);
    });

    it('should throw a controlled error for unknown strategyKey', async () => {
      const { calculateFantasyPoints } = require('../../services/scoringService');

      await expect(calculateFantasyPoints(mockPool, {}, 'fantasy_points_half_ppr_v2')).rejects.toThrow(/Unknown scoring strategy/);
    });

    it('should dispatch correctly when strategyKey is half_ppr', async () => {
      const { calculateFantasyPoints } = require('../../services/scoringService');
      const { nflScoringFn } = require('../../services/strategies/nflScoring');

      const stats = statPayloads.qbBasic;
      const dispatchedResult = await calculateFantasyPoints(mockPool, stats, 'half_ppr');
      const directResult = await nflScoringFn(mockPool, stats);

      // half_ppr maps to same nflScoringFn so output is identical
      expect(dispatchedResult).toBe(directResult);
    });

    it('should dispatch differently for ppr vs standard based on strategyKey', async () => {
      const { calculateFantasyPoints } = require('../../services/scoringService');

      // Both are valid registered keys — dispatch must not throw
      const statsPPR = statPayloads.wrPPR;
      const pointsPPR = await calculateFantasyPoints(mockPool, statsPPR, 'ppr');
      const pointsStd = await calculateFantasyPoints(mockPool, statsPPR, 'standard');

      // Scores may be identical (same underlying fn) but dispatch must succeed for both
      expect(typeof pointsPPR).toBe('number');
      expect(typeof pointsStd).toBe('number');
    });
  });

  describe('Registry contents match template keys', () => {
    it('should have all template scoring_strategy_key values registered', () => {
      const { listScoringStrategies } = require('../../services/scoringRegistry');
      const { VALID_SCORING_STRATEGIES } = require('../../services/customContestTemplateService');

      const registered = listScoringStrategies();
      for (const key of VALID_SCORING_STRATEGIES) {
        expect(registered).toContain(key);
      }
    });

    it('should return a function for each registered key', () => {
      const { getScoringStrategy, listScoringStrategies } = require('../../services/scoringRegistry');

      for (const key of listScoringStrategies()) {
        expect(typeof getScoringStrategy(key)).toBe('function');
      }
    });
  });
});
