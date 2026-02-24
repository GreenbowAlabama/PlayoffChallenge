/**
 * Scoring Service Unit Tests
 *
 * Purpose: Test scoring logic in isolation with mocked database
 * - Tests calculateFantasyPoints with controlled scoring rules
 * - Verifies correct point calculations for all stat types
 * - Uses mock pool to control rule values
 *
 * These tests are fast and deterministic because they don't hit real DB.
 */

const { createMockPool, mockQueryResponses } = require('../mocks/mockPool');
const { statPayloads } = require('../fixtures');
const { calculateFantasyPoints: calculateFantasyPointsFunc } = require('../../services/scoringService');

describe('Scoring Service Unit Tests', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = createMockPool();

    // Setup standard scoring rules
    mockPool.setQueryResponse(
      /SELECT stat_name, points FROM scoring_rules/,
      mockQueryResponses.scoringRules()
    );
  });

  afterEach(() => {
    mockPool.reset();
  });

  describe('Direct Calculation Tests (Using Mock Pool)', () => {
    // These tests use scoringService directly with injected mock pool
    // They demonstrate the behavioral contract we need to preserve

    it('should calculate QB passing stats correctly', async () => {
      const stats = statPayloads.qbBasic;
      const points = await calculateFantasyPointsFunc(mockPool, stats, 'ppr');

      expect(typeof points).toBe('number');
      expect(points).toBeGreaterThan(0);
    });

    it('should apply 400+ yard passing bonus', async () => {
      const under400 = { pass_yd: 399, pass_td: 2 };
      const over400 = { pass_yd: 400, pass_td: 2 };

      const pointsUnder = await calculateFantasyPointsFunc(mockPool, under400, 'ppr');
      const pointsOver = await calculateFantasyPointsFunc(mockPool, over400, 'ppr');

      expect(pointsOver).toBeGreaterThan(pointsUnder);
    });

    it('should calculate RB rushing stats correctly', async () => {
      const stats = statPayloads.rbBasic;
      const points = await calculateFantasyPointsFunc(mockPool, stats, 'ppr');

      expect(typeof points).toBe('number');
      expect(points).toBeGreaterThan(0);
    });

    it('should apply 150+ yard rushing bonus', async () => {
      const under150 = { rush_yd: 149, rush_td: 1 };
      const over150 = { rush_yd: 150, rush_td: 1 };

      const pointsUnder = await calculateFantasyPointsFunc(mockPool, under150, 'ppr');
      const pointsOver = await calculateFantasyPointsFunc(mockPool, over150, 'ppr');

      expect(pointsOver).toBeGreaterThan(pointsUnder);
    });

    it('should calculate WR receiving stats with PPR', async () => {
      const stats = statPayloads.wrPPR;
      const points = await calculateFantasyPointsFunc(mockPool, stats, 'ppr');

      expect(typeof points).toBe('number');
      expect(points).toBeGreaterThan(0);
    });

    it('should reward receptions (PPR)', async () => {
      const noRec = { rec: 0, rec_yd: 100 };
      const withRec = { rec: 5, rec_yd: 100 };

      const pointsNoRec = await calculateFantasyPointsFunc(mockPool, noRec, 'ppr');
      const pointsWithRec = await calculateFantasyPointsFunc(mockPool, withRec, 'ppr');

      expect(pointsWithRec).toBeGreaterThan(pointsNoRec);
    });

    it('should calculate kicker stats with flat scoring', async () => {
      const stats = statPayloads.kickerBasic;
      const points = await calculateFantasyPointsFunc(mockPool, stats, 'ppr');

      // 2 FG * 3 + 3 XP * 1 = 9 points minimum
      expect(points).toBeGreaterThanOrEqual(9);
    });

    it('should penalize missed FGs and XPs', async () => {
      const noMiss = { fg_made: 2, xp_made: 2, fg_missed: 0, xp_missed: 0 };
      const withMiss = { fg_made: 2, xp_made: 2, fg_missed: 1, xp_missed: 1 };

      const pointsNoMiss = await calculateFantasyPointsFunc(mockPool, noMiss, 'ppr');
      const pointsWithMiss = await calculateFantasyPointsFunc(mockPool, withMiss, 'ppr');

      expect(pointsWithMiss).toBeLessThan(pointsNoMiss);
    });

    it('should calculate defense shutout bonus', async () => {
      const stats = statPayloads.defenseShutout;
      const points = await calculateFantasyPointsFunc(mockPool, stats, 'ppr');

      // Shutout should give +20 points bonus
      expect(points).toBeGreaterThanOrEqual(20);
    });

    it('should scale defense points by points allowed', async () => {
      const shutout = { def_sack: 2, def_pts_allowed: 0 };
      const average = { def_sack: 2, def_pts_allowed: 17 };
      const bad = { def_sack: 2, def_pts_allowed: 35 };

      const pointsShutout = await calculateFantasyPointsFunc(mockPool, shutout, 'ppr');
      const pointsAverage = await calculateFantasyPointsFunc(mockPool, average, 'ppr');
      const pointsBad = await calculateFantasyPointsFunc(mockPool, bad, 'ppr');

      expect(pointsShutout).toBeGreaterThan(pointsAverage);
      expect(pointsAverage).toBeGreaterThan(pointsBad);
    });

    it('should penalize fumbles lost', async () => {
      const noFumble = { rush_yd: 100, fum_lost: 0 };
      const withFumble = { rush_yd: 100, fum_lost: 2 };

      const pointsNoFumble = await calculateFantasyPointsFunc(mockPool, noFumble, 'ppr');
      const pointsWithFumble = await calculateFantasyPointsFunc(mockPool, withFumble, 'ppr');

      expect(pointsWithFumble).toBeLessThan(pointsNoFumble);
    });

    it('should penalize interceptions', async () => {
      const noInt = { pass_yd: 200, pass_int: 0 };
      const withInt = { pass_yd: 200, pass_int: 2 };

      const pointsNoInt = await calculateFantasyPointsFunc(mockPool, noInt, 'ppr');
      const pointsWithInt = await calculateFantasyPointsFunc(mockPool, withInt, 'ppr');

      expect(pointsWithInt).toBeLessThan(pointsNoInt);
    });

    it('should handle empty stats object', async () => {
      const points = await calculateFantasyPointsFunc(mockPool, {}, 'ppr');

      expect(points).toBe(0);
    });

    it('should handle null and undefined values', async () => {
      const stats = {
        pass_yd: null,
        rush_yd: undefined,
        rec_td: 1
      };

      const points = await calculateFantasyPointsFunc(mockPool, stats, 'ppr');

      expect(typeof points).toBe('number');
      expect(points).not.toBeNaN();
    });

    it('should return consistent results for same input', async () => {
      const stats = { pass_yd: 300, pass_td: 3 };

      const points1 = await calculateFantasyPointsFunc(mockPool, stats, 'ppr');
      const points2 = await calculateFantasyPointsFunc(mockPool, stats, 'ppr');

      expect(points1).toBe(points2);
    });

    it('should round to 2 decimal places', async () => {
      const stats = { pass_yd: 273, rec_yd: 87 };

      const points = await calculateFantasyPointsFunc(mockPool, stats, 'ppr');

      const decimalPlaces = (points.toString().split('.')[1] || '').length;
      expect(decimalPlaces).toBeLessThanOrEqual(2);
    });
  });

  describe('Expected Point Calculations', () => {
    // These tests document specific expected outputs
    // for known stat combinations

    it('100 rushing yards + 1 TD = at least 16 points', async () => {
      // 100 yards * 0.1 = 10 points
      // 1 TD * 6 = 6 points
      // Total = 16 points
      const stats = { rush_yd: 100, rush_td: 1 };
      const points = await calculateFantasyPointsFunc(mockPool, stats, 'ppr');

      expect(points).toBeGreaterThanOrEqual(16);
    });

    it('10 receptions + 100 receiving yards = at least 20 points PPR', async () => {
      // 10 receptions * 1 = 10 points (PPR)
      // 100 yards * 0.1 = 10 points
      // Total = 20 points
      const stats = { rec: 10, rec_yd: 100 };
      const points = await calculateFantasyPointsFunc(mockPool, stats, 'ppr');

      expect(points).toBeGreaterThanOrEqual(20);
    });

    it('300 passing yards + 3 TDs = at least 24 points', async () => {
      // 300 yards * 0.04 = 12 points
      // 3 TDs * 4 = 12 points
      // Total = 24 points
      const stats = { pass_yd: 300, pass_td: 3 };
      const points = await calculateFantasyPointsFunc(mockPool, stats, 'ppr');

      expect(points).toBeGreaterThanOrEqual(24);
    });
  });
});
