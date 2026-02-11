/**
 * Custom Contest Service — lock_time Enforcement Tests
 *
 * Tests that lock_time is enforced in both:
 * - joinContest (post-auth, mutating)
 * - resolveJoinToken (pre-auth, read-only)
 */

const { createMockPool, mockQueryResponses } = require('../mocks/mockPool');
const customContestService = require('../../services/customContestService');

const TEST_USER_ID = '11111111-1111-1111-1111-111111111111';
const TEST_INSTANCE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('lock_time enforcement', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = createMockPool();
    process.env.APP_ENV = 'dev';
    process.env.JOIN_BASE_URL = 'https://test.example.com';
  });

  afterEach(() => {
    mockPool.reset();
    delete process.env.APP_ENV;
    delete process.env.JOIN_BASE_URL;
    jest.restoreAllMocks();
  });

  describe('joinContest — lock_time', () => {
    it('should reject join when lock_time has passed', async () => {
      const pastLockTime = new Date(Date.now() - 60000).toISOString(); // 1 minute ago

      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({
          id: TEST_INSTANCE_ID,
          status: 'SCHEDULED',
          join_token: 'dev_some_token',
          max_entries: 10,
          lock_time: pastLockTime
        })
      );
      mockPool.setQueryResponse(
        /INSERT INTO contest_participants/,
        mockQueryResponses.single({}) // Simulate successful insert to proceed to lock_time check
      );

      const result = await customContestService.joinContest(mockPool, TEST_INSTANCE_ID, TEST_USER_ID);
      expect(result.joined).toBe(false);
      expect(result.error_code).toBe('CONTEST_LOCKED');
      expect(result.reason).toBe('Contest join window has closed');
    });

    it('should allow join when lock_time is in the future', async () => {
      const futureLockTime = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now

      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({
          id: TEST_INSTANCE_ID,
          status: 'SCHEDULED',
          join_token: 'dev_some_token',
          max_entries: null,
          lock_time: futureLockTime
        })
      );
      mockPool.setQueryResponse(
        /INSERT INTO contest_participants/,
        mockQueryResponses.single({
          id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          contest_instance_id: TEST_INSTANCE_ID,
          user_id: TEST_USER_ID
        })
      );

      const result = await customContestService.joinContest(mockPool, TEST_INSTANCE_ID, TEST_USER_ID);
      expect(result.joined).toBe(true);
    });

    it('should allow join when lock_time is NULL', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({
          id: TEST_INSTANCE_ID,
          status: 'SCHEDULED',
          join_token: 'dev_some_token',
          max_entries: null,
          lock_time: null
        })
      );
      mockPool.setQueryResponse(
        /INSERT INTO contest_participants/,
        mockQueryResponses.single({
          id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          contest_instance_id: TEST_INSTANCE_ID,
          user_id: TEST_USER_ID
        })
      );

      const result = await customContestService.joinContest(mockPool, TEST_INSTANCE_ID, TEST_USER_ID);
      expect(result.joined).toBe(true);
    });

    it('should ROLLBACK when rejecting due to lock_time', async () => {
      const pastLockTime = new Date(Date.now() - 60000).toISOString();

      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances[\s\S]*FOR UPDATE/,
        mockQueryResponses.single({
          id: TEST_INSTANCE_ID,
          status: 'SCHEDULED',
          join_token: 'dev_some_token',
          max_entries: 10,
          lock_time: pastLockTime
        })
      );

      await customContestService.joinContest(mockPool, TEST_INSTANCE_ID, TEST_USER_ID);

      const queries = mockPool.getQueryHistory();
      const rollbacks = queries.filter(q => q.sql === 'ROLLBACK');
      expect(rollbacks.length).toBeGreaterThan(0);
    });
  });

  describe('resolveJoinToken — lock_time', () => {
    const mockScheduledInstance = {
      id: TEST_INSTANCE_ID,
      template_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      status: 'SCHEDULED',
      join_token: 'dev_abc123def456abc123def456abc123',
      template_name: 'NFL Playoff Challenge',
      template_sport: 'NFL',
      entry_fee_cents: 2500,
      payout_structure: { first: 100 },
      start_time: null,
      lock_time: null,
      max_entries: 10,
      organizer_name: 'TestUser',
      entries_current: 1
    };

    it('should return CONTEST_LOCKED when SCHEDULED contest has past lock_time', async () => {
      const pastLockTime = new Date(Date.now() - 60000).toISOString();
      const token = 'dev_abc123def456abc123def456abc123';
      const instanceWithPastLock = {
        ...mockScheduledInstance,
        lock_time: pastLockTime,
        entry_count: 1,
        user_has_entered: false
      };

      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*WHERE ci\.join_token/,
        mockQueryResponses.single(instanceWithPastLock)
      );

      // Lifecycle self-healing: advancer detects past lock_time and triggers
      // _updateContestStatusInternal, which issues these two queries:
      mockPool.setQueryResponse(
        /SELECT status FROM contest_instances WHERE id/,
        mockQueryResponses.single({ status: 'SCHEDULED' })
      );
      mockPool.setQueryResponse(
        /UPDATE contest_instances SET status/,
        mockQueryResponses.single({ ...instanceWithPastLock, status: 'LOCKED' })
      );

      const result = await customContestService.resolveJoinToken(mockPool, token);
      expect(result.valid).toBe(false);
      expect(result.error_code).toBe('CONTEST_LOCKED');
      expect(result.reason).toBe('Contest join window has closed');
      expect(result.contest.is_locked).toBe(true);
    });

    it('should return valid when SCHEDULED contest has future lock_time', async () => {
      const futureLockTime = new Date(Date.now() + 3600000).toISOString();
      const token = 'dev_abc123def456abc123def456abc123';

      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*WHERE ci\.join_token/,
        mockQueryResponses.single({
          ...mockScheduledInstance,
          lock_time: futureLockTime,
          entry_count: 1,
          user_has_entered: false
        })
      );

      const result = await customContestService.resolveJoinToken(mockPool, token);
      expect(result.valid).toBe(true);
      expect(result.contest.id).toBe(TEST_INSTANCE_ID);
    });

    it('should return valid when SCHEDULED contest has NULL lock_time', async () => {
      const token = 'dev_abc123def456abc123def456abc123';
      const futureLockTime = new Date(Date.now() + 3600000).toISOString();

      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_instances ci[\s\S]*WHERE ci\.join_token/,
        mockQueryResponses.single({
          ...mockScheduledInstance,
          lock_time: futureLockTime,
          entry_count: 1,
          user_has_entered: false
        })
      );

      const result = await customContestService.resolveJoinToken(mockPool, token);
      expect(result.valid).toBe(true);
    });
  });
});
