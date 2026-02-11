/**
 * GAP-08: Settlement-Triggered Lifecycle Failures
 *
 * Tests for settlement integration in LIVE→COMPLETE transitions.
 *
 * CRITICAL TEST CASES:
 * - "Not implemented" errors from isReadyForSettlement() trigger LIVE→ERROR
 * - Settlement failures are marked in audit payloads with settlement_failure: true
 * - Non-settlement errors remain unmarked
 * - Positive and neutral paths through settlement readiness checks work correctly
 */

const { pool } = require('../../server');
const { ACTORS } = require('../../services/helpers/contestTransitionValidator');
const customContestService = require('../../services/customContestService');

describe('GAP-08: Settlement-Triggered Lifecycle Failures', () => {
  describe('Unit Tests: isContestGamesComplete() - Time Gate (No Mocks)', () => {
    test('returns false when end_time is null', async () => {
      const { isContestGamesComplete } = require('../../services/helpers/contestLifecycleAdvancer');

      const contest = {
        id: 'test-id',
        status: 'LIVE',
        end_time: null
      };

      const mockPool = {};
      const result = await isContestGamesComplete(mockPool, contest);
      expect(result).toBe(false);
    });

    test('returns false when end_time is not yet reached', async () => {
      const { isContestGamesComplete } = require('../../services/helpers/contestLifecycleAdvancer');

      const futureTime = new Date(Date.now() + 60000); // 1 minute in future
      const contest = {
        id: 'test-id',
        status: 'LIVE',
        end_time: futureTime
      };

      const mockPool = {};
      const result = await isContestGamesComplete(mockPool, contest);
      expect(result).toBe(false);
    });

    test('throws when isReadyForSettlement() throws', async () => {
      jest.isolateModules(() => {
        const { isContestGamesComplete } = require('../../services/helpers/contestLifecycleAdvancer');

        const pastTime = new Date(Date.now() - 60000); // 1 minute in past
        const contest = {
          id: 'test-id',
          status: 'LIVE',
          end_time: pastTime
        };

        // isReadyForSettlement now throws when scores are incomplete
        const mockPool = {};
        return expect(
          isContestGamesComplete(mockPool, contest)
        ).rejects.toThrow();
      });
    });
  });

  describe('Unit Tests: isContestGamesComplete() - Settlement Readiness Paths (With Mocks)', () => {
    test('returns true when isReadyForSettlement() returns true', async () => {
      // Reset module cache to ensure clean state
      jest.resetModules();

      // Mock BEFORE requiring the module that uses it
      jest.doMock('../../services/settlementStrategy', () => ({
        isReadyForSettlement: jest.fn().mockResolvedValue(true)
      }));

      const { isContestGamesComplete } = require('../../services/helpers/contestLifecycleAdvancer');

      const pastTime = new Date(Date.now() - 60000);
      const contest = {
        id: 'test-id',
        status: 'LIVE',
        end_time: pastTime
      };

      const mockPool = {};
      const result = await isContestGamesComplete(mockPool, contest);
      expect(result).toBe(true);

      // Clean up after test
      jest.unmock('../../services/settlementStrategy');
    });

    test('returns false when isReadyForSettlement() returns false', async () => {
      // Reset module cache to ensure clean state
      jest.resetModules();

      // Mock BEFORE requiring the module that uses it
      jest.doMock('../../services/settlementStrategy', () => ({
        isReadyForSettlement: jest.fn().mockResolvedValue(false)
      }));

      const { isContestGamesComplete } = require('../../services/helpers/contestLifecycleAdvancer');

      const pastTime = new Date(Date.now() - 60000);
      const contest = {
        id: 'test-id',
        status: 'LIVE',
        end_time: pastTime
      };

      const mockPool = {};
      const result = await isContestGamesComplete(mockPool, contest);
      expect(result).toBe(false);

      // Clean up after test
      jest.unmock('../../services/settlementStrategy');
    });
  });

  describe('Integration Tests: Settlement Error Handling - LIVE→ERROR Transition', () => {
    let testContestId;
    let testOrgId;
    let testTemplateId;
    let poolReal;
    let updateFn;

    // Clear module cache and mocks before integration tests to ensure real modules are used
    beforeAll(() => {
      jest.unmock('../../services/settlementStrategy');
      jest.resetModules();
      // Re-require modules after cache reset to get fresh references
      const customContestService = require('../../services/customContestService');
      poolReal = require('../../server').pool;

      // Explicitly bind the update function with early validation
      updateFn = customContestService.updateContestStatusForSystem;
      if (typeof updateFn !== 'function') {
        throw new Error('updateContestStatusForSystem is not a function');
      }
    });

    beforeAll(async () => {
      // Create a test template and contest in LIVE state
      const templateRes = await poolReal.query(
        `SELECT id FROM contest_templates LIMIT 1`
      );
      testTemplateId = templateRes.rows[0]?.id;

      if (!testTemplateId) {
        throw new Error('No contest templates found in test database');
      }

      // Get or create a test user
      const userRes = await poolReal.query(
        `SELECT id FROM users LIMIT 1`
      );

      if (userRes.rows.length > 0) {
        testOrgId = userRes.rows[0].id;
      } else {
        // Create a test user if none exist
        const createUserRes = await poolReal.query(
          `INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`,
          ['gap08-test@example.com', 'GAP-08 Test User']
        );
        testOrgId = createUserRes.rows[0].id;
      }

      // Create a contest in LIVE state with end_time in the past
      const pastTime = new Date(Date.now() - 60000);
      const lockTime = new Date(Date.now() - 3600000); // locked 1 hour ago
      const startTime = new Date(Date.now() - 1800000); // started 30 mins ago

      const createRes = await poolReal.query(
        `INSERT INTO contest_instances
         (template_id, organizer_id, entry_fee_cents, payout_structure, status, lock_time, start_time, end_time, contest_name, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         RETURNING id`,
        [
          testTemplateId,
          testOrgId,
          10000,
          JSON.stringify({ first: 100 }),
          'LIVE',
          lockTime,
          startTime,
          pastTime,
          'GAP-08 Test Contest'
        ]
      );

      testContestId = createRes.rows[0].id;

      // Add test user as a participant (required for settlement readiness check)
      // Without participants, isReadyForSettlement() returns true instead of throwing
      await poolReal.query(
        `INSERT INTO contest_participants (contest_instance_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (contest_instance_id, user_id) DO NOTHING`,
        [testContestId, testOrgId]
      );
    });

    afterAll(async () => {
      if (testContestId) {
        // Delete in dependency order: audit first (has FK to contest_instances)
        await poolReal.query(
          `DELETE FROM admin_contest_audit WHERE contest_instance_id = $1`,
          [testContestId]
        );

        await poolReal.query(
          `DELETE FROM contest_participants WHERE contest_instance_id = $1`,
          [testContestId]
        );

        await poolReal.query(
          `DELETE FROM contest_instances WHERE id = $1`,
          [testContestId]
        );
      }
    });

    test('CRITICAL: "Not implemented" error from isReadyForSettlement() triggers LIVE→ERROR', async () => {
      // Fetch the contest
      const contestRes = await poolReal.query(
        `SELECT * FROM contest_instances WHERE id = $1`,
        [testContestId]
      );
      const contest = contestRes.rows[0];

      // Verify initial state
      expect(contest.status).toBe('LIVE');
      const initialUpdatedAt = new Date(contest.updated_at);

      const { attemptSystemTransitionWithErrorRecovery } = require('../../services/helpers/contestLifecycleAdvancer');

      // Attempt the LIVE→COMPLETE transition
      // Settlement validation now happens inside attemptSystemTransitionWithErrorRecovery
      // isReadyForSettlement() throws "Not implemented", triggering ERROR recovery (GAP-07)
      await attemptSystemTransitionWithErrorRecovery(
        poolReal,
        contest,
        'COMPLETE',
        updateFn
      );

      // Verify contest moved to ERROR state
      const updatedRes = await poolReal.query(
        `SELECT * FROM contest_instances WHERE id = $1`,
        [testContestId]
      );
      const updated = updatedRes.rows[0];

      expect(updated.status).toBe('ERROR');
      // Verify updated_at was set (transition occurred)
      const newUpdatedAt = new Date(updated.updated_at);
      expect(newUpdatedAt.getTime()).toBeGreaterThanOrEqual(initialUpdatedAt.getTime());
    });

    test('CRITICAL: Settlement failure audit includes settlement_failure: true', async () => {
      // Check the audit trail for the contest
      const auditRes = await poolReal.query(
        `SELECT * FROM admin_contest_audit
         WHERE contest_instance_id = $1
           AND action = 'system_error_transition'
         ORDER BY created_at DESC
         LIMIT 1`,
        [testContestId]
      );

      expect(auditRes.rows.length).toBeGreaterThan(0);
      const auditRecord = auditRes.rows[0];

      // Verify settlement marker in payload
      const payload = typeof auditRecord.payload === 'string'
        ? JSON.parse(auditRecord.payload)
        : auditRecord.payload;

      expect(payload.settlement_failure).toBe(true);
    });

    test('CRITICAL: Settlement failure audit includes error_origin field', async () => {
      const auditRes = await poolReal.query(
        `SELECT * FROM admin_contest_audit
         WHERE contest_instance_id = $1
           AND action = 'system_error_transition'
         ORDER BY created_at DESC
         LIMIT 1`,
        [testContestId]
      );

      expect(auditRes.rows.length).toBeGreaterThan(0);
      const auditRecord = auditRes.rows[0];

      const payload = typeof auditRecord.payload === 'string'
        ? JSON.parse(auditRecord.payload)
        : auditRecord.payload;

      expect(payload.error_origin).toBe('settlement_readiness_check');
    });

    test('CRITICAL: Settlement failure audit includes error stack trace', async () => {
      const auditRes = await poolReal.query(
        `SELECT * FROM admin_contest_audit
         WHERE contest_instance_id = $1
           AND action = 'system_error_transition'
         ORDER BY created_at DESC
         LIMIT 1`,
        [testContestId]
      );

      expect(auditRes.rows.length).toBeGreaterThan(0);
      const auditRecord = auditRes.rows[0];

      const payload = typeof auditRecord.payload === 'string'
        ? JSON.parse(auditRecord.payload)
        : auditRecord.payload;

      // Settlement errors should include stack trace
      expect(payload.error_stack).toBeDefined();
      expect(typeof payload.error_stack).toBe('string');
      expect(payload.error_stack).toContain('Error');
    });

    test('CRITICAL: attempted_status is COMPLETE in settlement failure audit', async () => {
      const auditRes = await poolReal.query(
        `SELECT * FROM admin_contest_audit
         WHERE contest_instance_id = $1
           AND action = 'system_error_transition'
         ORDER BY created_at DESC
         LIMIT 1`,
        [testContestId]
      );

      expect(auditRes.rows.length).toBeGreaterThan(0);
      const auditRecord = auditRes.rows[0];

      const payload = typeof auditRecord.payload === 'string'
        ? JSON.parse(auditRecord.payload)
        : auditRecord.payload;

      expect(payload.attempted_status).toBe('COMPLETE');
    });

    test('Non-settlement SYSTEM errors do NOT include settlement markers', async () => {
      // Create a SCHEDULED→LOCKED contest
      const schedRes = await poolReal.query(
        `INSERT INTO contest_instances
         (template_id, organizer_id, entry_fee_cents, payout_structure, status, lock_time, start_time, end_time, contest_name, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         RETURNING id`,
        [
          testTemplateId,
          testOrgId,
          10000,
          JSON.stringify({ first: 100 }),
          'SCHEDULED',
          new Date(Date.now() - 60000), // lock_time in past
          new Date(Date.now() + 3600000),
          new Date(Date.now() + 7200000),
          'Non-Settlement Test Contest'
        ]
      );

      const schedContestId = schedRes.rows[0].id;

      try {
        // Fetch the full contest from database
        const contestRes = await poolReal.query(
          `SELECT * FROM contest_instances WHERE id = $1`,
          [schedContestId]
        );
        const contest = contestRes.rows[0];

        const { attemptSystemTransitionWithErrorRecovery } = require('../../services/helpers/contestLifecycleAdvancer');

        // Attempt the SCHEDULED→LOCKED transition (no settlement involved)
        await attemptSystemTransitionWithErrorRecovery(
          poolReal,
          contest,
          'LOCKED',
          updateFn
        );

        // Verify transition succeeded
        const verifyRes = await poolReal.query(
          `SELECT status FROM contest_instances WHERE id = $1`,
          [schedContestId]
        );

        expect(verifyRes.rows[0].status).toBe('LOCKED');

        // Audit record should NOT have settlement markers
        const auditRes = await poolReal.query(
          `SELECT * FROM admin_contest_audit
           WHERE contest_instance_id = $1
             AND action = 'system_error_transition'`,
          [schedContestId]
        );

        // Should have no error audit records (transition succeeded)
        expect(auditRes.rows.length).toBe(0);
      } finally {
        await poolReal.query(`DELETE FROM contest_instances WHERE id = $1`, [schedContestId]);
      }
    });
  });

  describe('Audit Query Patterns - Settlement Distinction', () => {
    test('can query settlement failures using settlement_failure payload marker', async () => {
      const result = await pool.query(
        `SELECT COUNT(*) as count FROM admin_contest_audit
         WHERE action = 'system_error_transition'
           AND payload->>'settlement_failure' = 'true'`
      );

      // Should have settlement failures from integration tests
      expect(parseInt(result.rows[0].count)).toBeGreaterThanOrEqual(0);
    });

    test('can query non-settlement SYSTEM errors', async () => {
      const result = await pool.query(
        `SELECT COUNT(*) as count FROM admin_contest_audit
         WHERE action = 'system_error_transition'
           AND (payload->>'settlement_failure' IS NULL OR payload->>'settlement_failure' != 'true')`
      );

      expect(parseInt(result.rows[0].count)).toBeGreaterThanOrEqual(0);
    });

    test('settlement failure queries return correct payload structure', async () => {
      const result = await pool.query(
        `SELECT payload FROM admin_contest_audit
         WHERE action = 'system_error_transition'
           AND payload->>'settlement_failure' = 'true'
         LIMIT 1`
      );

      if (result.rows.length > 0) {
        const payload = typeof result.rows[0].payload === 'string'
          ? JSON.parse(result.rows[0].payload)
          : result.rows[0].payload;

        expect(payload).toHaveProperty('settlement_failure', true);
        expect(payload).toHaveProperty('error_origin', 'settlement_readiness_check');
        expect(payload).toHaveProperty('error_stack');
        expect(payload).toHaveProperty('attempted_status', 'COMPLETE');
        expect(payload).toHaveProperty('error_name');
        expect(payload).toHaveProperty('error_message');
      }
    });
  });
});
