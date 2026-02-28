/**
 * Settlement Isolation Test - Cancellation Sibling Independence
 *
 * Verifies that settlement on a LIVE contest instance is isolated from
 * CANCELLED siblings on the same template. Settlement scopes entirely by
 * contest_instance_id and must not be affected by other instances' status.
 *
 * Test Scenario:
 * 1. Create contest_template with all required fields (SCHEDULED)
 * 2. Create primary marketing contest_instance (LIVE) via direct DB insert
 * 3. Create sibling contest_instance (CANCELLED) on same template via direct DB insert
 * 4. Create contestant participant + golfer scores + snapshot binding for LIVE instance
 * 5. Execute settlement on LIVE instance
 * 6. Assert: LIVE settled successfully, CANCELLED unchanged, no cross-instance interference
 */

const { Pool } = require('pg');
const crypto = require('crypto');
const { executeSettlement } = require('../../services/settlementStrategy');

describe('Settlement Isolation - CANCELLED Sibling Independence', () => {
  let pool;
  let templateId;
  let liveContestId;
  let cancelledContestId;
  let participantId;
  let userId;
  let organizerId;
  let snapshotId;
  let snapshotHash;

  const testEmail = (label = 'user') =>
    `${label}-${crypto.randomUUID()}@test.com`;

  async function createIngestionSnapshot(contestInstanceId) {
    snapshotId = crypto.randomUUID();
    const payload = {
      contest_instance_id: contestInstanceId,
      event_type: 'isolation_test_snapshot',
      provider: 'test'
    };
    const canonicalJson = JSON.stringify(payload);
    snapshotHash = crypto.createHash('sha256').update(canonicalJson).digest('hex');

    await pool.query(
      `INSERT INTO ingestion_events
       (id, contest_instance_id, provider, event_type, provider_data_json, payload_hash, validation_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        snapshotId,
        contestInstanceId,
        'test',
        'isolation_test_snapshot',
        canonicalJson,
        snapshotHash,
        'VALID'
      ]
    );

    return { snapshotId, snapshotHash };
  }

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // 1. Create organizer user (required by contest_instances.organizer_id)
    organizerId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, username) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [organizerId, testEmail('organizer'), `organizer-${organizerId}`]
    );

    // 2. Create test participant user
    userId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, username) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [userId, testEmail('user'), `test-user-${userId}`]
    );

    // 3. Create contest_template with ALL required columns
    templateId = crypto.randomUUID();
    const testProviderId = `isolation_test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    await pool.query(
      `INSERT INTO contest_templates
       (id, name, sport, template_type, scoring_strategy_key, lock_strategy_key,
        settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
        allowed_entry_fee_max_cents, allowed_payout_structures, is_active,
        provider_tournament_id, season_year, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        templateId,
        'Settlement Isolation Test',
        'golf',
        'playoff',
        'pga_standard_v1',
        'golf_lock',
        'pga_standard_v1',
        10000,
        0,
        1000000,
        JSON.stringify({ '1': 100, '2': 0 }),
        false,
        testProviderId,
        2026,
        'SCHEDULED'
      ]
    );

    // 4. Create primary marketing LIVE contest instance
    liveContestId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO contest_instances
       (id, template_id, organizer_id, status, entry_fee_cents, payout_structure, contest_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        liveContestId,
        templateId,
        organizerId,
        'LIVE',
        10000,
        JSON.stringify({ '1': 100, '2': 0 }),
        'Primary Marketing Contest'
      ]
    );

    // 5. Create sibling CANCELLED contest instance on same template
    cancelledContestId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO contest_instances
       (id, template_id, organizer_id, status, entry_fee_cents, payout_structure, contest_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        cancelledContestId,
        templateId,
        organizerId,
        'CANCELLED',
        10000,
        JSON.stringify({ '1': 100, '2': 0 }),
        'Cancelled Sibling Contest'
      ]
    );

    // 5. Create contestant participant on LIVE instance
    participantId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO contest_participants
       (id, contest_instance_id, user_id)
       VALUES ($1, $2, $3)`,
      [participantId, liveContestId, userId]
    );

    // 6. Create golfer scores for participant (required for settlement ranking)
    // Single golfer with score of 70
    await pool.query(
      `INSERT INTO golfer_scores
       (id, contest_instance_id, user_id, golfer_id, round_number, hole_points,
        bonus_points, finish_bonus, total_points)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        crypto.randomUUID(),
        liveContestId,
        userId,
        'golfer-1',
        1,
        70,
        0,
        0,
        70
      ]
    );

    // 7. Create ingestion snapshot for LIVE instance (required for settlement)
    await createIngestionSnapshot(liveContestId);
  });

  afterEach(async () => {
    // Clean up in reverse order of creation (FK dependencies)
    await pool.query(
      `DELETE FROM settlement_records WHERE contest_instance_id IN ($1, $2)`,
      [liveContestId, cancelledContestId]
    );
    await pool.query(
      `DELETE FROM admin_contest_audit WHERE contest_instance_id IN ($1, $2)`,
      [liveContestId, cancelledContestId]
    );
    await pool.query(
      `DELETE FROM golfer_scores WHERE contest_instance_id IN ($1, $2)`,
      [liveContestId, cancelledContestId]
    );
    await pool.query(
      `DELETE FROM contest_state_transitions WHERE contest_instance_id IN ($1, $2)`,
      [liveContestId, cancelledContestId]
    );
    await pool.query(
      `DELETE FROM contest_participants WHERE contest_instance_id IN ($1, $2)`,
      [liveContestId, cancelledContestId]
    );
    // Note: ingestion_events (append-only) and contest_instances have FK relationships
    // that prevent simple ordered deletion. Since each test uses unique template_ids,
    // test isolation is maintained without explicit cleanup of these tables.
    // Cleanup happens implicitly via test database state isolation.
  });

  describe('settlement isolation on LIVE with CANCELLED sibling', () => {
    it('should settle LIVE instance successfully without affecting CANCELLED sibling', async () => {
      // Fetch LIVE instance for settlement
      const liveInstanceResult = await pool.query(
        `SELECT id, entry_fee_cents, payout_structure FROM contest_instances WHERE id = $1`,
        [liveContestId]
      );
      const liveInstance = liveInstanceResult.rows[0];

      // Execute settlement on LIVE instance
      const settlementResult = await executeSettlement(
        liveInstance,
        pool,
        snapshotId,
        snapshotHash
      );

      // Assert: Settlement succeeded
      expect(settlementResult).toBeTruthy();
      expect(settlementResult.contest_instance_id).toBe(liveContestId);
      expect(settlementResult.snapshot_id).toBe(snapshotId);

      // Assert: LIVE instance status changed to COMPLETE
      const liveStatusResult = await pool.query(
        `SELECT status FROM contest_instances WHERE id = $1`,
        [liveContestId]
      );
      expect(liveStatusResult.rows[0].status).toBe('COMPLETE');

      // Assert: CANCELLED sibling status unchanged
      const cancelledStatusResult = await pool.query(
        `SELECT status FROM contest_instances WHERE id = $1`,
        [cancelledContestId]
      );
      expect(cancelledStatusResult.rows[0].status).toBe('CANCELLED');

      // Assert: settlement_records written only for LIVE instance
      const settlementRecordsResult = await pool.query(
        `SELECT contest_instance_id FROM settlement_records WHERE contest_instance_id IN ($1, $2)`,
        [liveContestId, cancelledContestId]
      );
      expect(settlementRecordsResult.rows).toHaveLength(1);
      expect(settlementRecordsResult.rows[0].contest_instance_id).toBe(liveContestId);

      // Assert: No settlement_records for CANCELLED instance
      const cancelledSettlementResult = await pool.query(
        `SELECT * FROM settlement_records WHERE contest_instance_id = $1`,
        [cancelledContestId]
      );
      expect(cancelledSettlementResult.rows).toHaveLength(0);
    });

    it('should be idempotent: second settlement call returns existing record', async () => {
      const liveInstanceResult = await pool.query(
        `SELECT id, entry_fee_cents, payout_structure FROM contest_instances WHERE id = $1`,
        [liveContestId]
      );
      const liveInstance = liveInstanceResult.rows[0];

      // First settlement
      const result1 = await executeSettlement(
        liveInstance,
        pool,
        snapshotId,
        snapshotHash
      );
      expect(result1).toBeTruthy();

      // Second settlement (should return existing record)
      const result2 = await executeSettlement(
        liveInstance,
        pool,
        snapshotId,
        snapshotHash
      );
      expect(result2).toBeTruthy();
      expect(result2.id).toBe(result1.id);

      // Verify only one settlement_records entry exists
      const settlementCountResult = await pool.query(
        `SELECT COUNT(*) as count FROM settlement_records WHERE contest_instance_id = $1`,
        [liveContestId]
      );
      expect(parseInt(settlementCountResult.rows[0].count)).toBe(1);
    });

    it('should bind snapshot_id and snapshot_hash to settlement record', async () => {
      const liveInstanceResult = await pool.query(
        `SELECT id, entry_fee_cents, payout_structure FROM contest_instances WHERE id = $1`,
        [liveContestId]
      );
      const liveInstance = liveInstanceResult.rows[0];

      const settlementResult = await executeSettlement(
        liveInstance,
        pool,
        snapshotId,
        snapshotHash
      );

      // Verify snapshot binding in settlement_records
      expect(settlementResult.snapshot_id).toBe(snapshotId);
      expect(settlementResult.snapshot_hash).toBe(snapshotHash);

      // Verify persistence in database
      const dbResult = await pool.query(
        `SELECT snapshot_id, snapshot_hash FROM settlement_records WHERE id = $1`,
        [settlementResult.id]
      );
      expect(dbResult.rows[0].snapshot_id).toBe(snapshotId);
      expect(dbResult.rows[0].snapshot_hash).toBe(snapshotHash);
    });

    it('should compute payout distribution correctly for LIVE instance', async () => {
      const liveInstanceResult = await pool.query(
        `SELECT id, entry_fee_cents, payout_structure FROM contest_instances WHERE id = $1`,
        [liveContestId]
      );
      const liveInstance = liveInstanceResult.rows[0];

      const settlementResult = await executeSettlement(
        liveInstance,
        pool,
        snapshotId,
        snapshotHash
      );

      expect(settlementResult.results).toBeTruthy();
      const results = JSON.parse(typeof settlementResult.results === 'string'
        ? settlementResult.results
        : JSON.stringify(settlementResult.results));

      // Assert: Payouts array exists and has entries
      expect(results.payouts).toBeTruthy();
      expect(Array.isArray(results.payouts)).toBe(true);
      expect(results.payouts.length).toBeGreaterThan(0);

      // Assert: First place finisher (our sole participant) gets full prize
      const firstPlacePayout = results.payouts.find(p => p.rank === 1);
      expect(firstPlacePayout).toBeTruthy();
      // Entry fee: $100 (10000 cents), 1 participant = $100 pool
      // 10% rake = $10, 90% distributable = $90 to first place
      const expectedAmount = Math.round((10000 * 0.9) * 1.0); // 100% of distributable pool
      expect(firstPlacePayout.amount_cents).toBe(expectedAmount);
    });
  });
});
