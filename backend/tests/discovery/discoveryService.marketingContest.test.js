/**
 * Discovery Tier Ladder and Marketing Contest Tests
 *
 * Verifies that createContestsForEvent() creates exactly 5 tier contests
 * with the highest tier deterministically marked as is_primary_marketing = true.
 *
 * Architecture:
 * - discoverTournament() creates templates only
 * - createContestsForEvent() creates contest instances with tier ladder
 * - Highest tier ($100) is always marked is_primary_marketing = true
 */

const { Pool } = require('pg');
const { discoverTournament } = require('../../services/discovery/discoveryService');
const { createContestsForEvent } = require('../../services/discovery/discoveryContestCreationService');

describe('Discovery Tier Ladder and Marketing Contest', () => {
  let pool;
  const now = new Date('2026-03-01T12:00:00Z');
  const testOrganizerId = '00000000-0000-0000-0000-000000000001';

  const eventId = 'espn_pga_tier_test_2026';

  const validInput = {
    provider_tournament_id: eventId,
    season_year: 2026,
    name: 'PGA Tier Test 2026',
    start_time: new Date('2026-03-15T08:00:00Z'),
    end_time: new Date('2026-03-18T20:00:00Z'),
    status: 'SCHEDULED'
  };

  const testEvent = {
    provider_event_id: eventId,
    name: 'PGA Tier Test Tournament',
    start_time: new Date('2026-03-15T08:00:00Z'),
    end_time: new Date('2026-03-18T20:00:00Z')
  };

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    await pool.query(
      `INSERT INTO users (id, email, username) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [testOrganizerId, 'test-organizer@example.com', 'test-organizer']
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  afterEach(async () => {
    // Clean up test data
    await pool.query(
      `DELETE FROM admin_contest_audit
       WHERE contest_instance_id IN (
         SELECT id FROM contest_instances
         WHERE provider_event_id = $1
       )`,
      [eventId]
    );
    await pool.query(
      `DELETE FROM contest_instances
       WHERE provider_event_id = $1`,
      [eventId]
    );
    await pool.query(
      `DELETE FROM contest_templates
       WHERE provider_tournament_id = $1`,
      [eventId]
    );
  });

  describe('Tier ladder creation', () => {
    it('should create exactly 5 contests from tier ladder', async () => {
      // Step 1: Create template (no contests yet)
      const templateResult = await discoverTournament(validInput, pool, now, testOrganizerId);
      expect(templateResult.success).toBe(true);
      expect(templateResult.templateId).toBeTruthy();

      // Step 2: Create contests for event
      const contestResult = await createContestsForEvent(pool, testEvent, now, testOrganizerId);
      expect(contestResult.success).toBe(true);
      expect(contestResult.created).toBe(5); // Exactly 5 tiers

      // Verify all 5 contests exist
      const contests = await pool.query(
        `SELECT entry_fee_cents, is_primary_marketing, contest_name
         FROM contest_instances
         WHERE provider_event_id = $1
         ORDER BY entry_fee_cents ASC`,
        [testEvent.provider_event_id]
      );

      expect(contests.rows).toHaveLength(5);

      // Verify tier values: $5, $10, $20, $50, $100
      const expectedFees = [500, 1000, 2000, 5000, 10000];
      contests.rows.forEach((row, i) => {
        expect(row.entry_fee_cents).toBe(expectedFees[i]);
        expect(row.contest_name).toContain('PGA Tier Test Tournament');
      });
    });

    it('should mark highest tier as marketing contest', async () => {
      // Create template
      const templateResult = await discoverTournament(validInput, pool, now, testOrganizerId);
      expect(templateResult.success).toBe(true);

      // Create contests
      const contestResult = await createContestsForEvent(pool, testEvent, now, testOrganizerId);
      expect(contestResult.success).toBe(true);

      // Verify exactly one marketing contest (highest tier)
      const marketingContests = await pool.query(
        `SELECT entry_fee_cents FROM contest_instances
         WHERE provider_event_id = $1 AND is_primary_marketing = true`,
        [testEvent.provider_event_id]
      );

      expect(marketingContests.rows).toHaveLength(1);
      expect(marketingContests.rows[0].entry_fee_cents).toBe(10000); // $100
    });

    it('should have only one primary marketing contest', async () => {
      // Create template
      await discoverTournament(validInput, pool, now, testOrganizerId);

      // Create contests
      await createContestsForEvent(pool, testEvent, now, testOrganizerId);

      // Count primary marketing contests
      const marketingCount = await pool.query(
        `SELECT COUNT(*) as count FROM contest_instances
         WHERE provider_event_id = $1 AND is_primary_marketing = true`,
        [testEvent.provider_event_id]
      );

      expect(parseInt(marketingCount.rows[0].count, 10)).toBe(1);
    });

    it('should mark non-highest tiers as non-marketing', async () => {
      // Create template
      await discoverTournament(validInput, pool, now, testOrganizerId);

      // Create contests
      await createContestsForEvent(pool, testEvent, now, testOrganizerId);

      // Verify lower tiers are not marketing
      const nonMarketing = await pool.query(
        `SELECT COUNT(*) as count FROM contest_instances
         WHERE provider_event_id = $1
         AND is_primary_marketing = false
         AND entry_fee_cents < 10000`,
        [testEvent.provider_event_id]
      );

      expect(parseInt(nonMarketing.rows[0].count, 10)).toBe(4); // 4 non-marketing contests
    });

    it('should generate contest names correctly', async () => {
      // Create template
      await discoverTournament(validInput, pool, now, testOrganizerId);

      // Create contests
      await createContestsForEvent(pool, testEvent, now, testOrganizerId);

      // Verify contest names
      const contests = await pool.query(
        `SELECT entry_fee_cents, contest_name FROM contest_instances
         WHERE provider_event_id = $1
         ORDER BY entry_fee_cents ASC`,
        [testEvent.provider_event_id]
      );

      const expectedNames = [
        'PGA Tier Test Tournament — $5',
        'PGA Tier Test Tournament — $10',
        'PGA Tier Test Tournament — $20',
        'PGA Tier Test Tournament — $50',
        'PGA Tier Test Tournament — $100'
      ];

      contests.rows.forEach((row, i) => {
        expect(row.contest_name).toBe(expectedNames[i]);
      });
    });

    it('should set all contests to SCHEDULED status', async () => {
      // Create template
      await discoverTournament(validInput, pool, now, testOrganizerId);

      // Create contests
      await createContestsForEvent(pool, testEvent, now, testOrganizerId);

      // Verify all SCHEDULED
      const statuses = await pool.query(
        `SELECT DISTINCT status FROM contest_instances
         WHERE provider_event_id = $1`,
        [testEvent.provider_event_id]
      );

      expect(statuses.rows).toHaveLength(1);
      expect(statuses.rows[0].status).toBe('SCHEDULED');
    });

    it('should be idempotent: creating twice produces exactly 5 contests', async () => {
      // Create template
      await discoverTournament(validInput, pool, now, testOrganizerId);

      // Create contests first time
      const result1 = await createContestsForEvent(pool, testEvent, now, testOrganizerId);
      expect(result1.created).toBe(5);

      // Try to create contests again (should skip due to ON CONFLICT)
      const result2 = await createContestsForEvent(pool, testEvent, now, testOrganizerId);
      expect(result2.created).toBe(0); // All already exist
      expect(result2.skipped).toBe(5);

      // Verify still exactly 5 contests
      const finalCount = await pool.query(
        `SELECT COUNT(*) as count FROM contest_instances
         WHERE provider_event_id = $1`,
        [testEvent.provider_event_id]
      );

      expect(parseInt(finalCount.rows[0].count, 10)).toBe(5);
    });

    it('should generate join tokens for all contests', async () => {
      // Create template
      await discoverTournament(validInput, pool, now, testOrganizerId);

      // Create contests
      await createContestsForEvent(pool, testEvent, now, testOrganizerId);

      // Verify all have join tokens
      const contests = await pool.query(
        `SELECT join_token FROM contest_instances
         WHERE provider_event_id = $1`,
        [testEvent.provider_event_id]
      );

      contests.rows.forEach(row => {
        expect(row.join_token).not.toBeNull();
        expect(typeof row.join_token).toBe('string');
        expect(row.join_token.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Deterministic marketing selection', () => {
    it('$100 tier is always the marketing contest', async () => {
      // Create template
      await discoverTournament(validInput, pool, now, testOrganizerId);

      // Create contests
      await createContestsForEvent(pool, testEvent, now, testOrganizerId);

      // Verify $100 is marketing
      const contest = await pool.query(
        `SELECT is_primary_marketing FROM contest_instances
         WHERE provider_event_id = $1 AND entry_fee_cents = 10000`,
        [testEvent.provider_event_id]
      );

      expect(contest.rows).toHaveLength(1);
      expect(contest.rows[0].is_primary_marketing).toBe(true);
    });

    it('$5, $10, $20, $50 are never marketing', async () => {
      // Create template
      await discoverTournament(validInput, pool, now, testOrganizerId);

      // Create contests
      await createContestsForEvent(pool, testEvent, now, testOrganizerId);

      // Verify lower tiers are not marketing
      const lowerTiers = await pool.query(
        `SELECT entry_fee_cents, is_primary_marketing FROM contest_instances
         WHERE provider_event_id = $1 AND entry_fee_cents < 10000
         ORDER BY entry_fee_cents ASC`,
        [testEvent.provider_event_id]
      );

      expect(lowerTiers.rows).toHaveLength(4);
      lowerTiers.rows.forEach(row => {
        expect(row.is_primary_marketing).toBe(false);
      });
    });
  });
});
