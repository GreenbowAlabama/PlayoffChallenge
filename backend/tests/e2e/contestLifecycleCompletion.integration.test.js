/**
 * Contest Lifecycle Completion (LIVE → COMPLETE) - Integration Test Suite
 *
 * Validates MVP lifecycle completion:
 * - transitionLiveToComplete() - LIVE → COMPLETE via settlement based on tournament_end_time
 * - executeSettlement() - Enhanced to accept injected now, add status guard, insert transition record
 *
 * Requirements tested:
 * 1. Settlement succeeds when now >= tournament_end_time
 * 2. No settlement when now < tournament_end_time
 * 3. No settlement when tournament_end_time IS NULL
 * 4. Idempotent: second run produces no additional settlement_records or transition rows
 * 5. Missing snapshot prerequisite causes no change (status remains LIVE)
 * 6. Transition record inserted with triggered_by='TOURNAMENT_END_TIME_REACHED'
 *
 * Database Safety:
 * - Uses TEST_DB_ALLOW_DBNAME=railway for test isolation
 * - Cleans up all test data in afterEach
 */

const { Pool } = require('pg');
const crypto = require('crypto');

describe('Contest Lifecycle Completion - LIVE → COMPLETE', () => {
  let pool;
  let transitionLiveToComplete;

  // Test fixture IDs (regenerated per test)
  let templateId;
  let organizerId;
  let contestId;
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

    // Verify connection
    try {
      const testConn = await pool.connect();
      await testConn.query('SELECT 1');
      testConn.release();
    } catch (err) {
      throw new Error(`Failed to connect to test database: ${err.message}`);
    }

    // Require the real service (no mock for these tests)
    ({ transitionLiveToComplete } = require('../../services/contestLifecycleService'));
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
    userId = crypto.randomUUID();

    // Setup: Create organizer user
    await pool.query(
      'INSERT INTO users (id, email) VALUES ($1, $2)',
      [organizerId, `organizer-${organizerId}@test.com`]
    );

    // Setup: Create participant user
    await pool.query(
      'INSERT INTO users (id, email) VALUES ($1, $2)',
      [userId, `participant-${userId}@test.com`]
    );

    // Setup: Create template (is_active = false to avoid unique constraint)
    await pool.query(
      `INSERT INTO contest_templates
       (id, name, sport, template_type, scoring_strategy_key, lock_strategy_key,
        settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
        allowed_entry_fee_max_cents, allowed_payout_structures, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        templateId,
        `Test Template ${templateId}`,
        'PGA',
        'single_event',
        'pga_drop_lowest',
        'tournament_start_lock',
        'pga_standard_v1',
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
      // Delete audit records first (FK to contest_instances)
      await pool.query(
        'DELETE FROM admin_contest_audit WHERE contest_instance_id = $1',
        [contestId]
      );

      // Delete settlement records (no FK dependencies)
      await pool.query(
        'DELETE FROM settlement_records WHERE contest_instance_id = $1',
        [contestId]
      );

      // Delete lifecycle transitions
      await pool.query(
        'DELETE FROM contest_state_transitions WHERE contest_instance_id = $1',
        [contestId]
      );

      // Delete event data snapshots
      await pool.query(
        'DELETE FROM event_data_snapshots WHERE contest_instance_id = $1',
        [contestId]
      );

      // Delete participants
      await pool.query(
        'DELETE FROM contest_participants WHERE contest_instance_id = $1',
        [contestId]
      );

      // Delete contest instance
      await pool.query(
        'DELETE FROM contest_instances WHERE id = $1',
        [contestId]
      );

      // Delete template
      await pool.query(
        'DELETE FROM contest_templates WHERE id = $1',
        [templateId]
      );

      // Delete users
      await pool.query(
        'DELETE FROM users WHERE id = ANY($1::uuid[])',
        [[organizerId, userId]]
      );
    } catch (err) {
      console.error('Cleanup error:', err.message);
    }
  });

  // =========================================================================
  // TEST 1: Settlement succeeds when now >= tournament_end_time
  // =========================================================================

  it('settles and transitions LIVE → COMPLETE when now >= tournament_end_time', async () => {
    // Setup: Create LIVE contest with tournament_end_time in the past
    const pastEndTime = new Date(Date.now() - 60000); // 1 minute ago
    const now = new Date();

    await pool.query(
      `INSERT INTO contest_instances
       (id, template_id, organizer_id, entry_fee_cents, payout_structure, status,
        lock_time, tournament_start_time, tournament_end_time, contest_name, max_entries)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        contestId,
        templateId,
        organizerId,
        50000,
        JSON.stringify({ type: 'winners_take_all', winners: 1 }),
        'LIVE',
        new Date(Date.now() - 3600000),
        new Date(Date.now() - 1800000),
        pastEndTime,
        'Test Contest',
        20
      ]
    );

    // Add a participant
    await pool.query(
      'INSERT INTO contest_participants (contest_instance_id, user_id) VALUES ($1, $2)',
      [contestId, userId]
    );

    // Create FINAL snapshot (required for settlement)
    const snapshotId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO event_data_snapshots
       (id, contest_instance_id, provider_event_id, payload, snapshot_hash, provider_final_flag)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        snapshotId,
        contestId,
        'test_provider_event_id',
        JSON.stringify({ test: 'payload' }),
        'test_hash_123',
        true
      ]
    );

    // Execute: Call transitionLiveToComplete
    const result = await transitionLiveToComplete(pool, now);

    // Assert: Transition occurred
    expect(result.count).toBe(1);
    expect(result.changedIds).toEqual([contestId]);

    // Verify: Contest status is now COMPLETE
    const updated = await pool.query(
      'SELECT status, settle_time FROM contest_instances WHERE id = $1',
      [contestId]
    );
    expect(updated.rows[0].status).toBe('COMPLETE');
    expect(updated.rows[0].settle_time).not.toBeNull();

    // Verify: Settlement record was created
    const settlement = await pool.query(
      'SELECT * FROM settlement_records WHERE contest_instance_id = $1',
      [contestId]
    );
    expect(settlement.rows.length).toBe(1);
    expect(settlement.rows[0].snapshot_id).toBe(snapshotId);

    // Verify: Transition record was inserted
    const transition = await pool.query(
      `SELECT from_state, to_state, triggered_by FROM contest_state_transitions
       WHERE contest_instance_id = $1`,
      [contestId]
    );
    expect(transition.rows.length).toBe(1);
    expect(transition.rows[0]).toEqual({
      from_state: 'LIVE',
      to_state: 'COMPLETE',
      triggered_by: 'TOURNAMENT_END_TIME_REACHED'
    });
  });

  // =========================================================================
  // TEST 2: No settlement when now < tournament_end_time
  // =========================================================================

  it('skips settlement when now < tournament_end_time', async () => {
    // Setup: Create LIVE contest with tournament_end_time in the future
    const futureEndTime = new Date(Date.now() + 3600000); // 1 hour from now
    const now = new Date();

    await pool.query(
      `INSERT INTO contest_instances
       (id, template_id, organizer_id, entry_fee_cents, payout_structure, status,
        lock_time, tournament_start_time, tournament_end_time, contest_name, max_entries)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        contestId,
        templateId,
        organizerId,
        50000,
        JSON.stringify({ type: 'winners_take_all', winners: 1 }),
        'LIVE',
        new Date(Date.now() - 3600000),
        new Date(Date.now() - 1800000),
        futureEndTime,
        'Test Contest',
        20
      ]
    );

    // Execute: Call transitionLiveToComplete
    const result = await transitionLiveToComplete(pool, now);

    // Assert: No transition occurred
    expect(result.count).toBe(0);
    expect(result.changedIds).toEqual([]);

    // Verify: Contest status is still LIVE
    const unchanged = await pool.query(
      'SELECT status FROM contest_instances WHERE id = $1',
      [contestId]
    );
    expect(unchanged.rows[0].status).toBe('LIVE');

    // Verify: No settlement record was created
    const settlement = await pool.query(
      'SELECT COUNT(*) as count FROM settlement_records WHERE contest_instance_id = $1',
      [contestId]
    );
    expect(settlement.rows[0].count).toBe('0');
  });

  // =========================================================================
  // TEST 3: No settlement when tournament_end_time IS NULL
  // =========================================================================

  it('skips settlement when tournament_end_time IS NULL', async () => {
    // Setup: Create LIVE contest with NULL tournament_end_time
    const now = new Date();

    await pool.query(
      `INSERT INTO contest_instances
       (id, template_id, organizer_id, entry_fee_cents, payout_structure, status,
        lock_time, tournament_start_time, tournament_end_time, contest_name, max_entries)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        contestId,
        templateId,
        organizerId,
        50000,
        JSON.stringify({ type: 'winners_take_all', winners: 1 }),
        'LIVE',
        new Date(Date.now() - 3600000),
        new Date(Date.now() - 1800000),
        null, // NULL tournament_end_time
        'Test Contest',
        20
      ]
    );

    // Execute: Call transitionLiveToComplete
    const result = await transitionLiveToComplete(pool, now);

    // Assert: No transition occurred
    expect(result.count).toBe(0);
    expect(result.changedIds).toEqual([]);

    // Verify: Contest status is still LIVE
    const unchanged = await pool.query(
      'SELECT status FROM contest_instances WHERE id = $1',
      [contestId]
    );
    expect(unchanged.rows[0].status).toBe('LIVE');
  });

  // =========================================================================
  // TEST 4: Idempotent re-run
  // =========================================================================

  it('is idempotent: second run produces no additional settlement_records or transition rows', async () => {
    // Setup: Create LIVE contest with tournament_end_time in the past
    const pastEndTime = new Date(Date.now() - 60000);
    const now = new Date();

    await pool.query(
      `INSERT INTO contest_instances
       (id, template_id, organizer_id, entry_fee_cents, payout_structure, status,
        lock_time, tournament_start_time, tournament_end_time, contest_name, max_entries)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        contestId,
        templateId,
        organizerId,
        50000,
        JSON.stringify({ type: 'winners_take_all', winners: 1 }),
        'LIVE',
        new Date(Date.now() - 3600000),
        new Date(Date.now() - 1800000),
        pastEndTime,
        'Test Contest',
        20
      ]
    );

    // Add participant
    await pool.query(
      'INSERT INTO contest_participants (contest_instance_id, user_id) VALUES ($1, $2)',
      [contestId, userId]
    );

    // Create FINAL snapshot
    const snapshotId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO event_data_snapshots
       (id, contest_instance_id, provider_event_id, payload, snapshot_hash, provider_final_flag)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        snapshotId,
        contestId,
        'test_provider_event_id',
        JSON.stringify({ test: 'payload' }),
        'test_hash_123',
        true
      ]
    );

    // First run: Settle the contest
    const result1 = await transitionLiveToComplete(pool, now);
    expect(result1.count).toBe(1);

    // Verify settlement and transition records created
    const settlement1 = await pool.query(
      'SELECT COUNT(*) as count FROM settlement_records WHERE contest_instance_id = $1',
      [contestId]
    );
    const transition1 = await pool.query(
      'SELECT COUNT(*) as count FROM contest_state_transitions WHERE contest_instance_id = $1',
      [contestId]
    );
    expect(settlement1.rows[0].count).toBe('1');
    expect(transition1.rows[0].count).toBe('1');

    // Second run: Re-call transitionLiveToComplete
    const result2 = await transitionLiveToComplete(pool, now);

    // Assert: No additional changes
    expect(result2.count).toBe(0);
    expect(result2.changedIds).toEqual([]);

    // Verify: No new settlement or transition records
    const settlement2 = await pool.query(
      'SELECT COUNT(*) as count FROM settlement_records WHERE contest_instance_id = $1',
      [contestId]
    );
    const transition2 = await pool.query(
      'SELECT COUNT(*) as count FROM contest_state_transitions WHERE contest_instance_id = $1',
      [contestId]
    );
    expect(settlement2.rows[0].count).toBe('1'); // Still 1, not 2
    expect(transition2.rows[0].count).toBe('1'); // Still 1, not 2
  });

  // =========================================================================
  // TEST 5: Missing snapshot prerequisite leaves contest LIVE
  // =========================================================================

  it('leaves contest LIVE when snapshot is missing (no crash, no change)', async () => {
    // Setup: Create LIVE contest with tournament_end_time in the past, but NO snapshot
    const pastEndTime = new Date(Date.now() - 60000);
    const now = new Date();

    await pool.query(
      `INSERT INTO contest_instances
       (id, template_id, organizer_id, entry_fee_cents, payout_structure, status,
        lock_time, tournament_start_time, tournament_end_time, contest_name, max_entries)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        contestId,
        templateId,
        organizerId,
        50000,
        JSON.stringify({ type: 'winners_take_all', winners: 1 }),
        'LIVE',
        new Date(Date.now() - 3600000),
        new Date(Date.now() - 1800000),
        pastEndTime,
        'Test Contest',
        20
      ]
    );

    // Execute: Call transitionLiveToComplete (no snapshot created)
    const result = await transitionLiveToComplete(pool, now);

    // Assert: No transition occurred (missing snapshot skipped gracefully)
    expect(result.count).toBe(0);
    expect(result.changedIds).toEqual([]);

    // Verify: Contest status is still LIVE
    const unchanged = await pool.query(
      'SELECT status FROM contest_instances WHERE id = $1',
      [contestId]
    );
    expect(unchanged.rows[0].status).toBe('LIVE');

    // Verify: No settlement record was created
    const settlement = await pool.query(
      'SELECT COUNT(*) as count FROM settlement_records WHERE contest_instance_id = $1',
      [contestId]
    );
    expect(settlement.rows[0].count).toBe('0');
  });

  // =========================================================================
  // TEST 6: Correct transition record with triggered_by and reason
  // =========================================================================

  it('inserts transition record with triggered_by=TOURNAMENT_END_TIME_REACHED and from_state LIVE to_state COMPLETE', async () => {
    // Setup: Create LIVE contest with tournament_end_time in the past
    const pastEndTime = new Date(Date.now() - 60000);
    const now = new Date();

    await pool.query(
      `INSERT INTO contest_instances
       (id, template_id, organizer_id, entry_fee_cents, payout_structure, status,
        lock_time, tournament_start_time, tournament_end_time, contest_name, max_entries)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        contestId,
        templateId,
        organizerId,
        50000,
        JSON.stringify({ type: 'winners_take_all', winners: 1 }),
        'LIVE',
        new Date(Date.now() - 3600000),
        new Date(Date.now() - 1800000),
        pastEndTime,
        'Test Contest',
        20
      ]
    );

    // Add participant
    await pool.query(
      'INSERT INTO contest_participants (contest_instance_id, user_id) VALUES ($1, $2)',
      [contestId, userId]
    );

    // Create FINAL snapshot
    const snapshotId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO event_data_snapshots
       (id, contest_instance_id, provider_event_id, payload, snapshot_hash, provider_final_flag)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        snapshotId,
        contestId,
        'test_provider_event_id',
        JSON.stringify({ test: 'payload' }),
        'test_hash_123',
        true
      ]
    );

    // Execute: Call transitionLiveToComplete
    await transitionLiveToComplete(pool, now);

    // Verify: Transition record has correct structure
    const transition = await pool.query(
      `SELECT from_state, to_state, triggered_by, reason FROM contest_state_transitions
       WHERE contest_instance_id = $1`,
      [contestId]
    );
    expect(transition.rows.length).toBe(1);
    expect(transition.rows[0].from_state).toBe('LIVE');
    expect(transition.rows[0].to_state).toBe('COMPLETE');
    expect(transition.rows[0].triggered_by).toBe('TOURNAMENT_END_TIME_REACHED');
    expect(transition.rows[0].reason).toBe('Automatic settlement at tournament end time');
  });
});
