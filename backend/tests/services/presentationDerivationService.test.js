/**
 * Presentation Derivation Service Tests
 *
 * Tests for pure derivation functions used in Iteration 01 presentation layer.
 */

const {
  deriveLeaderboardState,
  deriveContestActions,
  derivePayoutTable,
  deriveRosterConfig,
  deriveColumnSchema
} = require('../../services/presentationDerivationService');

describe('presentationDerivationService', () => {
  describe('deriveLeaderboardState', () => {
    it('should return "error" when status is ERROR', () => {
      const result = deriveLeaderboardState({ status: 'ERROR' }, true);
      expect(result).toBe('error');
    });

    it('should return "error" when status is ERROR regardless of settlementRecordExists', () => {
      const result = deriveLeaderboardState({ status: 'ERROR' }, false);
      expect(result).toBe('error');
    });

    it('should return "computed" when settlementRecordExists is true', () => {
      const result = deriveLeaderboardState({ status: 'COMPLETE' }, true);
      expect(result).toBe('computed');
    });

    it('should return "pending" when no settlement record and not ERROR', () => {
      const result = deriveLeaderboardState({ status: 'LIVE' }, false);
      expect(result).toBe('pending');
    });

    it('should return "pending" for SCHEDULED status without settlement', () => {
      const result = deriveLeaderboardState({ status: 'SCHEDULED' }, false);
      expect(result).toBe('pending');
    });

    it('should return "pending" for LOCKED status without settlement', () => {
      const result = deriveLeaderboardState({ status: 'LOCKED' }, false);
      expect(result).toBe('pending');
    });
  });

  describe('deriveContestActions', () => {
    const now = Date.now();
    const futureTime = new Date(now + 3600000).toISOString(); // 1 hour from now
    const pastTime = new Date(now - 3600000).toISOString(); // 1 hour ago

    it('should allow joining SCHEDULED contest before lock_time with capacity', () => {
      const result = deriveContestActions(
        { status: 'SCHEDULED', lock_time: futureTime },
        'pending',
        { user_has_entered: false, entry_count: 5, max_entries: 10 },
        now
      );

      expect(result.can_join).toBe(true);
      expect(result.can_edit_entry).toBe(false);
      expect(result.is_read_only).toBe(false);
    });

    it('should not allow joining after lock_time', () => {
      const result = deriveContestActions(
        { status: 'SCHEDULED', lock_time: pastTime },
        'pending',
        { user_has_entered: false, entry_count: 5, max_entries: 10 },
        now
      );

      expect(result.can_join).toBe(false);
      expect(result.is_read_only).toBe(true);
    });

    it('should not allow joining when user already entered', () => {
      const result = deriveContestActions(
        { status: 'SCHEDULED', lock_time: futureTime },
        'pending',
        { user_has_entered: true, entry_count: 5, max_entries: 10 },
        now
      );

      expect(result.can_join).toBe(false);
      expect(result.can_edit_entry).toBe(true);
    });

    it('should not allow joining when contest is full', () => {
      const result = deriveContestActions(
        { status: 'SCHEDULED', lock_time: futureTime },
        'pending',
        { user_has_entered: false, entry_count: 10, max_entries: 10 },
        now
      );

      expect(result.can_join).toBe(false);
    });

    it('should allow unlimited entries when max_entries is null', () => {
      const result = deriveContestActions(
        { status: 'SCHEDULED', lock_time: futureTime },
        'pending',
        { user_has_entered: false, entry_count: 1000, max_entries: null },
        now
      );

      expect(result.can_join).toBe(true);
    });

    it('should set is_live for LIVE status', () => {
      const result = deriveContestActions(
        { status: 'LIVE', lock_time: futureTime },
        'pending',
        { user_has_entered: true, entry_count: 5, max_entries: 10 },
        now
      );

      expect(result.is_live).toBe(true);
    });

    it('should set is_closed for COMPLETE status', () => {
      const result = deriveContestActions(
        { status: 'COMPLETE', lock_time: futureTime },
        'computed',
        { user_has_entered: true, entry_count: 5, max_entries: 10 },
        now
      );

      expect(result.is_closed).toBe(true);
    });

    it('should set is_closed for CANCELLED status', () => {
      const result = deriveContestActions(
        { status: 'CANCELLED', lock_time: futureTime },
        'pending',
        { user_has_entered: true, entry_count: 5, max_entries: 10 },
        now
      );

      expect(result.is_closed).toBe(true);
    });

    it('should set is_scoring when leaderboard_state is pending and status is LIVE', () => {
      const result = deriveContestActions(
        { status: 'LIVE', lock_time: futureTime },
        'pending',
        { user_has_entered: true, entry_count: 5, max_entries: 10 },
        now
      );

      expect(result.is_scoring).toBe(true);
      expect(result.is_scored).toBe(false);
    });

    it('should set is_scored when leaderboard_state is computed', () => {
      const result = deriveContestActions(
        { status: 'COMPLETE', lock_time: futureTime },
        'computed',
        { user_has_entered: true, entry_count: 5, max_entries: 10 },
        now
      );

      expect(result.is_scored).toBe(true);
      expect(result.is_scoring).toBe(false);
    });
  });

  describe('derivePayoutTable', () => {
    it('should return empty array for null payout_structure', () => {
      const result = derivePayoutTable(null);
      expect(result).toEqual([]);
    });

    it('should return empty array for undefined payout_structure', () => {
      const result = derivePayoutTable(undefined);
      expect(result).toEqual([]);
    });

    it('should return empty array for non-object payout_structure', () => {
      const result = derivePayoutTable('invalid');
      expect(result).toEqual([]);
    });

    it('should transform simple payout structure', () => {
      const structure = { first: 70, second: 20, third: 10 };
      const result = derivePayoutTable(structure);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        place: 'first',
        min_rank: 1,
        max_rank: 1,
        payout_amount: null,
        payout_percent: 70,
        currency: 'USD'
      });
      expect(result[1]).toEqual({
        place: 'second',
        min_rank: 2,
        max_rank: 2,
        payout_amount: null,
        payout_percent: 20,
        currency: 'USD'
      });
    });

    it('should handle stringified JSON (defensive parsing)', () => {
      const structure = JSON.stringify({ first: 100 });
      const result = derivePayoutTable(structure);

      expect(result).toHaveLength(1);
      expect(result[0].place).toBe('first');
      expect(result[0].payout_percent).toBe(100);
    });

    it('should handle invalid JSON string gracefully', () => {
      const result = derivePayoutTable('{ invalid json');
      expect(result).toEqual([]);
    });
  });

  describe('deriveRosterConfig', () => {
    it('should return minimal config for null template', () => {
      const result = deriveRosterConfig(null);

      expect(result).toEqual({
        entry_fields: [],
        validation_rules: {}
      });
    });

    it('should return minimal config for valid template', () => {
      const template = {
        id: 'template-1',
        name: 'NFL Playoff',
        template_type: 'playoff_challenge'
      };

      const result = deriveRosterConfig(template);

      expect(result).toEqual({
        entry_fields: [],
        validation_rules: {}
      });
    });
  });

  describe('deriveColumnSchema', () => {
    it('should return stable default schema', () => {
      const result = deriveColumnSchema(null);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty('key');
      expect(result[0]).toHaveProperty('label');
      expect(result[0]).toHaveProperty('type');
      expect(result[0]).toHaveProperty('sortable');
    });

    it('should include rank column', () => {
      const result = deriveColumnSchema(null);
      const rankColumn = result.find(col => col.key === 'rank');

      expect(rankColumn).toBeDefined();
      expect(rankColumn.type).toBe('number');
    });

    it('should include user_display_name column', () => {
      const result = deriveColumnSchema(null);
      const participantColumn = result.find(col => col.key === 'user_display_name');

      expect(participantColumn).toBeDefined();
      expect(participantColumn.type).toBe('string');
    });

    it('should include total_score column', () => {
      const result = deriveColumnSchema(null);
      const scoreColumn = result.find(col => col.key === 'total_score');

      expect(scoreColumn).toBeDefined();
      expect(scoreColumn.type).toBe('number');
    });

    it('should return same schema for different templates (deterministic)', () => {
      const template1 = { id: 'template-1', name: 'NFL' };
      const template2 = { id: 'template-2', name: 'Golf' };

      const result1 = deriveColumnSchema(template1);
      const result2 = deriveColumnSchema(template2);

      expect(JSON.stringify(result1)).toBe(JSON.stringify(result2));
    });
  });
});
