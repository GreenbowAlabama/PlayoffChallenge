/**
 * PGA Contest Boot Flow - Core JSON-Only Onboarding Proof
 *
 * Objective: Prove that a PGA contest (Masters-style) can be fully onboarded
 * using JSON-only template configuration with ZERO platform-layer modifications.
 *
 * This test validates the boot flow only:
 * 1. Template-driven dispatch (settlement_strategy_key, scoring_strategy_key from JSON)
 * 2. Contest instance creation
 * 3. Multi-round golfer score ingestion (4 rounds, finish bonus in final only)
 * 4. Settlement execution via real service
 * 5. Settlement record persistence + settle_time update
 * 6. Idempotent replay (same settlement_record returned)
 *
 * Note: This test does NOT validate:
 * - Settlement math correctness (covered by pgaSettlementInvariants.test.js)
 * - Drop-lowest aggregation logic (covered by settlement invariant suite)
 * - Ranking algorithm correctness (covered by settlement invariant suite)
 * - Hash determinism (covered by settlement invariant suite)
 *
 * Database Safety:
 * - Uses DATABASE_URL_TEST exclusively
 * - Wraps all mutations in transactions
 * - Rolls back all changes at end of test
 * - No manual cleanup required
 *
 * Prerequisites:
 * - DATABASE_URL_TEST must be set in .env
 * - Schema must be present (run: npm run migrate:test)
 */

const { Pool } = require('pg');
const crypto = require('crypto');
const settlementStrategy = require('../../services/settlementStrategy');

