/**
 * Contest Service Unit Tests
 *
 * Purpose: Test contest-related service logic in isolation
 * - Contest creation and validation
 * - Contest discovery (public/private)
 * - Contest join logic and gating
 * - Contest state transitions
 * - Data shape validation for all contest payloads
 *
 * These tests assert against explicit field-level data contracts.
 */

const { createMockPool, mockQueryResponses } = require('../mocks/mockPool');
const {
  TEST_IDS,
  TEST_CONTEST_IDS,
  contests,
  contestStates,
  users
} = require('../fixtures');

describe('Contest Service Unit Tests', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = createMockPool();
  });

  afterEach(() => {
    mockPool.reset();
  });

  describe('Contest Creation', () => {
    it('should create a contest with all required fields', async () => {
      const newContest = {
        contest_type: 'playoff_challenge',
        league_name: 'Test League',
        entry_fee_cents: 1000,
        max_entries: 50,
        is_private: false
      };

      const createdContest = {
        ...newContest,
        contest_id: 'new-contest-uuid',
        current_entries: 0,
        state: 'draft',
        join_link: null,
        created_at: new Date()
      };

      mockPool.setQueryResponse(
        /INSERT INTO contests/,
        mockQueryResponses.single(createdContest)
      );

      const result = await mockPool.query(
        'INSERT INTO contests (contest_type, league_name, entry_fee_cents, max_entries, is_private) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [newContest.contest_type, newContest.league_name, newContest.entry_fee_cents, newContest.max_entries, newContest.is_private]
      );

      expect(result.rows[0]).toHaveProperty('contest_id');
      expect(result.rows[0].state).toBe('draft');
      expect(result.rows[0].current_entries).toBe(0);
    });

    it('should generate join_link for private contests', async () => {
      const privateContest = {
        ...contests.private,
        join_link: 'https://app.playoff.com/join/generated123'
      };

      mockPool.setQueryResponse(
        /INSERT INTO contests/,
        mockQueryResponses.single(privateContest)
      );

      const result = await mockPool.query('INSERT INTO contests...');

      expect(result.rows[0].is_private).toBe(true);
      expect(result.rows[0].join_link).toBeTruthy();
      expect(typeof result.rows[0].join_link).toBe('string');
    });

    it('should reject invalid contest_type', () => {
      const invalidContest = {
        contest_type: 'invalid_type',
        league_name: 'Test',
        entry_fee_cents: 0
      };

      const validTypes = ['playoff_challenge', 'march_madness'];
      expect(validTypes).not.toContain(invalidContest.contest_type);
    });

    it('should require entry_fee_cents to be a non-negative integer', () => {
      const validEntryFees = [0, 100, 2500, 10000];
      const invalidEntryFees = [-100, 25.50, 'free', null];

      validEntryFees.forEach(fee => {
        expect(Number.isInteger(fee)).toBe(true);
        expect(fee).toBeGreaterThanOrEqual(0);
      });

      invalidEntryFees.forEach(fee => {
        const isValidInteger = Number.isInteger(fee) && fee >= 0;
        expect(isValidInteger).toBe(false);
      });
    });
  });

  describe('Contest Discovery', () => {
    it('should return public contests for discovery', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM contests.*WHERE.*is_private\s*=\s*false/i,
        mockQueryResponses.multiple([contests.free, contests.paid])
      );

      const result = await mockPool.query('SELECT * FROM contests WHERE is_private = false AND state = $1', ['open']);

      expect(result.rows.length).toBeGreaterThan(0);
      result.rows.forEach(contest => {
        expect(contest.is_private).toBe(false);
      });
    });

    it('should hide private contests from public discovery', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM contests.*WHERE.*is_private\s*=\s*false/i,
        mockQueryResponses.multiple([contests.free, contests.paid])
      );

      const result = await mockPool.query('SELECT * FROM contests WHERE is_private = false');

      const privateContestIds = result.rows.filter(c => c.is_private === true);
      expect(privateContestIds.length).toBe(0);
    });

    it('should allow private contest access via join_link', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM contests.*WHERE.*join_link/,
        mockQueryResponses.single(contests.private)
      );

      const result = await mockPool.query(
        'SELECT * FROM contests WHERE join_link = $1',
        ['https://app.playoff.com/join/abc123']
      );

      expect(result.rows[0].contest_id).toBe(TEST_CONTEST_IDS.privateContest);
      expect(result.rows[0].is_private).toBe(true);
    });

    it('should filter contests by contest_type', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM contests.*WHERE.*contest_type/,
        mockQueryResponses.multiple([contests.marchMadness])
      );

      const result = await mockPool.query(
        'SELECT * FROM contests WHERE contest_type = $1',
        ['march_madness']
      );

      result.rows.forEach(contest => {
        expect(contest.contest_type).toBe('march_madness');
      });
    });
  });

  describe('Contest Join Logic', () => {
    it('should allow join when current_entries < max_entries', async () => {
      const openContest = { ...contests.free, current_entries: 25, max_entries: 100 };

      mockPool.setQueryResponse(
        /SELECT.*FROM contests.*WHERE.*contest_id/,
        mockQueryResponses.single(openContest)
      );

      const result = await mockPool.query(
        'SELECT * FROM contests WHERE contest_id = $1',
        [TEST_CONTEST_IDS.freeContest]
      );

      const contest = result.rows[0];
      const canJoin = contest.current_entries < contest.max_entries;
      expect(canJoin).toBe(true);
    });

    it('should block join when current_entries >= max_entries', async () => {
      const fullContest = { ...contests.free, current_entries: 100, max_entries: 100 };

      mockPool.setQueryResponse(
        /SELECT.*FROM contests/,
        mockQueryResponses.single(fullContest)
      );

      const result = await mockPool.query('SELECT * FROM contests WHERE contest_id = $1', [TEST_CONTEST_IDS.freeContest]);

      const contest = result.rows[0];
      const canJoin = contest.current_entries < contest.max_entries;
      expect(canJoin).toBe(false);
    });

    it('should block join when contest state is not open', async () => {
      const lockedContest = { ...contests.locked, state: 'locked' };

      mockPool.setQueryResponse(
        /SELECT.*FROM contests/,
        mockQueryResponses.single(lockedContest)
      );

      const result = await mockPool.query('SELECT * FROM contests WHERE contest_id = $1', [TEST_CONTEST_IDS.lockedContest]);

      const contest = result.rows[0];
      const canJoin = contest.state === 'open';
      expect(canJoin).toBe(false);
    });

    it('should require payment for paid contests before join', async () => {
      const paidContest = { ...contests.paid, entry_fee_cents: 2500 };

      mockPool.setQueryResponse(
        /SELECT.*FROM contests/,
        mockQueryResponses.single(paidContest)
      );

      const result = await mockPool.query('SELECT * FROM contests WHERE contest_id = $1', [TEST_CONTEST_IDS.paidContest]);

      const contest = result.rows[0];
      const requiresPayment = contest.entry_fee_cents > 0;
      expect(requiresPayment).toBe(true);
    });

    it('should prevent duplicate entries for same user in same contest', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM contest_entries.*WHERE.*user_id.*AND.*contest_id/,
        mockQueryResponses.single({ user_id: TEST_IDS.users.validUser, contest_id: TEST_CONTEST_IDS.freeContest })
      );

      const result = await mockPool.query(
        'SELECT * FROM contest_entries WHERE user_id = $1 AND contest_id = $2',
        [TEST_IDS.users.validUser, TEST_CONTEST_IDS.freeContest]
      );

      const alreadyEntered = result.rows.length > 0;
      expect(alreadyEntered).toBe(true);
    });
  });

  describe('Contest State Transitions', () => {
    const validTransitions = {
      draft: ['open', 'cancelled'],
      open: ['locked', 'cancelled'],
      locked: ['active', 'open'], // open allows admin unlock
      active: ['scoring'],
      scoring: ['finalized'],
      finalized: [], // terminal state
      cancelled: [] // terminal state
    };

    it('should validate all defined contest states', () => {
      contestStates.forEach(state => {
        expect(typeof state).toBe('string');
        expect(state.length).toBeGreaterThan(0);
      });

      expect(contestStates).toContain('draft');
      expect(contestStates).toContain('open');
      expect(contestStates).toContain('locked');
      expect(contestStates).toContain('active');
      expect(contestStates).toContain('scoring');
      expect(contestStates).toContain('finalized');
      expect(contestStates).toContain('cancelled');
    });

    it('should allow transition from draft to open', () => {
      const fromState = 'draft';
      const toState = 'open';

      expect(validTransitions[fromState]).toContain(toState);
    });

    it('should allow transition from open to locked', () => {
      const fromState = 'open';
      const toState = 'locked';

      expect(validTransitions[fromState]).toContain(toState);
    });

    it('should block transition from finalized to any other state', () => {
      const fromState = 'finalized';

      expect(validTransitions[fromState]).toHaveLength(0);
    });

    it('should block transition from cancelled to any other state', () => {
      const fromState = 'cancelled';

      expect(validTransitions[fromState]).toHaveLength(0);
    });

    it('should block invalid state transitions', () => {
      const invalidTransition = { from: 'draft', to: 'finalized' };

      expect(validTransitions[invalidTransition.from]).not.toContain(invalidTransition.to);
    });
  });

  describe('Contest Data Shape Validation', () => {
    it('should have all required fields in contest payload', () => {
      const requiredFields = [
        'contest_id',
        'contest_type',
        'league_name',
        'entry_fee_cents',
        'max_entries',
        'current_entries',
        'state',
        'join_link'
      ];

      requiredFields.forEach(field => {
        expect(contests.free).toHaveProperty(field);
      });
    });

    it('should have contest_id as UUID format', () => {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      expect(contests.free.contest_id).toMatch(uuidRegex);
      expect(contests.paid.contest_id).toMatch(uuidRegex);
      expect(contests.private.contest_id).toMatch(uuidRegex);
    });

    it('should have contest_type as valid enum value', () => {
      const validTypes = ['playoff_challenge', 'march_madness'];

      expect(validTypes).toContain(contests.free.contest_type);
      expect(validTypes).toContain(contests.marchMadness.contest_type);
    });

    it('should have league_name as non-empty string', () => {
      expect(typeof contests.free.league_name).toBe('string');
      expect(contests.free.league_name.length).toBeGreaterThan(0);
    });

    it('should have entry_fee_cents as integer', () => {
      expect(Number.isInteger(contests.free.entry_fee_cents)).toBe(true);
      expect(Number.isInteger(contests.paid.entry_fee_cents)).toBe(true);
    });

    it('should have max_entries as positive integer', () => {
      expect(Number.isInteger(contests.free.max_entries)).toBe(true);
      expect(contests.free.max_entries).toBeGreaterThan(0);
    });

    it('should have current_entries as non-negative integer', () => {
      expect(Number.isInteger(contests.free.current_entries)).toBe(true);
      expect(contests.free.current_entries).toBeGreaterThanOrEqual(0);
    });

    it('should enforce max_entries >= current_entries constraint', () => {
      Object.values(contests).forEach(contest => {
        expect(contest.max_entries).toBeGreaterThanOrEqual(contest.current_entries);
      });
    });

    it('should have state as valid enum value', () => {
      Object.values(contests).forEach(contest => {
        expect(contestStates).toContain(contest.state);
      });
    });

    it('should require join_link for private contests', () => {
      expect(contests.private.is_private).toBe(true);
      expect(contests.private.join_link).toBeTruthy();
      expect(typeof contests.private.join_link).toBe('string');
    });

    it('should allow null join_link for public contests', () => {
      expect(contests.free.is_private).toBe(false);
      expect(contests.free.join_link).toBeNull();
    });

    it('should fail validation when required field is missing', () => {
      const incompleteContest = {
        contest_id: 'test-id',
        league_name: 'Test'
        // Missing: contest_type, entry_fee_cents, max_entries, current_entries, state, join_link
      };

      const requiredFields = ['contest_type', 'entry_fee_cents', 'max_entries', 'current_entries', 'state'];
      const missingFields = requiredFields.filter(field => !(field in incompleteContest));

      expect(missingFields.length).toBeGreaterThan(0);
    });

    it('should fail validation when entry_fee_cents is not an integer', () => {
      const invalidFee = 25.99;

      expect(Number.isInteger(invalidFee)).toBe(false);
    });

    it('should fail validation when max_entries < current_entries', () => {
      const invalidContest = {
        max_entries: 10,
        current_entries: 15
      };

      const isValid = invalidContest.max_entries >= invalidContest.current_entries;
      expect(isValid).toBe(false);
    });
  });

  describe('Contest Query Patterns', () => {
    it('should support pagination for contest listing', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM contests.*LIMIT.*OFFSET/,
        mockQueryResponses.multiple([contests.free])
      );

      const result = await mockPool.query(
        'SELECT * FROM contests WHERE state = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
        ['open', 10, 0]
      );

      expect(result.rows).toBeDefined();
      expect(Array.isArray(result.rows)).toBe(true);
    });

    it('should support contest search by league_name', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM contests.*WHERE.*league_name.*ILIKE/,
        mockQueryResponses.multiple([contests.free])
      );

      const result = await mockPool.query(
        'SELECT * FROM contests WHERE league_name ILIKE $1',
        ['%Free%']
      );

      expect(result.rows.length).toBeGreaterThan(0);
    });

    it('should return contest with entry count aggregation', async () => {
      const contestWithCount = {
        ...contests.free,
        entry_count: 25,
        available_spots: 75
      };

      mockPool.setQueryResponse(
        /SELECT.*available_spots.*FROM contests/i,
        mockQueryResponses.single(contestWithCount)
      );

      const result = await mockPool.query(
        'SELECT c.*, (c.max_entries - c.current_entries) as available_spots FROM contests c WHERE c.contest_id = $1',
        [TEST_CONTEST_IDS.freeContest]
      );

      expect(result.rows[0].available_spots).toBeDefined();
    });
  });
});

