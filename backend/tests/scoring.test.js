/**
 * Scoring Guardrail Tests
 *
 * Purpose: Protect scoring behavior during refactors
 * - Tests calculateFantasyPoints function only
 * - Uses fixed stat payloads with expected outputs
 * - Does NOT write to database
 * - Does NOT modify scoring rules
 *
 * These tests act as a behavioral snapshot to detect
 * unintended changes in scoring output.
 *
 * FIXED: Now uses mock pool (unit test) instead of server.js wrapper
 * - Imports scoringService directly for test isolation
 * - Uses createMockPool to inject controlled test data
 * - Explicitly passes 'ppr' strategy key
 */

const { createMockPool, mockQueryResponses } = require('./mocks/mockPool');
const { calculateFantasyPoints } = require('../services/scoringService');

describe('Scoring Guardrail - calculateFantasyPoints', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = createMockPool();
    // Configure mock to return standard NFL PPR scoring rules
    mockPool.setQueryResponse(
      /SELECT stat_name, points FROM scoring_rules/,
      mockQueryResponses.scoringRules()
    );
  });

  afterEach(() => {
    mockPool.reset();
  });

  describe('QB Passing Stats', () => {
    it('should calculate basic passing stats', async () => {
      const stats = {
        pass_yd: 300,
        pass_td: 3,
        pass_int: 1
      };

      const points = await calculateFantasyPoints(mockPool, stats, 'ppr');

      // Verify the function returns a number
      expect(typeof points).toBe('number');
      expect(points).not.toBeNaN();
    });

    it('should apply 400+ yard passing bonus', async () => {
      const under400 = { pass_yd: 399, pass_td: 2 };
      const over400 = { pass_yd: 400, pass_td: 2 };

      const pointsUnder = await calculateFantasyPoints(mockPool, under400, 'ppr');
      const pointsOver = await calculateFantasyPoints(mockPool, over400, 'ppr');

      // Over 400 should have bonus points added
      expect(pointsOver).toBeGreaterThan(pointsUnder);
    });

    it('should penalize interceptions', async () => {
      const noInt = { pass_yd: 200, pass_td: 1, pass_int: 0 };
      const withInt = { pass_yd: 200, pass_td: 1, pass_int: 2 };

      const pointsNoInt = await calculateFantasyPoints(mockPool, noInt, 'ppr');
      const pointsWithInt = await calculateFantasyPoints(mockPool, withInt, 'ppr');

      expect(pointsWithInt).toBeLessThan(pointsNoInt);
    });
  });

  describe('RB Rushing Stats', () => {
    it('should calculate basic rushing stats', async () => {
      const stats = {
        rush_yd: 120,
        rush_td: 2
      };

      const points = await calculateFantasyPoints(mockPool, stats, 'ppr');

      expect(typeof points).toBe('number');
      expect(points).toBeGreaterThan(0);
    });

    it('should apply 150+ yard rushing bonus', async () => {
      const under150 = { rush_yd: 149, rush_td: 1 };
      const over150 = { rush_yd: 150, rush_td: 1 };

      const pointsUnder = await calculateFantasyPoints(mockPool, under150, 'ppr');
      const pointsOver = await calculateFantasyPoints(mockPool, over150, 'ppr');

      expect(pointsOver).toBeGreaterThan(pointsUnder);
    });
  });

  describe('WR Receiving Stats (PPR)', () => {
    it('should calculate basic receiving stats with receptions', async () => {
      const stats = {
        rec: 8,
        rec_yd: 100,
        rec_td: 1
      };

      const points = await calculateFantasyPoints(mockPool, stats, 'ppr');

      expect(typeof points).toBe('number');
      expect(points).toBeGreaterThan(0);
    });

    it('should reward receptions (PPR)', async () => {
      const noRec = { rec: 0, rec_yd: 100 };
      const withRec = { rec: 5, rec_yd: 100 };

      const pointsNoRec = await calculateFantasyPoints(mockPool, noRec, 'ppr');
      const pointsWithRec = await calculateFantasyPoints(mockPool, withRec, 'ppr');

      expect(pointsWithRec).toBeGreaterThan(pointsNoRec);
    });

    it('should apply 150+ yard receiving bonus', async () => {
      const under150 = { rec: 8, rec_yd: 149 };
      const over150 = { rec: 8, rec_yd: 150 };

      const pointsUnder = await calculateFantasyPoints(mockPool, under150, 'ppr');
      const pointsOver = await calculateFantasyPoints(mockPool, over150, 'ppr');

      expect(pointsOver).toBeGreaterThan(pointsUnder);
    });
  });

  describe('Kicker Scoring', () => {
    it('should calculate basic kicker stats', async () => {
      const stats = {
        fg_made: 2,
        fg_longest: 35,
        xp_made: 3
      };

      const points = await calculateFantasyPoints(mockPool, stats, 'ppr');

      expect(typeof points).toBe('number');
      expect(points).toBeGreaterThan(0);
    });

    it('should use flat scoring regardless of FG distance', async () => {
      // Current implementation uses flat 3 points per FG
      // fg_longest field is not used in scoring calculation
      const shortFG = { fg_made: 2, fg_longest: 39, xp_made: 1 };
      const longFG = { fg_made: 2, fg_longest: 50, xp_made: 1 };

      const pointsShort = await calculateFantasyPoints(mockPool, shortFG, 'ppr');
      const pointsLong = await calculateFantasyPoints(mockPool, longFG, 'ppr');

      // Both should be equal since distance isn't factored in
      expect(pointsLong).toBe(pointsShort);
    });

    it('should calculate flat FG points correctly', async () => {
      // 2 FG * 3 points + 1 XP * 1 point = 7 points
      const stats = { fg_made: 2, xp_made: 1 };
      const points = await calculateFantasyPoints(mockPool, stats, 'ppr');

      expect(points).toBe(7);
    });

    it('should penalize missed FGs', async () => {
      const noMiss = { fg_made: 2, fg_longest: 35, xp_made: 2, fg_missed: 0 };
      const withMiss = { fg_made: 2, fg_longest: 35, xp_made: 2, fg_missed: 2 };

      const pointsNoMiss = await calculateFantasyPoints(mockPool, noMiss, 'ppr');
      const pointsWithMiss = await calculateFantasyPoints(mockPool, withMiss, 'ppr');

      expect(pointsWithMiss).toBeLessThan(pointsNoMiss);
    });

    it('should penalize missed PATs', async () => {
      const noMiss = { fg_made: 1, fg_longest: 30, xp_made: 3, xp_missed: 0 };
      const withMiss = { fg_made: 1, fg_longest: 30, xp_made: 3, xp_missed: 2 };

      const pointsNoMiss = await calculateFantasyPoints(mockPool, noMiss, 'ppr');
      const pointsWithMiss = await calculateFantasyPoints(mockPool, withMiss, 'ppr');

      expect(pointsWithMiss).toBeLessThan(pointsNoMiss);
    });
  });

  describe('Defense Scoring', () => {
    it('should calculate basic defensive stats', async () => {
      const stats = {
        def_sack: 3,
        def_int: 2,
        def_pts_allowed: 14
      };

      const points = await calculateFantasyPoints(mockPool, stats, 'ppr');

      expect(typeof points).toBe('number');
    });

    it('should reward shutout with maximum bonus', async () => {
      const shutout = { def_sack: 2, def_int: 1, def_pts_allowed: 0 };
      const allowedPoints = { def_sack: 2, def_int: 1, def_pts_allowed: 14 };

      const pointsShutout = await calculateFantasyPoints(mockPool, shutout, 'ppr');
      const pointsAllowed = await calculateFantasyPoints(mockPool, allowedPoints, 'ppr');

      expect(pointsShutout).toBeGreaterThan(pointsAllowed);
    });

    it('should penalize high points allowed', async () => {
      const lowAllowed = { def_sack: 1, def_int: 1, def_pts_allowed: 10 };
      const highAllowed = { def_sack: 1, def_int: 1, def_pts_allowed: 35 };

      const pointsLow = await calculateFantasyPoints(mockPool, lowAllowed, 'ppr');
      const pointsHigh = await calculateFantasyPoints(mockPool, highAllowed, 'ppr');

      expect(pointsHigh).toBeLessThan(pointsLow);
    });

    it('should reward defensive TDs', async () => {
      const noTD = { def_sack: 2, def_pts_allowed: 14 };
      const withTD = { def_sack: 2, def_td: 1, def_pts_allowed: 14 };

      const pointsNoTD = await calculateFantasyPoints(mockPool, noTD, 'ppr');
      const pointsWithTD = await calculateFantasyPoints(mockPool, withTD, 'ppr');

      expect(pointsWithTD).toBeGreaterThan(pointsNoTD);
    });

    it('should reward turnovers', async () => {
      const noTurnover = { def_sack: 2, def_pts_allowed: 14 };
      const withTurnover = { def_sack: 2, def_int: 2, def_fum_rec: 1, def_pts_allowed: 14 };

      const pointsNoTurnover = await calculateFantasyPoints(mockPool, noTurnover, 'ppr');
      const pointsWithTurnover = await calculateFantasyPoints(mockPool, withTurnover, 'ppr');

      expect(pointsWithTurnover).toBeGreaterThan(pointsNoTurnover);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty stats object', async () => {
      const points = await calculateFantasyPoints(mockPool, {}, 'ppr');

      expect(points).toBe(0);
    });

    it('should handle undefined values gracefully', async () => {
      const stats = {
        pass_yd: undefined,
        pass_td: 2
      };

      const points = await calculateFantasyPoints(mockPool, stats, 'ppr');

      expect(typeof points).toBe('number');
      expect(points).not.toBeNaN();
    });

    it('should handle null values gracefully', async () => {
      const stats = {
        rush_yd: null,
        rush_td: 1
      };

      const points = await calculateFantasyPoints(mockPool, stats, 'ppr');

      expect(typeof points).toBe('number');
      expect(points).not.toBeNaN();
    });

    it('should penalize fumbles lost', async () => {
      const noFumble = { rush_yd: 80, rush_td: 1, fum_lost: 0 };
      const withFumble = { rush_yd: 80, rush_td: 1, fum_lost: 2 };

      const pointsNoFumble = await calculateFantasyPoints(mockPool, noFumble, 'ppr');
      const pointsWithFumble = await calculateFantasyPoints(mockPool, withFumble, 'ppr');

      expect(pointsWithFumble).toBeLessThan(pointsNoFumble);
    });

    it('should handle dual-threat QB stats', async () => {
      const stats = {
        pass_yd: 250,
        pass_td: 2,
        rush_yd: 45,
        rush_td: 1
      };

      const points = await calculateFantasyPoints(mockPool, stats, 'ppr');

      expect(typeof points).toBe('number');
      expect(points).toBeGreaterThan(0);
    });
  });

  describe('Scoring Consistency', () => {
    it('should return consistent results for same input', async () => {
      const stats = { pass_yd: 300, pass_td: 3, pass_int: 1 };

      const points1 = await calculateFantasyPoints(mockPool, stats, 'ppr');
      const points2 = await calculateFantasyPoints(mockPool, stats, 'ppr');
      const points3 = await calculateFantasyPoints(mockPool, stats, 'ppr');

      expect(points1).toBe(points2);
      expect(points2).toBe(points3);
    });

    it('should return a properly rounded number', async () => {
      const stats = { pass_yd: 273, rec_yd: 87 };

      const points = await calculateFantasyPoints(mockPool, stats, 'ppr');

      // Result should be rounded to 2 decimal places
      const decimalPlaces = (points.toString().split('.')[1] || '').length;
      expect(decimalPlaces).toBeLessThanOrEqual(2);
    });
  });
});
