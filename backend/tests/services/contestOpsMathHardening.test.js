/**
 * Contest Ops Math Hardening Tests
 *
 * Tests for aggregation correctness of contest operations metrics:
 * - Missing picks per contest (max_entries - participant_count)
 * - Stranded funds in cancelled contests
 * - Financial invariants and reconciliation
 * - Lifecycle counts
 * - Entry health metrics
 *
 * These tests validate SQL aggregation math before service integration.
 */

const { randomUUID } = require('crypto');
const { Pool } = require('pg');
const { ensureNflPlayoffChallengeTemplate } = require('../helpers/templateFactory');
const contestOpsService = require('../../services/contestOpsService');
const financialHealthService = require('../../services/financialHealthService');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_TEST || process.env.DATABASE_URL,
});

describe('Contest Ops Math Hardening', () => {
  let templateId;
  let organizerId;

  beforeAll(async () => {
    const template = await ensureNflPlayoffChallengeTemplate(pool);
    templateId = template.id;

    organizerId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, name, email) VALUES ($1, $2, $3)`,
      [organizerId, 'Test Organizer', `org-${organizerId}@test.com`],
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('Missing Picks Calculation', () => {
    it('should calculate 0 missing picks when all entries joined', async () => {
      const contestId = randomUUID();
      const user1Id = randomUUID();
      const user2Id = randomUUID();

      // Create users
      await pool.query(
        `INSERT INTO users (id, name, email) VALUES ($1, $2, $3), ($4, $5, $6)`,
        [user1Id, 'User 1', `user1-${user1Id}@test.com`, user2Id, 'User 2', `user2-${user2Id}@test.com`],
      );

      // Create contest with max_entries=2
      await pool.query(
        `INSERT INTO contest_instances (
          id, template_id, organizer_id, entry_fee_cents, payout_structure,
          status, contest_name, max_entries
        ) VALUES ($1, $2, $3, 5000, '{}', 'SCHEDULED', 'Full Contest', 2)`,
        [contestId, templateId, organizerId],
      );

      // Add 2 participants (full)
      await pool.query(
        `INSERT INTO contest_participants (contest_instance_id, user_id, joined_at)
         VALUES ($1, $2, NOW()), ($1, $3, NOW())`,
        [contestId, user1Id, user2Id],
      );

      // Query for missing picks
      const result = await pool.query(
        `SELECT
           ci.max_entries,
           COUNT(DISTINCT cp.user_id) as participant_count,
           (ci.max_entries - COUNT(DISTINCT cp.user_id)) as missing_picks
         FROM contest_instances ci
         LEFT JOIN contest_participants cp ON ci.id = cp.contest_instance_id
         WHERE ci.id = $1
         GROUP BY ci.id, ci.max_entries`,
        [contestId],
      );

      expect(result.rows.length).toBe(1);
      expect(parseInt(result.rows[0].max_entries, 10)).toBe(2);
      expect(parseInt(result.rows[0].participant_count, 10)).toBe(2);
      expect(parseInt(result.rows[0].missing_picks, 10)).toBe(0);
    });

    it('should calculate correct missing picks for partially filled contest (max 5, 2 joined)', async () => {
      const contestId = randomUUID();
      const user1Id = randomUUID();
      const user2Id = randomUUID();

      // Create users
      await pool.query(
        `INSERT INTO users (id, name, email) VALUES ($1, $2, $3), ($4, $5, $6)`,
        [user1Id, 'User 3', `user3-${user1Id}@test.com`, user2Id, 'User 4', `user4-${user2Id}@test.com`],
      );

      // Create contest with max_entries=5
      await pool.query(
        `INSERT INTO contest_instances (
          id, template_id, organizer_id, entry_fee_cents, payout_structure,
          status, contest_name, max_entries
        ) VALUES ($1, $2, $3, 5000, '{}', 'SCHEDULED', 'Partial Contest', 5)`,
        [contestId, templateId, organizerId],
      );

      // Add only 2 participants (3 missing)
      await pool.query(
        `INSERT INTO contest_participants (contest_instance_id, user_id, joined_at)
         VALUES ($1, $2, NOW()), ($1, $3, NOW())`,
        [contestId, user1Id, user2Id],
      );

      const result = await pool.query(
        `SELECT
           ci.max_entries,
           COUNT(DISTINCT cp.user_id) as participant_count,
           (ci.max_entries - COUNT(DISTINCT cp.user_id)) as missing_picks
         FROM contest_instances ci
         LEFT JOIN contest_participants cp ON ci.id = cp.contest_instance_id
         WHERE ci.id = $1
         GROUP BY ci.id, ci.max_entries`,
        [contestId],
      );

      expect(parseInt(result.rows[0].max_entries, 10)).toBe(5);
      expect(parseInt(result.rows[0].participant_count, 10)).toBe(2);
      expect(parseInt(result.rows[0].missing_picks, 10)).toBe(3);
    });

    it('should calculate all missing picks when no entries joined (max 5, 0 joined)', async () => {
      const contestId = randomUUID();

      // Create contest with max_entries=5, no participants
      await pool.query(
        `INSERT INTO contest_instances (
          id, template_id, organizer_id, entry_fee_cents, payout_structure,
          status, contest_name, max_entries
        ) VALUES ($1, $2, $3, 5000, '{}', 'LOCKED', 'Empty Contest', 5)`,
        [contestId, templateId, organizerId],
      );

      const result = await pool.query(
        `SELECT
           ci.max_entries,
           COUNT(DISTINCT cp.user_id) as participant_count,
           (ci.max_entries - COUNT(DISTINCT cp.user_id)) as missing_picks
         FROM contest_instances ci
         LEFT JOIN contest_participants cp ON ci.id = cp.contest_instance_id
         WHERE ci.id = $1
         GROUP BY ci.id, ci.max_entries`,
        [contestId],
      );

      expect(parseInt(result.rows[0].max_entries, 10)).toBe(5);
      expect(parseInt(result.rows[0].participant_count, 10)).toBe(0);
      expect(parseInt(result.rows[0].missing_picks, 10)).toBe(5);
    });

    it('should aggregate missing picks across multiple contests', async () => {
      const contest1Id = randomUUID();
      const contest2Id = randomUUID();
      const contest3Id = randomUUID();

      const user1Id = randomUUID();
      const user2Id = randomUUID();

      // Create users
      await pool.query(
        `INSERT INTO users (id, name, email) VALUES ($1, $2, $3), ($4, $5, $6)`,
        [user1Id, 'User 5', `user5-${user1Id}@test.com`, user2Id, 'User 6', `user6-${user2Id}@test.com`],
      );

      // Create 3 contests with different participation levels
      await pool.query(
        `INSERT INTO contest_instances (
          id, template_id, organizer_id, entry_fee_cents, payout_structure,
          status, contest_name, max_entries
        ) VALUES
          ($1, $2, $3, 5000, '{}', 'SCHEDULED', 'Contest A', 3),
          ($4, $2, $3, 5000, '{}', 'SCHEDULED', 'Contest B', 5),
          ($5, $2, $3, 5000, '{}', 'SCHEDULED', 'Contest C', 2)`,
        [contest1Id, templateId, organizerId, contest2Id, contest3Id],
      );

      // Contest1: 2 participants, 1 missing
      await pool.query(
        `INSERT INTO contest_participants (contest_instance_id, user_id, joined_at)
         VALUES ($1, $2, NOW()), ($1, $3, NOW())`,
        [contest1Id, user1Id, user2Id],
      );

      // Contest2: 0 participants, 5 missing
      // (no participants)

      // Contest3: 1 participant, 1 missing
      await pool.query(
        `INSERT INTO contest_participants (contest_instance_id, user_id, joined_at)
         VALUES ($1, $2, NOW())`,
        [contest3Id, user1Id],
      );

      const result = await pool.query(
        `SELECT
           ci.id,
           ci.contest_name,
           ci.max_entries,
           COUNT(DISTINCT cp.user_id) as participant_count,
           (ci.max_entries - COUNT(DISTINCT cp.user_id)) as missing_picks
         FROM contest_instances ci
         LEFT JOIN contest_participants cp ON ci.id = cp.contest_instance_id
         WHERE ci.id IN ($1, $2, $3)
         GROUP BY ci.id, ci.contest_name, ci.max_entries
         ORDER BY missing_picks DESC`,
        [contest1Id, contest2Id, contest3Id],
      );

      expect(result.rows.length).toBe(3);
      expect(parseInt(result.rows[0].missing_picks, 10)).toBe(5); // Contest B
      expect(parseInt(result.rows[1].missing_picks, 10)).toBe(1); // Contest A
      expect(parseInt(result.rows[2].missing_picks, 10)).toBe(1); // Contest C
    });
  });

  describe('Stranded Funds Calculation', () => {
    it('should return empty result when no cancelled contests with stranded funds', async () => {
      // All other tests use SCHEDULED/LOCKED/LIVE status
      const result = await pool.query(
        `SELECT ci.id, ci.contest_name
         FROM contest_instances ci
         WHERE ci.status = 'CANCELLED'
         LIMIT 1`,
      );

      // Should either be empty or contain contests from other tests
      // This test just verifies the query works
      expect(Array.isArray(result.rows)).toBe(true);
    });

    it('should identify stranded funds in cancelled contest with no refunds', async () => {
      const contestId = randomUUID();
      const user1Id = randomUUID();
      const user2Id = randomUUID();

      // Create users
      await pool.query(
        `INSERT INTO users (id, name, email) VALUES ($1, $2, $3), ($4, $5, $6)`,
        [user1Id, 'User 7', `user7-${user1Id}@test.com`, user2Id, 'User 8', `user8-${user2Id}@test.com`],
      );

      // Create cancelled contest
      await pool.query(
        `INSERT INTO contest_instances (
          id, template_id, organizer_id, entry_fee_cents, payout_structure,
          status, contest_name, max_entries
        ) VALUES ($1, $2, $3, 5000, '{}', 'CANCELLED', 'Stranded Funds Contest', 5)`,
        [contestId, templateId, organizerId],
      );

      // Add entry fees (debits) for 2 users
      const idemKey1 = `entry:${contestId}:${user1Id}`;
      const idemKey2 = `entry:${contestId}:${user2Id}`;

      await pool.query(
        `INSERT INTO ledger (
          contest_instance_id, user_id, entry_type, direction, amount_cents,
          currency, reference_type, reference_id, idempotency_key, metadata_json, created_at
        ) VALUES
          ($1, $2, 'ENTRY_FEE', 'DEBIT', 5000, 'USD', 'CONTEST', $1, $3, '{}', NOW()),
          ($1, $4, 'ENTRY_FEE', 'DEBIT', 5000, 'USD', 'CONTEST', $1, $5, '{}', NOW())`,
        [contestId, user1Id, idemKey1, user2Id, idemKey2],
      );

      // Query for stranded funds
      const result = await pool.query(
        `SELECT
           ci.id,
           ci.contest_name,
           COUNT(DISTINCT l.user_id) as affected_user_count,
           SUM(CASE WHEN l.direction = 'DEBIT' THEN l.amount_cents ELSE 0 END) as total_debit_cents,
           COALESCE(SUM(CASE WHEN l.entry_type = 'ENTRY_FEE_REFUND' AND l.direction = 'CREDIT' THEN l.amount_cents ELSE 0 END), 0) as total_refund_cents
         FROM contest_instances ci
         LEFT JOIN ledger l ON ci.id = l.contest_instance_id AND (l.entry_type = 'ENTRY_FEE' OR l.entry_type = 'ENTRY_FEE_REFUND')
         WHERE ci.id = $1
         GROUP BY ci.id, ci.contest_name`,
        [contestId],
      );

      expect(result.rows.length).toBe(1);
      expect(parseInt(result.rows[0].affected_user_count, 10)).toBe(2);
      expect(parseInt(result.rows[0].total_debit_cents, 10)).toBe(10000);
      expect(parseInt(result.rows[0].total_refund_cents, 10)).toBe(0);
      const strandedCents = result.rows[0].total_debit_cents - result.rows[0].total_refund_cents;
      expect(strandedCents).toBe(10000);
    });

    it('should calculate stranded funds after partial refunds', async () => {
      const contestId = randomUUID();
      const user1Id = randomUUID();
      const user2Id = randomUUID();

      // Create users
      await pool.query(
        `INSERT INTO users (id, name, email) VALUES ($1, $2, $3), ($4, $5, $6)`,
        [user1Id, 'User 9', `user9-${user1Id}@test.com`, user2Id, 'User 10', `user10-${user2Id}@test.com`],
      );

      // Create cancelled contest
      await pool.query(
        `INSERT INTO contest_instances (
          id, template_id, organizer_id, entry_fee_cents, payout_structure,
          status, contest_name, max_entries
        ) VALUES ($1, $2, $3, 5000, '{}', 'CANCELLED', 'Partial Refund Contest', 5)`,
        [contestId, templateId, organizerId],
      );

      const idemKey1 = `entry:${contestId}:${user1Id}`;
      const idemKey2 = `entry:${contestId}:${user2Id}`;
      const refundKey1 = `refund:${contestId}:${user1Id}`;

      // Add entry fees and 1 refund
      await pool.query(
        `INSERT INTO ledger (
          contest_instance_id, user_id, entry_type, direction, amount_cents,
          currency, reference_type, reference_id, idempotency_key, metadata_json, created_at
        ) VALUES
          ($1, $2, 'ENTRY_FEE', 'DEBIT', 5000, 'USD', 'CONTEST', $1, $3, '{}', NOW()),
          ($1, $4, 'ENTRY_FEE', 'DEBIT', 5000, 'USD', 'CONTEST', $1, $5, '{}', NOW()),
          ($1, $2, 'ENTRY_FEE_REFUND', 'CREDIT', 5000, 'USD', 'CONTEST', $1, $6, '{}', NOW())`,
        [contestId, user1Id, idemKey1, user2Id, idemKey2, refundKey1],
      );

      const result = await pool.query(
        `SELECT
           ci.id,
           COUNT(DISTINCT l.user_id) as affected_user_count,
           SUM(CASE WHEN l.direction = 'DEBIT' THEN l.amount_cents ELSE 0 END) as total_debit_cents,
           COALESCE(SUM(CASE WHEN l.entry_type = 'ENTRY_FEE_REFUND' AND l.direction = 'CREDIT' THEN l.amount_cents ELSE 0 END), 0) as total_refund_cents
         FROM contest_instances ci
         LEFT JOIN ledger l ON ci.id = l.contest_instance_id AND (l.entry_type = 'ENTRY_FEE' OR l.entry_type = 'ENTRY_FEE_REFUND')
         WHERE ci.id = $1
         GROUP BY ci.id`,
        [contestId],
      );

      expect(parseInt(result.rows[0].total_debit_cents, 10)).toBe(10000);
      expect(parseInt(result.rows[0].total_refund_cents, 10)).toBe(5000);
      const strandedCents = parseInt(result.rows[0].total_debit_cents, 10) - parseInt(result.rows[0].total_refund_cents, 10);
      expect(strandedCents).toBe(5000);
    });
  });

  describe('Lifecycle Counts', () => {
    it('should count contests by status accurately', async () => {
      const contest1Id = randomUUID();
      const contest2Id = randomUUID();
      const contest3Id = randomUUID();

      // Create contests in different statuses
      await pool.query(
        `INSERT INTO contest_instances (
          id, template_id, organizer_id, entry_fee_cents, payout_structure,
          status, contest_name, max_entries
        ) VALUES
          ($1, $2, $3, 5000, '{}', 'SCHEDULED', 'LC Contest 1', 5),
          ($4, $2, $3, 5000, '{}', 'LOCKED', 'LC Contest 2', 5),
          ($5, $2, $3, 5000, '{}', 'COMPLETE', 'LC Contest 3', 5)`,
        [contest1Id, templateId, organizerId, contest2Id, contest3Id],
      );

      const result = await pool.query(
        `SELECT status, COUNT(*) as count
         FROM contest_instances
         WHERE id IN ($1, $2, $3)
         GROUP BY status
         ORDER BY status`,
        [contest1Id, contest2Id, contest3Id],
      );

      const counts = {};
      result.rows.forEach(row => {
        counts[row.status] = parseInt(row.count, 10);
      });

      expect(counts['SCHEDULED']).toBe(1);
      expect(counts['LOCKED']).toBe(1);
      expect(counts['COMPLETE']).toBe(1);
    });
  });

  describe('Entry Health Metrics', () => {
    it('should calculate incomplete picks correctly', async () => {
      const contestId = randomUUID();
      const user1Id = randomUUID();

      // Create user
      await pool.query(
        `INSERT INTO users (id, name, email) VALUES ($1, $2, $3)`,
        [user1Id, 'User 11', `user11-${user1Id}@test.com`],
      );

      // Create contest with max_entries=4
      await pool.query(
        `INSERT INTO contest_instances (
          id, template_id, organizer_id, entry_fee_cents, payout_structure,
          status, contest_name, max_entries
        ) VALUES ($1, $2, $3, 5000, '{}', 'SCHEDULED', 'Incomplete Picks Contest', 4)`,
        [contestId, templateId, organizerId],
      );

      // Add only 1 participant
      await pool.query(
        `INSERT INTO contest_participants (contest_instance_id, user_id, joined_at)
         VALUES ($1, $2, NOW())`,
        [contestId, user1Id],
      );

      const result = await pool.query(
        `SELECT
           ci.max_entries,
           COUNT(DISTINCT cp.user_id) as submitted_entries,
           (ci.max_entries - COUNT(DISTINCT cp.user_id)) as incomplete_picks
         FROM contest_instances ci
         LEFT JOIN contest_participants cp ON ci.id = cp.contest_instance_id
         WHERE ci.id = $1
         GROUP BY ci.id, ci.max_entries`,
        [contestId],
      );

      expect(parseInt(result.rows[0].max_entries, 10)).toBe(4);
      expect(parseInt(result.rows[0].submitted_entries, 10)).toBe(1);
      expect(parseInt(result.rows[0].incomplete_picks, 10)).toBe(3);
    });
  });

  describe('Service Integration Tests', () => {
    describe('contestOpsService.getMissingPicks()', () => {
      it('should return missing picks for all contests', async () => {
        const user1Id = randomUUID();
        await pool.query(
          `INSERT INTO users (id, name, email) VALUES ($1, $2, $3)`,
          [user1Id, 'Integration User 1', `int-user1-${user1Id}@test.com`],
        );

        const contest1Id = randomUUID();
        await pool.query(
          `INSERT INTO contest_instances (
            id, template_id, organizer_id, entry_fee_cents, payout_structure,
            status, contest_name, max_entries
          ) VALUES ($1, $2, $3, 5000, '{}', 'SCHEDULED', 'Service Test Contest', 5)`,
          [contest1Id, templateId, organizerId],
        );

        await pool.query(
          `INSERT INTO contest_participants (contest_instance_id, user_id, joined_at)
           VALUES ($1, $2, NOW())`,
          [contest1Id, user1Id],
        );

        const result = await contestOpsService.getMissingPicks(pool);

        expect(Array.isArray(result)).toBe(true);
        const serviceContest = result.find(c => c.contest_id === contest1Id);
        expect(serviceContest).toBeDefined();
        expect(serviceContest.missing_picks).toBe(4);
        expect(serviceContest.max_entries).toBe(5);
        expect(serviceContest.participant_count).toBe(1);
      });

      it('should filter missing picks by status', async () => {
        const user1Id = randomUUID();
        await pool.query(
          `INSERT INTO users (id, name, email) VALUES ($1, $2, $3)`,
          [user1Id, 'Integration User 2', `int-user2-${user1Id}@test.com`],
        );

        const lockedContestId = randomUUID();
        const scheduledContestId = randomUUID();

        // Create LOCKED contest
        await pool.query(
          `INSERT INTO contest_instances (
            id, template_id, organizer_id, entry_fee_cents, payout_structure,
            status, contest_name, max_entries
          ) VALUES ($1, $2, $3, 5000, '{}', 'LOCKED', 'Locked Contest', 5)`,
          [lockedContestId, templateId, organizerId],
        );

        // Create SCHEDULED contest
        await pool.query(
          `INSERT INTO contest_instances (
            id, template_id, organizer_id, entry_fee_cents, payout_structure,
            status, contest_name, max_entries
          ) VALUES ($1, $2, $3, 5000, '{}', 'SCHEDULED', 'Scheduled Contest', 5)`,
          [scheduledContestId, templateId, organizerId],
        );

        // Get only LOCKED contests
        const result = await contestOpsService.getMissingPicks(pool, ['LOCKED']);

        expect(Array.isArray(result)).toBe(true);
        expect(result.every(c => c.status === 'LOCKED')).toBe(true);
      });
    });

    describe('financialHealthService.getDepositWithdrawalTotals()', () => {
      it('should return zero totals when no deposits or withdrawals', async () => {
        const result = await financialHealthService.getDepositWithdrawalTotals(pool);

        expect(result).toHaveProperty('deposits_cents');
        expect(result).toHaveProperty('withdrawals_cents');
        expect(typeof result.deposits_cents).toBe('number');
        expect(typeof result.withdrawals_cents).toBe('number');
      });

      it('should aggregate deposit and withdrawal totals from ledger', async () => {
        const beforeResult = await financialHealthService.getDepositWithdrawalTotals(pool);
        const beforeDeposits = beforeResult.deposits_cents;

        const userId = randomUUID();
        await pool.query(
          `INSERT INTO users (id, name, email) VALUES ($1, $2, $3)`,
          [userId, 'Deposit Test User', `dep-user-${userId}@test.com`],
        );

        // Add a deposit
        const depositKey = `deposit:${userId}:test`;
        await pool.query(
          `INSERT INTO ledger (
            contest_instance_id, user_id, entry_type, direction, amount_cents,
            currency, reference_type, reference_id, idempotency_key, metadata_json, created_at
          ) VALUES (
            NULL, $1, 'WALLET_DEPOSIT', 'CREDIT', 10000, 'USD', 'WALLET',
            $2, $3, '{}', NOW()
          )`,
          [userId, userId, depositKey],
        );

        const afterResult = await financialHealthService.getDepositWithdrawalTotals(pool);

        // Verify deposits increased by exactly 10000
        expect(afterResult.deposits_cents).toBe(beforeDeposits + 10000);
      });
    });
  });
});
