/**
 * Compute Effective Status Tests
 *
 * Verifies that LIVE derivation is:
 * - Deterministic
 * - Replay-safe
 * - Correct for all state combinations
 * - Temporal (based on injected now)
 */

const { computeEffectiveStatus } = require('../../services/helpers/computeEffectiveStatus');

describe('computeEffectiveStatus', () => {
  const now = new Date('2026-03-01T12:00:00Z');
  const nowMs = now.getTime();

  describe('input validation', () => {
    it('should reject null contest', () => {
      expect(() => computeEffectiveStatus(null, now)).toThrow('contest must be a non-null object');
    });

    it('should reject missing status', () => {
      const contest = { start_time: new Date() };
      expect(() => computeEffectiveStatus(contest, now)).toThrow('contest.status is required');
    });

    it('should reject non-string status', () => {
      const contest = { status: 123, start_time: new Date() };
      expect(() => computeEffectiveStatus(contest, now)).toThrow('contest.status is required and must be a string');
    });

    it('should reject invalid now parameter', () => {
      const contest = { status: 'SCHEDULED', start_time: new Date() };
      expect(() => computeEffectiveStatus(contest, 'not-a-date')).toThrow('now must be a valid Date or milliseconds number');
    });

    it('should reject NaN now parameter', () => {
      const contest = { status: 'SCHEDULED', start_time: new Date() };
      expect(() => computeEffectiveStatus(contest, NaN)).toThrow('now must be a valid Date or milliseconds number');
    });
  });

  describe('terminal state precedence', () => {
    it('should return COMPLETE regardless of time', () => {
      const beforeStart = {
        status: 'COMPLETE',
        start_time: new Date(nowMs + 86400000) // 1 day in future
      };
      expect(computeEffectiveStatus(beforeStart, now)).toBe('COMPLETE');
    });

    it('should return CANCELLED regardless of time', () => {
      const cancelled = {
        status: 'CANCELLED',
        start_time: new Date(nowMs - 86400000) // 1 day in past
      };
      expect(computeEffectiveStatus(cancelled, now)).toBe('CANCELLED');
    });

    it('should treat COMPLETE as case-insensitive', () => {
      const contest = { status: 'complete', start_time: new Date() };
      expect(computeEffectiveStatus(contest, now)).toBe('COMPLETE');
    });
  });

  describe('scheduled to live transition', () => {
    it('should return SCHEDULED before start_time', () => {
      const contest = {
        status: 'SCHEDULED',
        start_time: new Date(nowMs + 3600000) // 1 hour in future
      };
      expect(computeEffectiveStatus(contest, now)).toBe('SCHEDULED');
    });

    it('should return LIVE at exact start_time', () => {
      const contest = {
        status: 'SCHEDULED',
        start_time: now
      };
      expect(computeEffectiveStatus(contest, now)).toBe('LIVE');
    });

    it('should return LIVE after start_time', () => {
      const contest = {
        status: 'SCHEDULED',
        start_time: new Date(nowMs - 3600000) // 1 hour in past
      };
      expect(computeEffectiveStatus(contest, now)).toBe('LIVE');
    });

    it('should handle start_time as ISO string', () => {
      const contest = {
        status: 'SCHEDULED',
        start_time: now.toISOString()
      };
      expect(computeEffectiveStatus(contest, now)).toBe('LIVE');
    });

    it('should handle start_time as milliseconds number', () => {
      const contest = {
        status: 'SCHEDULED',
        start_time: nowMs
      };
      expect(computeEffectiveStatus(contest, now)).toBe('LIVE');
    });

    it('should return SCHEDULED when start_time is null', () => {
      const contest = {
        status: 'SCHEDULED',
        start_time: null
      };
      expect(computeEffectiveStatus(contest, now)).toBe('SCHEDULED');
    });

    it('should return SCHEDULED when start_time is missing', () => {
      const contest = { status: 'SCHEDULED' };
      expect(computeEffectiveStatus(contest, now)).toBe('SCHEDULED');
    });

    it('should return SCHEDULED for invalid start_time', () => {
      const contest = {
        status: 'SCHEDULED',
        start_time: 'invalid-date'
      };
      expect(computeEffectiveStatus(contest, now)).toBe('SCHEDULED');
    });
  });

  describe('boundary conditions', () => {
    it('should be exact at millisecond boundary', () => {
      const exactTime = new Date(nowMs);
      const contest = {
        status: 'SCHEDULED',
        start_time: exactTime
      };
      expect(computeEffectiveStatus(contest, exactTime)).toBe('LIVE');
    });

    it('should distinguish 1ms before vs at boundary', () => {
      const startTime = new Date(nowMs);
      const beforeStart = new Date(nowMs - 1);
      const afterStart = new Date(nowMs);

      const contestBefore = {
        status: 'SCHEDULED',
        start_time: startTime
      };
      const contestAfter = {
        status: 'SCHEDULED',
        start_time: startTime
      };

      expect(computeEffectiveStatus(contestBefore, beforeStart)).toBe('SCHEDULED');
      expect(computeEffectiveStatus(contestAfter, afterStart)).toBe('LIVE');
    });
  });

  describe('determinism', () => {
    it('should return same status for identical inputs', () => {
      const contest = {
        status: 'SCHEDULED',
        start_time: new Date(nowMs - 1000)
      };

      const result1 = computeEffectiveStatus(contest, now);
      const result2 = computeEffectiveStatus(contest, now);

      expect(result1).toBe(result2);
      expect(result1).toBe('LIVE');
    });

    it('should be replay-safe with same injected now', () => {
      const fixedNow = new Date('2026-03-01T12:00:00Z');

      const contest = {
        status: 'SCHEDULED',
        start_time: new Date('2026-03-01T11:00:00Z') // 1 hour before
      };

      const result1 = computeEffectiveStatus(contest, fixedNow);
      const result2 = computeEffectiveStatus(contest, fixedNow);

      expect(result1).toBe('LIVE');
      expect(result2).toBe('LIVE');
      expect(result1).toBe(result2);
    });
  });

  describe('now parameter formats', () => {
    it('should accept Date object', () => {
      const contest = {
        status: 'SCHEDULED',
        start_time: new Date(nowMs - 1000)
      };
      const result = computeEffectiveStatus(contest, new Date(nowMs));
      expect(result).toBe('LIVE');
    });

    it('should accept milliseconds number', () => {
      const contest = {
        status: 'SCHEDULED',
        start_time: new Date(nowMs - 1000)
      };
      const result = computeEffectiveStatus(contest, nowMs);
      expect(result).toBe('LIVE');
    });

    it('should handle both now formats consistently', () => {
      const contest = {
        status: 'SCHEDULED',
        start_time: new Date(nowMs - 1000)
      };

      const fromDate = computeEffectiveStatus(contest, new Date(nowMs));
      const fromMs = computeEffectiveStatus(contest, nowMs);

      expect(fromDate).toBe(fromMs);
    });
  });

  describe('case insensitivity', () => {
    it('should handle lowercase status', () => {
      const contest = { status: 'scheduled', start_time: new Date(nowMs - 1000) };
      expect(computeEffectiveStatus(contest, now)).toBe('LIVE');
    });

    it('should handle mixed case status', () => {
      const contest = { status: 'ScHeduLeD', start_time: new Date(nowMs - 1000) };
      expect(computeEffectiveStatus(contest, now)).toBe('LIVE');
    });
  });

  describe('comprehensive state matrix', () => {
    const scenarios = [
      { status: 'SCHEDULED', startOffset: -3600000, expectedBefore: 'SCHEDULED', expectedAt: 'LIVE', expectedAfter: 'LIVE' },
      { status: 'COMPLETE', startOffset: -3600000, expectedBefore: 'COMPLETE', expectedAt: 'COMPLETE', expectedAfter: 'COMPLETE' },
      { status: 'CANCELLED', startOffset: -3600000, expectedBefore: 'CANCELLED', expectedAt: 'CANCELLED', expectedAfter: 'CANCELLED' },
      { status: 'ERROR', startOffset: -3600000, expectedBefore: 'ERROR', expectedAt: 'ERROR', expectedAfter: 'ERROR' }
    ];

    scenarios.forEach(({ status, startOffset, expectedBefore, expectedAt, expectedAfter }) => {
      describe(`${status} contests`, () => {
        const startTime = new Date(nowMs + startOffset);

        it(`should return ${expectedBefore} before start_time`, () => {
          const contest = { status, start_time: startTime };
          const before = new Date(nowMs + startOffset - 1000);
          expect(computeEffectiveStatus(contest, before)).toBe(expectedBefore);
        });

        it(`should return ${expectedAt} at start_time`, () => {
          const contest = { status, start_time: startTime };
          expect(computeEffectiveStatus(contest, startTime)).toBe(expectedAt);
        });

        it(`should return ${expectedAfter} after start_time`, () => {
          const contest = { status, start_time: startTime };
          const after = new Date(nowMs + startOffset + 1000);
          expect(computeEffectiveStatus(contest, after)).toBe(expectedAfter);
        });
      });
    });
  });
});
