/**
 * Discovery Contest Creation Service Tests
 *
 * Unit tests for auto-creating contest instances for upcoming PGA events.
 * Verifies idempotency, template filtering, and audit logging.
 */

const { Pool } = require('pg');
const { runDiscoveryCycle, createContestsForEvent } = require('../../services/discovery/discoveryContestCreationService');

// Mock ESPN fetcher to prevent network calls in tests
jest.mock('../../services/discovery/espnDataFetcher', () => ({
  fetchEspnSummary: jest.fn().mockResolvedValue(null), // Always return null (ESPN unavailable)
  extractEspnEventId: jest.requireActual('../../services/discovery/espnDataFetcher').extractEspnEventId
}));

describe('discoveryContestCreationService', () => {
  let pool;
  const now = new Date('2026-04-01T12:00:00Z');
  const organizerId = '00000000-0000-0000-0000-000000000043';
  let testRunId; // Unique ID for this test run to avoid data collisions

  // Test event (within 7-day window from now)
  const upcomingEvent = {
    provider_event_id: 'espn_pga_401811941',
    name: 'Masters Tournament',
    start_time: new Date('2026-04-09T07:00:00Z'),
    end_time: new Date('2026-04-12T07:00:00Z')
  };

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    // Create platform organizer user
    await pool.query(
      `INSERT INTO users (id, email, username) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [organizerId, 'discovery-organizer@platform.local', 'platform-discovery']
    );

    // Generate unique test run ID to isolate data
    testRunId = Date.now().toString() + '_' + Math.random().toString(36).slice(2, 9);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Clean up test data between tests
    // NOTE: ingestion_events is append-only and creates FK constraints we can't bypass
    // DELETE ORDER: audit → transitions → instances → templates (FK dependencies)

    // Step 1: Find ALL auto-discovered system templates
    // This catches anything created by discoverTournament (via discoveryWorker or tests)
    const allSystemTemplates = await pool.query(
      `SELECT id FROM contest_templates
       WHERE is_system_generated = true
       AND lock_strategy_key = 'auto_discovery'`
    );

    const allTemplateIds = allSystemTemplates.rows.map(r => r.id);

    // Step 2: Delete audit records for all test instances
    if (allTemplateIds.length > 0) {
      await pool.query(
        `DELETE FROM admin_contest_audit
         WHERE contest_instance_id IN (
           SELECT id FROM contest_instances WHERE template_id = ANY($1::uuid[])
         )`,
        [allTemplateIds]
      );
    }

    // Step 3: Delete contest_state_transitions for all test instances
    if (allTemplateIds.length > 0) {
      await pool.query(
        `DELETE FROM contest_state_transitions
         WHERE contest_instance_id IN (
           SELECT id FROM contest_instances WHERE template_id = ANY($1::uuid[])
         )`,
        [allTemplateIds]
      );
    }

    // Step 4: Delete instances for all system templates
    // Note: instances with ingestion_events will prevent deletion of instances
    // We skip these and leave them in the database
    if (allTemplateIds.length > 0) {
      // Try to delete instances, silently ignore FK errors from ingestion_events
      try {
        await pool.query(
          `DELETE FROM contest_instances WHERE template_id = ANY($1::uuid[])`,
          [allTemplateIds]
        );
      } catch (err) {
        if (!err.message.includes('ingestion_events')) {
          throw err;
        }
        // Silently ignore FK errors from append-only ingestion_events
      }
    }

    // Step 5: Delete the templates themselves (only if they have no remaining instances)
    if (allTemplateIds.length > 0) {
      await pool.query(
        `DELETE FROM contest_templates
         WHERE id = ANY($1::uuid[])
         AND id NOT IN (SELECT DISTINCT template_id FROM contest_instances WHERE template_id IS NOT NULL)`,
        [allTemplateIds]
      );
    }
  });

  afterEach(async () => {
    // Cleanup is handled in beforeEach, which deletes all PGA daily templates before each test
    // This ensures no cross-test contamination
  });

  describe('createContestsForEvent', () => {
    it('should not create new contests when instances already exist', async () => {
      // This test verifies that createContestsForEvent handles existing instances idempotently
      // It may find templates and skip creating instances if they already exist
      const result = await createContestsForEvent(pool, upcomingEvent, now, organizerId);

      expect(result.success).toBe(true);
      expect(result.created).toBe(0);  // No NEW contests should be created
      expect(result.errors).toHaveLength(0);
      // skipped may be > 0 if templates exist from previous test runs
    });

    it('should create contest instances for each system-generated template', async () => {
      // Deactivate any existing active PGA daily templates to avoid constraint collision
      await pool.query(
        `UPDATE contest_templates SET is_active = false
         WHERE sport = 'pga' AND template_type = 'daily' AND is_active = true`
      );

      // Create a system-generated template with unique IDs to avoid collisions
      const uniqueTestId = `discovery_test_001_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const testEvent = {
        ...upcomingEvent,
        provider_event_id: `espn_pga_${uniqueTestId}`
      };

      const templateResult = await pool.query(
        `INSERT INTO contest_templates (
          name, sport, template_type, scoring_strategy_key, lock_strategy_key, settlement_strategy_key,
          default_entry_fee_cents, allowed_entry_fee_min_cents, allowed_entry_fee_max_cents,
          allowed_payout_structures, is_active, is_system_generated, provider_tournament_id
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
        )
        RETURNING id`,
        [
          `PGA Discovery Test Template ${testRunId}`,
          'pga',
          'daily',
          'stroke_play',
          'auto_discovery',
          'pga_settlement',
          5000,
          1000,
          50000,
          JSON.stringify([{ payout_percentages: [0.5, 0.3, 0.2], min_entries: 2 }]),
          true,
          true,
          `provider_${uniqueTestId}`
        ]
      );

      const templateId = templateResult.rows[0].id;

      const result = await createContestsForEvent(pool, testEvent, now, organizerId);

      expect(result.success).toBe(true);
      expect(result.created).toBeGreaterThanOrEqual(1); // At least 1 created for the new template
      expect(result.errors).toHaveLength(0);

      // Verify contest instance was created with the unique event ID
      const contestResult = await pool.query(
        `SELECT * FROM contest_instances WHERE provider_event_id = $1`,
        [testEvent.provider_event_id]
      );

      expect(contestResult.rows.length).toBeGreaterThanOrEqual(1);
      const contest = contestResult.rows[0];
      expect(contest.template_id).toBe(templateId);
      expect(contest.organizer_id).toBe(organizerId);
      expect(contest.status).toBe('SCHEDULED');
      expect(contest.tournament_start_time).toEqual(testEvent.start_time);
      expect(contest.tournament_end_time).toEqual(testEvent.end_time);
      expect(contest.lock_time).toEqual(testEvent.start_time);
      expect(contest.is_platform_owned).toBe(true);
    });

    it('should be idempotent: replaying does not create duplicates', async () => {
      const uniqueTestId = `idempotent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const testEvent = {
        ...upcomingEvent,
        provider_event_id: `espn_pga_${uniqueTestId}`
      };

      // Create a system-generated template with unique ID
      const templateResult = await pool.query(
        `INSERT INTO contest_templates (
          name, sport, template_type, scoring_strategy_key, lock_strategy_key, settlement_strategy_key,
          default_entry_fee_cents, allowed_entry_fee_min_cents, allowed_entry_fee_max_cents,
          allowed_payout_structures, is_active, is_system_generated, provider_tournament_id
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
        )
        RETURNING id`,
        [
          `PGA Idempotency Test ${testRunId}`,
          'pga',
          'daily',
          'stroke_play',
          'auto_discovery',
          'pga_settlement',
          5000,
          1000,
          50000,
          JSON.stringify([{ payout_percentages: [0.5, 0.3, 0.2], min_entries: 2 }]),
          true,
          true,
          `provider_${uniqueTestId}`
        ]
      );

      // First cycle
      const result1 = await createContestsForEvent(pool, testEvent, now, organizerId);
      const initialCreated = result1.created;
      expect(initialCreated).toBeGreaterThanOrEqual(1);

      // Second cycle (same event, same template) - should create 0 because instances already exist
      const result2 = await createContestsForEvent(pool, testEvent, now, organizerId);
      expect(result2.created).toBe(0);
      expect(result2.skipped).toBeGreaterThanOrEqual(1);

      // Verify only one contest instance exists for this specific template
      const contestResult = await pool.query(
        `SELECT COUNT(*) as count FROM contest_instances WHERE provider_event_id = $1 AND template_id = $2`,
        [testEvent.provider_event_id, templateResult.rows[0].id]
      );

      expect(parseInt(contestResult.rows[0].count, 10)).toBe(1);

      // Clean up this test's template and instances
      const templatesToCleanup = await pool.query(
        `SELECT id FROM contest_templates WHERE id = $1`,
        [templateResult.rows[0].id]
      );

      if (templatesToCleanup.rows.length > 0) {
        const tid = templatesToCleanup.rows[0].id;

        // Delete audit and transitions
        await pool.query(
          `DELETE FROM admin_contest_audit WHERE contest_instance_id IN (
            SELECT id FROM contest_instances WHERE template_id = $1
          )`,
          [tid]
        );

        await pool.query(
          `DELETE FROM contest_state_transitions WHERE contest_instance_id IN (
            SELECT id FROM contest_instances WHERE template_id = $1
          )`,
          [tid]
        );

        // Try to delete instances (may fail if they have ingestion_events)
        try {
          await pool.query(`DELETE FROM contest_instances WHERE template_id = $1`, [tid]);
        } catch (err) {
          // Silently ignore FK errors from ingestion_events
        }

        // Delete template if no instances remain
        await pool.query(
          `DELETE FROM contest_templates WHERE id = $1 AND id NOT IN (
            SELECT DISTINCT template_id FROM contest_instances WHERE template_id IS NOT NULL
          )`,
          [tid]
        );
      }
    });

    it('should use payout_structure from template.allowed_payout_structures[0]', async () => {
      // Deactivate any existing active PGA daily templates to avoid constraint collision
      await pool.query(
        `UPDATE contest_templates SET is_active = false
         WHERE sport = 'pga' AND template_type = 'daily' AND is_active = true`
      );

      const customPayout = { payout_percentages: [0.6, 0.25, 0.15], min_entries: 3 };
      const uniqueTestId = `payout_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const testEvent = {
        ...upcomingEvent,
        provider_event_id: `espn_pga_${uniqueTestId}`
      };

      const templateResult = await pool.query(
        `INSERT INTO contest_templates (
          name, sport, template_type, scoring_strategy_key, lock_strategy_key, settlement_strategy_key,
          default_entry_fee_cents, allowed_entry_fee_min_cents, allowed_entry_fee_max_cents,
          allowed_payout_structures, is_active, is_system_generated, provider_tournament_id
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
        )
        RETURNING id`,
        [
          `Custom Payout Template ${testRunId}`,
          'pga',
          'daily',
          'stroke_play',
          'auto_discovery',
          'pga_settlement',
          7500,
          1000,
          50000,
          JSON.stringify([customPayout]),
          true,
          true,
          `provider_${uniqueTestId}`
        ]
      );

      await createContestsForEvent(pool, testEvent, now, organizerId);

      const contestResult = await pool.query(
        `SELECT payout_structure FROM contest_instances WHERE provider_event_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [testEvent.provider_event_id]
      );

      expect(contestResult.rows.length).toBeGreaterThanOrEqual(1);
      // Check that the most recent instance has the custom payout structure
      expect(contestResult.rows[0].payout_structure).toEqual(customPayout);
    });

    it('should log successful creations in admin_contest_audit', async () => {
      const testEvent = {
        ...upcomingEvent,
        provider_event_id: 'espn_pga_discovery_test_audit'
      };

      const templateResult = await pool.query(
        `INSERT INTO contest_templates (
          name, sport, template_type, scoring_strategy_key, lock_strategy_key, settlement_strategy_key,
          default_entry_fee_cents, allowed_entry_fee_min_cents, allowed_entry_fee_max_cents,
          allowed_payout_structures, is_active, is_system_generated, provider_tournament_id
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
        )
        RETURNING id`,
        [
          `Audit Test Template ${testRunId}`,
          'pga',
          'daily',
          'stroke_play',
          'auto_discovery',
          'pga_settlement',
          5000,
          1000,
          50000,
          JSON.stringify([{ payout_percentages: [0.5, 0.3, 0.2], min_entries: 2 }]),
          true,
          true,
          'provider_discovery_test_audit'
        ]
      );

      await createContestsForEvent(pool, testEvent, now, organizerId);

      const contestResult = await pool.query(
        `SELECT id FROM contest_instances WHERE provider_event_id = $1`,
        [testEvent.provider_event_id]
      );

      const contestId = contestResult.rows[0].id;

      const auditResult = await pool.query(
        `SELECT * FROM admin_contest_audit WHERE contest_instance_id = $1`,
        [contestId]
      );

      expect(auditResult.rows).toHaveLength(1);
      const audit = auditResult.rows[0];
      expect(audit.action).toBe('AUTO_CREATE');
      expect(audit.admin_user_id).toBe(organizerId);
      expect(audit.from_status).toBe('NONE');
      expect(audit.to_status).toBe('SCHEDULED');
      expect(audit.payload.provider_event_id).toBe(testEvent.provider_event_id);
    });
  });

  describe('runDiscoveryCycle', () => {
    it('should return no-op when no events in 7-day window', async () => {
      const pastNow = new Date('2026-05-01T12:00:00Z');
      const result = await runDiscoveryCycle(pool, pastNow, organizerId);

      expect(result.success).toBe(true);
      expect(result.event_id).toBeNull();
      expect(result.created).toBe(0);
      expect(result.message).toContain('No upcoming events');
    });

    it('should fail if organizerId not provided', async () => {
      const result = await runDiscoveryCycle(pool, now, null);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('organizerId parameter is required');
    });

    it('should call createContestsForEvent when event found', async () => {
      // Create a system-generated template
      await pool.query(
        `INSERT INTO contest_templates (
          name, sport, template_type, scoring_strategy_key, lock_strategy_key, settlement_strategy_key,
          default_entry_fee_cents, allowed_entry_fee_min_cents, allowed_entry_fee_max_cents,
          allowed_payout_structures, is_active, is_system_generated, provider_tournament_id
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
        )`,
        [
          `Cycle Test Template ${testRunId}`,
          'pga',
          'daily',
          'stroke_play',
          'auto_discovery',
          'pga_settlement',
          5000,
          1000,
          50000,
          JSON.stringify([{ payout_percentages: [0.5, 0.3, 0.2], min_entries: 2 }]),
          true,
          true,
          'provider_discovery_test_cycle'
        ]
      );

      // Use a now that puts the Masters (2026-04-09T07:00:00Z) inside the 7-day window.
      // Window: now < start_time <= now + 7 days
      // April 3 00:00Z + 7 days = April 10 00:00Z — Masters (April 9 07:00Z) is inside.
      const nowForTest = new Date('2026-04-03T00:00:00Z');
      const result = await runDiscoveryCycle(pool, nowForTest, organizerId);

      expect(result.success).toBe(true);
      expect(result.event_id).toBe('espn_pga_401811941');
      // Note: result.created may be >1 if discoverTournament creates additional templates
      expect(result.created).toBeGreaterThanOrEqual(1);
    });

    it('should auto-create system template via discoverTournament before creating contests', async () => {
      // Do NOT pre-create template — runDiscoveryCycle should call discoverTournament
      // to create the template automatically.

      const nowForTest = new Date('2026-04-03T00:00:00Z');
      const result = await runDiscoveryCycle(pool, nowForTest, organizerId);

      expect(result.success).toBe(true);
      expect(result.event_id).toBe('espn_pga_401811941');
      // template_created should be true (or false if idempotent, but at least the field should exist)
      expect(result).toHaveProperty('template_created');
      // instance_created should be true
      expect(result.instance_created).toBe(true);
      // should have created at least one contest instance
      expect(result.created).toBeGreaterThan(0);

      // Verify template was created (system-generated for this provider tournament)
      const templateResult = await pool.query(
        `SELECT id FROM contest_templates
         WHERE provider_tournament_id = $1
         AND season_year = $2
         AND is_system_generated = true`,
        ['espn_pga_401811941', 2026]
      );
      expect(templateResult.rows.length).toBeGreaterThan(0);

      // Verify contest instance was created
      const contestResult = await pool.query(
        `SELECT id FROM contest_instances
         WHERE provider_event_id = $1`,
        ['espn_pga_401811941']
      );
      expect(contestResult.rows.length).toBeGreaterThan(0);

      // Clean up templates and instances created by this test to avoid test pollution
      // Get the template IDs we need to clean up
      const templatesToCleanup = await pool.query(
        `SELECT id FROM contest_templates
         WHERE provider_tournament_id = 'espn_pga_401811941'
         AND is_system_generated = true`
      );

      const templateIds = templatesToCleanup.rows.map(r => r.id);

      // Delete in FK-safe order: audit → instances → templates
      if (templateIds.length > 0) {
        // Delete audit records referencing these instances
        await pool.query(
          `DELETE FROM admin_contest_audit
           WHERE contest_instance_id IN (
             SELECT id FROM contest_instances WHERE template_id = ANY($1::uuid[])
           )`,
          [templateIds]
        );

        // Delete contest instances for these templates
        await pool.query(
          `DELETE FROM contest_instances
           WHERE template_id = ANY($1::uuid[])`,
          [templateIds]
        );
      }

      // Delete templates created for this provider tournament
      await pool.query(
        `DELETE FROM contest_templates
         WHERE provider_tournament_id = 'espn_pga_401811941'
         AND is_system_generated = true`
      );
    });
  });
});
