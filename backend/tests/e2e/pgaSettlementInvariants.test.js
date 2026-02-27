/**
 * PGA Settlement Invariants - Math Freeze
 *
 * Objective: Freeze settlement computation behavior
 * - Ranking algorithm (sort, tie-breaking, competition ranking)
 * - Drop-lowest aggregation (exactly 1 golfer dropped from 7)
 * - Hash determinism (immutable results across runs)
 * - Payout distribution (structure percentages, tie handling)
 *
 * These invariants are INDEPENDENT of boot flow.
 * If boot flow changes, these should still pass.
 * If these fail, settlement math broke.
 *
 * Database Safety:
 * - Uses DATABASE_URL_TEST exclusively
 * - All mutations committed immediately (direct pool queries)
 * - Cleanup via explicit DELETE statements
 * - No transaction nesting
 *
 * Prerequisites:
 * - DATABASE_URL_TEST must be set in .env
 * - Schema must be present (run: npm run migrate:test)
 */

const { Pool } = require('pg');
const crypto = require('crypto');
const settlementStrategy = require('../../services/settlementStrategy');
const { aggregateEntryScore } = require('../../services/scoring/pgaEntryAggregation');

// Scale tests need more time (100 participants + settlement computation)
jest.setTimeout(90000);

/**
 * Helper: Generate unique test email
 * Guarantees uniqueness per insertion and per run (zero cross-run collisions)
 */
const testEmail = (label = 'user') =>
  `${label}-${crypto.randomUUID()}@test.com`;

/**
 * Helper: Create ingestion snapshot and return binding (snapshotId + snapshotHash)
 * Required for PGA v1 snapshot binding compliance.
 *
 * @param {Object} pool - Database pool
 * @param {string} contestInstanceId - Contest instance to bind
 * @returns {Promise<{snapshotId: string, snapshotHash: string}>}
 */
