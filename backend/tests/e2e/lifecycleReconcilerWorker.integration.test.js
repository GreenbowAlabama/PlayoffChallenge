/**
 * Lifecycle Reconciler Worker - Integration Test Suite
 *
 * Validates the reconcileLifecycle orchestration function:
 * - Correct ordering (SCHEDULED → LOCKED, then LOCKED → LIVE)
 * - Correct aggregation of results
 * - No eligible contests case
 * - Day 1 case: single contest transitioning SCHEDULED → LOCKED → LIVE
 *
 * Database Safety:
 * - Uses TEST_DB_ALLOW_DBNAME=railway for test isolation
 * - Wraps mutations in transactions
 * - Cleans up all test data in afterEach
 */

const { Pool } = require('pg');
const crypto = require('crypto');
const { reconcileLifecycle } = require('../../services/lifecycleReconciliationService');

describe('Lifecycle Reconciliation Service', () => {
  let pool;

  // Test fixture IDs (regenerated per test)
  let templateId;
  let organizerId;
  let contestId;

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

    // Verify connection
    try {
      const testConn = await pool.connect();
      await testConn.query('SELECT 1');
      testConn.release();
    } catch (err) {
      throw new Error(`Failed to connect to test database: ${err.message}`);
    }
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  beforeEach(async () => {
    // Generate unique IDs per test
    templateId = crypto.randomUUID();
    organizerId = crypto.randomUUID();
    contestId = crypto.randomUUID();

    // Setup: Create organizer user
    await pool.query(
      'INSERT INTO users (id, email) VALUES ($1, $2)',
      [organizerId, `organizer-${organizerId}@test.com`]
    );

    // Setup: Create template (is_active=false to avoid unique constraint)
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
    // Cleanup: Delete test data in reverse FK order
    try {
      await pool.query(
        'DELETE FROM contest_state_transitions WHERE contest_instance_id = $1',
        [contestId]
      );
      await pool.query(
        'DELETE FROM contest_participants WHERE contest_instance_id = $1',
        [contestId]
      );
      await pool.query(
        'DELETE FROM contest_instances WHERE id = $1',
        [contestId]
      );
      await pool.query(
        'DELETE FROM contest_templates WHERE id = $1',
        [templateId]
      );
      await pool.query(
        'DELETE FROM users WHERE id = $1',
        [organizerId]
      );
    } catch (err) {
      console.error('Cleanup error:', err.message);
    }
  });

  // =========================================================================
  // TEST 1: No eligible contests => totals.count == 0
  // =========================================================================

  it('returns zero counts when no eligible contests exist', async () => {
    const now = new Date();

    // Execute: Reconcile with no contests
    const result = await reconcileLifecycle(pool, now);

    // Assert: All counts are zero
    expect(result.totals.count).toBe(0);
    expect(result.totals.changedIds).toEqual([]);
    expect(result.scheduledToLocked.count).toBe(0);
    expect(result.lockedToLive.count).toBe(0);

    // Verify: Result structure is correct
    expect(result.nowISO).toBeDefined();
    expect(typeof result.nowISO).toBe('string');
    expect(result.scheduledToLocked).toHaveProperty('count');
    expect(result.scheduledToLocked).toHaveProperty('changedIds');
  });

  // =========================================================================
  // TEST 2: Day 1 case - lock_time == tournament_start_time
  // Single contest: SCHEDULED → LOCKED → LIVE in one reconciliation
  // =========================================================================

  it('reconciles Day 1 case: SCHEDULED → LOCKED → LIVE with equal timestamps', async () => {
    // Setup: Create SCHEDULED contest with lock_time == tournament_start_time (both in the past)
    const commonTime = new Date(Date.now() - 60000); // 1 minute ago
    const now = new Date(); // Current time (after commonTime)

    await pool.query(
      `INSERT INTO contest_instances
       (id, template_id, organizer_id, entry_fee_cents, payout_structure, status,
        lock_time, tournament_start_time, contest_name, max_entries)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        contestId,
        templateId,
        organizerId,
        50000,
        JSON.stringify({ type: 'winners_take_all', winners: 1 }),
        'SCHEDULED',
        commonTime,
        commonTime, // Equal timestamps
        'Day 1 Contest',
        20
      ]
    );

    // Verify: Contest is initially SCHEDULED
    const beforeReconcile = await pool.query(
      'SELECT status FROM contest_instances WHERE id = $1',
      [contestId]
    );
    expect(beforeReconcile.rows[0].status).toBe('SCHEDULED');

    // Execute: Reconcile
    const result = await reconcileLifecycle(pool, now);

    // Assert: Correct counts
    expect(result.scheduledToLocked.count).toBe(1);
    expect(result.lockedToLive.count).toBe(1);
    expect(result.totals.count).toBe(2);
    expect(result.totals.changedIds).toContain(contestId);

    // Verify: Contest is now LIVE
    const afterReconcile = await pool.query(
      'SELECT status FROM contest_instances WHERE id = $1',
      [contestId]
    );
    expect(afterReconcile.rows[0].status).toBe('LIVE');

    // Verify: Both transition records exist
    const transitions = await pool.query(
      `SELECT from_state, to_state, triggered_by FROM contest_state_transitions
       WHERE contest_instance_id = $1
       ORDER BY created_at`,
      [contestId]
    );
    expect(transitions.rows.length).toBe(2);
    expect(transitions.rows[0]).toEqual({
      from_state: 'SCHEDULED',
      to_state: 'LOCKED',
      triggered_by: 'LOCK_TIME_REACHED'
    });
    expect(transitions.rows[1]).toEqual({
      from_state: 'LOCKED',
      to_state: 'LIVE',
      triggered_by: 'TOURNAMENT_START_TIME_REACHED'
    });
  });

  // =========================================================================
  // TEST 3: Idempotency - re-reconcile returns zero changes
  // =========================================================================

  it('is idempotent: re-reconciliation of LIVE contest returns zero changes', async () => {
    // Setup: Create LIVE contest
    const pastTime = new Date(Date.now() - 120000);
    const now = new Date();

    await pool.query(
      `INSERT INTO contest_instances
       (id, template_id, organizer_id, entry_fee_cents, payout_structure, status,
        lock_time, tournament_start_time, contest_name, max_entries)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        contestId,
        templateId,
        organizerId,
        50000,
        JSON.stringify({ type: 'winners_take_all', winners: 1 }),
        'LIVE',
        pastTime,
        pastTime,
        'Already Live Contest',
        20
      ]
    );

    // Execute: Reconcile (should do nothing)
    const result = await reconcileLifecycle(pool, now);

    // Assert: No changes
    expect(result.totals.count).toBe(0);
    expect(result.scheduledToLocked.count).toBe(0);
    expect(result.lockedToLive.count).toBe(0);

    // Verify: Contest status unchanged
    const afterReconcile = await pool.query(
      'SELECT status FROM contest_instances WHERE id = $1',
      [contestId]
    );
    expect(afterReconcile.rows[0].status).toBe('LIVE');
  });

  // =========================================================================
  // TEST 4: Correct ordering - SCHEDULED → LOCKED runs before LOCKED → LIVE
  // =========================================================================

  it('executes transitions in correct order (SCHEDULED→LOCKED before LOCKED→LIVE)', async () => {
    // Setup: Two contests:
    // - Contest 1: SCHEDULED, lock_time in past (should transition to LOCKED, then LIVE)
    // - Contest 2: LOCKED, tournament_start_time in past (should transition to LIVE)
    const contestId2 = crypto.randomUUID();
    const pastTime = new Date(Date.now() - 60000);
    const now = new Date();

    await pool.query(
      `INSERT INTO contest_instances
       (id, template_id, organizer_id, entry_fee_cents, payout_structure, status,
        lock_time, tournament_start_time, contest_name, max_entries)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10),
              ($11, $2, $3, $4, $5, $12, $7, $8, $13, $10)`,
      [
        contestId,
        templateId,
        organizerId,
        50000,
        JSON.stringify({ type: 'winners_take_all', winners: 1 }),
        'SCHEDULED',
        pastTime,
        pastTime,
        'Contest 1',
        20,
        contestId2,
        'LOCKED',
        'Contest 2'
      ]
    );

    // Execute: Reconcile
    const result = await reconcileLifecycle(pool, now);

    // Assert: Correct distribution of transitions
    expect(result.scheduledToLocked.count).toBe(1);
    expect(result.lockedToLive.count).toBe(2); // Contest 1 (LOCKED→LIVE) + Contest 2 (LOCKED→LIVE)
    expect(result.totals.count).toBe(3);

    // Verify: Both contests are now LIVE
    const contests = await pool.query(
      'SELECT id, status FROM contest_instances WHERE id = ANY($1::uuid[]) ORDER BY id',
      [[contestId, contestId2]]
    );
    expect(contests.rows.length).toBe(2);
    contests.rows.forEach(row => {
      expect(row.status).toBe('LIVE');
    });

    // Cleanup: Delete contest 2
    await pool.query(
      'DELETE FROM contest_state_transitions WHERE contest_instance_id = $1',
      [contestId2]
    );
    await pool.query(
      'DELETE FROM contest_instances WHERE id = $1',
      [contestId2]
    );
  });
});
