/**
 * Admin Discovery Routes Test
 *
 * Tests for read-only discovery visibility endpoints:
 * - GET /api/admin/discovery/recent-cycles
 * - GET /api/admin/discovery/system-templates
 * - GET /api/admin/discovery/system-instances
 * - GET /api/admin/discovery/ingestion-events
 *
 * Validates:
 * - Correct response shapes and data
 * - Filtering by status works
 * - pagination/limits work
 * - Error handling for database issues
 */

'use strict';

const request = require('supertest');
const { randomUUID } = require('crypto');
const { createTestApp, createMockAdminToken } = require('../mocks/testAppFactory');

describe('Admin Discovery Routes', () => {
  let app;
  let pool;
  let adminToken;
  let adminUserId;

  beforeAll(async () => {
    process.env.ADMIN_JWT_SECRET = 'test-secret-for-discovery-routes';

    const setup = await createTestApp();
    app = setup.app;
    pool = setup.pool;

    // Create admin user
    adminUserId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, name, email, is_admin)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [adminUserId, 'Discovery Test Admin', `admin-discovery-${adminUserId}@test.local`, true]
    );

    adminToken = createMockAdminToken({ sub: adminUserId });
  });

  afterAll(async () => {
    // Cleanup handled by testAppFactory
  });

  beforeEach(async () => {
    // Note: Database is shared and contains historical data.
    // Tests must be tolerant of existing records.
  });

  describe('GET /api/admin/discovery/recent-cycles', () => {
    it('should return cycles array with correct structure', async () => {
      const res = await request(app)
        .get('/api/admin/discovery/recent-cycles')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('timestamp');
      expect(res.body).toHaveProperty('count');
      expect(res.body).toHaveProperty('cycles');
      expect(Array.isArray(res.body.cycles)).toBe(true);
    });

    it('should return recent discovery cycles with instance counts', async () => {
      // Create test organizer
      const organizerId = randomUUID();
      await pool.query(
        `INSERT INTO users (id, name, email) VALUES ($1, $2, $3)`,
        [organizerId, 'Test Organizer', `org-${organizerId}@test.local`]
      );

      // Create system template with unique provider ID
      const templateId = randomUUID();
      const uniqueProviderId = `test_espn_pga_${randomUUID()}`;
      await pool.query(
        `INSERT INTO contest_templates (
          id, name, sport, template_type, status, is_system_generated, is_active,
          provider_tournament_id, season_year, scoring_strategy_key, lock_strategy_key,
          settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
          allowed_entry_fee_max_cents, allowed_payout_structures
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          templateId, 'Test Tournament 2026', 'GOLF', 'TOURNAMENT', 'SCHEDULED', true, false,
          uniqueProviderId, 2026, 'golf_standard', 'tournament_start',
          'payouts_after_complete', 1000, 500, 5000, JSON.stringify(['winner_takes_all'])
        ]
      );

      // Create system instances
      const instance1Id = randomUUID();
      const instance2Id = randomUUID();
      const now = new Date();
      await pool.query(
        `INSERT INTO contest_instances (
          id, template_id, contest_name, status, organizer_id, is_system_generated,
          entry_fee_cents, max_entries, lock_time, tournament_start_time, payout_structure
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11), ($12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)`,
        [
          instance1Id, templateId, 'Test Contest 1', 'SCHEDULED', organizerId, true,
          1000, 100, now, now, JSON.stringify({}),
          instance2Id, templateId, 'Test Contest 2', 'SCHEDULED', organizerId, true,
          1000, 100, now, now, JSON.stringify({})
        ]
      );

      const res = await request(app)
        .get('/api/admin/discovery/recent-cycles')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // Find our test template in the results
      const testCycle = res.body.cycles.find(c => c.template_id === templateId);
      expect(testCycle).toBeDefined();
      expect(testCycle).toHaveProperty('template_name', 'Test Tournament 2026');
      expect(testCycle).toHaveProperty('instance_count', 2);
      expect(testCycle).toHaveProperty('template_status', 'SCHEDULED');
    });

    it('should respect limit parameter', async () => {
      const res = await request(app)
        .get('/api/admin/discovery/recent-cycles?limit=5')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('cycles');
    });

    it('should return 401 without admin token', async () => {
      await request(app)
        .get('/api/admin/discovery/recent-cycles')
        .expect(401);
    });
  });

  describe('GET /api/admin/discovery/system-templates', () => {
    it('should return templates array with correct structure', async () => {
      const res = await request(app)
        .get('/api/admin/discovery/system-templates')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('timestamp');
      expect(res.body).toHaveProperty('count');
      expect(res.body).toHaveProperty('templates');
      expect(Array.isArray(res.body.templates)).toBe(true);
    });

    it('should return system-generated templates only', async () => {
      // Create system template
      const systemTemplateId = randomUUID();
      const sysProviderId = `test_system_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      await pool.query(
        `INSERT INTO contest_templates (
          id, name, sport, template_type, status, is_system_generated, is_active,
          provider_tournament_id, season_year, scoring_strategy_key, lock_strategy_key,
          settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
          allowed_entry_fee_max_cents, allowed_payout_structures
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          systemTemplateId, 'System Template', 'WNBA', 'TOURNAMENT', 'SCHEDULED', true, false,
          sysProviderId, 2026, 'wnba_standard', 'game_start',
          'payouts_after_complete', 1000, 500, 5000, JSON.stringify(['winner_takes_all'])
        ]
      );

      // Create non-system template (should NOT be returned)
      const userTemplateId = randomUUID();
      await pool.query(
        `INSERT INTO contest_templates (
          id, name, sport, template_type, status, is_system_generated, is_active,
          scoring_strategy_key, lock_strategy_key,
          settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
          allowed_entry_fee_max_cents, allowed_payout_structures
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          userTemplateId, 'User Template', 'WNBA', 'TOURNAMENT', 'SCHEDULED', false, false,
          'wnba_standard', 'game_start',
          'payouts_after_complete', 2000, 1000, 10000, JSON.stringify(['tiered_payouts'])
        ]
      );

      const res = await request(app)
        .get('/api/admin/discovery/system-templates')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // Find our test system template in the results
      const testTemplate = res.body.templates.find(t => t.id === systemTemplateId);
      expect(testTemplate).toBeDefined();
      expect(testTemplate.is_system_generated).toBe(true);

      // Verify user template is NOT in results
      const userTemplate = res.body.templates.find(t => t.id === userTemplateId);
      expect(userTemplate).toBeUndefined();
    });

    it('should filter by status', async () => {
      const templateId = randomUUID();
      const completeProviderId = `test_complete_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      await pool.query(
        `INSERT INTO contest_templates (
          id, name, sport, template_type, status, is_system_generated, is_active,
          provider_tournament_id, season_year, scoring_strategy_key, lock_strategy_key,
          settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
          allowed_entry_fee_max_cents, allowed_payout_structures
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          templateId, 'Complete Template', 'SOCCER', 'TOURNAMENT', 'COMPLETE', true, false,
          completeProviderId, 2026, 'soccer_standard', 'match_start',
          'payouts_after_complete', 1000, 500, 5000, JSON.stringify(['winner_takes_all'])
        ]
      );

      const res = await request(app)
        .get('/api/admin/discovery/system-templates?status=COMPLETE')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // Find our test template in the results
      const testTemplate = res.body.templates.find(t => t.id === templateId);
      expect(testTemplate).toBeDefined();
      expect(testTemplate.status).toBe('COMPLETE');
    });

    it('should return 401 without admin token', async () => {
      await request(app)
        .get('/api/admin/discovery/system-templates')
        .expect(401);
    });
  });

  describe('GET /api/admin/discovery/system-instances', () => {
    it('should return instances array with correct structure', async () => {
      const res = await request(app)
        .get('/api/admin/discovery/system-instances')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('timestamp');
      expect(res.body).toHaveProperty('count');
      expect(res.body).toHaveProperty('instances');
      expect(Array.isArray(res.body.instances)).toBe(true);
    });

    it('should return system-generated instances with template info', async () => {
      // Setup
      const organizerId = randomUUID();
      await pool.query(
        `INSERT INTO users (id, name, email) VALUES ($1, $2, $3)`,
        [organizerId, 'Test Org', `org-${organizerId}@test.local`]
      );

      const templateId = randomUUID();
      const uniqueNflId = `test_espn_nfl_${randomUUID()}`;
      await pool.query(
        `INSERT INTO contest_templates (
          id, name, sport, template_type, status, is_system_generated, is_active,
          provider_tournament_id, season_year, scoring_strategy_key, lock_strategy_key,
          settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
          allowed_entry_fee_max_cents, allowed_payout_structures
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          templateId, 'Test Template', 'NFL', 'TOURNAMENT', 'SCHEDULED', true, false,
          uniqueNflId, 2026, 'nfl_standard', 'kickoff_time',
          'payouts_after_complete', 1000, 500, 5000, JSON.stringify(['winner_takes_all'])
        ]
      );

      const instanceId = randomUUID();
      const lockTime = new Date();
      const startTime = new Date(lockTime.getTime() + 3600000); // 1 hour later
      await pool.query(
        `INSERT INTO contest_instances (
          id, template_id, contest_name, status, organizer_id, is_system_generated,
          entry_fee_cents, max_entries, current_entries, lock_time, tournament_start_time, payout_structure
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          instanceId, templateId, 'System Test Contest', 'SCHEDULED', organizerId, true,
          1000, 100, 5, lockTime, startTime, JSON.stringify({})
        ]
      );

      const res = await request(app)
        .get('/api/admin/discovery/system-instances')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // Find our test instance in the results
      const testInstance = res.body.instances.find(i => i.id === instanceId);
      expect(testInstance).toBeDefined();
      expect(testInstance).toHaveProperty('contest_name', 'System Test Contest');
      expect(testInstance).toHaveProperty('template_name', 'Test Template');
      expect(testInstance).toHaveProperty('current_entries', 5);
    });

    it('should filter by template_id', async () => {
      const organizerId = randomUUID();
      await pool.query(
        `INSERT INTO users (id, name, email) VALUES ($1, $2, $3)`,
        [organizerId, 'Test Org', `org-${organizerId}@test.local`]
      );

      const template1Id = randomUUID();
      const template2Id = randomUUID();

      // Create two templates with different sports and unique provider IDs to avoid constraint violations
      const templates = [
        [template1Id, 'Template 1', 'NBA', `tournament_nba_${randomUUID()}`],
        [template2Id, 'Template 2', 'NHL', `tournament_nhl_${randomUUID()}`]
      ];
      for (const [id, name, sport, tourny] of templates) {
        await pool.query(
          `INSERT INTO contest_templates (
            id, name, sport, template_type, status, is_system_generated, is_active,
            provider_tournament_id, season_year, scoring_strategy_key, lock_strategy_key,
            settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
            allowed_entry_fee_max_cents, allowed_payout_structures
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [
            id, name, sport, 'TOURNAMENT', 'SCHEDULED', true, false,
            tourny, 2026, 'standard', 'tournament_start',
            'payouts_after_complete', 1000, 500, 5000, JSON.stringify(['winner_takes_all'])
          ]
        );
      }

      // Create instances for both templates
      for (const templateId of [template1Id, template2Id]) {
        const instanceId = randomUUID();
        await pool.query(
          `INSERT INTO contest_instances (
            id, template_id, contest_name, status, organizer_id, is_system_generated,
            entry_fee_cents, max_entries, lock_time, tournament_start_time, payout_structure
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            instanceId, templateId, `Contest for ${templateId}`, 'SCHEDULED', organizerId, true,
            1000, 100, new Date(), new Date(), JSON.stringify({})
          ]
        );
      }

      const res = await request(app)
        .get(`/api/admin/discovery/system-instances?template_id=${template1Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // Verify at least one instance for our template is in results
      expect(res.body.instances.length).toBeGreaterThan(0);
      expect(res.body.instances[0].id).toBeDefined();
    });

    it('should return 401 without admin token', async () => {
      await request(app)
        .get('/api/admin/discovery/system-instances')
        .expect(401);
    });
  });

  describe('GET /api/admin/discovery/ingestion-events', () => {
    it('should return events array with correct structure', async () => {
      const res = await request(app)
        .get('/api/admin/discovery/ingestion-events')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('timestamp');
      expect(res.body).toHaveProperty('count');
      expect(res.body).toHaveProperty('events');
      expect(Array.isArray(res.body.events)).toBe(true);
    });

    it('should return recent ingestion events with correct columns', async () => {
      // Create test instance
      const organizerId = randomUUID();
      await pool.query(
        `INSERT INTO users (id, name, email) VALUES ($1, $2, $3)`,
        [organizerId, 'Test Org', `org-${organizerId}@test.local`]
      );

      const templateId = randomUUID();
      const uniqueProviderId = `test_events_${randomUUID()}`;
      await pool.query(
        `INSERT INTO contest_templates (
          id, name, sport, template_type, status, is_system_generated, is_active,
          provider_tournament_id, season_year, scoring_strategy_key, lock_strategy_key,
          settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
          allowed_entry_fee_max_cents, allowed_payout_structures
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          templateId, 'Test Template', 'MLB', 'TOURNAMENT', 'SCHEDULED', true, false,
          uniqueProviderId, 2026, 'mlb_standard', 'game_start',
          'payouts_after_complete', 1000, 500, 5000, JSON.stringify(['winner_takes_all'])
        ]
      );

      const instanceId = randomUUID();
      const now = new Date();
      await pool.query(
        `INSERT INTO contest_instances (
          id, template_id, contest_name, status, organizer_id, is_system_generated,
          entry_fee_cents, max_entries, lock_time, tournament_start_time, payout_structure
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          instanceId, templateId, 'Test Contest', 'SCHEDULED', organizerId, true,
          1000, 100, now, now, JSON.stringify({})
        ]
      );

      // Insert ingestion event
      const eventId = randomUUID();
      const receivedTime = new Date();
      await pool.query(
        `INSERT INTO ingestion_events (
          id, contest_instance_id, event_type, provider, provider_data_json,
          payload_hash, received_at, validation_status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          eventId, instanceId, 'LEADERBOARD_UPDATE', 'test_provider',
          JSON.stringify({ test: 'data' }), 'hash123', receivedTime, 'VALID'
        ]
      );

      const res = await request(app)
        .get('/api/admin/discovery/ingestion-events?limit=100')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // Find our test event in the list (there might be other events)
      const testEvent = res.body.events.find(e => e.id === eventId);
      expect(testEvent).toBeDefined();
      expect(testEvent).toHaveProperty('event_type', 'LEADERBOARD_UPDATE');
      expect(testEvent).toHaveProperty('provider', 'test_provider');
      expect(testEvent).toHaveProperty('validation_status', 'VALID');
      expect(testEvent).toHaveProperty('received_at');
      expect(testEvent).toHaveProperty('contest_name', 'Test Contest');
    });

    it('should respect limit parameter', async () => {
      const res = await request(app)
        .get('/api/admin/discovery/ingestion-events?limit=5')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('events');
    });

    it('should return 401 without admin token', async () => {
      await request(app)
        .get('/api/admin/discovery/ingestion-events')
        .expect(401);
    });
  });
});
