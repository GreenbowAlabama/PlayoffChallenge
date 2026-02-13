/**
 * Test App Factory
 *
 * Provides isolated Express app instances for testing.
 * Enables dependency injection and mocking of external services.
 *
 * Usage Patterns:
 *
 * 1. Integration tests (real database):
 *    const { getIntegrationApp } = require('./mocks/testAppFactory');
 *    const { app, pool } = getIntegrationApp();
 *
 * 2. Unit tests (mocked database):
 *    const { createIsolatedApp, createMockPool } = require('./mocks/testAppFactory');
 *    const mockPool = createMockPool();
 *    const app = createIsolatedApp({ pool: mockPool });
 *
 * 3. API contract tests:
 *    const { getContractTestApp } = require('./mocks/testAppFactory');
 *    const app = getContractTestApp();
 */

const { createMockPool, mockQueryResponses } = require('./mockPool');

// Cached reference to real app for integration tests
let cachedApp = null;
let cachedPool = null;

/**
 * Get the real app and pool for integration tests.
 * Uses the actual server.js exports with real database connection.
 * Suitable for tests that need to verify actual database behavior.
 */
function getIntegrationApp() {
  if (!cachedApp) {
    const server = require('../../server');
    cachedApp = server.app;
    cachedPool = server.pool;
  }
  return { app: cachedApp, pool: cachedPool };
}

/**
 * Create an isolated app instance with injectable dependencies.
 * This is useful for unit testing routes with mocked services.
 *
 * Note: This creates a minimal Express app that mirrors the server.js
 * configuration but allows swapping the database pool.
 *
 * @param {Object} options Configuration options
 * @param {Object} options.pool Database pool (real or mock)
 * @param {Object} options.overrides Additional app.locals overrides
 */
function createIsolatedApp(options = {}) {
  const express = require('express');
  const cors = require('cors');

  const {
    pool = createMockPool(),
    overrides = {}
  } = options;

  const app = express();

  // Mirror server.js middleware configuration
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Inject pool into app.locals (same pattern as server.js)
  app.locals.pool = pool;

  // Apply any additional overrides
  Object.assign(app.locals, overrides);

  // Health endpoint for smoke tests
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  return app;
}

/**
 * Get a pre-configured app for API contract tests.
 * Uses real database but isolates test runs.
 */
function getContractTestApp() {
  return getIntegrationApp().app;
}

/**
 * Create a supertest request wrapper with common headers.
 * Useful for simulating different client types.
 *
 * @param {Object} app Express app instance
 * @returns {Object} Request factory with methods for different client types
 */
function createRequestFactory(app) {
  const request = require('supertest');

  const modernHeaders = {
    'X-Client-Capabilities': 'leaderboard_meta,leaderboard_gating,tos_required_flag,picks_v2',
    'X-Client-Version': '2.0.0'
  };

  return {
    /**
     * GET request with modern client capabilities
     */
    get(path) {
      return request(app)
        .get(path)
        .set(modernHeaders);
    },

    /**
     * POST request with modern client capabilities
     */
    post(path) {
      return request(app)
        .post(path)
        .set(modernHeaders);
    },

    /**
     * PUT request with modern client capabilities
     */
    put(path) {
      return request(app)
        .put(path)
        .set(modernHeaders);
    },

    /**
     * DELETE request with modern client capabilities
     */
    delete(path) {
      return request(app)
        .delete(path)
        .set(modernHeaders);
    },

    /**
     * Raw supertest request (no preset headers)
     */
    raw() {
      return request(app);
    },

    /**
     * Request with admin authentication
     * @param {string} token JWT token for admin auth
     */
    withAdmin(token) {
      return {
        get: (path) => request(app).get(path).set('Authorization', `Bearer ${token}`).set(modernHeaders),
        post: (path) => request(app).post(path).set('Authorization', `Bearer ${token}`).set(modernHeaders),
        put: (path) => request(app).put(path).set('Authorization', `Bearer ${token}`).set(modernHeaders),
        delete: (path) => request(app).delete(path).set('Authorization', `Bearer ${token}`).set(modernHeaders)
      };
    }
  };
}

/**
 * Create a mock admin JWT token for testing protected routes.
 * Note: This token is only valid with a matching ADMIN_JWT_SECRET.
 *
 * @param {Object} claims Token payload claims
 * @returns {string} JWT token string
 */
function createMockAdminToken(claims = {}) {
  const jwt = require('jsonwebtoken');

  const defaultClaims = {
    sub: '33333333-3333-3333-3333-333333333333',
    email: 'admin@example.com',
    is_admin: true,
    role: 'admin',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600
  };

  const payload = { ...defaultClaims, ...claims };
  const secret = process.env.ADMIN_JWT_SECRET || 'test-secret-for-unit-tests';

  return jwt.sign(payload, secret);
}

/**
 * Setup common mock responses for standard test scenarios.
 * Call this helper to pre-configure a mock pool with typical data.
 *
 * @param {Object} mockPool Mock pool instance from createMockPool()
 * @param {string} scenario Name of the scenario to setup
 */
function setupMockScenario(mockPool, scenario) {
  const fixtures = require('../fixtures');

  switch (scenario) {
    case 'empty':
      // All queries return empty results (default)
      break;

    case 'wildcardActive':
      mockPool
        .setQueryResponse(/game_settings/, mockQueryResponses.gameSettings(fixtures.gameSettings.wildcardActive))
        .setQueryResponse(/scoring_rules/, mockQueryResponses.scoringRules())
        .setQueryResponse(/SELECT.*FROM players/, mockQueryResponses.multiple([fixtures.players.qb, fixtures.players.rb, fixtures.players.wr]));
      break;

    case 'wildcardLocked':
      mockPool
        .setQueryResponse(/game_settings/, mockQueryResponses.gameSettings(fixtures.gameSettings.wildcardLocked))
        .setQueryResponse(/scoring_rules/, mockQueryResponses.scoringRules());
      break;

    case 'withUser':
      mockPool
        .setQueryResponse(/SELECT.*FROM users WHERE id/, mockQueryResponses.single(fixtures.users.valid))
        .setQueryResponse(/game_settings/, mockQueryResponses.gameSettings(fixtures.gameSettings.wildcardActive));
      break;

    case 'withAdmin':
      mockPool
        .setQueryResponse(/SELECT.*FROM users WHERE id/, mockQueryResponses.single(fixtures.users.admin))
        .setQueryResponse(/game_settings/, mockQueryResponses.gameSettings(fixtures.gameSettings.wildcardActive));
      break;

    default:
      console.warn(`Unknown scenario: ${scenario}`);
  }

  return mockPool;
}

/**
 * Cleanup helper for after tests.
 * Resets mocks and cached references.
 */
async function cleanup() {
  // Don't close the real pool here - that's handled in setup.js
  cachedApp = null;
  cachedPool = null;
}

/**
 * Compatibility alias for legacy tests
 * createTestApp is an alias for getIntegrationApp (uses real database)
 * Legacy admin tests expect actual database access
 */
const createTestApp = getIntegrationApp;

module.exports = {
  // App factories
  getIntegrationApp,
  createIsolatedApp,
  getContractTestApp,
  createTestApp,  // Compatibility alias

  // Request helpers
  createRequestFactory,
  createMockAdminToken,

  // Mock setup
  createMockPool,
  mockQueryResponses,
  setupMockScenario,

  // Cleanup
  cleanup
};
