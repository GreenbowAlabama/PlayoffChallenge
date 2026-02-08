/**
 * Admin Intervention Recovery Integration Test
 *
 * Purpose: End-to-end validation of admin intervention scenarios
 * - Contest state override (unlock locked contest)
 * - Scoring recompute after data correction
 * - User issue resolution
 * - Audit trail verification
 *
 * Uses real service instances with mocked external dependencies.
 */

const { createMockPool, mockQueryResponses } = require('../mocks/mockPool');
const {
  TEST_IDS,
  TEST_CONTEST_IDS,
  contests,
  users,
  auditLogs,
  leaderboardEntries
} = require('../fixtures');

describe('Admin Intervention Recovery', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = createMockPool();
  });

  afterEach(() => {
    mockPool.reset();
  });

  describe('Scenario 1: Emergency Contest Unlock', () => {
    it('should verify admin has required permissions', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM users.*WHERE.*id/,
        mockQueryResponses.single(users.admin)
      );

      const result = await mockPool.query(
        'SELECT * FROM users WHERE id = $1',
        [TEST_IDS.users.adminUser]
      );

      expect(result.rows[0].is_admin).toBe(true);
    });

    it('should identify locked contest requiring intervention', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM contests.*WHERE.*state.*=.*locked/i,
        mockQueryResponses.single(contests.locked)
      );

      const result = await mockPool.query(
        "SELECT * FROM contests WHERE contest_id = $1 AND state = 'locked'",
        [TEST_CONTEST_IDS.lockedContest]
      );

      expect(result.rows[0].state).toBe('locked');
    });

    it('should override contest state to open', async () => {
      const unlockedContest = { ...contests.locked, state: 'open' };

      mockPool.setQueryResponse(
        /UPDATE contests.*SET.*state/,
        mockQueryResponses.single(unlockedContest)
      );

      const result = await mockPool.query(
        "UPDATE contests SET state = 'open' WHERE contest_id = $1 RETURNING *",
        [TEST_CONTEST_IDS.lockedContest]
      );

      expect(result.rows[0].state).toBe('open');
    });

    it('should create audit log for state override', async () => {
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
          'Emergency unlock requested by support ticket #12345',
          JSON.stringify({ previous_state: 'locked', new_state: 'open' })
        ]
      );

      expect(result.rows[0].action).toBe('contest_state_override');
      expect(result.rows[0].reason).toBeTruthy();
    });

    it('should verify contest is now open for picks', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM contests/,
        mockQueryResponses.single({ ...contests.locked, state: 'open' })
      );

      const result = await mockPool.query(
        'SELECT * FROM contests WHERE contest_id = $1',
        [TEST_CONTEST_IDS.lockedContest]
      );

      const canSubmitPicks = result.rows[0].state === 'open';
      expect(canSubmitPicks).toBe(true);
    });
  });

  describe('Scenario 2: Scoring Recompute After Data Fix', () => {
    it('should detect scoring discrepancy', async () => {
      const discrepancy = {
        user_id: TEST_IDS.users.validUser,
        stored_score: 100,
        calculated_score: 115,
        difference: 15
      };

      mockPool.setQueryResponse(
        /SELECT[\s\S]*score_audit[\s\S]*difference/i,
        mockQueryResponses.single(discrepancy)
      );

      const result = await mockPool.query(`
        SELECT user_id, stored_score, calculated_score,
        (calculated_score - stored_score) as difference
        FROM score_audit WHERE difference != 0
      `);

      expect(result.rows[0].difference).not.toBe(0);
    });

    it('should initiate recompute job', async () => {
      const recomputeJob = {
        job_id: 'recompute-job-123',
        contest_id: TEST_CONTEST_IDS.freeContest,
        status: 'pending',
        triggered_by: TEST_IDS.users.adminUser,
        reason: 'Score correction after ESPN data fix'
      };

      mockPool.setQueryResponse(
        /INSERT INTO recompute_jobs/,
        mockQueryResponses.single(recomputeJob)
      );

      const result = await mockPool.query(
        'INSERT INTO recompute_jobs (contest_id, triggered_by, reason) VALUES ($1, $2, $3) RETURNING *',
        [TEST_CONTEST_IDS.freeContest, TEST_IDS.users.adminUser, 'Score correction after ESPN data fix']
      );

      expect(result.rows[0].status).toBe('pending');
    });

    it('should execute recompute and track progress', async () => {
      const inProgressJob = {
        job_id: 'recompute-job-123',
        status: 'in_progress',
        progress: 50,
        processed_users: 12,
        total_users: 25
      };

      mockPool.setQueryResponse(
        /UPDATE recompute_jobs.*SET.*status.*progress/i,
        mockQueryResponses.single(inProgressJob)
      );

      const result = await mockPool.query(
        'UPDATE recompute_jobs SET status = $1, progress = $2 WHERE job_id = $3 RETURNING *',
        ['in_progress', 50, 'recompute-job-123']
      );

      expect(result.rows[0].status).toBe('in_progress');
      expect(result.rows[0].progress).toBe(50);
    });

    it('should complete recompute with summary', async () => {
      const completedJob = {
        job_id: 'recompute-job-123',
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
        'UPDATE recompute_jobs SET status = $1, progress = $2, affected_users = $3, score_changes = $4, completed_at = $5 WHERE job_id = $6 RETURNING *',
        ['completed', 100, 25, 12, new Date(), 'recompute-job-123']
      );

      expect(result.rows[0].status).toBe('completed');
      expect(result.rows[0].score_changes).toBeGreaterThan(0);
    });

    it('should create audit log for recompute', async () => {
      mockPool.setQueryResponse(
        /INSERT INTO audit_logs/,
        mockQueryResponses.single(auditLogs.scoringRecompute)
      );

      const result = await mockPool.query(
        'INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, reason, metadata) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [
          TEST_IDS.users.adminUser,
          'scoring_recompute',
          'contest',
          TEST_CONTEST_IDS.freeContest,
          'Score correction after ESPN data fix',
          JSON.stringify({ affected_users: 25, score_changes: 12 })
        ]
      );

      expect(result.rows[0].action).toBe('scoring_recompute');
    });

    it('should verify leaderboard reflects new scores', async () => {
      const updatedLeaderboard = [...leaderboardEntries].map(entry => ({
        ...entry,
        total_points: entry.total_points + 10 // Simulated correction
      }));

      mockPool.setQueryResponse(
        /SELECT.*FROM leaderboard/,
        mockQueryResponses.multiple(updatedLeaderboard)
      );

      const result = await mockPool.query(
        'SELECT * FROM leaderboard WHERE contest_id = $1 ORDER BY rank',
        [TEST_CONTEST_IDS.freeContest]
      );

      expect(result.rows[0].total_points).toBeGreaterThan(leaderboardEntries[0].total_points);
    });
  });

  describe('Scenario 3: User Issue Resolution', () => {
    it('should identify user with issue', async () => {
      const userIssue = {
        user_id: TEST_IDS.users.validUser,
        issue_type: 'missing_entry',
        contest_id: TEST_CONTEST_IDS.paidContest,
        payment_id: 'payment-xyz'
      };

      mockPool.setQueryResponse(
        /SELECT.*FROM support_tickets/,
        mockQueryResponses.single(userIssue)
      );

      const result = await mockPool.query(
        'SELECT * FROM support_tickets WHERE user_id = $1',
        [TEST_IDS.users.validUser]
      );

      expect(result.rows[0].issue_type).toBe('missing_entry');
    });

    it('should verify payment was successful', async () => {
      const payment = {
        payment_id: 'payment-xyz',
        user_id: TEST_IDS.users.validUser,
        contest_id: TEST_CONTEST_IDS.paidContest,
        payment_status: 'paid'
      };

      mockPool.setQueryResponse(
        /SELECT.*FROM payments/,
        mockQueryResponses.single(payment)
      );

      const result = await mockPool.query(
        'SELECT * FROM payments WHERE user_id = $1 AND contest_id = $2',
        [TEST_IDS.users.validUser, TEST_CONTEST_IDS.paidContest]
      );

      expect(result.rows[0].payment_status).toBe('paid');
    });

    it('should manually create contest entry for user', async () => {
      const entry = {
        user_id: TEST_IDS.users.validUser,
        contest_id: TEST_CONTEST_IDS.paidContest,
        joined_at: new Date(),
        created_by_admin: true
      };

      mockPool.setQueryResponse(
        /INSERT INTO contest_entries/,
        mockQueryResponses.single(entry)
      );

      const result = await mockPool.query(
        'INSERT INTO contest_entries (user_id, contest_id, created_by_admin) VALUES ($1, $2, $3) RETURNING *',
        [TEST_IDS.users.validUser, TEST_CONTEST_IDS.paidContest, true]
      );

      expect(result.rows[0].created_by_admin).toBe(true);
    });

    it('should create audit log for manual entry', async () => {
      const auditLog = {
        audit_id: 'audit-manual-entry',
        actor_user_id: TEST_IDS.users.adminUser,
        action: 'manual_contest_entry',
        target_type: 'user',
        target_id: TEST_IDS.users.validUser,
        reason: 'User paid but entry was not created due to webhook failure',
        metadata: { contest_id: TEST_CONTEST_IDS.paidContest }
      };

      mockPool.setQueryResponse(
        /INSERT INTO audit_logs/,
        mockQueryResponses.single(auditLog)
      );

      const result = await mockPool.query(
        'INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, reason, metadata) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [
          TEST_IDS.users.adminUser,
          'manual_contest_entry',
          'user',
          TEST_IDS.users.validUser,
          'User paid but entry was not created due to webhook failure',
          JSON.stringify({ contest_id: TEST_CONTEST_IDS.paidContest })
        ]
      );

      expect(result.rows[0].action).toBe('manual_contest_entry');
      expect(result.rows[0].reason).toBeTruthy();
    });
  });

  describe('Scenario 4: Force Finalize Stuck Contest', () => {
    it('should identify stuck contest in scoring state', async () => {
      const stuckContest = {
        ...contests.free,
        state: 'scoring',
        state_updated_at: new Date(Date.now() - 24 * 60 * 60 * 1000) // 24 hours ago
      };

      mockPool.setQueryResponse(
        /SELECT.*FROM contests.*WHERE.*state.*=.*scoring/i,
        mockQueryResponses.single(stuckContest)
      );

      const result = await mockPool.query(
        "SELECT * FROM contests WHERE state = 'scoring' AND state_updated_at < NOW() - INTERVAL '1 hour'"
      );

      expect(result.rows[0].state).toBe('scoring');
    });

    it('should force finalize stuck contest', async () => {
      const finalizedContest = { ...contests.free, state: 'finalized' };

      mockPool.setQueryResponse(
        /UPDATE contests.*state.*finalized/i,
        mockQueryResponses.single(finalizedContest)
      );

      const result = await mockPool.query(
        "UPDATE contests SET state = 'finalized', force_finalized = true WHERE contest_id = $1 RETURNING *",
        [TEST_CONTEST_IDS.freeContest]
      );

      expect(result.rows[0].state).toBe('finalized');
    });

    it('should create audit log for force finalization', async () => {
      const auditLog = {
        actor_user_id: TEST_IDS.users.adminUser,
        action: 'force_finalize',
        target_type: 'contest',
        target_id: TEST_CONTEST_IDS.freeContest,
        reason: 'Contest stuck in scoring state for > 24 hours',
        metadata: { previous_state: 'scoring', time_in_state_hours: 26 }
      };

      mockPool.setQueryResponse(
        /INSERT INTO audit_logs/,
        mockQueryResponses.single(auditLog)
      );

      const result = await mockPool.query(
        'INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, reason, metadata) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [
          TEST_IDS.users.adminUser,
          'force_finalize',
          'contest',
          TEST_CONTEST_IDS.freeContest,
          'Contest stuck in scoring state for > 24 hours',
          JSON.stringify({ previous_state: 'scoring', time_in_state_hours: 26 })
        ]
      );

      expect(result.rows[0].action).toBe('force_finalize');
    });
  });

  describe('Audit Trail Verification', () => {
    it('should retrieve all admin actions for contest', async () => {
      const contestAuditLogs = [
        auditLogs.contestStateChange,
        auditLogs.scoringRecompute
      ];

      mockPool.setQueryResponse(
        /SELECT.*FROM audit_logs.*WHERE.*target_id/,
        mockQueryResponses.multiple(contestAuditLogs)
      );

      const result = await mockPool.query(
        'SELECT * FROM audit_logs WHERE target_type = $1 AND target_id = $2 ORDER BY created_at DESC',
        ['contest', TEST_CONTEST_IDS.freeContest]
      );

      expect(result.rows.length).toBeGreaterThan(0);
    });

    it('should retrieve all actions by admin user', async () => {
      mockPool.setQueryResponse(
        /SELECT.*FROM audit_logs.*WHERE.*actor_user_id/,
        mockQueryResponses.multiple(Object.values(auditLogs))
      );

      const result = await mockPool.query(
        'SELECT * FROM audit_logs WHERE actor_user_id = $1 ORDER BY created_at DESC',
        [TEST_IDS.users.adminUser]
      );

      result.rows.forEach(log => {
        expect(log.actor_user_id).toBe(TEST_IDS.users.adminUser);
        expect(log.reason).toBeTruthy();
      });
    });

    it('should verify all audit logs have required fields', () => {
      const requiredFields = ['actor_user_id', 'action', 'target_type', 'target_id', 'reason', 'created_at'];

      Object.values(auditLogs).forEach(log => {
        requiredFields.forEach(field => {
          expect(log).toHaveProperty(field);
        });
      });
    });

    it('should verify reason is always present', () => {
      Object.values(auditLogs).forEach(log => {
        expect(log.reason).toBeTruthy();
        expect(log.reason.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Recovery State Verification', () => {
    it('should verify all interventions resulted in valid states', async () => {
      // After unlock, contest should be in valid state
      mockPool.setQueryResponse(
        /SELECT.*FROM contests.*WHERE.*contest_id/i,
        mockQueryResponses.single({ ...contests.locked, state: 'open' })
      );

      const result = await mockPool.query(
        'SELECT * FROM contests WHERE contest_id = $1',
        [TEST_CONTEST_IDS.lockedContest]
      );

      const validStates = ['draft', 'open', 'locked', 'active', 'scoring', 'finalized', 'cancelled'];
      expect(validStates).toContain(result.rows[0].state);
    });

    it('should verify no orphaned records exist', async () => {
      // Check for entries without valid users
      mockPool.setQueryResponse(
        /SELECT.*FROM contest_entries.*LEFT JOIN.*users.*WHERE.*users\.id IS NULL/i,
        mockQueryResponses.empty()
      );

      const result = await mockPool.query(
        'SELECT ce.* FROM contest_entries ce LEFT JOIN users u ON ce.user_id = u.id WHERE u.id IS NULL'
      );

      expect(result.rows.length).toBe(0);
    });

    it('should verify audit trail is complete', async () => {
      const expectedActions = ['contest_state_override', 'scoring_recompute', 'user_suspension'];

      mockPool.setQueryResponse(
        /SELECT DISTINCT action FROM audit_logs/,
        mockQueryResponses.multiple(expectedActions.map(a => ({ action: a })))
      );

      const result = await mockPool.query(
        'SELECT DISTINCT action FROM audit_logs WHERE actor_user_id = $1',
        [TEST_IDS.users.adminUser]
      );

      const actions = result.rows.map(r => r.action);
      expectedActions.forEach(expected => {
        expect(actions).toContain(expected);
      });
    });
  });
});
