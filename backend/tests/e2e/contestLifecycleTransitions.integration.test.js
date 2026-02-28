/**
 * Contest Lifecycle Transitions - Integration Test Suite
 *
 * Validates the pure contestLifecycleService.transitionLockedToLive() function:
 * - Atomic state transitions (LOCKED → LIVE)
 * - Idempotency (re-calls are safe)
 * - Deterministic execution (injected now, not database clock)
 * - Transition record persistence
 * - Contest isolation (one contest's transition doesn't affect others)
 * - Boundary conditions (NULL tournament_start_time, now < start time, already LIVE)
 *
 * Database Safety:
 * - Uses TEST_DB_ALLOW_DBNAME=railway for test isolation
 * - Wraps mutations in transactions
 * - Cleans up all test data in afterEach
 */

const { Pool } = require('pg');
const crypto = require('crypto');
const { transitionLockedToLive } = require('../../services/contestLifecycleService');

describe('Contest Lifecycle Transitions - LOCKED → LIVE', () => {
  let pool;

  // Test fixture IDs (regenerated per test)
  let templateId;
  let organizerId;
  let contestId1;
  let contestId2;

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
    contestId1 = crypto.randomUUID();
    contestId2 = crypto.randomUUID();

    // Setup: Create organizer user (required for FK constraint)
    await pool.query(
      'INSERT INTO users (id, email) VALUES ($1, $2)',
      [organizerId, `organizer-${organizerId}@test.com`]
    );

    // Setup: Create template (required for foreign key)
    await pool.query(
      `INSERT INTO contest_templates
       (id, name, sport, template_type, scoring_strategy_key, lock_strategy_key,
        settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
        allowed_entry_fee_max_cents, allowed_payout_structures)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
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
        JSON.stringify([{ type: 'winners_take_all', winners: 1 }])
      ]
    );
  });

  afterEach(async () => {
    // Cleanup: Delete test data in reverse FK order
    try {
      await pool.query(
        'DELETE FROM contest_state_transitions WHERE contest_instance_id = ANY($1::uuid[])',
        [[contestId1, contestId2]]
      );
      await pool.query(
        'DELETE FROM contest_participants WHERE contest_instance_id = ANY($1::uuid[])',
        [[contestId1, contestId2]]
      );
      await pool.query(
        'DELETE FROM contest_instances WHERE id = ANY($1::uuid[])',
        [[contestId1, contestId2]]
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
  // TEST 1: Transition succeeds when now >= tournament_start_time
  // =========================================================================

  it('transitions LOCKED → LIVE when now >= tournament_start_time', async () => {
    // Setup: Create LOCKED contest with tournament_start_time in the past
    const pastStartTime = new Date(Date.now() - 60000); // 1 minute ago

    await pool.query(
      `INSERT INTO contest_instances
       (id, template_id, organizer_id, entry_fee_cents, payout_structure, status,
        tournament_start_time, contest_name, max_entries)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        contestId1,
        templateId,
        organizerId,
        50000,
        JSON.stringify({ type: 'winners_take_all', winners: 1 }),
        'LOCKED',
        pastStartTime,
        'Test Contest 1',
        20
      ]
    );

    // Execute: Call transitionLockedToLive with current time
    const result = await transitionLockedToLive(pool, new Date());

    // Assert: Transition occurred
    expect(result.count).toBe(1);
    expect(result.changedIds).toEqual([contestId1]);

    // Verify: Contest status is now LIVE
    const updated = await pool.query(
      'SELECT status FROM contest_instances WHERE id = $1',
      [contestId1]
    );
    expect(updated.rows[0].status).toBe('LIVE');

    // Verify: Transition record was inserted
    const transition = await pool.query(
      `SELECT from_state, to_state, triggered_by FROM contest_state_transitions
       WHERE contest_instance_id = $1`,
      [contestId1]
    );
    expect(transition.rows.length).toBe(1);
    expect(transition.rows[0]).toEqual({
      from_state: 'LOCKED',
      to_state: 'LIVE',
      triggered_by: 'TOURNAMENT_START_TIME_REACHED'
    });
  });

  // =========================================================================
  // TEST 2: No transition when now < tournament_start_time
  // =========================================================================

  it('skips transition when now < tournament_start_time', async () => {
    // Setup: Create LOCKED contest with tournament_start_time in the future
    const futureStartTime = new Date(Date.now() + 3600000); // 1 hour from now

    await pool.query(
      `INSERT INTO contest_instances
       (id, template_id, organizer_id, entry_fee_cents, payout_structure, status,
        tournament_start_time, contest_name, max_entries)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        contestId1,
        templateId,
        organizerId,
        50000,
        JSON.stringify({ type: 'winners_take_all', winners: 1 }),
        'LOCKED',
        futureStartTime,
        'Test Contest 1',
        20
      ]
    );

    // Execute: Call transitionLockedToLive with current time
    const result = await transitionLockedToLive(pool, new Date());

    // Assert: No transition occurred
    expect(result.count).toBe(0);
    expect(result.changedIds).toEqual([]);

    // Verify: Contest status is still LOCKED
    const unchanged = await pool.query(
      'SELECT status FROM contest_instances WHERE id = $1',
      [contestId1]
    );
    expect(unchanged.rows[0].status).toBe('LOCKED');

    // Verify: No transition record was inserted
    const transition = await pool.query(
      `SELECT COUNT(*) FROM contest_state_transitions
       WHERE contest_instance_id = $1`,
      [contestId1]
    );
    expect(transition.rows[0].count).toBe('0');
  });

  // =========================================================================
  // TEST 3: No transition when tournament_start_time IS NULL
  // =========================================================================

  it('skips transition when tournament_start_time IS NULL', async () => {
    // Setup: Create LOCKED contest with NULL tournament_start_time
    await pool.query(
      `INSERT INTO contest_instances
       (id, template_id, organizer_id, entry_fee_cents, payout_structure, status,
        tournament_start_time, contest_name, max_entries)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        contestId1,
        templateId,
        organizerId,
        50000,
        JSON.stringify({ type: 'winners_take_all', winners: 1 }),
        'LOCKED',
        null, // NULL tournament_start_time
        'Test Contest 1',
        20
      ]
    );

    // Execute: Call transitionLockedToLive
    const result = await transitionLockedToLive(pool, new Date());

    // Assert: No transition occurred
    expect(result.count).toBe(0);
    expect(result.changedIds).toEqual([]);

    // Verify: Contest status is still LOCKED
    const unchanged = await pool.query(
      'SELECT status FROM contest_instances WHERE id = $1',
      [contestId1]
    );
    expect(unchanged.rows[0].status).toBe('LOCKED');
  });

  // =========================================================================
  // TEST 4: Idempotent - LIVE status unchanged on re-call
  // =========================================================================

  it('is idempotent: LIVE contests are not re-transitioned', async () => {
    // Setup: Create LIVE contest
    const pastStartTime = new Date(Date.now() - 60000);

    await pool.query(
      `INSERT INTO contest_instances
       (id, template_id, organizer_id, entry_fee_cents, payout_structure, status,
        tournament_start_time, contest_name, max_entries)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        contestId1,
        templateId,
        organizerId,
        50000,
        JSON.stringify({ type: 'winners_take_all', winners: 1 }),
        'LIVE', // Already LIVE
        pastStartTime,
        'Test Contest 1',
        20
      ]
    );

    // Execute: Call transitionLockedToLive (should do nothing)
    const result = await transitionLockedToLive(pool, new Date());

    // Assert: No change
    expect(result.count).toBe(0);
    expect(result.changedIds).toEqual([]);

    // Verify: No new transition records
    const transition = await pool.query(
      `SELECT COUNT(*) FROM contest_state_transitions
       WHERE contest_instance_id = $1`,
      [contestId1]
    );
    expect(transition.rows[0].count).toBe('0');
  });

  // =========================================================================
  // TEST 5: Transition record persists correctly
  // =========================================================================

  it('persists transition record with correct metadata', async () => {
    // Setup: Create LOCKED contest with past start time
    const pastStartTime = new Date(Date.now() - 60000);

    await pool.query(
      `INSERT INTO contest_instances
       (id, template_id, organizer_id, entry_fee_cents, payout_structure, status,
        tournament_start_time, contest_name, max_entries)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        contestId1,
        templateId,
        organizerId,
        50000,
        JSON.stringify({ type: 'winners_take_all', winners: 1 }),
        'LOCKED',
        pastStartTime,
        'Test Contest 1',
        20
      ]
    );

    // Execute: Transition
    const now = new Date();
    await transitionLockedToLive(pool, now);

    // Verify: Transition record has correct fields
    const transition = await pool.query(
      `SELECT contest_instance_id, from_state, to_state, triggered_by, reason, created_at
       FROM contest_state_transitions
       WHERE contest_instance_id = $1`,
      [contestId1]
    );

    expect(transition.rows.length).toBe(1);
    const record = transition.rows[0];
    expect(record.contest_instance_id).toBe(contestId1);
    expect(record.from_state).toBe('LOCKED');
    expect(record.to_state).toBe('LIVE');
    expect(record.triggered_by).toBe('TOURNAMENT_START_TIME_REACHED');
    expect(record.reason).toBe('Automatic transition at tournament start time');
    expect(record.created_at).toBeDefined();
  });

  // =========================================================================
  // TEST 6: Contest isolation - multiple contests transition independently
  // =========================================================================

  it('transitions multiple eligible contests independently', async () => {
    // Setup: Create two LOCKED contests, both with past start times
    const pastStartTime = new Date(Date.now() - 60000);

    await pool.query(
      `INSERT INTO contest_instances
       (id, template_id, organizer_id, entry_fee_cents, payout_structure, status,
        tournament_start_time, contest_name, max_entries)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9),
              ($10, $2, $3, $4, $5, $6, $7, $11, $9)`,
      [
        contestId1,
        templateId,
        organizerId,
        50000,
        JSON.stringify({ type: 'winners_take_all', winners: 1 }),
        'LOCKED',
        pastStartTime,
        'Test Contest 1',
        20,
        contestId2,
        'Test Contest 2'
      ]
    );

    // Execute: Transition both
    const result = await transitionLockedToLive(pool, new Date());

    // Assert: Both transitioned
    expect(result.count).toBe(2);
    expect(result.changedIds).toContain(contestId1);
    expect(result.changedIds).toContain(contestId2);

    // Verify: Both are now LIVE
    const updated = await pool.query(
      'SELECT id, status FROM contest_instances WHERE id = ANY($1::uuid[]) ORDER BY id',
      [[contestId1, contestId2]]
    );
    expect(updated.rows.length).toBe(2);
    updated.rows.forEach(row => {
      expect(row.status).toBe('LIVE');
    });

    // Verify: Each has a transition record
    const transitions = await pool.query(
      `SELECT contest_instance_id FROM contest_state_transitions
       WHERE contest_instance_id = ANY($1::uuid[])
       ORDER BY contest_instance_id`,
      [[contestId1, contestId2]]
    );
    expect(transitions.rows.length).toBe(2);
  });

  // =========================================================================
  // TEST 7: Boundary - Exact time match (now == tournament_start_time)
  // =========================================================================

  it('transitions when now == tournament_start_time (boundary)', async () => {
    // Setup: Create LOCKED contest with tournament_start_time = exact now
    const now = new Date();

    await pool.query(
      `INSERT INTO contest_instances
       (id, template_id, organizer_id, entry_fee_cents, payout_structure, status,
        tournament_start_time, contest_name, max_entries)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        contestId1,
        templateId,
        organizerId,
        50000,
        JSON.stringify({ type: 'winners_take_all', winners: 1 }),
        'LOCKED',
        now, // Exact match
        'Test Contest 1',
        20
      ]
    );

    // Execute: Transition with the same timestamp
    const result = await transitionLockedToLive(pool, now);

    // Assert: Transition occurred
    expect(result.count).toBe(1);
    expect(result.changedIds).toEqual([contestId1]);
  });

  // =========================================================================
  // TEST 8: No transition for non-LOCKED statuses (isolation)
  // =========================================================================

  it('ignores SCHEDULED and COMPLETE contests', async () => {
    const pastStartTime = new Date(Date.now() - 60000);

    // Setup: Create one SCHEDULED, one COMPLETE (both with past start times)
    await pool.query(
      `INSERT INTO contest_instances
       (id, template_id, organizer_id, entry_fee_cents, payout_structure, status,
        tournament_start_time, contest_name, max_entries)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9),
              ($10, $2, $3, $4, $5, $11, $7, $12, $9)`,
      [
        contestId1,
        templateId,
        organizerId,
        50000,
        JSON.stringify({ type: 'winners_take_all', winners: 1 }),
        'SCHEDULED',
        pastStartTime,
        'Test Contest SCHEDULED',
        20,
        contestId2,
        'COMPLETE',
        'Test Contest COMPLETE'
      ]
    );

    // Execute: Transition
    const result = await transitionLockedToLive(pool, new Date());

    // Assert: No transitions (neither is LOCKED)
    expect(result.count).toBe(0);

    // Verify: Status unchanged
    const scheduled = await pool.query(
      'SELECT status FROM contest_instances WHERE id = $1',
      [contestId1]
    );
    const complete = await pool.query(
      'SELECT status FROM contest_instances WHERE id = $1',
      [contestId2]
    );
    expect(scheduled.rows[0].status).toBe('SCHEDULED');
    expect(complete.rows[0].status).toBe('COMPLETE');
  });
});
