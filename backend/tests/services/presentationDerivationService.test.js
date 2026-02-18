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

    describe('Organizer capability: can_share_invite and can_manage_contest', () => {
      const organizerId = '11111111-1111-1111-1111-111111111111';
      const otherUserId = '22222222-2222-2222-2222-222222222222';

      it('should grant organizer capabilities when authenticated user is creator', () => {
        const result = deriveContestActions(
          { status: 'SCHEDULED', lock_time: futureTime, organizer_id: organizerId },
          'pending',
          { user_has_entered: true, entry_count: 5, max_entries: 10 },
          now,
          organizerId
        );

        expect(result.can_share_invite).toBe(true);
        expect(result.can_manage_contest).toBe(true);
      });

      it('should allow share capability for non-creator participant but deny manage', () => {
        const result = deriveContestActions(
          { status: 'SCHEDULED', lock_time: futureTime, organizer_id: organizerId },
          'pending',
          { user_has_entered: true, entry_count: 5, max_entries: 10 },
          now,
          otherUserId
        );

        expect(result.can_share_invite).toBe(true);
        expect(result.can_manage_contest).toBe(false);
      });

      it('should deny organizer capabilities for unauthenticated user (null)', () => {
        const result = deriveContestActions(
          { status: 'SCHEDULED', lock_time: futureTime, organizer_id: organizerId },
          'pending',
          { user_has_entered: false, entry_count: 5, max_entries: 10 },
          now,
          null
        );

        expect(result.can_share_invite).toBe(false);
        expect(result.can_manage_contest).toBe(false);
      });

      it('should grant organizer capabilities for creator in LIVE contest', () => {
        const result = deriveContestActions(
          { status: 'LIVE', lock_time: pastTime, organizer_id: organizerId },
          'pending',
          { user_has_entered: true, entry_count: 5, max_entries: 10 },
          now,
          organizerId
        );

        expect(result.can_share_invite).toBe(true);
        expect(result.can_manage_contest).toBe(true);
      });

      it('should grant organizer capabilities for creator in COMPLETE contest', () => {
        const result = deriveContestActions(
          { status: 'COMPLETE', lock_time: pastTime, organizer_id: organizerId },
          'computed',
          { user_has_entered: true, entry_count: 5, max_entries: 10 },
          now,
          organizerId
        );

        expect(result.can_share_invite).toBe(true);
        expect(result.can_manage_contest).toBe(true);
      });

      it('should deny share capability for unauthenticated user when authenticatedUserId is not provided', () => {
        const result = deriveContestActions(
          { status: 'SCHEDULED', lock_time: futureTime, organizer_id: organizerId },
          'pending',
          { user_has_entered: false, entry_count: 5, max_entries: 10 },
          now
          // No authenticatedUserId parameter, should default to null
        );

        expect(result.can_share_invite).toBe(false);
        expect(result.can_manage_contest).toBe(false);
      });

      it('should allow both share and manage for organizer in LIVE contest', () => {
        const result = deriveContestActions(
          { status: 'LIVE', lock_time: pastTime, organizer_id: organizerId },
          'pending',
          { user_has_entered: true, entry_count: 5, max_entries: 10 },
          now,
          organizerId
        );

        expect(result.can_share_invite).toBe(true);
        expect(result.can_manage_contest).toBe(true);
      });

      it('should allow share but deny manage for non-organizer participant in LIVE contest', () => {
        const result = deriveContestActions(
          { status: 'LIVE', lock_time: pastTime, organizer_id: organizerId },
          'pending',
          { user_has_entered: true, entry_count: 5, max_entries: 10 },
          now,
          otherUserId
        );

        expect(result.can_share_invite).toBe(true);
        expect(result.can_manage_contest).toBe(false);
      });

      it('should deny all capabilities for unauthenticated user in LIVE contest', () => {
        const result = deriveContestActions(
          { status: 'LIVE', lock_time: pastTime, organizer_id: organizerId },
          'pending',
          { user_has_entered: false, entry_count: 5, max_entries: 10 },
          now,
          null
        );

        expect(result.can_share_invite).toBe(false);
        expect(result.can_manage_contest).toBe(false);
      });

      it('should allow share but deny manage for non-organizer participant in COMPLETE contest', () => {
        const result = deriveContestActions(
          { status: 'COMPLETE', lock_time: pastTime, organizer_id: organizerId },
          'computed',
          { user_has_entered: true, entry_count: 5, max_entries: 10 },
          now,
          otherUserId
        );

        expect(result.can_share_invite).toBe(true);
        expect(result.can_manage_contest).toBe(false);
      });

      describe('Governance Invariant: can_share_invite lifecycle containment', () => {
        // GOVERNANCE TEST: can_share_invite must depend on:
        // - authenticatedUserId !== null
        // - contest.status !== 'ERROR'
        //
        // ERROR is an uncontrolled system state that must not be virally propagated.
        // COMPLETE and CANCELLED are controlled outcomes and may be shared.
        //
        // can_share_invite must NEVER depend on:
        // - user_has_entered, entry_count, max_entries (capacity)
        // - leaderboard_state
        // - join eligibility or other context logic

        const shareableStatuses = [
          { status: 'SCHEDULED', leaderboard: 'pending', userEntered: false, atCapacity: false },
          { status: 'SCHEDULED', leaderboard: 'pending', userEntered: true, atCapacity: false },
          { status: 'SCHEDULED', leaderboard: 'pending', userEntered: false, atCapacity: true },
          { status: 'LOCKED', leaderboard: 'pending', userEntered: false, atCapacity: false },
          { status: 'LOCKED', leaderboard: 'pending', userEntered: true, atCapacity: true },
          { status: 'LIVE', leaderboard: 'pending', userEntered: false, atCapacity: false },
          { status: 'LIVE', leaderboard: 'pending', userEntered: true, atCapacity: true },
          { status: 'COMPLETE', leaderboard: 'computed', userEntered: false, atCapacity: false },
          { status: 'COMPLETE', leaderboard: 'computed', userEntered: true, atCapacity: true },
          { status: 'CANCELLED', leaderboard: 'pending', userEntered: false, atCapacity: false },
          { status: 'CANCELLED', leaderboard: 'pending', userEntered: true, atCapacity: true }
        ];

        shareableStatuses.forEach(testCase => {
          it(`should return can_share_invite=true (authenticated) for status=${testCase.status}, userEntered=${testCase.userEntered}, capacity=${testCase.atCapacity}`, () => {
            const maxEntries = testCase.atCapacity ? 10 : 100;
            const entryCount = testCase.atCapacity ? 10 : 5;
            const lockTime = testCase.status === 'SCHEDULED' ? futureTime : pastTime;

            const result = deriveContestActions(
              { status: testCase.status, lock_time: lockTime, organizer_id: organizerId },
              testCase.leaderboard,
              { user_has_entered: testCase.userEntered, entry_count: entryCount, max_entries: maxEntries },
              now,
              otherUserId // authenticated, non-organizer
            );

            // GOVERNANCE INVARIANT: can_share_invite=true for all non-ERROR statuses when authenticated
            expect(result.can_share_invite).toBe(true);
            // can_manage_contest still respects organizer logic
            expect(result.can_manage_contest).toBe(false);
          });
        });

        describe('ERROR Containment: viral propagation prevention', () => {
          it('should block share capability for authenticated user in ERROR contest', () => {
            const result = deriveContestActions(
              { status: 'ERROR', lock_time: pastTime, organizer_id: organizerId },
              'error',
              { user_has_entered: false, entry_count: 0, max_entries: 100 },
              now,
              otherUserId // authenticated, non-organizer
            );

            // GOVERNANCE INVARIANT: ERROR contests cannot be shared, even by authenticated users
            expect(result.can_share_invite).toBe(false);
            expect(result.can_manage_contest).toBe(false);
          });

          it('should block share capability for organizer in ERROR contest', () => {
            const result = deriveContestActions(
              { status: 'ERROR', lock_time: pastTime, organizer_id: organizerId },
              'error',
              { user_has_entered: true, entry_count: 5, max_entries: 100 },
              now,
              organizerId // authenticated, organizer
            );

            // GOVERNANCE INVARIANT: ERROR contests cannot be shared, even by organizer
            expect(result.can_share_invite).toBe(false);
            // Organizer retains management capability to resolve ERROR
            expect(result.can_manage_contest).toBe(true);
          });
        });

        it('should return can_share_invite=false (unauthenticated) regardless of status, entry state, or capacity', () => {
          const testCases = [
            { status: 'SCHEDULED', leaderboard: 'pending' },
            { status: 'LIVE', leaderboard: 'pending' },
            { status: 'COMPLETE', leaderboard: 'computed' },
            { status: 'CANCELLED', leaderboard: 'pending' },
            { status: 'ERROR', leaderboard: 'error' }
          ];

          testCases.forEach(testCase => {
            const lockTime = testCase.status === 'SCHEDULED' ? futureTime : pastTime;

            const result = deriveContestActions(
              { status: testCase.status, lock_time: lockTime, organizer_id: organizerId },
              testCase.leaderboard,
              { user_has_entered: true, entry_count: 10, max_entries: 10 }, // At capacity, already joined
              now,
              null // unauthenticated
            );

            // GOVERNANCE INVARIANT: unauthenticated users never get share capability
            expect(result.can_share_invite).toBe(false);
            expect(result.can_manage_contest).toBe(false);
          });
        });
      });
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
        rank_min: 1,
        rank_max: 1,
        amount: null,
        payout_percent: 70,
        currency: 'USD'
      });
      expect(result[1]).toEqual({
        place: 'second',
        rank_min: 2,
        rank_max: 2,
        amount: null,
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

    it('CONTRACT: should include rank_min (not min_rank) for iOS compatibility', () => {
      const structure = { first: 100 };
      const result = derivePayoutTable(structure);

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('rank_min');
      expect(result[0]).not.toHaveProperty('min_rank');
    });

    it('CONTRACT: should include rank_max (not max_rank) for iOS compatibility', () => {
      const structure = { first: 100 };
      const result = derivePayoutTable(structure);

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('rank_max');
      expect(result[0]).not.toHaveProperty('max_rank');
    });

    it('CONTRACT: should include amount (required field for iOS)', () => {
      const structure = { first: 100, second: 50 };
      const result = derivePayoutTable(structure);

      expect(result).toHaveLength(2);
      result.forEach(row => {
        expect(row).toHaveProperty('amount');
      });
    });

    it('CONTRACT: should have all required fields for iOS ContestDetailResponseContract', () => {
      const structure = { first: 70, second: 20, third: 10 };
      const result = derivePayoutTable(structure);

      expect(result).toHaveLength(3);
      result.forEach((row, index) => {
        // Required fields per iOS contract
        expect(row).toHaveProperty('rank_min');
        expect(row).toHaveProperty('rank_max');
        expect(row).toHaveProperty('amount');
        expect(typeof row.rank_min).toBe('number');
        expect(typeof row.rank_max).toBe('number');
        // amount is null initially, computed at settlement
      });
    });

    it('CONTRACT: rank_min and rank_max should match placement order', () => {
      const structure = { first: 50, second: 30, third: 20 };
      const result = derivePayoutTable(structure);

      expect(result[0].rank_min).toBe(1);
      expect(result[0].rank_max).toBe(1);
      expect(result[1].rank_min).toBe(2);
      expect(result[1].rank_max).toBe(2);
      expect(result[2].rank_min).toBe(3);
      expect(result[2].rank_max).toBe(3);
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
