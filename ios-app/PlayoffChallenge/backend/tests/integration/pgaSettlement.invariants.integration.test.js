/**
 * PGA Settlement - Invariant Enforcement Integration Test
 *
 * Uses REAL PostgreSQL test database (not mocks).
 * Validates invariants under actual transaction boundaries:
 * - Row-level locking (SELECT FOR UPDATE)
 * - Idempotency guard (duplicate settlement_records prevented)
 * - No partial writes on error
 *
 * NOT testing logic correctness (covered by unit tests).
 * ONLY testing transactional invariants and boundary enforcement.
 *
 * PREREQUISITES (this test will skip if not met):
 * 1. Set DATABASE_URL_TEST in .env to isolated test database
 * 2. Run: npm run migrate:test
 * 3. Ensure all tables exist: contest_instances, contest_participants, golfer_scores,
 *    settlement_records, contest_templates, users, admin_contest_audit
 *
 * SKIPS AUTOMATICALLY if:
 * - DATABASE_URL_TEST is not configured
 * - Database schema is incomplete (all tests will fail with error, not skip)
 */

const { Pool } = require('pg');
const crypto = require('crypto');
const settlementStrategy = require('../../services/settlementStrategy');
const { ensureGolfMajorTemplate, ensureActiveTemplate } = require('../helpers/templateFactory');

