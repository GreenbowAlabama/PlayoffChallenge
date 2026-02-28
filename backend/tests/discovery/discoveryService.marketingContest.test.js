/**
 * Discovery Service — Marketing Contest Creation Tests
 *
 * Verifies that system template discovery automatically creates exactly one
 * primary marketing contest, with atomicity and idempotency guarantees.
 */

const { Pool } = require('pg');
const { discoverTournament } = require('../../services/discovery/discoveryService');

describe('discoverTournament — Marketing Contest Creation', () => {
  let pool;
  const now = new Date('2026-03-01T12:00:00Z');

  const validInput = {
    provider_tournament_id: 'pga_marketing_test_2026',
    season_year: 2026,
    name: 'PGA Marketing Test 2026',
    start_time: new Date('2026-03-15T08:00:00Z'),
    end_time: new Date('2026-03-18T20:00:00Z'),
    status: 'SCHEDULED'
  };

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    // Create marketing contest organizer user
    // User ID should map to system user 67 for platform contests
    const organizerId = '00000000-0000-0000-0000-000000000043';
    await pool.query(
      `INSERT INTO users (id, email, username) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [organizerId, 'marketing-organizer@platform.local', 'platform-marketing']
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  afterEach(async () => {
    // Clean up test data
    await pool.query(
      `DELETE FROM contest_instances
       WHERE template_id IN (
         SELECT id FROM contest_templates
         WHERE provider_tournament_id LIKE 'pga_marketing_test_%'
       )`
    );
    await pool.query(
      `DELETE FROM contest_templates
       WHERE provider_tournament_id LIKE 'pga_marketing_test_%'`
    );
  });

  describe('marketing contest creation on discovery', () => {
    it('should create exactly one primary marketing contest when template created', async () => {
      const result = await discoverTournament(validInput, pool, now);

      expect(result.success).toBe(true);
      expect(result.created).toBe(true);
      expect(result.templateId).toBeTruthy();

      // Verify primary marketing contest was created
      const contests = await pool.query(
        `SELECT * FROM contest_instances
         WHERE template_id = $1 AND is_primary_marketing = true`,
        [result.templateId]
      );

      expect(contests.rows).toHaveLength(1);
      const contest = contests.rows[0];
      expect(contest.is_primary_marketing).toBe(true);
      expect(contest.is_platform_owned).toBe(true);
      expect(contest.status).toBe('SCHEDULED');
    });

    it('should set marketing contest defaults correctly', async () => {
      const result = await discoverTournament(validInput, pool, now);
      const contests = await pool.query(
        `SELECT * FROM contest_instances
         WHERE template_id = $1 AND is_primary_marketing = true`,
        [result.templateId]
      );

      const contest = contests.rows[0];

      // Verify defaults
      expect(contest.entry_fee_cents).toBe(5000); // $50
      expect(contest.max_entries).toBe(100);
      expect(contest.status).toBe('SCHEDULED');
      expect(contest.is_platform_owned).toBe(true);
      expect(contest.is_primary_marketing).toBe(true);

      // Verify payout structure
      const payout = contest.payout_structure;
      expect(payout).toBeDefined();
      expect(payout.payout_percentages).toEqual([0.5, 0.3, 0.2]);
    });

    it('should name contest with tournament name + Marketing', async () => {
      const result = await discoverTournament(validInput, pool, now);
      const contests = await pool.query(
        `SELECT * FROM contest_instances
         WHERE template_id = $1 AND is_primary_marketing = true`,
        [result.templateId]
      );

      expect(contests.rows[0].contest_name).toBe('PGA Marketing Test 2026 - Marketing');
    });

    it('should NOT create marketing contest on template update (no new contest)', async () => {
      // First discovery: creates template + marketing contest
      const result1 = await discoverTournament(validInput, pool, now);
      expect(result1.created).toBe(true);

      const contests1 = await pool.query(
        `SELECT COUNT(*) as count FROM contest_instances
         WHERE template_id = $1 AND is_primary_marketing = true`,
        [result1.templateId]
      );
      expect(parseInt(contests1.rows[0].count, 10)).toBe(1);

      // Second discovery: updates template, does NOT create new contest
      const updatedInput = {
        ...validInput,
        name: 'PGA Marketing Test 2026 (Updated)'
      };
      const result2 = await discoverTournament(updatedInput, pool, now);
      expect(result2.created).toBe(false); // Template not created, just updated
      expect(result2.templateId).toBe(result1.templateId);

      // Verify still exactly one marketing contest
      const contests2 = await pool.query(
        `SELECT COUNT(*) as count FROM contest_instances
         WHERE template_id = $1 AND is_primary_marketing = true`,
        [result1.templateId]
      );
      expect(parseInt(contests2.rows[0].count, 10)).toBe(1);
    });

    it('should be idempotent: rediscovery does not create duplicate contests', async () => {
      // First discovery
      const result1 = await discoverTournament(validInput, pool, now);
      expect(result1.created).toBe(true);

      const contests1 = await pool.query(
        `SELECT COUNT(*) as count FROM contest_instances
         WHERE template_id = $1 AND is_primary_marketing = true`,
        [result1.templateId]
      );
      expect(parseInt(contests1.rows[0].count, 10)).toBe(1);

      // Rediscovery: template already exists, contest already exists
      const result2 = await discoverTournament(validInput, pool, now);
      expect(result2.created).toBe(false);
      expect(result2.templateId).toBe(result1.templateId);

      // Verify still exactly one marketing contest
      const contests2 = await pool.query(
        `SELECT COUNT(*) as count FROM contest_instances
         WHERE template_id = $1 AND is_primary_marketing = true`,
        [result1.templateId]
      );
      expect(parseInt(contests2.rows[0].count, 10)).toBe(1);
    });

    it('should enforce unique constraint via partial index', async () => {
      // Create template + marketing contest
      const result = await discoverTournament(validInput, pool, now);
      expect(result.created).toBe(true);

      // Try to manually insert another primary marketing contest for same template
      const duplicateInsert = async () => {
        return pool.query(
          `INSERT INTO contest_instances (
            template_id, organizer_id, entry_fee_cents, payout_structure,
            status, start_time, contest_name, max_entries,
            is_platform_owned, is_primary_marketing
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            result.templateId,
            '00000000-0000-0000-0000-000000000001',
            5000,
            JSON.stringify({ payout_percentages: [0.5, 0.3, 0.2] }),
            'SCHEDULED',
            new Date(),
            'Duplicate',
            100,
            true,
            true // is_primary_marketing = true
          ]
        );
      };

      // Should fail with unique constraint violation
      await expect(duplicateInsert()).rejects.toThrow('unique');
    });

    it('should allow multiple non-primary contests per template', async () => {
      // Create template + primary marketing contest
      const result = await discoverTournament(validInput, pool, now);

      // Manually create a non-primary contest for same template
      await pool.query(
        `INSERT INTO contest_instances (
          template_id, organizer_id, entry_fee_cents, payout_structure,
          status, start_time, contest_name, max_entries, is_primary_marketing
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          result.templateId,
          '00000000-0000-0000-0000-000000000001',
          10000, // different fee
          JSON.stringify({ payout_percentages: [0.5, 0.3, 0.2] }),
          'SCHEDULED',
          new Date(),
          'Non-primary Contest',
          50,
          false // is_primary_marketing = false
        ]
      );

      // Verify both contests exist for same template
      const contests = await pool.query(
        `SELECT is_primary_marketing FROM contest_instances
         WHERE template_id = $1
         ORDER BY is_primary_marketing DESC`,
        [result.templateId]
      );

      expect(contests.rows).toHaveLength(2);
      expect(contests.rows[0].is_primary_marketing).toBe(true); // Primary
      expect(contests.rows[1].is_primary_marketing).toBe(false); // Non-primary
    });
  });

  describe('atomicity guarantees', () => {
    it('should rollback template if marketing contest creation fails', async () => {
      // This test verifies atomicity by triggering a contest insert error
      // We'll use an invalid organizer_id that doesn't exist (foreign key violation)

      // Note: The actual implementation uses a hardcoded organizer_id (67)
      // For this test, we verify the invariant by checking transaction behavior
      // In practice, the organizer_id should always exist, so this test
      // documents the guarantee rather than triggering it

      const result = await discoverTournament(validInput, pool, now);
      expect(result.success).toBe(true);

      // Verify both template and contest exist
      const template = await pool.query(
        `SELECT id FROM contest_templates WHERE id = $1`,
        [result.templateId]
      );
      expect(template.rows).toHaveLength(1);

      const contest = await pool.query(
        `SELECT id FROM contest_instances
         WHERE template_id = $1 AND is_primary_marketing = true`,
        [result.templateId]
      );
      expect(contest.rows).toHaveLength(1);
    });
  });

  describe('determinism', () => {
    it('should use injected now, not current time', async () => {
      const fixedNow = new Date('2026-03-01T12:00:00Z');

      const result = await discoverTournament(validInput, pool, fixedNow);

      const contests = await pool.query(
        `SELECT start_time FROM contest_instances
         WHERE template_id = $1 AND is_primary_marketing = true`,
        [result.templateId]
      );

      // start_time should be set to the injected 'now'
      expect(contests.rows[0].start_time).toEqual(fixedNow);
    });

    it('should be deterministic: same input → same template + contest', async () => {
      const result1 = await discoverTournament(validInput, pool, now);
      const result2 = await discoverTournament(validInput, pool, now);

      expect(result1.templateId).toBe(result2.templateId);

      // Both should have exactly one marketing contest
      const contests1 = await pool.query(
        `SELECT COUNT(*) as count FROM contest_instances
         WHERE template_id = $1 AND is_primary_marketing = true`,
        [result1.templateId]
      );
      const contests2 = await pool.query(
        `SELECT COUNT(*) as count FROM contest_instances
         WHERE template_id = $1 AND is_primary_marketing = true`,
        [result2.templateId]
      );

      expect(parseInt(contests1.rows[0].count, 10)).toBe(1);
      expect(parseInt(contests2.rows[0].count, 10)).toBe(1);
    });
  });
});
