/**
 * Admin Routes Contract Tests
 *
 * Purpose: Verify admin route protection and response contracts
 * - All admin routes require authentication
 * - Unauthorized access returns 401/403
 * - Valid admin tokens grant access
 *
 * These tests focus on authorization behavior, not business logic.
 */

const request = require('supertest');
const { getIntegrationApp, createMockAdminToken, createRequestFactory } = require('../mocks/testAppFactory');

describe('Admin Routes Contract Tests', () => {
  let app;
  let requestFactory;

  beforeAll(() => {
    const { app: integrationApp } = getIntegrationApp();
    app = integrationApp;
    requestFactory = createRequestFactory(app);
  });

  describe('Admin Protection Middleware', () => {
    const protectedRoutes = [
      { method: 'post', path: '/api/admin/update-week-status' },
      { method: 'post', path: '/api/admin/update-current-week' },
      { method: 'post', path: '/api/admin/set-active-week' },
      { method: 'get', path: '/api/admin/verify-lock-status' },
      { method: 'get', path: '/api/admin/incomplete-lineups' },
      { method: 'get', path: '/api/admin/all-lineups' },
      { method: 'post', path: '/api/admin/sync-espn-ids' },
      { method: 'post', path: '/api/admin/populate-image-urls' },
      { method: 'post', path: '/api/admin/sync-players' },
      { method: 'post', path: '/api/admin/update-live-stats' },
      { method: 'get', path: '/api/admin/cache-status' },
      { method: 'get', path: '/api/admin/check-espn-ids' },
      { method: 'get', path: '/api/admin/picks/count' },
      { method: 'get', path: '/api/admin/scores/count' },
      { method: 'get', path: '/api/admin/picks/multiplier-distribution' },
      { method: 'get', path: '/api/admin/preview-week-transition' },
      // Custom contest template management
      { method: 'get', path: '/api/admin/custom-contests/templates' },
      { method: 'post', path: '/api/admin/custom-contests/templates' },
      { method: 'delete', path: '/api/admin/custom-contests/templates/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }
    ];

    describe('Unauthenticated Access', () => {
      protectedRoutes.forEach(({ method, path }) => {
        it(`${method.toUpperCase()} ${path} should reject without token`, async () => {
          const response = await request(app)[method](path);

          expect([401, 403]).toContain(response.status);
        });
      });
    });

    describe('Invalid Token Access', () => {
      it('should reject requests with malformed token', async () => {
        const response = await request(app)
          .get('/api/admin/cache-status')
          .set('Authorization', 'Bearer invalid-token');

        expect([401, 403]).toContain(response.status);
      });

      it('should reject requests with expired token', async () => {
        const expiredToken = createMockAdminToken({
          exp: Math.floor(Date.now() / 1000) - 3600 // Expired 1 hour ago
        });

        const response = await request(app)
          .get('/api/admin/cache-status')
          .set('Authorization', `Bearer ${expiredToken}`);

        expect([401, 403]).toContain(response.status);
      });

      it('should reject non-admin tokens', async () => {
        const nonAdminToken = createMockAdminToken({
          is_admin: false,
          role: 'user'
        });

        const response = await request(app)
          .get('/api/admin/cache-status')
          .set('Authorization', `Bearer ${nonAdminToken}`);

        expect([401, 403]).toContain(response.status);
      });
    });

    describe('Auth Routes (Unprotected)', () => {
      it('POST /api/admin/auth/apple should be accessible without token', async () => {
        // Apple auth endpoint should be publicly accessible
        // Will fail with 400 due to missing params, but not 401/403
        const response = await request(app)
          .post('/api/admin/auth/apple')
          .send({});

        expect(response.status).not.toBe(401);
        expect(response.status).not.toBe(403);
      });
    });
  });

  describe('Admin Diagnostics Routes', () => {
    describe('Unauthenticated Access', () => {
      const diagnosticsRoutes = [
        { method: 'get', path: '/api/admin/diagnostics/users' },
        { method: 'get', path: '/api/admin/diagnostics/users-stats' },
        { method: 'get', path: '/api/admin/diagnostics/health' },
        { method: 'get', path: '/api/admin/diagnostics/health/db' },
        { method: 'get', path: '/api/admin/diagnostics/health/external' },
        { method: 'get', path: '/api/admin/diagnostics/rate-limits' },
        { method: 'get', path: '/api/admin/diagnostics/jobs' }
      ];

      diagnosticsRoutes.forEach(({ method, path }) => {
        it(`${method.toUpperCase()} ${path} should reject without token`, async () => {
          const response = await request(app)[method](path);

          expect([401, 403]).toContain(response.status);
        });
      });
    });
  });

  describe('Admin Trends Routes', () => {
    it('should reject unauthenticated access to trends endpoints', async () => {
      const response = await request(app).get('/api/admin/trends');

      expect([401, 403, 404]).toContain(response.status);
    });
  });

  describe('Response Error Format', () => {
    it('should return JSON error on auth failure', async () => {
      const response = await request(app)
        .get('/api/admin/cache-status');

      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.body).toHaveProperty('error');
    });

    it('error message should not expose sensitive details', async () => {
      const response = await request(app)
        .get('/api/admin/cache-status');

      // Error message should be generic, not exposing internal details
      const errorMessage = response.body.error || '';
      expect(errorMessage).not.toMatch(/secret/i);
      expect(errorMessage).not.toMatch(/password/i);
      expect(errorMessage).not.toMatch(/key/i);
    });
  });
});
