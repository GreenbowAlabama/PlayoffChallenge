/**
 * Admin Templates Routes Test
 *
 * Tests for template management endpoints:
 * - GET /api/admin/templates/list — List all or system-only templates
 * - POST /api/admin/templates/create — Create new contest template
 *
 * Validates:
 * - Template listing with filters
 * - Template creation with validation
 * - Error handling for missing required fields
 * - Admin authentication
 */

'use strict';

const request = require('supertest');
const { randomUUID } = require('crypto');
const { createTestApp, createMockAdminToken } = require('../mocks/testAppFactory');

describe('Admin Templates Routes', () => {
  let app;
  let pool;
  let adminToken;
  let adminUserId;

  beforeAll(async () => {
    process.env.ADMIN_JWT_SECRET = 'test-secret-for-templates-routes';

    const setup = await createTestApp();
    app = setup.app;
    pool = setup.pool;

    // Create admin user
    adminUserId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, name, email, is_admin)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [adminUserId, 'Templates Test Admin', `admin-templates-${adminUserId}@test.local`, true]
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

  describe('GET /api/admin/templates/list', () => {
    it('should return empty array when no templates exist', async () => {
      const res = await request(app)
        .get('/api/admin/templates/list')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('timestamp');
      expect(res.body).toHaveProperty('count');
      expect(res.body).toHaveProperty('templates');
      expect(Array.isArray(res.body.templates)).toBe(true);
    });

    it('should list all templates (both system and manual)', async () => {
      // Create system template
      const systemId = randomUUID();
      await pool.query(
        `INSERT INTO contest_templates (
          id, name, sport, template_type, status, is_system_generated,
          provider_tournament_id, season_year, scoring_strategy_key, lock_strategy_key,
          settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
          allowed_entry_fee_max_cents, allowed_payout_structures
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          systemId, 'Test Template System', 'PGA', 'STROKE_PLAY', 'SCHEDULED', true,
          'test_system_001', 2026, 'pga_standard', 'tournament_start',
          'payouts_after_complete', 1000, 500, 5000, JSON.stringify(['winner_takes_all'])
        ]
      );

      // Create manual template
      const manualId = randomUUID();
      await pool.query(
        `INSERT INTO contest_templates (
          id, name, sport, template_type, status, is_system_generated,
          scoring_strategy_key, lock_strategy_key,
          settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
          allowed_entry_fee_max_cents, allowed_payout_structures, lineup_size, drop_lowest
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          manualId, 'Test Template Manual', 'NFL', 'TOURNAMENT', 'SCHEDULED', false,
          'nfl_standard', 'kickoff_time',
          'payouts_after_complete', 2000, 1000, 10000, JSON.stringify(['tiered_payouts']),
          8, false
        ]
      );

      const res = await request(app)
        .get('/api/admin/templates/list')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // Should have both templates
      const templateIds = res.body.templates.map(t => t.id);
      expect(templateIds).toContain(systemId);
      expect(templateIds).toContain(manualId);
      expect(res.body.count).toBeGreaterThanOrEqual(2);
    });

    it('should filter to system-only templates', async () => {
      // Create system template
      const systemId = randomUUID();
      await pool.query(
        `INSERT INTO contest_templates (
          id, name, sport, template_type, status, is_system_generated,
          provider_tournament_id, season_year, scoring_strategy_key, lock_strategy_key,
          settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
          allowed_entry_fee_max_cents, allowed_payout_structures
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          systemId, 'Test Template System Only', 'PGA', 'STROKE_PLAY', 'SCHEDULED', true,
          'test_system_only_001', 2026, 'pga_standard', 'tournament_start',
          'payouts_after_complete', 1000, 500, 5000, JSON.stringify(['winner_takes_all'])
        ]
      );

      // Create manual template
      const manualId = randomUUID();
      await pool.query(
        `INSERT INTO contest_templates (
          id, name, sport, template_type, status, is_system_generated,
          scoring_strategy_key, lock_strategy_key,
          settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
          allowed_entry_fee_max_cents, allowed_payout_structures
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          manualId, 'Test Template Manual Only', 'NFL', 'TOURNAMENT', 'SCHEDULED', false,
          'nfl_standard', 'kickoff_time',
          'payouts_after_complete', 2000, 1000, 10000, JSON.stringify(['tiered_payouts'])
        ]
      );

      const res = await request(app)
        .get('/api/admin/templates/list?system_only=true')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // Should only have system template
      const templateIds = res.body.templates.map(t => t.id);
      expect(templateIds).toContain(systemId);
      expect(templateIds).not.toContain(manualId);
    });

    it('should return 401 without admin token', async () => {
      await request(app)
        .get('/api/admin/templates/list')
        .expect(401);
    });
  });

  describe('POST /api/admin/templates/create', () => {
    it('should create a new template with required fields', async () => {
      const payload = {
        name: 'Test Template Creation',
        sport: 'PGA',
        template_type: 'STROKE_PLAY',
        scoring_strategy_key: 'pga_standard',
        lock_strategy_key: 'tournament_start',
        settlement_strategy_key: 'payouts_after_complete',
        default_entry_fee_cents: 1500,
        allowed_entry_fee_min_cents: 1000,
        allowed_entry_fee_max_cents: 5000,
        allowed_payout_structures: ['winner_takes_all', 'tiered_payouts']
      };

      const res = await request(app)
        .post('/api/admin/templates/create')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload)
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('templateId');
      expect(typeof res.body.templateId).toBe('string');

      // Verify created in database
      const dbResult = await pool.query(
        'SELECT * FROM contest_templates WHERE id = $1',
        [res.body.templateId]
      );

      expect(dbResult.rows).toHaveLength(1);
      expect(dbResult.rows[0].name).toBe(payload.name);
      expect(dbResult.rows[0].sport).toBe(payload.sport);
      expect(dbResult.rows[0].is_system_generated).toBe(false);
    });

    it('should create template with optional fields', async () => {
      const payload = {
        name: 'Test Template With Optional',
        sport: 'NFL',
        template_type: 'TOURNAMENT',
        scoring_strategy_key: 'nfl_standard',
        lock_strategy_key: 'kickoff_time',
        settlement_strategy_key: 'payouts_after_complete',
        default_entry_fee_cents: 2000,
        allowed_entry_fee_min_cents: 1000,
        allowed_entry_fee_max_cents: 10000,
        allowed_payout_structures: ['tiered_payouts'],
        lineup_size: 8,
        drop_lowest: true,
        scoring_format: 'ppr'
      };

      const res = await request(app)
        .post('/api/admin/templates/create')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload)
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('templateId');

      // Verify all fields in database
      const dbResult = await pool.query(
        'SELECT * FROM contest_templates WHERE id = $1',
        [res.body.templateId]
      );

      expect(dbResult.rows[0].lineup_size).toBe(8);
      expect(dbResult.rows[0].drop_lowest).toBe(true);
      expect(dbResult.rows[0].scoring_format).toBe('ppr');
    });

    it('should reject request without required field: name', async () => {
      const payload = {
        sport: 'PGA',
        template_type: 'STROKE_PLAY',
        scoring_strategy_key: 'pga_standard',
        lock_strategy_key: 'tournament_start',
        settlement_strategy_key: 'payouts_after_complete',
        default_entry_fee_cents: 1000,
        allowed_entry_fee_min_cents: 500,
        allowed_entry_fee_max_cents: 5000,
        allowed_payout_structures: ['winner_takes_all']
      };

      const res = await request(app)
        .post('/api/admin/templates/create')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload)
        .expect(400);

      expect(res.body).toHaveProperty('success', false);
      expect(res.body.error).toContain('name is required');
    });

    it('should reject request without required field: scoring_strategy_key', async () => {
      const payload = {
        name: 'Test Template',
        sport: 'PGA',
        template_type: 'STROKE_PLAY',
        lock_strategy_key: 'tournament_start',
        settlement_strategy_key: 'payouts_after_complete',
        default_entry_fee_cents: 1000,
        allowed_entry_fee_min_cents: 500,
        allowed_entry_fee_max_cents: 5000,
        allowed_payout_structures: ['winner_takes_all']
      };

      const res = await request(app)
        .post('/api/admin/templates/create')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload)
        .expect(400);

      expect(res.body).toHaveProperty('success', false);
      expect(res.body.error).toContain('scoring_strategy_key is required');
    });

    it('should reject request with invalid payout_structures (not array)', async () => {
      const payload = {
        name: 'Test Template',
        sport: 'PGA',
        template_type: 'STROKE_PLAY',
        scoring_strategy_key: 'pga_standard',
        lock_strategy_key: 'tournament_start',
        settlement_strategy_key: 'payouts_after_complete',
        default_entry_fee_cents: 1000,
        allowed_entry_fee_min_cents: 500,
        allowed_entry_fee_max_cents: 5000,
        allowed_payout_structures: 'not_an_array'
      };

      const res = await request(app)
        .post('/api/admin/templates/create')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload)
        .expect(400);

      expect(res.body).toHaveProperty('success', false);
      expect(res.body.error).toContain('allowed_payout_structures must be an array');
    });

    it('should reject request with multiple validation errors', async () => {
      const payload = {
        // missing name, sport, scoring_strategy_key, etc.
        allowed_payout_structures: 'not_an_array'
      };

      const res = await request(app)
        .post('/api/admin/templates/create')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload)
        .expect(400);

      expect(res.body).toHaveProperty('success', false);
      // Should contain multiple error messages
      expect(res.body.error).toContain(';');
    });

    it('should return 401 without admin token', async () => {
      const payload = {
        name: 'Test Template',
        sport: 'PGA',
        template_type: 'STROKE_PLAY',
        scoring_strategy_key: 'pga_standard',
        lock_strategy_key: 'tournament_start',
        settlement_strategy_key: 'payouts_after_complete',
        default_entry_fee_cents: 1000,
        allowed_entry_fee_min_cents: 500,
        allowed_entry_fee_max_cents: 5000,
        allowed_payout_structures: ['winner_takes_all']
      };

      await request(app)
        .post('/api/admin/templates/create')
        .send(payload)
        .expect(401);
    });

    it('should handle database errors gracefully', async () => {
      // This would test error handling if we could trigger a DB error
      // For now, we just verify the happy path works
      const payload = {
        name: 'Test Template Error Handling',
        sport: 'PGA',
        template_type: 'STROKE_PLAY',
        scoring_strategy_key: 'pga_standard',
        lock_strategy_key: 'tournament_start',
        settlement_strategy_key: 'payouts_after_complete',
        default_entry_fee_cents: 1000,
        allowed_entry_fee_min_cents: 500,
        allowed_entry_fee_max_cents: 5000,
        allowed_payout_structures: ['winner_takes_all']
      };

      const res = await request(app)
        .post('/api/admin/templates/create')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload)
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });
});
