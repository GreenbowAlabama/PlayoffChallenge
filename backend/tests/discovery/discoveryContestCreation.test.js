/**
 * Discovery Contest Creation Service Tests
 *
 * Unit tests for auto-creating contest instances for upcoming PGA events.
 * Verifies idempotency, template filtering, and audit logging.
 */

const { Pool } = require('pg');
const { runDiscoveryCycle, createContestsForEvent } = require('../../services/discovery/discoveryContestCreationService');

describe('discoveryContestCreationService', () => {
  let pool;
  const now = new Date('2026-04-01T12:00:00Z');
  const organizerId = '00000000-0000-0000-0000-000000000043';

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
  });

  afterAll(async () => {
    await pool.end();
  });

  afterEach(async () => {
    // Clean up test data (contests, then templates)
    await pool.query(
      `DELETE FROM admin_contest_audit
       WHERE contest_instance_id IN (
         SELECT id FROM contest_instances
         WHERE provider_event_id LIKE 'espn_pga_discovery_test_%'
       )`
    );
    await pool.query(
      `DELETE FROM contest_instances
       WHERE provider_event_id LIKE 'espn_pga_discovery_test_%'`
    );
    await pool.query(
      `DELETE FROM contest_templates
       WHERE provider_tournament_id LIKE 'pga_discovery_test_%'`
    );
  });

  describe('createContestsForEvent', () => {
    it('should not create contests when no system-generated templates exist', async () => {
      const result = await createContestsForEvent(pool, upcomingEvent, now, organizerId);

      expect(result.success).toBe(true);
      expect(result.created).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should create contest instances for each system-generated template', async () => {
      // Create a system-generated template
      const templateResult = await pool.query(
        `INSERT INTO contest_templates (
          name, sport, template_type, scoring_strategy_key, lock_strategy_key, settlement_strategy_key,
          default_entry_fee_cents, allowed_entry_fee_min_cents, allowed_entry_fee_max_cents,
          allowed_payout_structures, is_active, is_system_generated
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
        )
        RETURNING id`,
        [
          'PGA Discovery Test Template',
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
          true
        ]
      );

      const templateId = templateResult.rows[0].id;

      const testEvent = {
        ...upcomingEvent,
        provider_event_id: 'espn_pga_discovery_test_001'
      };

      const result = await createContestsForEvent(pool, testEvent, now, organizerId);

      expect(result.success).toBe(true);
      expect(result.created).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);

      // Verify contest instance was created
      const contestResult = await pool.query(
        `SELECT * FROM contest_instances WHERE provider_event_id = $1`,
        [testEvent.provider_event_id]
      );

      expect(contestResult.rows).toHaveLength(1);
      const contest = contestResult.rows[0];
      expect(contest.template_id).toBe(templateId);
      expect(contest.organizer_id).toBe(organizerId);
      expect(contest.status).toBe('SCHEDULED');
      expect(contest.tournament_start_time).toEqual(testEvent.start_time);
      expect(contest.tournament_end_time).toEqual(testEvent.end_time);
      expect(contest.lock_time).toEqual(testEvent.start_time);
      expect(contest.is_platform_owned).toBe(true);
      expect(contest.contest_name).toBe(`${templateResult.rows[0].id === templateId ? 'PGA Discovery Test Template' : ''} - ${testEvent.name}`);
    });

    it('should be idempotent: replaying does not create duplicates', async () => {
      // Create a system-generated template
      const templateResult = await pool.query(
        `INSERT INTO contest_templates (
          name, sport, template_type, scoring_strategy_key, lock_strategy_key, settlement_strategy_key,
          default_entry_fee_cents, allowed_entry_fee_min_cents, allowed_entry_fee_max_cents,
          allowed_payout_structures, is_active, is_system_generated
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
        )
        RETURNING id`,
        [
          'PGA Idempotency Test',
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
          true
        ]
      );

      const testEvent = {
        ...upcomingEvent,
        provider_event_id: 'espn_pga_discovery_test_idempotent'
      };

      // First cycle
      const result1 = await createContestsForEvent(pool, testEvent, now, organizerId);
      expect(result1.created).toBe(1);

      // Second cycle (same event, same template)
      const result2 = await createContestsForEvent(pool, testEvent, now, organizerId);
      expect(result2.created).toBe(0);
      expect(result2.skipped).toBe(1);

      // Verify only one contest instance exists
      const contestResult = await pool.query(
        `SELECT COUNT(*) as count FROM contest_instances WHERE provider_event_id = $1`,
        [testEvent.provider_event_id]
      );

      expect(parseInt(contestResult.rows[0].count, 10)).toBe(1);
    });

    it('should use payout_structure from template.allowed_payout_structures[0]', async () => {
      const customPayout = { payout_percentages: [0.6, 0.25, 0.15], min_entries: 3 };

      const templateResult = await pool.query(
        `INSERT INTO contest_templates (
          name, sport, template_type, scoring_strategy_key, lock_strategy_key, settlement_strategy_key,
          default_entry_fee_cents, allowed_entry_fee_min_cents, allowed_entry_fee_max_cents,
          allowed_payout_structures, is_active, is_system_generated
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
        )
        RETURNING id`,
        [
          'Custom Payout Template',
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
          true
        ]
      );

      const testEvent = {
        ...upcomingEvent,
        provider_event_id: 'espn_pga_discovery_test_payout'
      };

      await createContestsForEvent(pool, testEvent, now, organizerId);

      const contestResult = await pool.query(
        `SELECT payout_structure FROM contest_instances WHERE provider_event_id = $1`,
        [testEvent.provider_event_id]
      );

      expect(contestResult.rows).toHaveLength(1);
      expect(contestResult.rows[0].payout_structure).toEqual(customPayout);
    });

    it('should log successful creations in admin_contest_audit', async () => {
      const templateResult = await pool.query(
        `INSERT INTO contest_templates (
          name, sport, template_type, scoring_strategy_key, lock_strategy_key, settlement_strategy_key,
          default_entry_fee_cents, allowed_entry_fee_min_cents, allowed_entry_fee_max_cents,
          allowed_payout_structures, is_active, is_system_generated
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
        )
        RETURNING id`,
        [
          'Audit Test Template',
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
          true
        ]
      );

      const testEvent = {
        ...upcomingEvent,
        provider_event_id: 'espn_pga_discovery_test_audit'
      };

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
          allowed_payout_structures, is_active, is_system_generated
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
        )`,
        [
          'Cycle Test Template',
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
          true
        ]
      );

      // Use now from setup (2026-04-01) which is within 7 days of Masters (2026-04-09)
      const result = await runDiscoveryCycle(pool, now, organizerId);

      expect(result.success).toBe(true);
      expect(result.event_id).toBe('espn_pga_401811941');
      expect(result.created).toBe(1);
    });
  });
});
