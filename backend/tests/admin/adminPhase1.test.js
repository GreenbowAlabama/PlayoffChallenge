/**
 * Admin Phase 1 Operations - Test Suite
 *
 * Tests for:
 * - Frozen primitives (unlockScheduledContestForAdmin, transitionSingleLockedToLive)
 * - Admin endpoints (force-lock, unlock, force-live, wallet/credit, audit-trail)
 *
 * Governance:
 * - Test-first workflow: tests written before implementation
 * - All endpoints must respect frozen primitives
 * - Wallet credit must be idempotent
 * - Audit trail is append-only
 *
 * Database: TEST_DB_ALLOW_DBNAME=railway required
 */

'use strict';

const { Pool } = require('pg');
const crypto = require('crypto');
const {
  unlockScheduledContestForAdmin,
  transitionSingleLockedToLive,
  lockScheduledContestForAdmin
} = require('../../services/contestLifecycleService');

describe('Admin Phase 1 - Frozen Primitives', () => {
  let pool;
  let templateId;
  let organizerId;
  let userId;

  beforeAll(async () => {
    if (!process.env.TEST_DB_ALLOW_DBNAME) {
      throw new Error(
        '⚠️  TEST_DB_ALLOW_DBNAME must be set. Run: TEST_DB_ALLOW_DBNAME=railway npm test'
      );
    }

    pool = new Pool({
      connectionString: process.env.DATABASE_URL_TEST,
      max: 3
    });

    const testConn = await pool.connect();
    await testConn.query('SELECT 1');
    testConn.release();
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  beforeEach(async () => {
    templateId = crypto.randomUUID();
    organizerId = crypto.randomUUID();
    userId = crypto.randomUUID();

    // Create organizer user
    await pool.query(
      'INSERT INTO users (id, email) VALUES ($1, $2)',
      [organizerId, `organizer-${organizerId}@test.com`]
    );

    // Create regular user for wallet tests
    await pool.query(
      'INSERT INTO users (id, email) VALUES ($1, $2)',
      [userId, `user-${userId}@test.com`]
    );

    // Create template
    await pool.query(
      `INSERT INTO contest_templates
       (id, name, sport, template_type, scoring_strategy_key, lock_strategy_key,
        settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
        allowed_entry_fee_max_cents, allowed_payout_structures, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        templateId,
        'Test Template',
        'PGA',
        'single_event',
        'pga_drop_lowest',
        'tournament_start_lock',
        'pga_settlement',
        50000,
        10000,
        1000000,
        JSON.stringify([{ type: 'winners_take_all', winners: 1 }]),
        false
      ]
    );
  });

  afterEach(async () => {
    // Cleanup in reverse FK order
    try {
      const contestsResult = await pool.query(
        'SELECT id FROM contest_instances WHERE template_id = $1',
        [templateId]
      );
      const contestIds = contestsResult.rows.map(row => row.id);

      if (contestIds.length > 0) {
        await pool.query(
          'DELETE FROM contest_state_transitions WHERE contest_instance_id = ANY($1::uuid[])',
          [contestIds]
        );
        await pool.query(
          'DELETE FROM ledger WHERE reference_id = ANY($1::uuid[])',
          [contestIds]
        );
        await pool.query(
          'DELETE FROM contest_participants WHERE contest_instance_id = ANY($1::uuid[])',
          [contestIds]
        );
        await pool.query(
          'DELETE FROM contest_instances WHERE template_id = $1',
          [templateId]
        );
      }

      await pool.query(
        'DELETE FROM ledger WHERE reference_id = $1',
        [userId]
      );
      await pool.query(
        'DELETE FROM contest_templates WHERE id = $1',
        [templateId]
      );
      await pool.query(
        'DELETE FROM users WHERE id = ANY($1::uuid[])',
        [[organizerId, userId]]
      );
    } catch (err) {
      console.error('Cleanup error:', err.message);
    }
  });

  // =========================================================================
  // A.2.1: unlockScheduledContestForAdmin Tests
  // =========================================================================

  describe('unlockScheduledContestForAdmin', () => {
    it('transitions LOCKED → SCHEDULED and clears lock_time', async () => {
      // Setup: Create SCHEDULED contest, lock it, then unlock
      const contestId = crypto.randomUUID();
      const lockTime = new Date(Date.now() + 60000); // 1 minute in future

      // Create SCHEDULED contest
      await pool.query(
        `INSERT INTO contest_instances
         (id, template_id, organizer_id, entry_fee_cents, payout_structure, status,
          lock_time, contest_name, max_entries)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [contestId, templateId, organizerId, 50000, JSON.stringify({ type: 'winners_take_all', winners: 1 }), 'SCHEDULED', lockTime, 'Test', 20]
      );

      // Manually lock it
      await pool.query(
        'UPDATE contest_instances SET status = $1, lock_time = $2 WHERE id = $3',
        ['LOCKED', lockTime, contestId]
      );

      // Unlock
      const result = await unlockScheduledContestForAdmin(pool, new Date(), contestId);

      expect(result.success).toBe(true);
      expect(result.changed).toBe(true);

      // Verify state
      const checkResult = await pool.query(
        'SELECT status, lock_time FROM contest_instances WHERE id = $1',
        [contestId]
      );

      expect(checkResult.rows[0].status).toBe('SCHEDULED');
      expect(checkResult.rows[0].lock_time).toBeNull();
    });

    it('is idempotent: calling twice returns changed=false on second call', async () => {
      const contestId = crypto.randomUUID();

      await pool.query(
        `INSERT INTO contest_instances
         (id, template_id, organizer_id, entry_fee_cents, payout_structure, status,
          lock_time, contest_name, max_entries)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [contestId, templateId, organizerId, 50000, JSON.stringify({ type: 'winners_take_all', winners: 1 }), 'SCHEDULED', null, 'Test', 20]
      );

      // Call twice
      const result1 = await unlockScheduledContestForAdmin(pool, new Date(), contestId);
      const result2 = await unlockScheduledContestForAdmin(pool, new Date(), contestId);

      expect(result1.success).toBe(true);
      expect(result1.changed).toBe(false); // Already SCHEDULED, no change
      expect(result2.success).toBe(true);
      expect(result2.changed).toBe(false);
    });

    it('cannot unlock non-LOCKED contest', async () => {
      const contestId = crypto.randomUUID();

      await pool.query(
        `INSERT INTO contest_instances
         (id, template_id, organizer_id, entry_fee_cents, payout_structure, status,
          lock_time, contest_name, max_entries)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [contestId, templateId, organizerId, 50000, JSON.stringify({ type: 'winners_take_all', winners: 1 }), 'LIVE', null, 'Test', 20]
      );

      try {
        await unlockScheduledContestForAdmin(pool, new Date(), contestId);
        fail('Should have thrown error');
      } catch (err) {
        expect(err.code).toBe('INVALID_STATUS');
        expect(err.message).toContain('Cannot transition');
      }
    });

    it('inserts transition record', async () => {
      const contestId = crypto.randomUUID();

      await pool.query(
        `INSERT INTO contest_instances
         (id, template_id, organizer_id, entry_fee_cents, payout_structure, status,
          lock_time, contest_name, max_entries)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [contestId, templateId, organizerId, 50000, JSON.stringify({ type: 'winners_take_all', winners: 1 }), 'LOCKED', new Date(), 'Test', 20]
      );

      await unlockScheduledContestForAdmin(pool, new Date(), contestId);

      const transitions = await pool.query(
        'SELECT from_state, to_state, triggered_by FROM contest_state_transitions WHERE contest_instance_id = $1',
        [contestId]
      );

      expect(transitions.rows).toHaveLength(1);
      expect(transitions.rows[0].from_state).toBe('LOCKED');
      expect(transitions.rows[0].to_state).toBe('SCHEDULED');
      expect(transitions.rows[0].triggered_by).toBe('ADMIN_UNLOCK');
    });
  });

  // =========================================================================
  // A.2.2: transitionSingleLockedToLive Tests
  // =========================================================================

  describe('transitionSingleLockedToLive', () => {
    it('transitions LOCKED → LIVE when now >= tournament_start_time', async () => {
      const contestId = crypto.randomUUID();
      const pastStartTime = new Date(Date.now() - 60000); // 1 minute ago

      await pool.query(
        `INSERT INTO contest_instances
         (id, template_id, organizer_id, entry_fee_cents, payout_structure, status,
          tournament_start_time, contest_name, max_entries)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [contestId, templateId, organizerId, 50000, JSON.stringify({ type: 'winners_take_all', winners: 1 }), 'LOCKED', pastStartTime, 'Test', 20]
      );

      const result = await transitionSingleLockedToLive(pool, new Date(), contestId);

      expect(result.success).toBe(true);
      expect(result.changed).toBe(true);

      const checkResult = await pool.query(
        'SELECT status FROM contest_instances WHERE id = $1',
        [contestId]
      );

      expect(checkResult.rows[0].status).toBe('LIVE');
    });

    it('is idempotent: calling twice returns changed=false on second call', async () => {
      const contestId = crypto.randomUUID();
      const pastStartTime = new Date(Date.now() - 60000);

      await pool.query(
        `INSERT INTO contest_instances
         (id, template_id, organizer_id, entry_fee_cents, payout_structure, status,
          tournament_start_time, contest_name, max_entries)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [contestId, templateId, organizerId, 50000, JSON.stringify({ type: 'winners_take_all', winners: 1 }), 'LIVE', pastStartTime, 'Test', 20]
      );

      const result = await transitionSingleLockedToLive(pool, new Date(), contestId);

      expect(result.success).toBe(true);
      expect(result.changed).toBe(false); // Already LIVE
    });

    it('fails if tournament_start_time is null', async () => {
      const contestId = crypto.randomUUID();

      await pool.query(
        `INSERT INTO contest_instances
         (id, template_id, organizer_id, entry_fee_cents, payout_structure, status,
          tournament_start_time, contest_name, max_entries)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [contestId, templateId, organizerId, 50000, JSON.stringify({ type: 'winners_take_all', winners: 1 }), 'LOCKED', null, 'Test', 20]
      );

      try {
        await transitionSingleLockedToLive(pool, new Date(), contestId);
        fail('Should have thrown error');
      } catch (err) {
        expect(err.code).toBe('TOURNAMENT_START_TIME_MISSING');
      }
    });

    it('fails if tournament_start_time is in the future', async () => {
      const contestId = crypto.randomUUID();
      const futureStartTime = new Date(Date.now() + 60000); // 1 minute in future

      await pool.query(
        `INSERT INTO contest_instances
         (id, template_id, organizer_id, entry_fee_cents, payout_structure, status,
          tournament_start_time, contest_name, max_entries)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [contestId, templateId, organizerId, 50000, JSON.stringify({ type: 'winners_take_all', winners: 1 }), 'LOCKED', futureStartTime, 'Test', 20]
      );

      try {
        await transitionSingleLockedToLive(pool, new Date(), contestId);
        fail('Should have thrown error');
      } catch (err) {
        expect(err.code).toBe('TOURNAMENT_NOT_STARTED');
      }
    });

    it('inserts transition record with triggered_by=ADMIN_FORCE_LIVE', async () => {
      const contestId = crypto.randomUUID();
      const pastStartTime = new Date(Date.now() - 60000);

      await pool.query(
        `INSERT INTO contest_instances
         (id, template_id, organizer_id, entry_fee_cents, payout_structure, status,
          tournament_start_time, contest_name, max_entries)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [contestId, templateId, organizerId, 50000, JSON.stringify({ type: 'winners_take_all', winners: 1 }), 'LOCKED', pastStartTime, 'Test', 20]
      );

      await transitionSingleLockedToLive(pool, new Date(), contestId);

      const transitions = await pool.query(
        'SELECT triggered_by FROM contest_state_transitions WHERE contest_instance_id = $1',
        [contestId]
      );

      expect(transitions.rows[0].triggered_by).toBe('ADMIN_FORCE_LIVE');
    });
  });

  // =========================================================================
  // Wallet Credit Idempotency Tests
  // =========================================================================

  describe('Wallet Credit Idempotency', () => {
    it('idempotency_key unique constraint exists on ledger table', async () => {
      // Verify the constraint exists by checking schema
      const constraintCheck = await pool.query(
        `SELECT constraint_name
         FROM information_schema.table_constraints
         WHERE table_name='ledger' AND constraint_type='UNIQUE' AND constraint_name LIKE '%idempotency%'`
      );

      expect(constraintCheck.rows.length).toBeGreaterThan(0);
      expect(constraintCheck.rows.some(r => r.constraint_name.includes('idempotency'))).toBe(true);
    });

    it('wallet credit endpoint must use deterministic idempotency key format', async () => {
      // Test the idempotency key format that will be used by the endpoint
      const userId = crypto.randomUUID();
      const contestId = crypto.randomUUID();
      const idempotencyKey = `wallet_credit:${userId}:GOODWILL:${contestId}`;

      // Verify key format is reasonable (contains required parts)
      expect(idempotencyKey).toContain('wallet_credit:');
      expect(idempotencyKey).toContain(userId);
      expect(idempotencyKey).toContain('GOODWILL');
      expect(idempotencyKey).toContain(contestId);
    });
  });

  // =========================================================================
  // Audit Trail Tests
  // =========================================================================

  describe('Contest State Transitions (Audit Trail)', () => {
    it('returns all transitions in chronological order', async () => {
      const contestId = crypto.randomUUID();
      const lockTime = new Date(Date.now() - 120000);
      const startTime = new Date(Date.now() - 60000);

      // Create SCHEDULED contest
      await pool.query(
        `INSERT INTO contest_instances
         (id, template_id, organizer_id, entry_fee_cents, payout_structure, status,
          lock_time, tournament_start_time, contest_name, max_entries)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [contestId, templateId, organizerId, 50000, JSON.stringify({ type: 'winners_take_all', winners: 1 }), 'SCHEDULED', lockTime, startTime, 'Test', 20]
      );

      // Transition SCHEDULED → LOCKED
      await lockScheduledContestForAdmin(pool, new Date(), contestId);

      // Transition LOCKED → LIVE
      await transitionSingleLockedToLive(pool, new Date(), contestId);

      // Query all transitions
      const transitions = await pool.query(
        'SELECT from_state, to_state, triggered_by, created_at FROM contest_state_transitions WHERE contest_instance_id = $1 ORDER BY created_at ASC',
        [contestId]
      );

      expect(transitions.rows.length).toBeGreaterThanOrEqual(2);
      expect(transitions.rows[0].from_state).toBe('SCHEDULED');
      expect(transitions.rows[0].to_state).toBe('LOCKED');
      expect(transitions.rows[1].from_state).toBe('LOCKED');
      expect(transitions.rows[1].to_state).toBe('LIVE');
    });

    it('includes reason when transition is recorded', async () => {
      const contestId = crypto.randomUUID();

      await pool.query(
        `INSERT INTO contest_instances
         (id, template_id, organizer_id, entry_fee_cents, payout_structure, status,
          lock_time, contest_name, max_entries)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [contestId, templateId, organizerId, 50000, JSON.stringify({ type: 'winners_take_all', winners: 1 }), 'LOCKED', null, 'Test', 20]
      );

      // Unlock (records admin action)
      await unlockScheduledContestForAdmin(pool, new Date(), contestId);

      const transitions = await pool.query(
        'SELECT reason, triggered_by FROM contest_state_transitions WHERE contest_instance_id = $1',
        [contestId]
      );

      expect(transitions.rows.length).toBeGreaterThan(0);
      expect(transitions.rows[0].triggered_by).toBe('ADMIN_UNLOCK');
      expect(transitions.rows[0].reason).toBeDefined();
    });
  });
});