describe('PGA Settlement - Invariant Enforcement (Real DB)', () => {
  let pool;
  let testPool; // For cleanup and setup
  let contestId;
  let templateId;
  let organizerId;
  let participant1Id;
  let participant2Id;

  beforeAll(async () => {
    // Skip if test database not configured
    if (!process.env.DATABASE_URL_TEST) {
      console.warn('⚠️  Skipping PGA settlement invariant tests: DATABASE_URL_TEST not set');
      return;
    }

    pool = new Pool({
      connectionString: process.env.DATABASE_URL_TEST,
      max: 3
    });

    testPool = new Pool({
      connectionString: process.env.DATABASE_URL_TEST,
      max: 2
    });
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (testPool) await testPool.end();
  });

  beforeEach(async () => {
    if (!process.env.DATABASE_URL_TEST) return;

    // Generate test IDs
    contestId = crypto.randomUUID();
    organizerId = crypto.randomUUID();
    participant1Id = crypto.randomUUID();
    participant2Id = crypto.randomUUID();

    // Create users
    await testPool.query(
      `INSERT INTO users (id, email) VALUES ($1, $2)`,
      [organizerId, `organizer-${organizerId}@test.com`]
    );
    await testPool.query(
      `INSERT INTO users (id, email) VALUES ($1, $2)`,
      [participant1Id, `participant1-${participant1Id}@test.com`]
    );
    await testPool.query(
      `INSERT INTO users (id, email) VALUES ($1, $2)`,
      [participant2Id, `participant2-${participant2Id}@test.com`]
    );

    // Create PGA Golf Major template (deterministic, prevents accumulation)
    const template = await ensureGolfMajorTemplate(testPool);
    templateId = template.id;

    // Create contest instance (LIVE status for settlement)
    await testPool.query(
      `INSERT INTO contest_instances
       (id, template_id, organizer_id, status, entry_fee_cents, payout_structure,
        contest_name, max_entries)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        contestId, templateId, organizerId, 'LIVE', 10000,
        JSON.stringify({ '1': 60, '2': 40 }),
        'PGA Test Contest', 100
      ]
    );

    // Add participants
    await testPool.query(
      `INSERT INTO contest_participants (id, contest_instance_id, user_id)
       VALUES ($1, $2, $3)`,
      [crypto.randomUUID(), contestId, participant1Id]
    );
    await testPool.query(
      `INSERT INTO contest_participants (id, contest_instance_id, user_id)
       VALUES ($1, $2, $3)`,
      [crypto.randomUUID(), contestId, participant2Id]
    );

    // Create golfer_scores for both participants (minimal data)
    const golfers1 = ['g1-1', 'g1-2', 'g1-3', 'g1-4', 'g1-5', 'g1-6', 'g1-7'];
    const golfers2 = ['g2-1', 'g2-2', 'g2-3', 'g2-4', 'g2-5', 'g2-6', 'g2-7'];

    for (const golferId of golfers1) {
      // Score across 4 rounds
      for (let round = 1; round <= 4; round++) {
        await testPool.query(
          `INSERT INTO golfer_scores
           (id, contest_instance_id, user_id, golfer_id, round_number, hole_points,
            bonus_points, finish_bonus, total_points)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            crypto.randomUUID(),
            contestId,
            participant1Id,
            golferId,
            round,
            Math.floor(Math.random() * 20) + 5, // 5-25 hole points
            0,
            round === 4 ? 10 : 0, // Finish bonus in round 4 only
            Math.floor(Math.random() * 20) + 5 + (round === 4 ? 10 : 0)
          ]
        );
      }
    }

    for (const golferId of golfers2) {
      // Score across 4 rounds (different scores)
      for (let round = 1; round <= 4; round++) {
        await testPool.query(
          `INSERT INTO golfer_scores
           (id, contest_instance_id, user_id, golfer_id, round_number, hole_points,
            bonus_points, finish_bonus, total_points)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            crypto.randomUUID(),
            contestId,
            participant2Id,
            golferId,
            round,
            Math.floor(Math.random() * 20) + 10, // 10-30 hole points (higher)
            0,
            round === 4 ? 5 : 0, // Finish bonus in round 4 only
            Math.floor(Math.random() * 20) + 10 + (round === 4 ? 5 : 0)
          ]
        );
      }
    }
  });

  afterEach(async () => {
    if (!process.env.DATABASE_URL_TEST) return;

    // Cleanup: Delete in reverse FK order
    try {
      await testPool.query('DELETE FROM golfer_scores WHERE contest_instance_id = $1', [contestId]);
      await testPool.query('DELETE FROM settlement_records WHERE contest_instance_id = $1', [contestId]);
      await testPool.query('DELETE FROM admin_contest_audit WHERE contest_instance_id = $1', [contestId]);
      await testPool.query('DELETE FROM contest_participants WHERE contest_instance_id = $1', [contestId]);
      await testPool.query('DELETE FROM contest_instances WHERE id = $1', [contestId]);
      await testPool.query('DELETE FROM contest_templates WHERE id = $1', [templateId]);
      await testPool.query('DELETE FROM users WHERE id IN ($1, $2, $3)', [organizerId, participant1Id, participant2Id]);
    } catch (err) {
      // Cleanup errors are non-fatal
    }
  });

  describe('Invariant: Row-level locking (SELECT FOR UPDATE)', () => {
    it('should lock contest_instances row during settlement', async () => {
      // Verify that row lock is acquired (by checking lock behavior)
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Manual lock acquisition mimicking executeSettlement
        const lockResult = await client.query(
          'SELECT id, status FROM contest_instances WHERE id = $1 FOR UPDATE',
          [contestId]
        );

        expect(lockResult.rows).toHaveLength(1);
        expect(lockResult.rows[0].id).toBe(contestId);

        await client.query('COMMIT');
      } finally {
        client.release();
      }
    });
  });

  describe('Invariant: Idempotency guard (settlement_records duplicate prevention)', () => {
    it('should prevent duplicate settlement_records for same contest', async () => {
      // First settlement execution
      const client1 = await pool.connect();
      try {
        const contestInstance = {
          id: contestId,
          entry_fee_cents: 10000
        };

        const settlement1 = await settlementStrategy.executeSettlement(contestInstance, pool);

        expect(settlement1).toBeDefined();
        expect(settlement1.contest_instance_id).toBe(contestId);
        const firstHash = settlement1.results_sha256;

        // Verify settlement_records exists
        const check1 = await testPool.query(
          'SELECT COUNT(*) as count FROM settlement_records WHERE contest_instance_id = $1',
          [contestId]
        );
        expect(parseInt(check1.rows[0].count)).toBe(1);

        // Second settlement execution (should be idempotent)
        const settlement2 = await settlementStrategy.executeSettlement(contestInstance, pool);

        expect(settlement2).toBeDefined();
        expect(settlement2.contest_instance_id).toBe(contestId);
        expect(settlement2.results_sha256).toBe(firstHash); // Same hash = same result

        // Verify no duplicate record created
        const check2 = await testPool.query(
          'SELECT COUNT(*) as count FROM settlement_records WHERE contest_instance_id = $1',
          [contestId]
        );
        expect(parseInt(check2.rows[0].count)).toBe(1); // Still only 1 record
      } finally {
        client1.release();
      }
    });

    it('should return existing settlement_records on second call', async () => {
      const contestInstance = {
        id: contestId,
        entry_fee_cents: 10000
      };

      // First call
      const settlement1 = await settlementStrategy.executeSettlement(contestInstance, pool);
      const id1 = settlement1.id;
      const hash1 = settlement1.results_sha256;

      // Second call
      const settlement2 = await settlementStrategy.executeSettlement(contestInstance, pool);
      const id2 = settlement2.id;
      const hash2 = settlement2.results_sha256;

      // Same record returned
      expect(id1).toBe(id2);
      expect(hash1).toBe(hash2);
    });
  });

  describe('Invariant: No partial writes on error', () => {
    it('should rollback all changes if settlement fails', async () => {
      // Create contest with invalid state (no participants)
      const badContestId = crypto.randomUUID();

      // Create bad template with different templateType to avoid collision with main test template
      const badTemplate = await ensureActiveTemplate(testPool, {
        sport: 'golf',
        templateType: 'invalid_strategy_test',  // Intentionally invalid to test error handling
        name: 'Bad Template (Invalid Strategy)',
        scoringKey: 'invalid_strategy',
        lockKey: 'time_based_lock_v1',  // Valid lock key (error is in scoring/settlement)
        settlementKey: 'invalid_strategy',
        allowedPayoutStructures: {},
        entryFeeCents: 10000
      });

      await testPool.query(
        `INSERT INTO contest_instances
         (id, template_id, organizer_id, status, entry_fee_cents, payout_structure,
          contest_name, max_entries)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          badContestId, badTemplate.id, organizerId, 'LIVE', 10000,
          JSON.stringify({}),
          'Bad Contest', 100
        ]
      );

      // Try settlement (should fail due to unknown strategy)
      const badContestInstance = {
        id: badContestId,
        entry_fee_cents: 10000
      };

      try {
        await settlementStrategy.executeSettlement(badContestInstance, pool);
        fail('Expected settlement to throw on unknown strategy');
      } catch (err) {
        expect(err.message).toMatch(/Unknown settlement strategy/);
      }

      // Verify no settlement_records created (transaction rolled back)
      const check = await testPool.query(
        'SELECT COUNT(*) as count FROM settlement_records WHERE contest_instance_id = $1',
        [badContestId]
      );
      expect(parseInt(check.rows[0].count)).toBe(0);

      // Cleanup
      await testPool.query('DELETE FROM contest_instances WHERE id = $1', [badContestId]);
      // Note: bad template no longer deleted; templateFactory handles deactivation
    });
  });

  describe('Invariant: Settlement consistency with contest_instances.settle_time', () => {
    it('should set settle_time exactly once with settlement_records', async () => {
      const contestInstance = {
        id: contestId,
        entry_fee_cents: 10000
      };

      // Verify settle_time is NULL before settlement
      const before = await testPool.query(
        'SELECT settle_time FROM contest_instances WHERE id = $1',
        [contestId]
      );
      expect(before.rows[0].settle_time).toBeNull();

      // Execute settlement
      await settlementStrategy.executeSettlement(contestInstance, pool);

      // Verify settle_time is set
      const after = await testPool.query(
        'SELECT settle_time FROM contest_instances WHERE id = $1',
        [contestId]
      );
      expect(after.rows[0].settle_time).not.toBeNull();

      // Verify settlement_records exists
      const records = await testPool.query(
        'SELECT COUNT(*) as count FROM settlement_records WHERE contest_instance_id = $1',
        [contestId]
      );
      expect(parseInt(records.rows[0].count)).toBe(1);
    });

    it('should throw if settle_time exists but no settlement_records', async () => {
      // Manually set settle_time without settlement_records (data corruption scenario)
      await testPool.query(
        'UPDATE contest_instances SET settle_time = NOW() WHERE id = $1',
        [contestId]
      );

      const contestInstance = {
        id: contestId,
        entry_fee_cents: 10000
      };

      // Try settlement (should detect inconsistency)
      try {
        await settlementStrategy.executeSettlement(contestInstance, pool);
        fail('Expected settlement to throw on inconsistent state');
      } catch (err) {
        expect(err.message).toMatch(/INCONSISTENT_STATE/);
      }
    });
  });

  describe('Invariant: SYSTEM audit record created', () => {
    it('should create admin_contest_audit record for settlement', async () => {
      const contestInstance = {
        id: contestId,
        entry_fee_cents: 10000
      };

      await settlementStrategy.executeSettlement(contestInstance, pool);

      // Verify audit record exists
      const audit = await testPool.query(
        `SELECT * FROM admin_contest_audit
         WHERE contest_instance_id = $1 AND action = $2`,
        [contestId, 'system_settlement_complete']
      );

      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0].admin_user_id).toBe('00000000-0000-0000-0000-000000000000'); // SYSTEM_USER_ID
      expect(audit.rows[0].reason).toBe('Settlement executed successfully');
    });
  });

  describe('Invariant: PGA settlement strategy dispatch from template', () => {
    it('should load settlement_strategy_key from contest template', async () => {
      // Template has settlement_strategy_key = 'pga_standard_v1'
      const contestInstance = {
        id: contestId,
        entry_fee_cents: 10000
      };

      // executeSettlement should dispatch to pgaSettlementFn (via settlementRegistry)
      const settlement = await settlementStrategy.executeSettlement(contestInstance, pool);

      expect(settlement).toBeDefined();
      expect(settlement.results).toBeDefined();

      // Results should contain rankings and payouts (PGA settlement output)
      // JSONB columns return as objects; handle both string and object
      const results = typeof settlement.results === 'string'
        ? JSON.parse(settlement.results)
        : settlement.results;
      expect(results).toHaveProperty('rankings');
      expect(results).toHaveProperty('payouts');
      expect(Array.isArray(results.rankings)).toBe(true);
      expect(Array.isArray(results.payouts)).toBe(true);
    });
  });

  describe('Invariant: Results hash immutability', () => {
    it('should compute and store SHA-256 hash for results', async () => {
      const contestInstance = {
        id: contestId,
        entry_fee_cents: 10000
      };

      const settlement = await settlementStrategy.executeSettlement(contestInstance, pool);

      // Verify hash is present
      expect(settlement.results_sha256).toBeDefined();
      expect(settlement.results_sha256).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex format

      // Verify hash can be validated
      const crypto = require('crypto');
      const resultsParsed = typeof settlement.results === 'string'
        ? JSON.parse(settlement.results)
        : settlement.results;
      const computed = crypto.createHash('sha256')
        .update(JSON.stringify(settlementStrategy.canonicalizeJson(resultsParsed)))
        .digest('hex');

      expect(settlement.results_sha256).toBe(computed);
    });
  });
});
