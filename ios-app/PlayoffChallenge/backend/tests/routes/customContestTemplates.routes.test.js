/**
 * Custom Contest Templates Admin Routes Unit Tests
 *
 * Purpose: Test template admin API endpoints
 * - Admin protection (via integration tests)
 * - Template listing
 * - Template creation with validation (201, 400)
 * - Template deactivation (200, 404, 409)
 */

const request = require('supertest');
const express = require('express');
const templateRoutes = require('../../routes/customContestTemplates.routes');
const { createMockPool, mockQueryResponses } = require('../mocks/mockPool');
const { getIntegrationApp, createMockAdminToken } = require('../mocks/testAppFactory');

// Test fixtures
const TEST_TEMPLATE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TEST_TEMPLATE_ID_2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ADMIN_USER_ID = '33333333-3333-3333-3333-333333333333';

const mockTemplate = {
  id: TEST_TEMPLATE_ID,
  name: 'NFL Playoff Challenge',
  sport: 'NFL',
  template_type: 'playoff_challenge',
  scoring_strategy_key: 'ppr',
  lock_strategy_key: 'first_game_kickoff',
  settlement_strategy_key: 'final_standings',
  default_entry_fee_cents: 2500,
  allowed_entry_fee_min_cents: 0,
  allowed_entry_fee_max_cents: 10000,
  allowed_payout_structures: [
    { first: 70, second: 20, third: 10 },
    { first: 100 }
  ],
  is_active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
};

const mockInactiveTemplate = {
  ...mockTemplate,
  id: TEST_TEMPLATE_ID_2,
  name: 'Inactive Template',
  is_active: false
};

const validTemplateInput = {
  name: 'New Survivor Pool',
  sport: 'NFL',
  template_type: 'survivor',
  scoring_strategy_key: 'ppr',
  lock_strategy_key: 'first_game_kickoff',
  settlement_strategy_key: 'final_standings',
  default_entry_fee_cents: 5000,
  allowed_entry_fee_min_cents: 1000,
  allowed_entry_fee_max_cents: 10000,
  allowed_payout_structures: [{ first: 100 }]
};

