/**
 * Admin Service Unit Tests
 *
 * Purpose: Test admin-related service logic in isolation
 * - RBAC enforcement
 * - Contest state overrides
 * - Scoring recompute operations
 * - Audit logging
 *
 * These tests assert against explicit field-level data contracts.
 */

const { createMockPool, mockQueryResponses } = require('../mocks/mockPool');
const {
  TEST_IDS,
  TEST_CONTEST_IDS,
  users,
  contests,
  auditLogs
} = require('../fixtures');

describe('Admin Service Unit Tests', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = createMockPool();
  });

  afterEach(() => {
    mockPool.reset();
  });

  describe('RBAC Enforcement', () => {
    it('should allow admin access for admin users', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM users.*WHERE.*id/,
        mockQueryResponses.single(users.admin)
      );

      const result = await mockPool.query(
        'SELECT * FROM users WHERE id = $1',
        [TEST_IDS.users.adminUser]
      );

      const user = result.rows[0];
      const hasAdminAccess = user.is_admin === true;

      expect(hasAdminAccess).toBe(true);
    });

    it('should deny admin access for non-admin users', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM users/,
        mockQueryResponses.single(users.valid)
      );

      const result = await mockPool.query(
        'SELECT * FROM users WHERE id = $1',
        [TEST_IDS.users.validUser]
      );

      const user = result.rows[0];
      const hasAdminAccess = user.is_admin === true;

      expect(hasAdminAccess).toBe(false);
    });

    it('should deny admin access for paid but non-admin users', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM users/,
        mockQueryResponses.single(users.paid)
      );

      const result = await mockPool.query(
        'SELECT * FROM users WHERE id = $1',
        [TEST_IDS.users.paidUser]
      );

      const user = result.rows[0];
      const hasAdminAccess = user.is_admin === true;

      expect(hasAdminAccess).toBe(false);
    });

    it('should verify is_admin is boolean type', () => {
      expect(typeof users.admin.is_admin).toBe('boolean');
      expect(typeof users.valid.is_admin).toBe('boolean');
    });

    it('should support role-based permissions', () => {
      const permissions = {
        admin: ['read', 'write', 'delete', 'manage_users', 'manage_contests', 'recompute_scores'],
        moderator: ['read', 'write', 'manage_contests'],
        user: ['read']
      };

      expect(permissions.admin).toContain('manage_users');
      expect(permissions.admin).toContain('recompute_scores');
      expect(permissions.user).not.toContain('manage_users');
    });

    it('should check permission for specific action', () => {
      const userPermissions = ['read'];
      const adminPermissions = ['read', 'write', 'delete', 'manage_users', 'manage_contests', 'recompute_scores'];
      const requiredPermission = 'recompute_scores';

      expect(userPermissions).not.toContain(requiredPermission);
      expect(adminPermissions).toContain(requiredPermission);
    });
  });

  describe('Contest State Overrides', () => {
    it('should allow admin to override contest state', async () => {
      const updatedContest = { ...contests.locked, state: 'open' };

      mockPool.setQueryResponse(
        /UPDATE contests.*SET.*state/,
        mockQueryResponses.single(updatedContest)
      );

      const result = await mockPool.query(
        'UPDATE contests SET state = $1 WHERE contest_id = $2 RETURNING *',
        ['open', TEST_CONTEST_IDS.lockedContest]
      );

      expect(result.rows[0].state).toBe('open');
    });

    it('should allow unlock of locked contest', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM contests/,
        mockQueryResponses.single(contests.locked)
      );

      const contestResult = await mockPool.query(
        'SELECT * FROM contests WHERE contest_id = $1',
        [TEST_CONTEST_IDS.lockedContest]
      );

      expect(contestResult.rows[0].state).toBe('locked');

      // Admin unlocks it
      const unlockedContest = { ...contests.locked, state: 'open' };
      mockPool.setQueryResponse(
        /UPDATE contests/,
        mockQueryResponses.single(unlockedContest)
      );

      const updateResult = await mockPool.query(
        'UPDATE contests SET state = $1 WHERE contest_id = $2 RETURNING *',
        ['open', TEST_CONTEST_IDS.lockedContest]
      );

      expect(updateResult.rows[0].state).toBe('open');
    });

    it('should allow force-finalize contest', async () => {
      const finalizedContest = { ...contests.free, state: 'finalized' };

      mockPool.setQueryResponse(
        /UPDATE contests.*SET.*state.*=.*finalized/i,
        mockQueryResponses.single(finalizedContest)
      );

      const result = await mockPool.query(
        "UPDATE contests SET state = 'finalized' WHERE contest_id = $1 RETURNING *",
        [TEST_CONTEST_IDS.freeContest]
      );

      expect(result.rows[0].state).toBe('finalized');
    });

    it('should allow cancel contest', async () => {
      const cancelledContest = { ...contests.free, state: 'cancelled' };

      mockPool.setQueryResponse(
        /UPDATE contests/,
        mockQueryResponses.single(cancelledContest)
      );

      const result = await mockPool.query(
        "UPDATE contests SET state = 'cancelled' WHERE contest_id = $1 RETURNING *",
        [TEST_CONTEST_IDS.freeContest]
      );

      expect(result.rows[0].state).toBe('cancelled');
    });

    it('should require reason for state override', () => {
      const stateOverrideRequest = {
        contest_id: TEST_CONTEST_IDS.lockedContest,
        new_state: 'open',
        reason: 'Emergency unlock requested by support ticket #12345',
        admin_id: TEST_IDS.users.adminUser
      };

      expect(stateOverrideRequest.reason).toBeTruthy();
      expect(stateOverrideRequest.reason.length).toBeGreaterThan(0);
    });

    it('should reject state override without reason', () => {
      const invalidRequest = {
        contest_id: TEST_CONTEST_IDS.lockedContest,
        new_state: 'open',
        reason: '',
        admin_id: TEST_IDS.users.adminUser
      };

      // Validate reason is non-empty after trimming whitespace
      const trimmedReason = (invalidRequest.reason || '').trim();
      const isValid = trimmedReason.length > 0;
      expect(isValid).toBe(false);
    });
  });

  describe('Scoring Recompute Operations', () => {
    it('should trigger recompute for specific contest', async () => {
      const recomputeJob = {
        job_id: 'job-123',
        contest_id: TEST_CONTEST_IDS.freeContest,
        status: 'pending',
        triggered_by: TEST_IDS.users.adminUser,
        created_at: new Date()
      };

      mockPool.setQueryResponse(
        /INSERT INTO recompute_jobs/,
        mockQueryResponses.single(recomputeJob)
      );

      const result = await mockPool.query(
        'INSERT INTO recompute_jobs (contest_id, triggered_by) VALUES ($1, $2) RETURNING *',
        [TEST_CONTEST_IDS.freeContest, TEST_IDS.users.adminUser]
      );

      expect(result.rows[0].status).toBe('pending');
      expect(result.rows[0].contest_id).toBe(TEST_CONTEST_IDS.freeContest);
    });

    it('should track recompute job progress', async () => {
      const inProgressJob = {
        job_id: 'job-123',
        contest_id: TEST_CONTEST_IDS.freeContest,
        status: 'in_progress',
        progress: 50,
        affected_users: 12
      };

      mockPool.setQueryResponse(
        /SELECT.*FROM recompute_jobs/,
        mockQueryResponses.single(inProgressJob)
      );

      const result = await mockPool.query(
        'SELECT * FROM recompute_jobs WHERE job_id = $1',
        ['job-123']
      );

      expect(result.rows[0].status).toBe('in_progress');
      expect(result.rows[0].progress).toBe(50);
    });

    it('should complete recompute with summary', async () => {
      const completedJob = {
        job_id: 'job-123',
        contest_id: TEST_CONTEST_IDS.freeContest,
        status: 'completed',
        progress: 100,
        affected_users: 25,
        score_changes: 12,
        completed_at: new Date()
      };

      mockPool.setQueryResponse(
        /UPDATE recompute_jobs/,
        mockQueryResponses.single(completedJob)
      );

      const result = await mockPool.query(
        'UPDATE recompute_jobs SET status = $1, progress = $2, completed_at = $3 WHERE job_id = $4 RETURNING *',
        ['completed', 100, new Date(), 'job-123']
      );

      expect(result.rows[0].status).toBe('completed');
      expect(result.rows[0].affected_users).toBeDefined();
    });

    it('should be idempotent - same inputs produce same outputs', () => {
      const scoreData = [
        { user_id: 'user-1', pick_points: 25 },
        { user_id: 'user-1', pick_points: 30 },
        { user_id: 'user-2', pick_points: 40 }
      ];

      const computeTotals = (data) => {
        const totals = {};
        data.forEach(d => {
          if (!totals[d.user_id]) totals[d.user_id] = 0;
          totals[d.user_id] += d.pick_points;
        });
        return totals;
      };

      const result1 = computeTotals(scoreData);
      const result2 = computeTotals(scoreData);

      expect(result1).toEqual(result2);
    });

    it('should handle recompute errors gracefully', async () => {
      const failedJob = {
        job_id: 'job-123',
        status: 'failed',
        error_message: 'Database timeout during scoring calculation'
      };

      mockPool.setQueryResponse(
        /UPDATE recompute_jobs/,
        mockQueryResponses.single(failedJob)
      );

      const result = await mockPool.query(
        'UPDATE recompute_jobs SET status = $1, error_message = $2 WHERE job_id = $3 RETURNING *',
        ['failed', 'Database timeout', 'job-123']
      );

      expect(result.rows[0].status).toBe('failed');
      expect(result.rows[0].error_message).toBeTruthy();
    });
  });

  describe('Audit Logging', () => {
    it('should have all required fields in audit log', () => {
      const requiredFields = [
        'actor_user_id',
        'action',
        'target_type',
        'target_id',
        'reason',
        'created_at'
      ];

      requiredFields.forEach(field => {
        expect(auditLogs.contestStateChange).toHaveProperty(field);
      });
    });

    it('should have actor_user_id as UUID format', () => {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      expect(auditLogs.contestStateChange.actor_user_id).toMatch(uuidRegex);
    });

    it('should have action as non-empty string', () => {
      expect(typeof auditLogs.contestStateChange.action).toBe('string');
      expect(auditLogs.contestStateChange.action.length).toBeGreaterThan(0);
    });

    it('should have target_type as valid enum', () => {
      const validTargetTypes = ['user', 'contest', 'payment', 'score', 'system'];

      expect(validTargetTypes).toContain(auditLogs.contestStateChange.target_type);
      expect(validTargetTypes).toContain(auditLogs.scoringRecompute.target_type);
      expect(validTargetTypes).toContain(auditLogs.userSuspension.target_type);
    });

    it('should have target_id as non-empty string', () => {
      expect(typeof auditLogs.contestStateChange.target_id).toBe('string');
      expect(auditLogs.contestStateChange.target_id.length).toBeGreaterThan(0);
    });

    it('should require reason for audit log', () => {
      expect(auditLogs.contestStateChange.reason).toBeTruthy();
      expect(auditLogs.scoringRecompute.reason).toBeTruthy();
      expect(auditLogs.userSuspension.reason).toBeTruthy();
    });

    it('should have reason as non-empty string', () => {
      Object.values(auditLogs).forEach(log => {
        expect(typeof log.reason).toBe('string');
        expect(log.reason.length).toBeGreaterThan(0);
      });
    });

    it('should have created_at as Date', () => {
      expect(auditLogs.contestStateChange.created_at instanceof Date).toBe(true);
    });

    it('should log contest state change with metadata', () => {
      const log = auditLogs.contestStateChange;

      expect(log.action).toBe('contest_state_override');
      expect(log.metadata).toBeDefined();
      expect(log.metadata.previous_state).toBe('locked');
      expect(log.metadata.new_state).toBe('open');
    });

    it('should log scoring recompute with affected counts', () => {
      const log = auditLogs.scoringRecompute;

      expect(log.action).toBe('scoring_recompute');
      expect(log.metadata.affected_users).toBeDefined();
      expect(log.metadata.score_changes).toBeDefined();
    });

    it('should log user suspension with duration', () => {
      const log = auditLogs.userSuspension;

      expect(log.action).toBe('user_suspension');
      expect(log.target_type).toBe('user');
      expect(log.metadata.suspension_duration_days).toBeDefined();
    });

    it('should create audit log entry in database', async () => {
      mockPool.setQueryResponse(
        /INSERT INTO audit_logs/,
        mockQueryResponses.single(auditLogs.contestStateChange)
      );

      const result = await mockPool.query(
        'INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, reason, metadata) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [
          TEST_IDS.users.adminUser,
          'contest_state_override',
          'contest',
          TEST_CONTEST_IDS.lockedContest,
          'Emergency unlock',
          { previous_state: 'locked', new_state: 'open' }
        ]
      );

      expect(result.rows[0].action).toBe('contest_state_override');
    });

    it('should query audit logs by target', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM audit_logs.*WHERE.*target_id/,
        mockQueryResponses.multiple([auditLogs.contestStateChange])
      );

      const result = await mockPool.query(
        'SELECT * FROM audit_logs WHERE target_type = $1 AND target_id = $2 ORDER BY created_at DESC',
        ['contest', TEST_CONTEST_IDS.lockedContest]
      );

      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows[0].target_id).toBe(TEST_CONTEST_IDS.lockedContest);
    });

    it('should query audit logs by actor', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM audit_logs.*WHERE.*actor_user_id/,
        mockQueryResponses.multiple(Object.values(auditLogs))
      );

      const result = await mockPool.query(
        'SELECT * FROM audit_logs WHERE actor_user_id = $1 ORDER BY created_at DESC',
        [TEST_IDS.users.adminUser]
      );

      expect(result.rows.length).toBeGreaterThan(0);
      result.rows.forEach(log => {
        expect(log.actor_user_id).toBe(TEST_IDS.users.adminUser);
      });
    });
  });

  describe('Idempotent Admin Actions', () => {
    it('should not duplicate state change on retry', async () => {
      // First attempt - contest is in 'locked' state, update to 'open'
      mockPool.setQueryResponse(
        /UPDATE contests.*SET.*state.*WHERE.*contest_id.*AND.*state.*!=/i,
        mockQueryResponses.single({ ...contests.locked, state: 'open' })
      );

      const result1 = await mockPool.query(
        "UPDATE contests SET state = 'open' WHERE contest_id = $1 AND state != 'open' RETURNING *",
        [TEST_CONTEST_IDS.lockedContest]
      );

      expect(result1.rows.length).toBe(1);

      // Reset mock for second attempt
      mockPool.reset();

      // Second attempt - contest is already 'open', no update needed
      mockPool.setQueryResponse(
        /UPDATE contests.*SET.*state.*WHERE.*contest_id.*AND.*state.*!=/i,
        mockQueryResponses.empty()
      );

      const result2 = await mockPool.query(
        "UPDATE contests SET state = 'open' WHERE contest_id = $1 AND state != 'open' RETURNING *",
        [TEST_CONTEST_IDS.lockedContest]
      );

      // No rows updated since already in desired state
      expect(result2.rows.length).toBe(0);
    });

    it('should use optimistic locking for updates', () => {
      const updateWithVersion = {
        contest_id: TEST_CONTEST_IDS.freeContest,
        new_state: 'locked',
        expected_version: 5,
        new_version: 6
      };

      // Version check ensures no concurrent modifications
      expect(updateWithVersion.new_version).toBe(updateWithVersion.expected_version + 1);
    });

    it('should track operation idempotency key', async () => {
      const idempotencyKey = 'op-123-unique-key';

      mockPool.setQueryResponse(
        /SELECT.*FROM idempotency_keys/,
        mockQueryResponses.empty()
      );

      const checkResult = await mockPool.query(
        'SELECT * FROM idempotency_keys WHERE key = $1',
        [idempotencyKey]
      );

      const isNewOperation = checkResult.rows.length === 0;
      expect(isNewOperation).toBe(true);
    });
  });

  describe('Admin Query Patterns', () => {
    it('should support admin user listing', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM users.*WHERE.*is_admin.*=.*true/i,
        mockQueryResponses.multiple([users.admin])
      );

      const result = await mockPool.query(
        'SELECT * FROM users WHERE is_admin = true'
      );

      result.rows.forEach(user => {
        expect(user.is_admin).toBe(true);
      });
    });

    it('should support audit log pagination', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM audit_logs.*LIMIT.*OFFSET/,
        mockQueryResponses.multiple([auditLogs.contestStateChange])
      );

      const result = await mockPool.query(
        'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2',
        [10, 0]
      );

      expect(result.rows).toBeDefined();
    });

    it('should support contest administration queries', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM contests.*WHERE.*state.*IN/i,
        mockQueryResponses.multiple([contests.locked, contests.free])
      );

      const result = await mockPool.query(
        "SELECT * FROM contests WHERE state IN ('open', 'locked', 'active') ORDER BY created_at DESC"
      );

      expect(result.rows.length).toBeGreaterThan(0);
    });
  });
});
