/**
 * Lock Strategy Tests
 *
 * Tests core lock strategy functionality:
 * - shouldLock() deterministic time check
 * - Strategy registry and validation
 * - New time_based_lock_v1 strategy
 */

const lockStrategy = require('../../services/lockStrategy');

describe('Lock Strategy Module', () => {
  describe('shouldLock() - Deterministic time-based locking', () => {
    it('should return false when contest is not open', () => {
      const contestInstance = {
        status: 'locked',
        lock_time: new Date(Date.now() - 60000).toISOString()
      };
      const currentTime = new Date();

      const result = lockStrategy.shouldLock(contestInstance, currentTime);
      expect(result).toBe(false);
    });

    it('should return false when lock_time is null', () => {
      const contestInstance = {
        status: 'open',
        lock_time: null
      };
      const currentTime = new Date();

      const result = lockStrategy.shouldLock(contestInstance, currentTime);
      expect(result).toBe(false);
    });

    it('should return false when lock_time is in the future', () => {
      const futureLockTime = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now
      const contestInstance = {
        status: 'open',
        lock_time: futureLockTime
      };
      const currentTime = new Date();

      const result = lockStrategy.shouldLock(contestInstance, currentTime);
      expect(result).toBe(false);
    });

    it('should return true when lock_time is in the past', () => {
      const pastLockTime = new Date(Date.now() - 60000).toISOString(); // 1 minute ago
      const contestInstance = {
        status: 'open',
        lock_time: pastLockTime
      };
      const currentTime = new Date();

      const result = lockStrategy.shouldLock(contestInstance, currentTime);
      expect(result).toBe(true);
    });

    it('should return true when current time equals lock_time', () => {
      const now = new Date();
      const contestInstance = {
        status: 'open',
        lock_time: now.toISOString()
      };

      const result = lockStrategy.shouldLock(contestInstance, now);
      expect(result).toBe(true);
    });

    it('should use current time if not provided', () => {
      const pastLockTime = new Date(Date.now() - 60000).toISOString();
      const contestInstance = {
        status: 'open',
        lock_time: pastLockTime
      };

      // Call without currentTime argument
      const result = lockStrategy.shouldLock(contestInstance);
      expect(result).toBe(true);
    });
  });

  describe('VALID_STRATEGIES - Registry-derived whitelist', () => {
    it('should include time_based_lock_v1', () => {
      expect(lockStrategy.VALID_STRATEGIES).toContain('time_based_lock_v1');
    });

    it('should include first_game_kickoff', () => {
      expect(lockStrategy.VALID_STRATEGIES).toContain('first_game_kickoff');
    });

    it('should include manual', () => {
      expect(lockStrategy.VALID_STRATEGIES).toContain('manual');
    });

    it('should be frozen to prevent modification', () => {
      expect(() => {
        lockStrategy.VALID_STRATEGIES.push('new_strategy');
      }).toThrow();
    });
  });

  describe('isValidStrategy() - Validation', () => {
    it('should return true for registered strategies', () => {
      expect(lockStrategy.isValidStrategy('time_based_lock_v1')).toBe(true);
      expect(lockStrategy.isValidStrategy('manual')).toBe(true);
      expect(lockStrategy.isValidStrategy('first_game_kickoff')).toBe(true);
    });

    it('should return false for unregistered strategies', () => {
      expect(lockStrategy.isValidStrategy('unknown_strategy')).toBe(false);
      expect(lockStrategy.isValidStrategy('')).toBe(false);
    });
  });

  describe('computeLockTime() - Strategy dispatch', () => {
    it('should throw for unknown strategy', () => {
      const context = { lock_time: new Date().toISOString() };

      expect(() => {
        lockStrategy.computeLockTime('unknown_strategy', context);
      }).toThrow('Unknown lock strategy: unknown_strategy');
    });

    it('should return null for manual strategy', () => {
      const context = {};
      const result = lockStrategy.computeLockTime('manual', context);
      expect(result).toBe(null);
    });

    it('should return null for manual strategy even with lock_time context', () => {
      const context = { lock_time: new Date().toISOString() };
      const result = lockStrategy.computeLockTime('manual', context);
      expect(result).toBe(null);
    });
  });

  describe('time_based_lock_v1 - Generic sport-agnostic strategy', () => {
    it('should return lock_time when provided', () => {
      const lockTime = new Date(Date.now() + 3600000);
      const context = { lock_time: lockTime };

      const result = lockStrategy.computeLockTime('time_based_lock_v1', context);
      expect(result).toEqual(lockTime);
    });

    it('should return null when lock_time is not provided', () => {
      const context = {};
      const result = lockStrategy.computeLockTime('time_based_lock_v1', context);
      expect(result).toBe(null);
    });

    it('should return null when lock_time is null', () => {
      const context = { lock_time: null };
      const result = lockStrategy.computeLockTime('time_based_lock_v1', context);
      expect(result).toBe(null);
    });

    it('should work with past lock_time', () => {
      const pastLockTime = new Date(Date.now() - 3600000);
      const context = { lock_time: pastLockTime };

      const result = lockStrategy.computeLockTime('time_based_lock_v1', context);
      expect(result).toEqual(pastLockTime);
    });

    it('should work with string lock_time (ISO format)', () => {
      const lockTime = new Date(Date.now() + 3600000);
      const context = { lock_time: lockTime.toISOString() };

      const result = lockStrategy.computeLockTime('time_based_lock_v1', context);
      expect(result).toEqual(new Date(lockTime.toISOString()));
    });

    it('should work with numeric lock_time (milliseconds)', () => {
      const lockTimeMs = Date.now() + 3600000;
      const context = { lock_time: lockTimeMs };

      const result = lockStrategy.computeLockTime('time_based_lock_v1', context);
      expect(result.getTime()).toEqual(lockTimeMs);
    });
  });

  describe('Integration: time_based_lock_v1 + shouldLock', () => {
    it('should lock when now >= computed lock_time', () => {
      // Compute lock time 1 minute in the past
      const pastLockTime = new Date(Date.now() - 60000);
      const context = { lock_time: pastLockTime };
      const computedLockTime = lockStrategy.computeLockTime('time_based_lock_v1', context);

      // Create contest with computed lock time
      const contestInstance = {
        status: 'open',
        lock_time: computedLockTime.toISOString()
      };

      // Should lock with current time
      const shouldLock = lockStrategy.shouldLock(contestInstance, new Date());
      expect(shouldLock).toBe(true);
    });

    it('should not lock when now < computed lock_time', () => {
      // Compute lock time 1 hour in the future
      const futureLockTime = new Date(Date.now() + 3600000);
      const context = { lock_time: futureLockTime };
      const computedLockTime = lockStrategy.computeLockTime('time_based_lock_v1', context);

      // Create contest with computed lock time
      const contestInstance = {
        status: 'open',
        lock_time: computedLockTime.toISOString()
      };

      // Should not lock with current time
      const shouldLock = lockStrategy.shouldLock(contestInstance, new Date());
      expect(shouldLock).toBe(false);
    });
  });
});
