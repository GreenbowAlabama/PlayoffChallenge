/**
 * computeJoinState Unit Tests
 *
 * Tests the pure function that derives join state from an instance row.
 */

const { computeJoinState, JOIN_STATES } = require('../../services/helpers/contestState');

describe('computeJoinState', () => {
  describe('JOINABLE', () => {
    it('should return JOINABLE when status is open and lock_time is null', () => {
      const result = computeJoinState({ status: 'open', lock_time: null });
      expect(result).toBe('UNAVAILABLE');
    });

    it('should return JOINABLE when status is open and now < lock_time', () => {
      const futureLock = new Date(Date.now() + 3600000).toISOString();
      const result = computeJoinState({ status: 'open', lock_time: futureLock });
      expect(result).toBe('UNAVAILABLE');
    });

    it('should return JOINABLE when now is injected before lock_time', () => {
      const lockTime = '2025-06-01T12:00:00Z';
      const now = new Date('2025-06-01T11:00:00Z');
      const result = computeJoinState({ status: 'open', lock_time: lockTime }, now);
      expect(result).toBe('UNAVAILABLE');
    });
  });

  describe('LOCKED', () => {
    it('should return LOCKED when status is open and now >= lock_time', () => {
      const pastLock = new Date(Date.now() - 60000).toISOString();
      const result = computeJoinState({ status: 'open', lock_time: pastLock });
      expect(result).toBe('UNAVAILABLE');
    });

    it('should return LOCKED when status is locked (regardless of lock_time)', () => {
      const result = computeJoinState({ status: 'locked', lock_time: null });
      expect(result).toBe('UNAVAILABLE');
    });

    it('should return LOCKED when now equals lock_time exactly', () => {
      const lockTime = '2025-06-01T12:00:00Z';
      const now = new Date('2025-06-01T12:00:00Z');
      const result = computeJoinState({ status: 'open', lock_time: lockTime }, now);
      expect(result).toBe('UNAVAILABLE');
    });
  });

  describe('COMPLETED', () => {
    it('should return COMPLETED when status is settled', () => {
      const result = computeJoinState({ status: 'settled', lock_time: null });
      expect(result).toBe('UNAVAILABLE');
    });
  });

  describe('UNAVAILABLE', () => {
    it('should return UNAVAILABLE when status is cancelled', () => {
      const result = computeJoinState({ status: 'cancelled', lock_time: null });
      expect(result).toBe('UNAVAILABLE');
    });

    it('should return UNAVAILABLE when status is draft', () => {
      const result = computeJoinState({ status: 'draft', lock_time: null });
      expect(result).toBe('UNAVAILABLE');
    });

    it('should return UNAVAILABLE for unknown status (fail closed)', () => {
      const result = computeJoinState({ status: 'some_future_status', lock_time: null });
      expect(result).toBe('UNAVAILABLE');
    });
  });

  describe('JOIN_STATES enum', () => {
    it('should export all four states', () => {
      expect(JOIN_STATES.JOINABLE).toBe('JOINABLE');
      expect(JOIN_STATES.LOCKED).toBe('LOCKED');
      expect(JOIN_STATES.COMPLETED).toBe('COMPLETED');
      expect(JOIN_STATES.UNAVAILABLE).toBe('UNAVAILABLE');
    });
  });
});