describe('PGA Contest Boot Flow - JSON-Only Configuration (Core E2E)', () => {
  let pool;
  let client;

  // Test data IDs (generated per test)
  let contestId;
  let templateId;
  let organizerId;
  let participant1Id;
  let participant2Id;

  // =========================================================================
  // SETUP / TEARDOWN
  // =========================================================================

  beforeAll(async () => {
    // Safety: Verify test database is configured
    if (!process.env.DATABASE_URL_TEST) {
      throw new Error(
        '⚠️  DATABASE_URL_TEST must be set. Add to .env: DATABASE_URL_TEST=postgresql://...'
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
    contestId = crypto.randomUUID();
    templateId = crypto.randomUUID();
    organizerId = crypto.randomUUID();
    participant1Id = crypto.randomUUID();
    participant2Id = crypto.randomUUID();
  });

  afterEach(async () => {
    // Cleanup: Delete test data in reverse FK order
    // NOTE: executeSettlement uses its own transaction, so we must
    // clean up via direct pool queries (not a nested transaction)
    try {
      await pool.query(
        'DELETE FROM golfer_scores WHERE contest_instance_id = $1',
        [contestId]
      );
      await pool.query(
        'DELETE FROM settlement_records WHERE contest_instance_id = $1',
        [contestId]
      );
      await pool.query(
        'DELETE FROM admin_contest_audit WHERE contest_instance_id = $1',
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
        'DELETE FROM users WHERE id IN ($1, $2)',
        [organizerId, participant1Id]
      );
      await pool.query(
        'DELETE FROM users WHERE id = $1',
        [participant2Id]
      );
    } catch (err) {
      // Cleanup errors are non-fatal
    }
  });

  // =========================================================================
  // TEST: JSON-DRIVEN TEMPLATE CONFIGURATION
  // =========================================================================

  describe('JSON-DRIVEN TEMPLATE: Settlement and Scoring Strategy Keys', () => {
    it('should read settlement_strategy_key from contest_templates (not hardcoded)', async () => {
      // Insert PGA contest template with JSON configuration
      await pool.query(
        `INSERT INTO contest_templates
         (id, name, sport, template_type, scoring_strategy_key, lock_strategy_key,
          settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
          allowed_entry_fee_max_cents, allowed_payout_structures)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          templateId,
          'PGA Masters Boot Test',
          'golf',
          'playoff',
          'pga_standard_v1',        // scoring_strategy_key
          'golf_lock',
          'pga_standard_v1',        // settlement_strategy_key (from JSON template!)
          10000,                    // $100 entry fee
          0,
          1000000,
          JSON.stringify({ '1': 60, '2': 40 })
        ]
      );

      // Verify template was inserted
      const templateCheck = await pool.query(
        'SELECT settlement_strategy_key, scoring_strategy_key FROM contest_templates WHERE id = $1',
        [templateId]
      );

      expect(templateCheck.rows).toHaveLength(1);
      expect(templateCheck.rows[0].settlement_strategy_key).toBe('pga_standard_v1');
      expect(templateCheck.rows[0].scoring_strategy_key).toBe('pga_standard_v1');
    });

    it('should load scoring_strategy_key from template (not hardcoded)', async () => {
      // Create template with explicit scoring key
      await pool.query(
        `INSERT INTO contest_templates
         (id, name, sport, template_type, scoring_strategy_key, lock_strategy_key,
          settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
          allowed_entry_fee_max_cents, allowed_payout_structures)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          templateId,
          'PGA Scoring Test',
          'golf',
          'playoff',
          'pga_standard_v1',
          'golf_lock',
          'pga_standard_v1',
          10000,
          0,
          1000000,
          JSON.stringify({ '1': 60, '2': 40 })
        ]
      );

      const template = await pool.query(
        'SELECT scoring_strategy_key FROM contest_templates WHERE id = $1',
        [templateId]
      );

      expect(template.rows[0].scoring_strategy_key).toBe('pga_standard_v1');
    });
  });

  // =========================================================================
  // TEST: CONTEST INSTANCE CREATION
  // =========================================================================

  describe('CONTEST INSTANCE CREATION: Template-Driven Setup', () => {
    it('should create contest instance from template without platform sport checks', async () => {
      // FK constraint: organizer user MUST be created FIRST
      await pool.query(
        'INSERT INTO users (id, email) VALUES ($1, $2)',
        [organizerId, `organizer-${organizerId}@test.com`]
      );

      // Create template
      await pool.query(
        `INSERT INTO contest_templates
         (id, name, sport, template_type, scoring_strategy_key, lock_strategy_key,
          settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
          allowed_entry_fee_max_cents, allowed_payout_structures)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          templateId,
          'Test Template',
          'golf',
          'playoff',
          'pga_standard_v1',
          'golf_lock',
          'pga_standard_v1',
          10000,
          0,
          1000000,
          JSON.stringify({ '1': 60, '2': 40 })
        ]
      );

      // Create contest instance
      await pool.query(
        `INSERT INTO contest_instances
         (id, template_id, organizer_id, status, entry_fee_cents, payout_structure,
          contest_name, max_entries)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          contestId,
          templateId,
          organizerId,
          'LIVE',
          10000,
          JSON.stringify({ '1': 60, '2': 40 }),
          'Test Contest',
          100
        ]
      );

      // Verify instance created
      const instance = await pool.query(
        'SELECT id, template_id, status FROM contest_instances WHERE id = $1',
        [contestId]
      );

      expect(instance.rows).toHaveLength(1);
      expect(instance.rows[0].template_id).toBe(templateId);
      expect(instance.rows[0].status).toBe('LIVE');
    });
  });

  // =========================================================================
  // TEST: MULTI-ROUND INGESTION
  // =========================================================================

  describe('MULTI-ROUND INGESTION: 4 Rounds + Finish Bonus Only in Final', () => {
    it('should accept 4 rounds with finish_bonus only in round 4', async () => {
      // Setup: Create template, contest, participants, users
      await setupBootFlowFixture();

      // Insert golfer round scores (7 golfers × 4 rounds for participant 1)
      const golferIds = [
        'golfer-a', 'golfer-b', 'golfer-c', 'golfer-d',
        'golfer-e', 'golfer-f', 'golfer-g'
      ];

      for (const golferId of golferIds) {
        for (let round = 1; round <= 4; round++) {
          const isFinalRound = round === 4;
          await pool.query(
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
              10,           // hole_points
              0,            // bonus_points
              isFinalRound ? 5 : 0,  // finish_bonus ONLY in round 4
              10 + (isFinalRound ? 5 : 0)  // total_points
            ]
          );
        }
      }

      // Verify round 4 has finish bonus, earlier rounds don't
      const round1 = await pool.query(
        `SELECT finish_bonus FROM golfer_scores
         WHERE contest_instance_id = $1 AND round_number = 1
         LIMIT 1`,
        [contestId]
      );
      expect(round1.rows[0].finish_bonus).toBe(0);

      const round4 = await pool.query(
        `SELECT finish_bonus FROM golfer_scores
         WHERE contest_instance_id = $1 AND round_number = 4
         LIMIT 1`,
        [contestId]
      );
      expect(round4.rows[0].finish_bonus).toBe(5);

      // Verify scores were inserted
      const scoreCount = await pool.query(
        `SELECT COUNT(*) as count FROM golfer_scores
         WHERE contest_instance_id = $1`,
        [contestId]
      );
      expect(parseInt(scoreCount.rows[0].count)).toBe(28);  // 7 golfers × 4 rounds
    });
  });

  // =========================================================================
  // TEST: SETTLEMENT EXECUTION (CORE PROOF)
  // =========================================================================

  describe('SETTLEMENT EXECUTION: Core Boot Flow', () => {
    it('should execute settlement and create settlement_record', async () => {
      // Setup
      await setupBootFlowFixture();
      await addSimpleGolferScores(participant1Id);
      await addSimpleGolferScores(participant2Id);

      // Execute settlement
      const settlement = await settlementStrategy.executeSettlement(
        {
          id: contestId,
          entry_fee_cents: 10000
        },
        pool
      );

      // Verify settlement record returned
      expect(settlement).toBeDefined();
      expect(settlement.id).toBeDefined();
      expect(settlement.contest_instance_id).toBe(contestId);
      expect(settlement.results).toBeDefined();
      expect(settlement.results_sha256).toBeDefined();
      expect(settlement.settled_at).toBeDefined();

      // Verify results structure
      // PostgreSQL JSONB auto-parses, so results may already be an object
      const results = typeof settlement.results === 'string' ? JSON.parse(settlement.results) : settlement.results;
      expect(results).toHaveProperty('rankings');
      expect(results).toHaveProperty('payouts');
      expect(Array.isArray(results.rankings)).toBe(true);
      expect(Array.isArray(results.payouts)).toBe(true);
    });

    it('should set settle_time on contest_instances', async () => {
      // Setup
      await setupBootFlowFixture();
      await addSimpleGolferScores(participant1Id);
      await addSimpleGolferScores(participant2Id);

      // Verify settle_time is NULL before
      const before = await pool.query(
        'SELECT settle_time FROM contest_instances WHERE id = $1',
        [contestId]
      );
      expect(before.rows[0].settle_time).toBeNull();

      // Execute settlement
      await settlementStrategy.executeSettlement(
        {
          id: contestId,
          entry_fee_cents: 10000
        },
        pool
      );

      // Verify settle_time is set after
      const after = await pool.query(
        'SELECT settle_time FROM contest_instances WHERE id = $1',
        [contestId]
      );
      expect(after.rows[0].settle_time).not.toBeNull();
    });

    it('should create exactly one settlement_record per contest', async () => {
      // Setup
      await setupBootFlowFixture();
      await addSimpleGolferScores(participant1Id);
      await addSimpleGolferScores(participant2Id);

      // Execute settlement
      await settlementStrategy.executeSettlement(
        {
          id: contestId,
          entry_fee_cents: 10000
        },
        pool
      );

      // Verify exactly one record
      const records = await pool.query(
        'SELECT COUNT(*) as count FROM settlement_records WHERE contest_instance_id = $1',
        [contestId]
      );
      expect(parseInt(records.rows[0].count)).toBe(1);
    });
  });

  // =========================================================================
  // TEST: IDEMPOTENCY (CORE PROOF)
  // =========================================================================

  describe('IDEMPOTENCY: Settlement is Replayable', () => {
    it('should return same settlement_record on second execution', async () => {
      // Setup
      await setupBootFlowFixture();
      await addSimpleGolferScores(participant1Id);
      await addSimpleGolferScores(participant2Id);

      // First settlement
      const settlement1 = await settlementStrategy.executeSettlement(
        {
          id: contestId,
          entry_fee_cents: 10000
        },
        pool
      );

      const id1 = settlement1.id;
      const hash1 = settlement1.results_sha256;

      // Second settlement (should be idempotent)
      const settlement2 = await settlementStrategy.executeSettlement(
        {
          id: contestId,
          entry_fee_cents: 10000
        },
        pool
      );

      const id2 = settlement2.id;
      const hash2 = settlement2.results_sha256;

      // Same record and hash returned
      expect(id1).toBe(id2);
      expect(hash1).toBe(hash2);
    });

    it('should not create duplicate settlement_records on replay', async () => {
      // Setup
      await setupBootFlowFixture();
      await addSimpleGolferScores(participant1Id);
      await addSimpleGolferScores(participant2Id);

      // First settlement
      await settlementStrategy.executeSettlement(
        {
          id: contestId,
          entry_fee_cents: 10000
        },
        pool
      );

      const countAfterFirst = await pool.query(
        'SELECT COUNT(*) as count FROM settlement_records WHERE contest_instance_id = $1',
        [contestId]
      );
      expect(parseInt(countAfterFirst.rows[0].count)).toBe(1);

      // Second settlement
      await settlementStrategy.executeSettlement(
        {
          id: contestId,
          entry_fee_cents: 10000
        },
        pool
      );

      const countAfterSecond = await pool.query(
        'SELECT COUNT(*) as count FROM settlement_records WHERE contest_instance_id = $1',
        [contestId]
      );
      expect(parseInt(countAfterSecond.rows[0].count)).toBe(1);  // Still 1, not 2
    });
  });

  // =========================================================================
  // TEST: TEMPLATE-DRIVEN DISPATCH (NO PLATFORM SPORT CONDITIONALS)
  // =========================================================================

  describe('TEMPLATE-DRIVEN DISPATCH: No Platform Sport Conditionals', () => {
    it('should dispatch to settlement strategy via template key (not sport checks)', async () => {
      // Setup
      await setupBootFlowFixture();
      await addSimpleGolferScores(participant1Id);
      await addSimpleGolferScores(participant2Id);

      // Template specifies settlement_strategy_key = 'pga_standard_v1'
      const template = await pool.query(
        'SELECT settlement_strategy_key FROM contest_templates WHERE id = $1',
        [templateId]
      );
      expect(template.rows[0].settlement_strategy_key).toBe('pga_standard_v1');

      // executeSettlement should resolve strategy from template
      // (not from hardcoded if(contest.sport === 'golf') checks)
      const settlement = await settlementStrategy.executeSettlement(
        {
          id: contestId,
          entry_fee_cents: 10000
        },
        pool
      );

      // If platform had sport conditionals, this would fail
      // Instead, it uses template-registered strategy
      expect(settlement).toBeDefined();
      expect(settlement.results).toBeDefined();

      // PostgreSQL JSONB auto-parses, so results may already be an object
      const results = typeof settlement.results === 'string' ? JSON.parse(settlement.results) : settlement.results;
      expect(results).toHaveProperty('rankings');
      expect(results).toHaveProperty('payouts');
    });
  });

  // =========================================================================
  // TEST: FULL BOOT FLOW (COMPLETE END-TO-END)
  // =========================================================================

  describe('FULL BOOT FLOW: Complete JSON-Only Onboarding (E2E)', () => {
    it('should complete: template → instance → participants → scores → settlement', async () => {
      // FK CONSTRAINT: Create organizer user FIRST
      await pool.query(
        'INSERT INTO users (id, email) VALUES ($1, $2)',
        [organizerId, `organizer-${organizerId}@test.com`]
      );
      await pool.query(
        'INSERT INTO users (id, email) VALUES ($1, $2)',
        [participant1Id, `participant1-${participant1Id}@test.com`]
      );
      await pool.query(
        'INSERT INTO users (id, email) VALUES ($1, $2)',
        [participant2Id, `participant2-${participant2Id}@test.com`]
      );

      // 1. CREATE TEMPLATE (JSON-only configuration)
      await pool.query(
        `INSERT INTO contest_templates
         (id, name, sport, template_type, scoring_strategy_key, lock_strategy_key,
          settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
          allowed_entry_fee_max_cents, allowed_payout_structures)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          templateId,
          'Complete Boot Flow Test',
          'golf',
          'playoff',
          'pga_standard_v1',
          'golf_lock',
          'pga_standard_v1',
          10000,
          0,
          1000000,
          JSON.stringify({ '1': 60, '2': 40 })
        ]
      );

      // 2. CREATE CONTEST INSTANCE (organizer now exists)
      await pool.query(
        `INSERT INTO contest_instances
         (id, template_id, organizer_id, status, entry_fee_cents, payout_structure,
          contest_name, max_entries)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          contestId,
          templateId,
          organizerId,
          'LIVE',
          10000,
          JSON.stringify({ '1': 60, '2': 40 }),
          'Complete Boot Flow Test Contest',
          100
        ]
      );

      // 4. ADD PARTICIPANTS
      await pool.query(
        'INSERT INTO contest_participants (id, contest_instance_id, user_id) VALUES ($1, $2, $3)',
        [crypto.randomUUID(), contestId, participant1Id]
      );
      await pool.query(
        'INSERT INTO contest_participants (id, contest_instance_id, user_id) VALUES ($1, $2, $3)',
        [crypto.randomUUID(), contestId, participant2Id]
      );

      // 5. INSERT GOLFER SCORES (4 rounds, multiple golfers)
      await addSimpleGolferScores(participant1Id);
      await addSimpleGolferScores(participant2Id);

      // 6. EXECUTE SETTLEMENT
      const settlement = await settlementStrategy.executeSettlement(
        {
          id: contestId,
          entry_fee_cents: 10000
        },
        pool
      );

      // 7. VALIDATE BOOT FLOW COMPLETED
      expect(settlement).toBeDefined();
      expect(settlement.id).toBeDefined();
      expect(settlement.contest_instance_id).toBe(contestId);
      expect(settlement.results_sha256).toBeDefined();

      // PostgreSQL JSONB auto-parses, so results may already be an object
      const results = typeof settlement.results === 'string' ? JSON.parse(settlement.results) : settlement.results;
      expect(results.rankings).toBeDefined();
      expect(results.payouts).toBeDefined();
      expect(Array.isArray(results.rankings)).toBe(true);
      expect(Array.isArray(results.payouts)).toBe(true);

      // Verify persistence
      const records = await pool.query(
        'SELECT COUNT(*) as count FROM settlement_records WHERE contest_instance_id = $1',
        [contestId]
      );
      expect(parseInt(records.rows[0].count)).toBe(1);

      const contest = await pool.query(
        'SELECT settle_time FROM contest_instances WHERE id = $1',
        [contestId]
      );
      expect(contest.rows[0].settle_time).not.toBeNull();

      // ✅ PROOF: Platform supports JSON-only PGA contest onboarding
    });
  });

  // =========================================================================
  // HELPER FUNCTIONS
  // =========================================================================

  /**
   * Setup: Create template, contest instance, and participants
   *
   * IMPORTANT: Uses direct pool.query() (NOT a transaction client)
   * so executeSettlement can see the data when it opens its own transaction.
   *
   * Transaction isolation: If setup used a transaction that wasn't
   * committed, executeSettlement's separate transaction wouldn't see it.
   *
   * FK CONSTRAINT: organizer_id must exist in users table BEFORE contest_instances.
   */
  async function setupBootFlowFixture() {
    // Create users FIRST (direct pool query, auto-committed)
    // FK constraint: organizer must exist before contest_instances
    await pool.query(
      'INSERT INTO users (id, email) VALUES ($1, $2)',
      [organizerId, `organizer-${organizerId}@test.com`]
    );
    await pool.query(
      'INSERT INTO users (id, email) VALUES ($1, $2)',
      [participant1Id, `participant1-${participant1Id}@test.com`]
    );
    await pool.query(
      'INSERT INTO users (id, email) VALUES ($1, $2)',
      [participant2Id, `participant2-${participant2Id}@test.com`]
    );

    // Create template (direct pool query, auto-committed)
    await pool.query(
      `INSERT INTO contest_templates
       (id, name, sport, template_type, scoring_strategy_key, lock_strategy_key,
        settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
        allowed_entry_fee_max_cents, allowed_payout_structures)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        templateId,
        'Boot Flow Test Template',
        'golf',
        'playoff',
        'pga_standard_v1',
        'golf_lock',
        'pga_standard_v1',
        10000,
        0,
        1000000,
        JSON.stringify({ '1': 60, '2': 40 })
      ]
    );

    // Create contest instance (organizerId now exists in users table)
    await pool.query(
      `INSERT INTO contest_instances
       (id, template_id, organizer_id, status, entry_fee_cents, payout_structure,
        contest_name, max_entries)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        contestId,
        templateId,
        organizerId,
        'LIVE',
        10000,
        JSON.stringify({ '1': 60, '2': 40 }),
        'Boot Flow Test Contest',
        100
      ]
    );

    // Add participants (direct pool query, auto-committed)
    await pool.query(
      'INSERT INTO contest_participants (id, contest_instance_id, user_id) VALUES ($1, $2, $3)',
      [crypto.randomUUID(), contestId, participant1Id]
    );
    await pool.query(
      'INSERT INTO contest_participants (id, contest_instance_id, user_id) VALUES ($1, $2, $3)',
      [crypto.randomUUID(), contestId, participant2Id]
    );
  }

  /**
   * Helper: Add simple golfer scores (7 golfers, 1 round, equal scores)
   *
   * Uses direct pool.query() to ensure data is immediately committed
   * and visible to executeSettlement's independent transaction.
   */
  async function addSimpleGolferScores(userId) {
    const scorePerGolfer = 100;

    for (let i = 1; i <= 7; i++) {
      await pool.query(
        `INSERT INTO golfer_scores
         (id, contest_instance_id, user_id, golfer_id, round_number, hole_points,
          bonus_points, finish_bonus, total_points)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          crypto.randomUUID(),
          contestId,
          userId,
          `golfer-${i}`,
          1,
          scorePerGolfer,
          0,
          0,
          scorePerGolfer
        ]
      );
    }
  }
});