describe('Custom Contest Templates Routes - Unit Tests', () => {
  let app;
  let mockPool;

  beforeEach(() => {
    mockPool = createMockPool();

    app = express();
    app.use(express.json());
    app.locals.pool = mockPool;
    // Mount routes directly without admin middleware for unit testing
    app.use('/api/admin/custom-contests/templates', templateRoutes);
  });

  afterEach(() => {
    mockPool.reset();
  });

  describe('GET /api/admin/custom-contests/templates', () => {
    it('should return 200 with list of all templates', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_templates ORDER BY/,
        mockQueryResponses.multiple([mockTemplate, mockInactiveTemplate])
      );

      const response = await request(app)
        .get('/api/admin/custom-contests/templates');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(2);
    });

    it('should return empty array if no templates exist', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_templates ORDER BY/,
        mockQueryResponses.empty()
      );

      const response = await request(app)
        .get('/api/admin/custom-contests/templates');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should return 500 on database error', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_templates ORDER BY/,
        mockQueryResponses.error('Database connection failed')
      );

      const response = await request(app)
        .get('/api/admin/custom-contests/templates');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal server error');
    });
  });

  describe('POST /api/admin/custom-contests/templates', () => {
    it('should return 201 with created template', async () => {
      mockPool.setQueryResponse(
        /INSERT INTO contest_templates/,
        mockQueryResponses.single({ ...mockTemplate, ...validTemplateInput, id: TEST_TEMPLATE_ID })
      );

      const response = await request(app)
        .post('/api/admin/custom-contests/templates')
        .send(validTemplateInput);

      expect(response.status).toBe(201);
      expect(response.body.name).toBe(validTemplateInput.name);
      expect(response.body.id).toBeDefined();
    });

    it('should return 400 for missing name', async () => {
      const response = await request(app)
        .post('/api/admin/custom-contests/templates')
        .send({ ...validTemplateInput, name: undefined });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('name is required');
    });

    it('should return 400 for invalid sport', async () => {
      const response = await request(app)
        .post('/api/admin/custom-contests/templates')
        .send({ ...validTemplateInput, sport: 'CRICKET' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('sport is required and must be one of');
    });

    it('should return 400 for invalid scoring strategy', async () => {
      const response = await request(app)
        .post('/api/admin/custom-contests/templates')
        .send({ ...validTemplateInput, scoring_strategy_key: 'invalid' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('scoring_strategy_key is required and must be one of');
    });

    it('should return 400 for min > max entry fee', async () => {
      const response = await request(app)
        .post('/api/admin/custom-contests/templates')
        .send({
          ...validTemplateInput,
          allowed_entry_fee_min_cents: 10000,
          allowed_entry_fee_max_cents: 1000
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('allowed_entry_fee_min_cents must be <=');
    });

    it('should return 400 for empty payout structures', async () => {
      const response = await request(app)
        .post('/api/admin/custom-contests/templates')
        .send({ ...validTemplateInput, allowed_payout_structures: [] });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('allowed_payout_structures is required');
    });

    it('should return 500 on database error', async () => {
      mockPool.setQueryResponse(
        /INSERT INTO contest_templates/,
        mockQueryResponses.error('Database write failed')
      );

      const response = await request(app)
        .post('/api/admin/custom-contests/templates')
        .send(validTemplateInput);

      expect(response.status).toBe(500);
    });
  });

  describe('DELETE /api/admin/custom-contests/templates/:id', () => {
    it('should return 200 with deactivated template', async () => {
      // Template exists and is active
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_templates WHERE id/,
        mockQueryResponses.single(mockTemplate)
      );

      // Not in use
      mockPool.setQueryResponse(
        /SELECT EXISTS.*FROM contest_instances WHERE template_id/,
        mockQueryResponses.single({ in_use: false })
      );

      // Update succeeds
      mockPool.setQueryResponse(
        /UPDATE contest_templates SET is_active = false/,
        mockQueryResponses.single({ ...mockTemplate, is_active: false })
      );

      const response = await request(app)
        .delete(`/api/admin/custom-contests/templates/${TEST_TEMPLATE_ID}`);

      expect(response.status).toBe(200);
      expect(response.body.is_active).toBe(false);
    });

    it('should return 400 for invalid UUID format', async () => {
      const response = await request(app)
        .delete('/api/admin/custom-contests/templates/invalid-uuid');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid template ID format');
    });

    it('should return 404 if template not found', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_templates WHERE id/,
        mockQueryResponses.empty()
      );

      const response = await request(app)
        .delete(`/api/admin/custom-contests/templates/${TEST_TEMPLATE_ID}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Template not found');
    });

    it('should return 400 if template is already inactive', async () => {
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_templates WHERE id/,
        mockQueryResponses.single(mockInactiveTemplate)
      );

      const response = await request(app)
        .delete(`/api/admin/custom-contests/templates/${TEST_TEMPLATE_ID_2}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Template is already inactive');
    });

    it('should return 409 if template is in use by contests', async () => {
      // Template exists and is active
      mockPool.setQueryResponse(
        /SELECT[\s\S]*FROM contest_templates WHERE id/,
        mockQueryResponses.single(mockTemplate)
      );

      // In use
      mockPool.setQueryResponse(
        /SELECT EXISTS.*FROM contest_instances WHERE template_id/,
        mockQueryResponses.single({ in_use: true })
      );

      const response = await request(app)
        .delete(`/api/admin/custom-contests/templates/${TEST_TEMPLATE_ID}`);

      expect(response.status).toBe(409);
      expect(response.body.error).toContain('Template is referenced by existing contests');
    });
  });
});

describe('Custom Contest Templates Routes - Admin Protection', () => {
  let app;

  beforeAll(() => {
    const { app: integrationApp } = getIntegrationApp();
    app = integrationApp;
  });

  describe('Unauthenticated Access', () => {
    it('GET /api/admin/custom-contests/templates should reject without token', async () => {
      const response = await request(app)
        .get('/api/admin/custom-contests/templates');

      expect([401, 403]).toContain(response.status);
    });

    it('POST /api/admin/custom-contests/templates should reject without token', async () => {
      const response = await request(app)
        .post('/api/admin/custom-contests/templates')
        .send(validTemplateInput);

      expect([401, 403]).toContain(response.status);
    });

    it('DELETE /api/admin/custom-contests/templates/:id should reject without token', async () => {
      const response = await request(app)
        .delete(`/api/admin/custom-contests/templates/${TEST_TEMPLATE_ID}`);

      expect([401, 403]).toContain(response.status);
    });
  });

  describe('Invalid Token Access', () => {
    it('should reject requests with malformed token', async () => {
      const response = await request(app)
        .get('/api/admin/custom-contests/templates')
        .set('Authorization', 'Bearer invalid-token');

      expect([401, 403]).toContain(response.status);
    });

    it('should reject requests with non-admin token', async () => {
      const nonAdminToken = createMockAdminToken({
        is_admin: false,
        role: 'user'
      });

      const response = await request(app)
        .get('/api/admin/custom-contests/templates')
        .set('Authorization', `Bearer ${nonAdminToken}`);

      expect([401, 403]).toContain(response.status);
    });

    it('should reject requests with expired token', async () => {
      const expiredToken = createMockAdminToken({
        exp: Math.floor(Date.now() / 1000) - 3600 // Expired 1 hour ago
      });

      const response = await request(app)
        .get('/api/admin/custom-contests/templates')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect([401, 403]).toContain(response.status);
    });
  });
});
