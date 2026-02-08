# Backend Test Suite

## Overview

This test suite provides behavioral guardrails for safe refactoring. The structure mirrors future SOLID layers to enable incremental migration.

## Directory Structure

```
/tests
├── routes/                    # Route contract tests (Supertest)
│   ├── public.routes.test.js  # Public API endpoints
│   ├── picks.routes.test.js   # Picks CRUD operations
│   ├── users.routes.test.js   # User management & auth
│   └── admin.routes.test.js   # Admin protection verification
│
├── services/                  # Service layer unit tests
│   ├── scoring.service.test.js   # Fantasy points calculation
│   └── gameState.service.test.js # Week/team state logic
│
├── integration/               # End-to-end smoke tests
│   └── api.smoke.test.js      # Full stack verification
│
├── mocks/                     # Test doubles & factories
│   ├── testAppFactory.js      # App instance factory
│   ├── mockPool.js            # Mock PostgreSQL pool
│   └── mockEspnApi.js         # Mock ESPN API responses
│
├── fixtures/                  # Reusable test data
│   └── index.js               # Users, players, picks, rules
│
├── api.test.js                # Legacy golden-path tests
├── smoke.test.js              # Legacy boot tests
├── scoring.test.js            # Legacy scoring guardrails
├── setup.js                   # Jest setup & teardown
└── README.md                  # This file
```

## Test Categories

### Route Contract Tests
Located in `/routes/`. These tests verify the API contract that must be preserved during refactoring:
- HTTP status codes
- Response shapes
- Parameter validation
- Error responses

### Service Unit Tests
Located in `/services/`. These tests verify business logic in isolation:
- Use mock database pool
- Fast and deterministic
- No external dependencies

### Integration Tests
Located in `/integration/`. These tests verify the system works end-to-end:
- Server boots
- Database connects
- Full request/response cycle

## Prerequisites

Tests require a PostgreSQL database connection. The database must have:
- The schema applied (all tables created)
- Active scoring_rules entries

## Running Tests

### Using .env file

Create a `.env` file in the backend directory:

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/playoff_challenge_test
```

Then run:

```bash
npm test
```

### Using environment variable

```bash
DATABASE_URL="postgresql://user:password@localhost:5432/playoff_challenge" npm test
```

## Test Commands

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with verbose output (see console.log)
VERBOSE_TESTS=true npm test

# Run specific test file
npm test -- tests/scoring.test.js

# Run only route tests
npm test -- tests/routes/

# Run only service tests
npm test -- tests/services/

# Run only integration tests
npm test -- tests/integration/
```

## Test Utilities

### testAppFactory.js

Provides isolated app instances for different testing scenarios:

```javascript
const { getIntegrationApp, createIsolatedApp, createMockPool } = require('./mocks/testAppFactory');

// Integration tests (real database)
const { app, pool } = getIntegrationApp();

// Unit tests (mocked database)
const mockPool = createMockPool();
const app = createIsolatedApp({ pool: mockPool });
```

### mockPool.js

Configurable mock for PostgreSQL pool:

```javascript
const { createMockPool, mockQueryResponses } = require('./mocks/mockPool');

const mockPool = createMockPool();
mockPool.setQueryResponse(
  /SELECT.*FROM users/,
  mockQueryResponses.single({ id: '123', email: 'test@example.com' })
);
```

### fixtures/index.js

Reusable test data:

```javascript
const { users, players, statPayloads, gameSettings } = require('./fixtures');

// Use pre-defined test entities
const testUser = users.valid;
const qbStats = statPayloads.qbBasic;
```

## Test Philosophy

These tests are designed as **behavioral guardrails** for refactoring:

1. **Lock in behavior** - Tests fail if API contracts change
2. **Fast feedback** - Most tests run without external calls
3. **Layer isolation** - Each layer can be tested independently
4. **Deterministic** - Same input always produces same output

The tests do NOT:
- Modify production data (read-only by design)
- Insert permanent test fixtures
- Change scoring rules
- Make external API calls in unit tests

## Safe for Shared Databases

Route and integration tests are read-only and safe to run against a shared development database.

## Adding New Tests

When adding tests, follow these patterns:

### Route Test
```javascript
// tests/routes/example.routes.test.js
const request = require('supertest');
const { getIntegrationApp } = require('../mocks/testAppFactory');

describe('Example Routes', () => {
  let app;
  beforeAll(() => { app = getIntegrationApp().app; });

  it('GET /api/example should return 200', async () => {
    const response = await request(app).get('/api/example');
    expect(response.status).toBe(200);
  });
});
```

### Service Test
```javascript
// tests/services/example.service.test.js
const { createMockPool, mockQueryResponses } = require('../mocks/mockPool');

describe('Example Service', () => {
  let mockPool;
  beforeEach(() => { mockPool = createMockPool(); });
  afterEach(() => { mockPool.reset(); });

  it('should do something', async () => {
    mockPool.setQueryResponse(/SELECT/, mockQueryResponses.single({ value: 42 }));
    // Test your service logic
  });
});
```

## Migration Path

This test structure supports incremental SOLID refactoring:

1. Route tests ensure API contracts don't change
2. Service tests can be written before extracting services
3. Repository tests can be added when repositories are created
4. Mock infrastructure enables testing without database

As code is refactored, move tests from legacy files to appropriate layer directories.