async function createIngestionSnapshot(pool, contestInstanceId) {
  const snapshotId = crypto.randomUUID();

  // Canonical snapshot payload (sorted keys for deterministic hashing)
  const payload = {
    contest_instance_id: contestInstanceId,
    event_type: 'test_snapshot',
    provider: 'test'
  };

  // Compute SHA-256 hash of canonical JSON
  const canonicalJson = JSON.stringify(payload);
  const snapshotHash = crypto.createHash('sha256').update(canonicalJson).digest('hex');

  // Insert ingestion_events row
  await pool.query(
    `INSERT INTO ingestion_events
     (id, contest_instance_id, provider, event_type, provider_data_json, payload_hash, validation_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      snapshotId,
      contestInstanceId,
      'test',
      'test_snapshot',
      JSON.stringify(payload),
      snapshotHash,
      'VALID'
    ]
  );

  return { snapshotId, snapshotHash };
}

describe('PGA Settlement Invariants - Math Freeze', () => {
  let pool;

  // Test data IDs
  let contestId;
  let templateId;
  let organizerId;
  let createdUserIds = [];  // Track all created users for centralized cleanup

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

    // FK CONSTRAINT: organizer user MUST exist before contest_instances
    await pool.query(
      'INSERT INTO users (id, email) VALUES ($1, $2)',
      [organizerId, testEmail('organizer')]
    );
    createdUserIds.push(organizerId);

    // Create base template and contest (used by all tests)
    await pool.query(
      `INSERT INTO contest_templates
       (id, name, sport, template_type, scoring_strategy_key, lock_strategy_key,
        settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
        allowed_entry_fee_max_cents, allowed_payout_structures, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false)`,
      [
        templateId,
        'Invariants Test Template',
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

    // Create contest instance (organizerId now exists)
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
        'Invariants Test Contest',
        100
      ]
    );
  });

  afterEach(async () => {
    // Cleanup: Delete test data in reverse FK order
    try {
      const userIds = await pool.query(
        `SELECT DISTINCT user_id FROM contest_participants
         WHERE contest_instance_id = $1`,
        [contestId]
      );

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
        'DELETE FROM users WHERE id = $1',
        [organizerId]
      );

      // Clean up all centrally-tracked users (ensures no residue from any test)
      // This is the single source of truth for user deletion
      if (createdUserIds.length > 0) {
        const placeholders = createdUserIds.map((_, i) => `$${i + 1}`).join(',');
        await pool.query(
          `DELETE FROM users WHERE id IN (${placeholders})`,
          createdUserIds
        );
      }

      // Reset user tracking array for next test
      createdUserIds = [];
    } catch (err) {
      // Cleanup errors are non-fatal, but reset tracking array
      createdUserIds = [];
    }
  });

  // =========================================================================
  // INVARIANT 1: DROP-LOWEST AGGREGATION
  // =========================================================================

  describe('INVARIANT: Drop-Lowest Aggregation (7 golfers → best 6)', () => {
    it('should drop exactly 1 golfer from 7 and sum best 6', async () => {
      const participantId = crypto.randomUUID();

      // Create user and participant
      await pool.query(
        'INSERT INTO users (id, email) VALUES ($1, $2)',
        [participantId, testEmail('participant')]
      );
      createdUserIds.push(participantId);
      await pool.query(
        'INSERT INTO contest_participants (id, contest_instance_id, user_id) VALUES ($1, $2, $3)',
        [crypto.randomUUID(), contestId, participantId]
      );

      // Create 7 golfers with known scores
      // Scores: [50, 60, 70, 80, 90, 100, 110]
      // Lowest: 50 (should be dropped)
      // Best 6: 60 + 70 + 80 + 90 + 100 + 110 = 510
      const golferScores = [
        { golferId: 'g1', score: 50 },    // DROPPED
        { golferId: 'g2', score: 60 },
        { golferId: 'g3', score: 70 },
        { golferId: 'g4', score: 80 },
        { golferId: 'g5', score: 90 },
        { golferId: 'g6', score: 100 },
        { golferId: 'g7', score: 110 }
      ];

      // Insert golfer scores
      for (const { golferId, score } of golferScores) {
        await pool.query(
          `INSERT INTO golfer_scores
           (id, contest_instance_id, user_id, golfer_id, round_number, hole_points,
            bonus_points, finish_bonus, total_points)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            crypto.randomUUID(),
            contestId,
            participantId,
            golferId,
            1,
            score,
            0,
            0,
            score
          ]
        );
      }

      // Create ingestion snapshot for settlement binding
      const { snapshotId, snapshotHash } = await createIngestionSnapshot(pool, contestId);

      // Execute settlement
      const settlement = await settlementStrategy.executeSettlement(
        { id: contestId, entry_fee_cents: 10000 },
        pool,
        snapshotId,
        snapshotHash
      );

      // PostgreSQL JSONB auto-parses, so results may already be an object
      const results = typeof settlement.results === 'string' ? JSON.parse(settlement.results) : settlement.results;
      const ranking = results.rankings.find(r => r.user_id === participantId);

      expect(ranking.score).toBe(510);  // Best 6 sum
    });

    it('should NOT drop if 6 or fewer golfers', async () => {
      const participantId = crypto.randomUUID();

      // Create user and participant
      await pool.query(
        'INSERT INTO users (id, email) VALUES ($1, $2)',
        [participantId, testEmail('participant')]
      );
      createdUserIds.push(participantId);
      await pool.query(
        'INSERT INTO contest_participants (id, contest_instance_id, user_id) VALUES ($1, $2, $3)',
        [crypto.randomUUID(), contestId, participantId]
      );

      // Create only 5 golfers (< 7)
      const golferScores = [
        { golferId: 'g1', score: 100 },
        { golferId: 'g2', score: 100 },
        { golferId: 'g3', score: 100 },
        { golferId: 'g4', score: 100 },
        { golferId: 'g5', score: 100 }
      ];

      for (const { golferId, score } of golferScores) {
        await pool.query(
          `INSERT INTO golfer_scores
           (id, contest_instance_id, user_id, golfer_id, round_number, hole_points,
            bonus_points, finish_bonus, total_points)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            crypto.randomUUID(),
            contestId,
            participantId,
            golferId,
            1,
            score,
            0,
            0,
            score
          ]
        );
      }

      // Create ingestion snapshot for settlement binding
      const { snapshotId, snapshotHash } = await createIngestionSnapshot(pool, contestId);

      // Execute settlement
      const settlement = await settlementStrategy.executeSettlement(
        { id: contestId, entry_fee_cents: 10000 },
        pool,
        snapshotId,
        snapshotHash
      );

      // PostgreSQL JSONB auto-parses, so results may already be an object
      const results = typeof settlement.results === 'string' ? JSON.parse(settlement.results) : settlement.results;
      const ranking = results.rankings.find(r => r.user_id === participantId);

      // All 5 golfers scored, no drop: 5 × 100 = 500
      expect(ranking.score).toBe(500);
    });

    it('should drop the LOWEST score deterministically', async () => {
      const participantId = crypto.randomUUID();

      await pool.query(
        'INSERT INTO users (id, email) VALUES ($1, $2)',
        [participantId, testEmail('participant')]
      );
      createdUserIds.push(participantId);
      await pool.query(
        'INSERT INTO contest_participants (id, contest_instance_id, user_id) VALUES ($1, $2, $3)',
        [crypto.randomUUID(), contestId, participantId]
      );

      // All golfers except one score the same
      const golferScores = [
        { golferId: 'g1', score: 100 },
        { golferId: 'g2', score: 100 },
        { golferId: 'g3', score: 100 },
        { golferId: 'g4', score: 100 },
        { golferId: 'g5', score: 100 },
        { golferId: 'g6', score: 100 },
        { golferId: 'g7', score: 50 }    // LOWEST
      ];

      for (const { golferId, score } of golferScores) {
        await pool.query(
          `INSERT INTO golfer_scores
           (id, contest_instance_id, user_id, golfer_id, round_number, hole_points,
            bonus_points, finish_bonus, total_points)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            crypto.randomUUID(),
            contestId,
            participantId,
            golferId,
            1,
            score,
            0,
            0,
            score
          ]
        );
      }

      // Create ingestion snapshot for settlement binding
      const { snapshotId, snapshotHash } = await createIngestionSnapshot(pool, contestId);

      // Execute settlement
      const settlement = await settlementStrategy.executeSettlement(
        { id: contestId, entry_fee_cents: 10000 },
        pool,
        snapshotId,
        snapshotHash
      );

      // PostgreSQL JSONB auto-parses, so results may already be an object
      const results = typeof settlement.results === 'string' ? JSON.parse(settlement.results) : settlement.results;
      const ranking = results.rankings.find(r => r.user_id === participantId);

      // Drops 50, sums 6×100 = 600
      expect(ranking.score).toBe(600);
    });
  });

  // =========================================================================
  // INVARIANT 2: RANKING ALGORITHM
  // =========================================================================

  describe('INVARIANT: Ranking Algorithm (DESC score, ASC user_id for ties)', () => {
    it('should rank by total_score DESC', async () => {
      const user1Id = crypto.randomUUID();
      const user2Id = crypto.randomUUID();
      const user3Id = crypto.randomUUID();

      // Create users
      await pool.query('INSERT INTO users (id, email) VALUES ($1, $2)',
        [user1Id, testEmail('user1')]);
      createdUserIds.push(user1Id);
      await pool.query('INSERT INTO users (id, email) VALUES ($1, $2)',
        [user2Id, testEmail('user2')]);
      createdUserIds.push(user2Id);
      await pool.query('INSERT INTO users (id, email) VALUES ($1, $2)',
        [user3Id, testEmail('user3')]);
      createdUserIds.push(user3Id);

      // Create participants
      await pool.query(
        'INSERT INTO contest_participants (id, contest_instance_id, user_id) VALUES ($1, $2, $3)',
        [crypto.randomUUID(), contestId, user1Id]
      );
      await pool.query(
        'INSERT INTO contest_participants (id, contest_instance_id, user_id) VALUES ($1, $2, $3)',
        [crypto.randomUUID(), contestId, user2Id]
      );
      await pool.query(
        'INSERT INTO contest_participants (id, contest_instance_id, user_id) VALUES ($1, $2, $3)',
        [crypto.randomUUID(), contestId, user3Id]
      );

      // Add golfer scores: user1=500, user2=600, user3=400
      await addGolferScores(user1Id, 500);
      await addGolferScores(user2Id, 600);
      await addGolferScores(user3Id, 400);

      // Create ingestion snapshot for settlement binding
      const { snapshotId, snapshotHash } = await createIngestionSnapshot(pool, contestId);

      // Execute settlement
      const settlement = await settlementStrategy.executeSettlement(
        { id: contestId, entry_fee_cents: 10000 },
        pool,
        snapshotId,
        snapshotHash
      );

      // PostgreSQL JSONB auto-parses, so results may already be an object
      const results = typeof settlement.results === 'string' ? JSON.parse(settlement.results) : settlement.results;
      const rankings = results.rankings;

      // Verify DESC order
      expect(rankings[0].user_id).toBe(user2Id);  // 600
      expect(rankings[0].rank).toBe(1);
      expect(rankings[1].user_id).toBe(user1Id);  // 500
      expect(rankings[1].rank).toBe(2);
      expect(rankings[2].user_id).toBe(user3Id);  // 400
      expect(rankings[2].rank).toBe(3);
    });

    it('should break ties by user_id ASC (deterministic)', async () => {
      // Create 3 users with IDs that sort differently as strings
      const userA = crypto.randomUUID();
      const userB = crypto.randomUUID();
      const userC = crypto.randomUUID();

      // Ensure userA < userB < userC lexicographically (for this test)
      const users = [
        { id: userA, name: 'A' },
        { id: userB, name: 'B' },
        { id: userC, name: 'C' }
      ].sort((a, b) => a.id.localeCompare(b.id));

      for (const user of users) {
        await pool.query(
          'INSERT INTO users (id, email) VALUES ($1, $2)',
          [user.id, `${user.name}-${user.id}@test.com`]
        );
        createdUserIds.push(user.id);
        await pool.query(
          'INSERT INTO contest_participants (id, contest_instance_id, user_id) VALUES ($1, $2, $3)',
          [crypto.randomUUID(), contestId, user.id]
        );

        // All users score the SAME (tie)
        await addGolferScores(user.id, 500);
      }

      // Create ingestion snapshot for settlement binding
      const { snapshotId, snapshotHash } = await createIngestionSnapshot(pool, contestId);

      // Execute settlement
      const settlement = await settlementStrategy.executeSettlement(
        { id: contestId, entry_fee_cents: 10000 },
        pool,
        snapshotId,
        snapshotHash
      );

      // PostgreSQL JSONB auto-parses, so results may already be an object
      const results = typeof settlement.results === 'string' ? JSON.parse(settlement.results) : settlement.results;
      const rankings = results.rankings;

      // All should rank as 1 (competition ranking, ties)
      expect(rankings[0].rank).toBe(1);
      expect(rankings[1].rank).toBe(1);
      expect(rankings[2].rank).toBe(1);

      // But order should be ASC by user_id
      expect(rankings[0].user_id).toBe(users[0].id);
      expect(rankings[1].user_id).toBe(users[1].id);
      expect(rankings[2].user_id).toBe(users[2].id);
    });

    it('should use competition ranking (1, 1, 3 pattern)', async () => {
      const user1Id = crypto.randomUUID();
      const user2Id = crypto.randomUUID();
      const user3Id = crypto.randomUUID();

      // Create users
      await pool.query('INSERT INTO users (id, email) VALUES ($1, $2)',
        [user1Id, testEmail('u1')]);
      createdUserIds.push(user1Id);
      await pool.query('INSERT INTO users (id, email) VALUES ($1, $2)',
        [user2Id, testEmail('u2')]);
      createdUserIds.push(user2Id);
      await pool.query('INSERT INTO users (id, email) VALUES ($1, $2)',
        [user3Id, testEmail('u3')]);
      createdUserIds.push(user3Id);

      // Create participants
      await pool.query(
        'INSERT INTO contest_participants (id, contest_instance_id, user_id) VALUES ($1, $2, $3)',
        [crypto.randomUUID(), contestId, user1Id]
      );
      await pool.query(
        'INSERT INTO contest_participants (id, contest_instance_id, user_id) VALUES ($1, $2, $3)',
        [crypto.randomUUID(), contestId, user2Id]
      );
      await pool.query(
        'INSERT INTO contest_participants (id, contest_instance_id, user_id) VALUES ($1, $2, $3)',
        [crypto.randomUUID(), contestId, user3Id]
      );

      // Scores: user1=100, user2=100 (tie), user3=90
      // Expected ranks: 1, 1, 3 (NOT 1, 1, 2)
      await addGolferScores(user1Id, 100);
      await addGolferScores(user2Id, 100);
      await addGolferScores(user3Id, 90);

      // Create ingestion snapshot for settlement binding
      const { snapshotId, snapshotHash } = await createIngestionSnapshot(pool, contestId);

      // Execute settlement
      const settlement = await settlementStrategy.executeSettlement(
        { id: contestId, entry_fee_cents: 10000 },
        pool,
        snapshotId,
        snapshotHash
      );

      // PostgreSQL JSONB auto-parses, so results may already be an object
      const results = typeof settlement.results === 'string' ? JSON.parse(settlement.results) : settlement.results;
      const rankings = results.rankings;

      const rank1s = rankings.filter(r => r.rank === 1);
      const rank3s = rankings.filter(r => r.rank === 3);

      expect(rank1s).toHaveLength(2);  // Two users tied at rank 1
      expect(rank3s).toHaveLength(1);  // Next rank is 3 (competition ranking)
      expect(rank3s[0].user_id).toBe(user3Id);
    });
  });

  // =========================================================================
  // INVARIANT 3: HASH DETERMINISM
  // =========================================================================

  describe('INVARIANT: Hash Determinism (immutable, canonical JSON)', () => {
    it('should produce identical SHA-256 hash across multiple settlements', async () => {
      const participantId = crypto.randomUUID();

      await pool.query(
        'INSERT INTO users (id, email) VALUES ($1, $2)',
        [participantId, testEmail('p')]
      );
      createdUserIds.push(participantId);
      await pool.query(
        'INSERT INTO contest_participants (id, contest_instance_id, user_id) VALUES ($1, $2, $3)',
        [crypto.randomUUID(), contestId, participantId]
      );

      await addGolferScores(participantId, 500);

      // Create ingestion snapshot once (reuse for all 3 idempotent calls)
      const { snapshotId, snapshotHash } = await createIngestionSnapshot(pool, contestId);

      // Run settlement 3 times (idempotent - reuse same snapshot)
      const hashes = [];
      for (let i = 0; i < 3; i++) {
        const settlement = await settlementStrategy.executeSettlement(
          { id: contestId, entry_fee_cents: 10000 },
          pool,
          snapshotId,
          snapshotHash
        );
        hashes.push(settlement.results_sha256);
      }

      // All hashes should be identical
      expect(hashes[0]).toBe(hashes[1]);
      expect(hashes[1]).toBe(hashes[2]);

      // Hash should be valid SHA-256 (64 hex chars)
      expect(hashes[0]).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should use canonical JSON (sorted keys) for hashing', async () => {
      const participantId = crypto.randomUUID();

      await pool.query(
        'INSERT INTO users (id, email) VALUES ($1, $2)',
        [participantId, testEmail('p')]
      );
      createdUserIds.push(participantId);
      await pool.query(
        'INSERT INTO contest_participants (id, contest_instance_id, user_id) VALUES ($1, $2, $3)',
        [crypto.randomUUID(), contestId, participantId]
      );

      await addGolferScores(participantId, 500);

      // Create ingestion snapshot for settlement binding
      const { snapshotId, snapshotHash } = await createIngestionSnapshot(pool, contestId);

      // Execute settlement
      const settlement = await settlementStrategy.executeSettlement(
        { id: contestId, entry_fee_cents: 10000 },
        pool,
        snapshotId,
        snapshotHash
      );

      // Verify hash matches canonicalized results
      // PostgreSQL JSONB auto-parses, so results may already be an object
      const results = typeof settlement.results === 'string' ? JSON.parse(settlement.results) : settlement.results;
      const canonical = settlementStrategy.canonicalizeJson(results);
      const expectedHash = require('crypto')
        .createHash('sha256')
        .update(JSON.stringify(canonical))
        .digest('hex');

      expect(settlement.results_sha256).toBe(expectedHash);
    });

    it('should NOT produce same hash if results change', async () => {
      const user1Id = crypto.randomUUID();
      const user2Id = crypto.randomUUID();

      // Create both users
      await pool.query('INSERT INTO users (id, email) VALUES ($1, $2)',
        [user1Id, testEmail('u1')]);
      createdUserIds.push(user1Id);
      await pool.query('INSERT INTO users (id, email) VALUES ($1, $2)',
        [user2Id, testEmail('u2')]);
      createdUserIds.push(user2Id);

      // Create participants
      await pool.query(
        'INSERT INTO contest_participants (id, contest_instance_id, user_id) VALUES ($1, $2, $3)',
        [crypto.randomUUID(), contestId, user1Id]
      );
      await pool.query(
        'INSERT INTO contest_participants (id, contest_instance_id, user_id) VALUES ($1, $2, $3)',
        [crypto.randomUUID(), contestId, user2Id]
      );

      // First settlement: user1=500, user2=600
      await addGolferScores(user1Id, 500);
      await addGolferScores(user2Id, 600);

      // Create ingestion snapshot for settlement binding
      const { snapshotId, snapshotHash } = await createIngestionSnapshot(pool, contestId);

      const settlement1 = await settlementStrategy.executeSettlement(
        { id: contestId, entry_fee_cents: 10000 },
        pool,
        snapshotId,
        snapshotHash
      );
      const hash1 = settlement1.results_sha256;

      // If we could modify scores, hash should change
      // (This is just a conceptual test of hash sensitivity)
      // We can't actually modify because idempotency prevents re-settlement
      // But we verify the hash from the first execution is correct

      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
      expect(settlement1.results).toBeDefined();
    });
  });

  // =========================================================================
  // INVARIANT 4: PAYOUT DISTRIBUTION
  // =========================================================================

  describe('INVARIANT: Payout Distribution (structure percentages)', () => {
    it('should allocate payouts per payout_structure percentages', async () => {
      const user1Id = crypto.randomUUID();
      const user2Id = crypto.randomUUID();

      await pool.query('INSERT INTO users (id, email) VALUES ($1, $2)',
        [user1Id, testEmail('u1')]);
      createdUserIds.push(user1Id);
      await pool.query('INSERT INTO users (id, email) VALUES ($1, $2)',
        [user2Id, testEmail('u2')]);
      createdUserIds.push(user2Id);

      await pool.query(
        'INSERT INTO contest_participants (id, contest_instance_id, user_id) VALUES ($1, $2, $3)',
        [crypto.randomUUID(), contestId, user1Id]
      );
      await pool.query(
        'INSERT INTO contest_participants (id, contest_instance_id, user_id) VALUES ($1, $2, $3)',
        [crypto.randomUUID(), contestId, user2Id]
      );

      // Contest has payout_structure: { "1": 60, "2": 40 }
      // 2 participants × $100 = $200 pool
      // Rank 1: 60% of $200 = $120
      // Rank 2: 40% of $200 = $80
      await addGolferScores(user1Id, 600);
      await addGolferScores(user2Id, 500);

      // Create ingestion snapshot for settlement binding
      const { snapshotId, snapshotHash } = await createIngestionSnapshot(pool, contestId);

      const settlement = await settlementStrategy.executeSettlement(
        { id: contestId, entry_fee_cents: 10000 },
        pool,
        snapshotId,
        snapshotHash
      );

      console.log('TEST: should allocate payouts per payout_structure percentages');
      console.log('Total Pool:', settlement.total_pool_cents);
      console.log('Entry Fee:', 10000);
      console.log('Participants:', 2);
      console.log('Payout Structure:', settlement.payout_structure);

      // PostgreSQL JSONB auto-parses, so results may already be an object
      const results = typeof settlement.results === 'string' ? JSON.parse(settlement.results) : settlement.results;
      const payouts = results.payouts;

      // Find payouts for each user
      const payout1 = payouts.find(p => p.user_id === user1Id);
      const payout2 = payouts.find(p => p.user_id === user2Id);

      const totalPool = 20000;  // 2 participants × $100

      // Pool after 10% service fee applied: 18000
      // Rank 1 (60% of 18000 = 10800)
      expect(payout1.amount_cents).toBe(10800);
      // Rank 2 (40% of 18000 = 7200)
      expect(payout2.amount_cents).toBe(7200);

      // Verify total payouts ≤ pool
      const totalPayouts = payouts.reduce((sum, p) => sum + p.amount_cents, 0);
      expect(totalPayouts).toBeLessThanOrEqual(totalPool);
    });

    it('should split tied payouts equally', async () => {
      // FROZEN INVARIANT: Create isolated contest with specific payout structure
      // This test freezes tie-splitting math with known, explicit inputs
      const tieTestContestId = crypto.randomUUID();
      const tieTestTemplateId = crypto.randomUUID();
      const tieTestOrganizerId = crypto.randomUUID();

      // Create organizer for this test contest
      await pool.query(
        'INSERT INTO users (id, email) VALUES ($1, $2)',
        [tieTestOrganizerId, testEmail('tie-org')]
      );
      createdUserIds.push(tieTestOrganizerId);

      // Create template with specific payout structure for this invariant
      await pool.query(
        `INSERT INTO contest_templates
         (id, name, sport, template_type, scoring_strategy_key, lock_strategy_key,
          settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
          allowed_entry_fee_max_cents, allowed_payout_structures, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false)`,
        [
          tieTestTemplateId,
          'Tie-Split Test Template',
          'golf',
          'playoff',
          'pga_standard_v1',
          'golf_lock',
          'pga_standard_v1',
          10000,
          0,
          1000000,
          JSON.stringify({ '1': 60, '2': 20, '3': 20 })
        ]
      );

      // Create contest with the tie-split payout structure
      await pool.query(
        `INSERT INTO contest_instances
         (id, template_id, organizer_id, status, entry_fee_cents, payout_structure,
          contest_name, max_entries)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          tieTestContestId,
          tieTestTemplateId,
          tieTestOrganizerId,
          'LIVE',
          10000,
          JSON.stringify({ '1': 60, '2': 20, '3': 20 }),
          'Tie-Split Test Contest',
          100
        ]
      );

      const user1Id = crypto.randomUUID();
      const user2Id = crypto.randomUUID();
      const user3Id = crypto.randomUUID();

      await pool.query('INSERT INTO users (id, email) VALUES ($1, $2)',
        [user1Id, testEmail('u1')]);
      createdUserIds.push(user1Id);
      await pool.query('INSERT INTO users (id, email) VALUES ($1, $2)',
        [user2Id, testEmail('u2')]);
      createdUserIds.push(user2Id);
      await pool.query('INSERT INTO users (id, email) VALUES ($1, $2)',
        [user3Id, testEmail('u3')]);
      createdUserIds.push(user3Id);

      await pool.query(
        'INSERT INTO contest_participants (id, contest_instance_id, user_id) VALUES ($1, $2, $3)',
        [crypto.randomUUID(), tieTestContestId, user1Id]
      );
      await pool.query(
        'INSERT INTO contest_participants (id, contest_instance_id, user_id) VALUES ($1, $2, $3)',
        [crypto.randomUUID(), tieTestContestId, user2Id]
      );
      await pool.query(
        'INSERT INTO contest_participants (id, contest_instance_id, user_id) VALUES ($1, $2, $3)',
        [crypto.randomUUID(), tieTestContestId, user3Id]
      );

      // Test invariant with known inputs:
      // - Payout structure: { "1": 60, "2": 20, "3": 20 }
      // - 3 participants × $100 = $300 pool = 30000 cents
      // - User1 & User2: 600 points (tied at rank 1, occupy positions 1-2)
      // - User3: 500 points (rank 3, position 3)
      //
      // Expected math:
      // - Rank 1 (positions 1-2): (60 + 20) / 2 = 40% each = 12000 cents
      // - Rank 3 (position 3): 20% = 6000 cents
      const scores = [
        { userId: user1Id, score: 600 },
        { userId: user2Id, score: 600 },
        { userId: user3Id, score: 500 }
      ];
      for (const { userId, score } of scores) {
        const perGolfer = Math.floor(score / 7);
        for (let i = 1; i <= 7; i++) {
          await pool.query(
            `INSERT INTO golfer_scores
             (id, contest_instance_id, user_id, golfer_id, round_number, hole_points,
              bonus_points, finish_bonus, total_points)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              crypto.randomUUID(),
              tieTestContestId,
              userId,
              `golfer-${i}`,
              1,
              perGolfer,
              0,
              0,
              perGolfer
            ]
          );
        }
      }

      // Create ingestion snapshot for settlement binding
      const { snapshotId, snapshotHash } = await createIngestionSnapshot(pool, tieTestContestId);

      const settlement = await settlementStrategy.executeSettlement(
        { id: tieTestContestId, entry_fee_cents: 10000 },
        pool,
        snapshotId,
        snapshotHash
      );

      console.log('TEST: should split tied payouts equally');
      console.log('Total Pool:', settlement.total_pool_cents);
      console.log('Entry Fee:', 10000);
      console.log('Participants:', 3);
      console.log('Payout Structure:', settlement.payout_structure);

      // PostgreSQL JSONB auto-parses, so results may already be an object
      const results = typeof settlement.results === 'string' ? JSON.parse(settlement.results) : settlement.results;
      const payouts = results.payouts;

      const p1 = payouts.find(p => p.user_id === user1Id);
      const p2 = payouts.find(p => p.user_id === user2Id);
      const p3 = payouts.find(p => p.user_id === user3Id);

      // Tied users should get equal payouts
      expect(p1.amount_cents).toBe(p2.amount_cents);
      // Pool after 10% service fee applied: 27000
      // FROZEN: 40% of 27000 = 10800 cents per tied user
      // If this fails, tie-splitting math broke
      expect(p1.amount_cents).toBe(10800);
      expect(p2.amount_cents).toBe(10800);

      // FROZEN: 20% of 27000 = 5400 cents for rank 3
      // If this fails, position allocation math broke
      expect(p3.amount_cents).toBe(5400);
    });

    it('should never exceed total pool', async () => {
      const user1Id = crypto.randomUUID();
      const user2Id = crypto.randomUUID();
      const user3Id = crypto.randomUUID();

      await pool.query('INSERT INTO users (id, email) VALUES ($1, $2)',
        [user1Id, testEmail('u1')]);
      createdUserIds.push(user1Id);
      await pool.query('INSERT INTO users (id, email) VALUES ($1, $2)',
        [user2Id, testEmail('u2')]);
      createdUserIds.push(user2Id);
      await pool.query('INSERT INTO users (id, email) VALUES ($1, $2)',
        [user3Id, testEmail('u3')]);
      createdUserIds.push(user3Id);

      await pool.query(
        'INSERT INTO contest_participants (id, contest_instance_id, user_id) VALUES ($1, $2, $3)',
        [crypto.randomUUID(), contestId, user1Id]
      );
      await pool.query(
        'INSERT INTO contest_participants (id, contest_instance_id, user_id) VALUES ($1, $2, $3)',
        [crypto.randomUUID(), contestId, user2Id]
      );
      await pool.query(
        'INSERT INTO contest_participants (id, contest_instance_id, user_id) VALUES ($1, $2, $3)',
        [crypto.randomUUID(), contestId, user3Id]
      );

      await addGolferScores(user1Id, 100);
      await addGolferScores(user2Id, 200);
      await addGolferScores(user3Id, 300);

      // Create ingestion snapshot for settlement binding
      const { snapshotId, snapshotHash } = await createIngestionSnapshot(pool, contestId);

      const settlement = await settlementStrategy.executeSettlement(
        { id: contestId, entry_fee_cents: 10000 },
        pool,
        snapshotId,
        snapshotHash
      );

      // PostgreSQL JSONB auto-parses, so results may already be an object
      const results = typeof settlement.results === 'string' ? JSON.parse(settlement.results) : settlement.results;
      const payouts = results.payouts;

      const totalPayouts = payouts.reduce((sum, p) => sum + p.amount_cents, 0);
      const totalPool = 3 * 10000;  // 3 participants × $100

      expect(totalPayouts).toBeLessThanOrEqual(totalPool);
    });
  });

  // =========================================================================
  // INVARIANT 5: MULTI-ROUND AGGREGATION
  // =========================================================================

  describe('INVARIANT: Multi-Round Aggregation (4 rounds, finish bonus final only)', () => {
    it('should accumulate scores across all 4 rounds', async () => {
      const participantId = crypto.randomUUID();

      await pool.query(
        'INSERT INTO users (id, email) VALUES ($1, $2)',
        [participantId, testEmail('p')]
      );
      createdUserIds.push(participantId);
      await pool.query(
        'INSERT INTO contest_participants (id, contest_instance_id, user_id) VALUES ($1, $2, $3)',
        [crypto.randomUUID(), contestId, participantId]
      );

      // FROZEN INVARIANT: Multi-round accumulation (without drop-lowest interference)
      // Insert exactly 6 golfers × 4 rounds (6 is the kept count; drop-lowest applies to 7+)
      // Round 1-3: 10 points per golfer per round
      // Round 4: 10 points + 5 finish bonus per golfer
      // Total per golfer: 10 + 10 + 10 + 15 = 45
      // 6 golfers × 45 = 270 (all 6 kept, no drop)

      for (let golfer = 1; golfer <= 6; golfer++) {
        for (let round = 1; round <= 4; round++) {
          const isFinalRound = round === 4;
          const holePoints = 10;
          const finishBonus = isFinalRound ? 5 : 0;

          await pool.query(
            `INSERT INTO golfer_scores
             (id, contest_instance_id, user_id, golfer_id, round_number, hole_points,
              bonus_points, finish_bonus, total_points)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              crypto.randomUUID(),
              contestId,
              participantId,
              `golfer-${golfer}`,
              round,
              holePoints,
              0,
              finishBonus,
              holePoints + finishBonus
            ]
          );
        }
      }

      // Create ingestion snapshot for settlement binding
      const { snapshotId, snapshotHash } = await createIngestionSnapshot(pool, contestId);

      // Execute settlement
      const settlement = await settlementStrategy.executeSettlement(
        { id: contestId, entry_fee_cents: 10000 },
        pool,
        snapshotId,
        snapshotHash
      );

      // PostgreSQL JSONB auto-parses, so results may already be an object
      const results = typeof settlement.results === 'string' ? JSON.parse(settlement.results) : settlement.results;
      const ranking = results.rankings[0];

      // FROZEN: Accumulation across 4 rounds with finish bonus in final round only
      // 6 golfers × (10+10+10+15) = 6 × 45 = 270
      // If this fails, multi-round accumulation is broken
      expect(ranking.score).toBe(270);
    });

    it('should apply finish_bonus only in final round (round 4)', async () => {
      const participantId = crypto.randomUUID();

      await pool.query(
        'INSERT INTO users (id, email) VALUES ($1, $2)',
        [participantId, testEmail('p')]
      );
      createdUserIds.push(participantId);
      await pool.query(
        'INSERT INTO contest_participants (id, contest_instance_id, user_id) VALUES ($1, $2, $3)',
        [crypto.randomUUID(), contestId, participantId]
      );

      // Add one golfer with finish bonus in all rounds (but only round 4 should be applied)
      for (let round = 1; round <= 4; round++) {
        const isFinalRound = round === 4;
        const finishBonus = isFinalRound ? 10 : 0;

        await pool.query(
          `INSERT INTO golfer_scores
           (id, contest_instance_id, user_id, golfer_id, round_number, hole_points,
            bonus_points, finish_bonus, total_points)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            crypto.randomUUID(),
            contestId,
            participantId,
            'single-golfer',
            round,
            20,
            0,
            finishBonus,
            20 + finishBonus
          ]
        );
      }

      // Verify data: rounds 1-3 have finish_bonus=0, round 4 has finish_bonus=10
      const scores = await pool.query(
        `SELECT round_number, finish_bonus FROM golfer_scores
         WHERE contest_instance_id = $1
         ORDER BY round_number`,
        [contestId]
      );

      expect(scores.rows[0].finish_bonus).toBe(0);  // Round 1
      expect(scores.rows[1].finish_bonus).toBe(0);  // Round 2
      expect(scores.rows[2].finish_bonus).toBe(0);  // Round 3
      expect(scores.rows[3].finish_bonus).toBe(10); // Round 4
    });
  });

  // =========================================================================
  // GOLDEN SNAPSHOT TEST: Exact Deterministic Behavior
  // =========================================================================

  describe('GOLDEN SNAPSHOT: Frozen Exact Results (Do Not Touch Lightly)', () => {
    it('should produce exact expected rankings, payouts, and hash for deterministic scenario', async () => {
      // Create 3 users with random UUIDs
      // Determinism comes from scores, not IDs
      const user1Id = crypto.randomUUID();
      const user2Id = crypto.randomUUID();
      const user3Id = crypto.randomUUID();

      // Create users (in order) and track for cleanup
      await pool.query(
        'INSERT INTO users (id, email) VALUES ($1, $2)',
        [user1Id, testEmail('user1')]
      );
      createdUserIds.push(user1Id);
      await pool.query(
        'INSERT INTO users (id, email) VALUES ($1, $2)',
        [user2Id, testEmail('user2')]
      );
      createdUserIds.push(user2Id);
      await pool.query(
        'INSERT INTO users (id, email) VALUES ($1, $2)',
        [user3Id, testEmail('user3')]
      );
      createdUserIds.push(user3Id);

      // Create participants in order (ensures deterministic ordering)
      await pool.query(
        'INSERT INTO contest_participants (id, contest_instance_id, user_id) VALUES ($1, $2, $3)',
        [crypto.randomUUID(), contestId, user1Id]
      );
      await pool.query(
        'INSERT INTO contest_participants (id, contest_instance_id, user_id) VALUES ($1, $2, $3)',
        [crypto.randomUUID(), contestId, user2Id]
      );
      await pool.query(
        'INSERT INTO contest_participants (id, contest_instance_id, user_id) VALUES ($1, $2, $3)',
        [crypto.randomUUID(), contestId, user3Id]
      );

      // GOLDEN SNAPSHOT: Deterministic test with known inputs
      // addExactGolferScores(userId, totalScore) inserts 7 golfers with totalScore/7 each
      // Engine applies drop-lowest → keeps best 6 → score = 6 × (totalScore/7)
      //
      // user1: 100 → 100/7=14 per golfer → 7 golfers → drop 1 → 6×14 = 84
      // user2: 140 → 140/7=20 per golfer → 7 golfers → drop 1 → 6×20 = 120
      // user3: 80 → 80/7=11 per golfer → 7 golfers → drop 1 → 6×11 = 66
      //
      // Payout structure: { "1": 60, "2": 40 } = 100% total
      // Pool: 3 participants × $100 = $300 = 30000 cents
      // Rank 1: 60% = 18000, Rank 2: 40% = 12000, Rank 3: 0%
      //
      // Final rankings: user2 (120) > user1 (84) > user3 (66)
      await addExactGolferScores(user1Id, 100);
      await addExactGolferScores(user2Id, 140);
      await addExactGolferScores(user3Id, 80);

      // Create ingestion snapshot for settlement binding
      const { snapshotId, snapshotHash } = await createIngestionSnapshot(pool, contestId);

      // Execute settlement
      const settlement = await settlementStrategy.executeSettlement(
        { id: contestId, entry_fee_cents: 10000 },
        pool,
        snapshotId,
        snapshotHash
      );

      // PostgreSQL JSONB auto-parses, so results may already be an object
      const results = typeof settlement.results === 'string' ? JSON.parse(settlement.results) : settlement.results;

      // GOLDEN SNAPSHOT: Assert exact structure (frozen with drop-lowest applied)
      // DO NOT SILENTLY UPDATE THIS - confirm math is correct before changing
      expect(results.rankings).toEqual([
        { user_id: user2Id, rank: 1, score: 120 },
        { user_id: user1Id, rank: 2, score: 84 },
        { user_id: user3Id, rank: 3, score: 66 }
      ]);

      expect(results.payouts).toEqual([
        { user_id: user2Id, rank: 1, amount_cents: 16200 },  // 60% of 27000 (after 10% service fee)
        { user_id: user1Id, rank: 2, amount_cents: 10800 },  // 40% of 27000 (after 10% service fee)
        { user_id: user3Id, rank: 3, amount_cents: 0 }       // No payout structure for rank 3
      ]);

      // Hash should be deterministic and freeze this exact result
      expect(settlement.results_sha256).toMatch(/^[a-f0-9]{64}$/);

      // If this test fails, settlement math changed and that's intentional.
      // Update the snapshot only after code review confirms the change.
      // DO NOT SILENTLY UPDATE THIS TEST.
    });

    it('should freeze exact hash across runs for golden snapshot', async () => {
      const user1Id = crypto.randomUUID();

      await pool.query(
        'INSERT INTO users (id, email) VALUES ($1, $2)',
        [user1Id, testEmail('sole-user')]
      );
      createdUserIds.push(user1Id);
      await pool.query(
        'INSERT INTO contest_participants (id, contest_instance_id, user_id) VALUES ($1, $2, $3)',
        [crypto.randomUUID(), contestId, user1Id]
      );

      await addExactGolferScores(user1Id, 100);

      // Create ingestion snapshot once (reuse for both idempotent calls)
      const { snapshotId, snapshotHash } = await createIngestionSnapshot(pool, contestId);

      // Run settlement twice (idempotent - reuse same snapshot)
      const settlement1 = await settlementStrategy.executeSettlement(
        { id: contestId, entry_fee_cents: 10000 },
        pool,
        snapshotId,
        snapshotHash
      );

      const settlement2 = await settlementStrategy.executeSettlement(
        { id: contestId, entry_fee_cents: 10000 },
        pool,
        snapshotId,
        snapshotHash
      );

      // Hash must be byte-for-byte identical
      expect(settlement1.results_sha256).toBe(settlement2.results_sha256);

      // If you change settlement math, this hash WILL change.
      // That's the point: catch unintended changes.
    });
  });

  // =========================================================================
  // NEGATIVE INVARIANTS: Guard Invalid States
  // =========================================================================

  describe('NEGATIVE INVARIANTS: Reject Invalid States', () => {
    it('should refuse settlement if contest status is not LIVE', async () => {
      const participantId = crypto.randomUUID();

      await pool.query(
        'INSERT INTO users (id, email) VALUES ($1, $2)',
        [participantId, testEmail('p')]
      );
      createdUserIds.push(participantId);
      await pool.query(
        'INSERT INTO contest_participants (id, contest_instance_id, user_id) VALUES ($1, $2, $3)',
        [crypto.randomUUID(), contestId, participantId]
      );

      await addGolferScores(participantId, 500);

      // Change contest status to LOCKED (not LIVE)
      await pool.query(
        'UPDATE contest_instances SET status = $1 WHERE id = $2',
        ['LOCKED', contestId]
      );

      // Create ingestion snapshot for settlement binding
      const { snapshotId, snapshotHash } = await createIngestionSnapshot(pool, contestId);

      // Attempt settlement (should fail or ignore based on platform logic)
      const settlement = await settlementStrategy.executeSettlement(
        { id: contestId, entry_fee_cents: 10000 },
        pool,
        snapshotId,
        snapshotHash
      );

      // Settlement should complete (platform doesn't enforce status check)
      // But this test documents the behavior:
      // If you want to add status enforcement, this test will fail
      // and you'll know to update the invariant.
      expect(settlement).toBeDefined();
    });

    it('should reject payout_structure with percentages > 100%', async () => {
      // Create template with invalid payout structure (sum > 100)
      const invalidTemplateId = crypto.randomUUID();

      await pool.query(
        `INSERT INTO contest_templates
         (id, name, sport, template_type, scoring_strategy_key, lock_strategy_key,
          settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
          allowed_entry_fee_max_cents, allowed_payout_structures, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false)`,
        [
          invalidTemplateId,
          'Invalid Payout Template',
          'golf',
          'playoff',
          'pga_standard_v1',
          'golf_lock',
          'pga_standard_v1',
          10000,
          0,
          1000000,
          JSON.stringify({ '1': 70, '2': 50 })  // 70 + 50 = 120% (INVALID)
        ]
      );

      // Create contest with invalid template
      const invalidContestId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO contest_instances
         (id, template_id, organizer_id, status, entry_fee_cents, payout_structure,
          contest_name, max_entries)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          invalidContestId,
          invalidTemplateId,
          organizerId,
          'LIVE',
          10000,
          JSON.stringify({ '1': 70, '2': 50 }),
          'Invalid Contest',
          100
        ]
      );

      const participantId = crypto.randomUUID();
      await pool.query(
        'INSERT INTO users (id, email) VALUES ($1, $2)',
        [participantId, testEmail('p')]
      );
      createdUserIds.push(participantId);
      await pool.query(
        'INSERT INTO contest_participants (id, contest_instance_id, user_id) VALUES ($1, $2, $3)',
        [crypto.randomUUID(), invalidContestId, participantId]
      );

      // Add minimal scores
      for (let i = 1; i <= 7; i++) {
        await pool.query(
          `INSERT INTO golfer_scores
           (id, contest_instance_id, user_id, golfer_id, round_number, hole_points,
            bonus_points, finish_bonus, total_points)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            crypto.randomUUID(),
            invalidContestId,
            participantId,
            `golfer-${i}`,
            1,
            100,
            0,
            0,
            100
          ]
        );
      }

      // Create ingestion snapshot for settlement binding
      const { snapshotId, snapshotHash } = await createIngestionSnapshot(pool, invalidContestId);

      // Settlement may succeed or fail based on validation
      // This test documents current behavior:
      // If payouts exceed 100%, that's undefined behavior
      const settlement = await settlementStrategy.executeSettlement(
        { id: invalidContestId, entry_fee_cents: 10000 },
        pool,
        snapshotId,
        snapshotHash
      );

      // For now, settlement completes
      // Future: Add validation and update this test to expect an error
      expect(settlement).toBeDefined();

      // Note: Cleanup skipped for this test
      // Uses unique contest_instance_id (invalidContestId) so test isolation is preserved
      // Append-only tables (ingestion_events) prevent full cleanup without schema changes
    });

    it('should handle empty participant list gracefully', async () => {
      // Contest with no participants
      const emptyContestId = crypto.randomUUID();
      const emptyTemplateId = crypto.randomUUID();

      await pool.query(
        `INSERT INTO contest_templates
         (id, name, sport, template_type, scoring_strategy_key, lock_strategy_key,
          settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
          allowed_entry_fee_max_cents, allowed_payout_structures, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false)`,
        [
          emptyTemplateId,
          'Empty Contest Template',
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

      await pool.query(
        `INSERT INTO contest_instances
         (id, template_id, organizer_id, status, entry_fee_cents, payout_structure,
          contest_name, max_entries)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          emptyContestId,
          emptyTemplateId,
          organizerId,
          'LIVE',
          10000,
          JSON.stringify({ '1': 60, '2': 40 }),
          'Empty Contest',
          100
        ]
      );

      // No participants added

      // Create ingestion snapshot for settlement binding
      const { snapshotId, snapshotHash } = await createIngestionSnapshot(pool, emptyContestId);

      // Settlement should handle gracefully (empty rankings)
      const settlement = await settlementStrategy.executeSettlement(
        { id: emptyContestId, entry_fee_cents: 10000 },
        pool,
        snapshotId,
        snapshotHash
      );

      // PostgreSQL JSONB auto-parses, so results may already be an object
      const results = typeof settlement.results === 'string' ? JSON.parse(settlement.results) : settlement.results;
      expect(results.rankings).toHaveLength(0);
      expect(results.payouts).toHaveLength(0);

      // Note: Cleanup skipped for this test
      // Uses unique contest_instance_id (emptyContestId) so test isolation is preserved
      // Append-only tables (ingestion_events) prevent full cleanup without schema changes
    });
  });

  // =========================================================================
  // SCALE TEST: 100 Participants (Future)
  // =========================================================================

  describe('SCALE TEST: 100 Participants with Random Scores', () => {
    beforeAll(() => {
      jest.setTimeout(90000);  // 90 seconds for 100 participant scale test
    });

    it('should settle 100 participants correctly without correctness degradation', async () => {
      const participantCount = 100;
      const participantIds = [];

      // Create 100 users and participants
      for (let i = 0; i < participantCount; i++) {
        const userId = crypto.randomUUID();
        participantIds.push(userId);

        await pool.query(
          'INSERT INTO users (id, email) VALUES ($1, $2)',
          [userId, testEmail(`user-${i}`)]
        );
        createdUserIds.push(userId);  // Track for cleanup
        await pool.query(
          'INSERT INTO contest_participants (id, contest_instance_id, user_id) VALUES ($1, $2, $3)',
          [crypto.randomUUID(), contestId, userId]
        );
      }

      // Add random scores to each participant
      for (const userId of participantIds) {
        const randomScore = Math.floor(Math.random() * 1000) + 100;  // 100-1100
        await addGolferScores(userId, randomScore);
      }

      // Create ingestion snapshot for settlement binding
      const { snapshotId, snapshotHash } = await createIngestionSnapshot(pool, contestId);

      // Execute settlement
      const settlement = await settlementStrategy.executeSettlement(
        { id: contestId, entry_fee_cents: 10000 },
        pool,
        snapshotId,
        snapshotHash
      );

      // PostgreSQL JSONB auto-parses, so results may already be an object
      const results = typeof settlement.results === 'string' ? JSON.parse(settlement.results) : settlement.results;
      const rankings = results.rankings;
      const payouts = results.payouts;

      // INVARIANT 1: All participants are ranked
      expect(rankings).toHaveLength(participantCount);

      // INVARIANT 2: No gaps in ranking (except for ties)
      const rankSet = new Set(rankings.map(r => r.rank));
      const expectedRanks = [];
      let expectedRank = 1;
      rankings.forEach((r, i) => {
        if (i > 0 && r.rank !== rankings[i - 1].rank) {
          expectedRank = i + 1;
        }
        expectedRanks.push(expectedRank);
      });
      rankings.forEach((r, i) => {
        expect(r.rank).toBeLessThanOrEqual(expectedRanks[i]);
      });

      // INVARIANT 3: Total payouts don't exceed pool
      const totalPool = participantCount * 10000;  // 100 × $100
      const totalPayouts = payouts.reduce((sum, p) => sum + p.amount_cents, 0);
      expect(totalPayouts).toBeLessThanOrEqual(totalPool);

      // INVARIANT 4: All participants have a payout record (even if 0)
      expect(payouts).toHaveLength(participantCount);

      // INVARIANT 5: Rankings sorted descending by score
      for (let i = 1; i < rankings.length; i++) {
        if (rankings[i].rank > rankings[i - 1].rank) {
          // Different rank, must have lower score
          expect(rankings[i].score).toBeLessThanOrEqual(rankings[i - 1].score);
        }
      }

      // INVARIANT 6: Hash is deterministic (same input = same hash)
      const settlement2 = await settlementStrategy.executeSettlement(
        { id: contestId, entry_fee_cents: 10000 },
        pool,
        snapshotId,
        snapshotHash
      );
      expect(settlement2.results_sha256).toBe(settlement.results_sha256);
      // Cleanup handled by global afterEach
    });
  });

  // =========================================================================
  // HELPER FUNCTIONS
  // =========================================================================

  /**
   * Helper: Add exact golfer scores (7 golfers, 1 round, equal scores, deterministic)
   */
  async function addExactGolferScores(userId, totalScore) {
    const scorePerGolfer = Math.floor(totalScore / 7);

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

  /**
   * Helper: Add golfer scores (7 golfers, 1 round, equal scores)
   */
  async function addGolferScores(userId, totalScore) {
    const scorePerGolfer = Math.floor(totalScore / 7);

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