/**
 * Custom Contest Creation v1 - Owner Semantics
 *
 * Tests for contest ownership, draft state, and visibility rules.
 * These tests validate the new owner-centric contest creation flow.
 */
const contestService = require('../../services/contestService');

describe('Custom Contest Creation v1 - Owner Semantics', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = createMockPool();
  });

  afterEach(() => {
    mockPool.reset();
  });

  describe('Owner Assignment', () => {
    it('should create a contest owned by the creating user', async () => {
      const ownerUserId = TEST_IDS.users.validUser;
      const contestInput = {
        contest_type: 'playoff_challenge',
        league_name: 'My Custom League',
        max_entries: 50,
        entry_fee_cents: 1000,
        is_private: false
      };

      const expectedContest = {
        contest_id: 'new-contest-uuid',
        created_by_user_id: ownerUserId,
        ...contestInput,
        state: 'draft',
        current_entries: 0,
        join_link: null
      };

      mockPool.setQueryResponse(
        /INSERT INTO contests/,
        mockQueryResponses.single(expectedContest)
      );

      const result = await contestService.createContest(mockPool, ownerUserId, contestInput);

      expect(result).toHaveProperty('created_by_user_id');
      expect(result.created_by_user_id).toBe(ownerUserId);
      expect(typeof result.created_by_user_id).toBe('string');
    });
  });

  describe('Draft State Initialization', () => {
    it('should initialize new contests in draft state', async () => {
      const ownerUserId = TEST_IDS.users.validUser;
      const contestInput = {
        contest_type: 'playoff_challenge',
        league_name: 'Draft State Test League',
        max_entries: 25,
        entry_fee_cents: 0,
        is_private: false
      };

      const expectedContest = {
        contest_id: 'draft-contest-uuid',
        created_by_user_id: ownerUserId,
        ...contestInput,
        state: 'draft',
        current_entries: 0,
        join_link: null
      };

      mockPool.setQueryResponse(
        /INSERT INTO contests/,
        mockQueryResponses.single(expectedContest)
      );

      const result = await contestService.createContest(mockPool, ownerUserId, contestInput);

      expect(result).toHaveProperty('state');
      expect(result.state).toBe('draft');
      expect(contestStates).toContain(result.state);
    });
  });

  describe('Draft Visibility', () => {
    it('should restrict contest visibility to owner while in draft', async () => {
      const ownerUserId = TEST_IDS.users.validUser;
      const otherUserId = TEST_IDS.users.paidUser;
      const draftContest = {
        contest_id: 'draft-contest-uuid',
        created_by_user_id: ownerUserId,
        state: 'draft',
        league_name: 'Owner Only League',
        is_private: false
      };

      mockPool.setQueryResponse(
        /SELECT.*FROM contests.*WHERE.*created_by_user_id/,
        mockQueryResponses.single(draftContest)
      );

      // Owner should see their draft contest
      const ownerResult = await contestService.getContestsForUser(mockPool, ownerUserId);
      expect(ownerResult.length).toBeGreaterThan(0);
      expect(ownerResult[0].contest_id).toBe(draftContest.contest_id);

      // Other user should NOT see someone else's draft contest
      mockPool.setQueryResponse(
        /SELECT.*FROM contests.*WHERE.*state.*!=.*draft/,
        mockQueryResponses.empty()
      );

      const otherResult = await contestService.getVisibleContests(mockPool, otherUserId);
      const draftContestsVisible = otherResult.filter(c => c.state === 'draft' && c.created_by_user_id !== otherUserId);
      expect(draftContestsVisible.length).toBe(0);
    });
  });

  describe('Join Link Generation', () => {
    const originalEnv = process.env.APP_ENV;

    afterEach(() => {
      // Restore original env
      if (originalEnv !== undefined) {
        process.env.APP_ENV = originalEnv;
      } else {
        delete process.env.APP_ENV;
      }
    });

    it('should generate join_link only for private contests', async () => {
      process.env.APP_ENV = 'test';
      const ownerUserId = TEST_IDS.users.validUser;
      const privateContestInput = {
        contest_type: 'playoff_challenge',
        league_name: 'Private League',
        max_entries: 10,
        entry_fee_cents: 500,
        is_private: true
      };

      // Mock will return whatever the service inserts
      mockPool.setQueryResponse(
        /INSERT INTO contests/,
        { rows: [{}], rowCount: 1 }
      );

      // Override mock to capture and return the actual join_link
      mockPool.query = jest.fn(async (sql, params) => {
        if (/INSERT INTO contests/.test(sql)) {
          const joinLink = params[8]; // join_link is 9th param (index 8)
          return {
            rows: [{
              contest_id: 'private-contest-uuid',
              created_by_user_id: ownerUserId,
              ...privateContestInput,
              state: 'draft',
              current_entries: 0,
              join_link: joinLink
            }],
            rowCount: 1
          };
        }
        return { rows: [], rowCount: 0 };
      });

      const result = await contestService.createContest(mockPool, ownerUserId, privateContestInput);

      expect(result.is_private).toBe(true);
      expect(result.join_link).toBeTruthy();
      expect(typeof result.join_link).toBe('string');
      expect(result.join_link.length).toBeGreaterThan(0);
    });

    it('should generate environment-prefixed join tokens', async () => {
      process.env.APP_ENV = 'stg';
      const ownerUserId = TEST_IDS.users.validUser;
      const privateContestInput = {
        contest_type: 'playoff_challenge',
        league_name: 'Staging Private League',
        max_entries: 10,
        entry_fee_cents: 500,
        is_private: true
      };

      // Capture the generated join_link
      let capturedJoinLink = null;
      mockPool.query = jest.fn(async (sql, params) => {
        if (/INSERT INTO contests/.test(sql)) {
          capturedJoinLink = params[8];
          return {
            rows: [{
              contest_id: 'stg-contest-uuid',
              created_by_user_id: ownerUserId,
              ...privateContestInput,
              state: 'draft',
              current_entries: 0,
              join_link: capturedJoinLink
            }],
            rowCount: 1
          };
        }
        return { rows: [], rowCount: 0 };
      });

      const result = await contestService.createContest(mockPool, ownerUserId, privateContestInput);

      // Extract token from URL
      const token = result.join_link.split('/join/')[1];

      // Token must have format: {env}_{hex}
      expect(token).toMatch(/^stg_[a-f0-9]+$/);
    });

    it('should use prd prefix in production environment', async () => {
      process.env.APP_ENV = 'prd';
      const ownerUserId = TEST_IDS.users.validUser;
      const privateContestInput = {
        contest_type: 'playoff_challenge',
        league_name: 'Production Private League',
        max_entries: 10,
        entry_fee_cents: 500,
        is_private: true
      };

      let capturedJoinLink = null;
      mockPool.query = jest.fn(async (sql, params) => {
        if (/INSERT INTO contests/.test(sql)) {
          capturedJoinLink = params[8];
          return {
            rows: [{
              contest_id: 'prd-contest-uuid',
              created_by_user_id: ownerUserId,
              ...privateContestInput,
              state: 'draft',
              current_entries: 0,
              join_link: capturedJoinLink
            }],
            rowCount: 1
          };
        }
        return { rows: [], rowCount: 0 };
      });

      const result = await contestService.createContest(mockPool, ownerUserId, privateContestInput);
      const token = result.join_link.split('/join/')[1];

      expect(token).toMatch(/^prd_[a-f0-9]+$/);
    });

    it('should reject join tokens from wrong environment', async () => {
      // Token generated in staging
      const stagingToken = 'stg_abc123def456';

      // Attempting to validate in production
      process.env.APP_ENV = 'prd';

      const validationResult = contestService.validateJoinToken(stagingToken);

      expect(validationResult.valid).toBe(false);
      expect(validationResult.error).toMatch(/environment mismatch/i);
    });

    it('should accept join tokens from matching environment', async () => {
      process.env.APP_ENV = 'stg';
      const stagingToken = 'stg_abc123def456';

      const validationResult = contestService.validateJoinToken(stagingToken);

      expect(validationResult.valid).toBe(true);
      expect(validationResult.tokenId).toBe('abc123def456');
    });

    it('should reject malformed tokens without valid env prefix', async () => {
      process.env.APP_ENV = 'prd';

      // No prefix
      expect(contestService.validateJoinToken('abc123def456').valid).toBe(false);

      // Unknown prefix
      expect(contestService.validateJoinToken('xyz_abc123def456').valid).toBe(false);

      // Empty token
      expect(contestService.validateJoinToken('').valid).toBe(false);
    });

    it('should not generate join_link for public contests', async () => {
      const ownerUserId = TEST_IDS.users.validUser;
      const publicContestInput = {
        contest_type: 'march_madness',
        league_name: 'Public League',
        max_entries: 100,
        entry_fee_cents: 2500,
        is_private: false
      };

      const expectedPublicContest = {
        contest_id: 'public-contest-uuid',
        created_by_user_id: ownerUserId,
        ...publicContestInput,
        state: 'draft',
        current_entries: 0,
        join_link: null
      };

      mockPool.setQueryResponse(
        /INSERT INTO contests/,
        mockQueryResponses.single(expectedPublicContest)
      );

      const result = await contestService.createContest(mockPool, ownerUserId, publicContestInput);

      expect(result.is_private).toBe(false);
      expect(result.join_link).toBeNull();
    });
  });

  describe('Input Validation', () => {
    it('should reject invalid contest_type values', async () => {
      const ownerUserId = TEST_IDS.users.validUser;
      const invalidContestInput = {
        contest_type: 'invalid_type',
        league_name: 'Invalid Type League',
        max_entries: 50,
        entry_fee_cents: 0,
        is_private: false
      };

      await expect(
        contestService.createContest(mockPool, ownerUserId, invalidContestInput)
      ).rejects.toThrow(/invalid.*contest_type/i);
    });

    it('should require league_name as non-empty string', async () => {
      const ownerUserId = TEST_IDS.users.validUser;

      // Test empty string
      const emptyNameInput = {
        contest_type: 'playoff_challenge',
        league_name: '',
        max_entries: 50,
        entry_fee_cents: 0,
        is_private: false
      };

      await expect(
        contestService.createContest(mockPool, ownerUserId, emptyNameInput)
      ).rejects.toThrow(/league_name.*required|league_name.*non-empty/i);

      // Test null
      const nullNameInput = {
        contest_type: 'playoff_challenge',
        league_name: null,
        max_entries: 50,
        entry_fee_cents: 0,
        is_private: false
      };

      await expect(
        contestService.createContest(mockPool, ownerUserId, nullNameInput)
      ).rejects.toThrow(/league_name.*required|league_name.*non-empty/i);
    });

    it('should require max_entries as positive integer', async () => {
      const ownerUserId = TEST_IDS.users.validUser;

      // Test zero
      const zeroEntriesInput = {
        contest_type: 'playoff_challenge',
        league_name: 'Zero Entries League',
        max_entries: 0,
        entry_fee_cents: 0,
        is_private: false
      };

      await expect(
        contestService.createContest(mockPool, ownerUserId, zeroEntriesInput)
      ).rejects.toThrow(/max_entries.*positive/i);

      // Test negative
      const negativeEntriesInput = {
        contest_type: 'playoff_challenge',
        league_name: 'Negative Entries League',
        max_entries: -5,
        entry_fee_cents: 0,
        is_private: false
      };

      await expect(
        contestService.createContest(mockPool, ownerUserId, negativeEntriesInput)
      ).rejects.toThrow(/max_entries.*positive/i);

      // Test non-integer
      const floatEntriesInput = {
        contest_type: 'playoff_challenge',
        league_name: 'Float Entries League',
        max_entries: 10.5,
        entry_fee_cents: 0,
        is_private: false
      };

      await expect(
        contestService.createContest(mockPool, ownerUserId, floatEntriesInput)
      ).rejects.toThrow(/max_entries.*integer/i);
    });

    it('should require entry_fee_cents as non-negative integer', async () => {
      const ownerUserId = TEST_IDS.users.validUser;

      // Test negative
      const negativeFeeInput = {
        contest_type: 'playoff_challenge',
        league_name: 'Negative Fee League',
        max_entries: 50,
        entry_fee_cents: -100,
        is_private: false
      };

      await expect(
        contestService.createContest(mockPool, ownerUserId, negativeFeeInput)
      ).rejects.toThrow(/entry_fee_cents.*non-negative/i);

      // Test non-integer
      const floatFeeInput = {
        contest_type: 'playoff_challenge',
        league_name: 'Float Fee League',
        max_entries: 50,
        entry_fee_cents: 25.99,
        is_private: false
      };

      await expect(
        contestService.createContest(mockPool, ownerUserId, floatFeeInput)
      ).rejects.toThrow(/entry_fee_cents.*integer/i);
    });
  });
});
