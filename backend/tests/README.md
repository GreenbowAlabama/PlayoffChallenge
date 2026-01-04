# Backend Test Suite

## Overview

This test suite provides behavioral guardrails for safe refactoring:

- **smoke.test.js** - Server boot and database connection tests
- **api.test.js** - Golden-path API endpoint tests
- **scoring.test.js** - Scoring logic guardrail tests

## Prerequisites

Tests require a PostgreSQL database connection. The database must have:
- The schema applied (all tables created)
- Active scoring_rules entries

## Running Tests

### Option 1: Using .env file

Create a `.env` file in the backend directory:

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/playoff_challenge_test
```

Then run:

```bash
npm test
```

### Option 2: Environment variable

```bash
DATABASE_URL="postgresql://user:password@localhost:5432/playoff_challenge" npm test
```

### Option 3: Using existing development database

If you have a development database already configured:

```bash
export DATABASE_URL="your_connection_string"
npm test
```

## Test Options

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with verbose output (see console.log)
VERBOSE_TESTS=true npm test

# Run specific test file
npm test -- tests/scoring.test.js
```

## Test Philosophy

These tests are designed as **behavioral guardrails** for refactoring:

1. **Smoke tests** verify the server boots correctly
2. **API tests** verify endpoints respond as expected
3. **Scoring tests** verify scoring logic produces consistent results

The tests do NOT:
- Modify production data
- Insert test fixtures (except smoke/api tests for essential verification)
- Change scoring rules

## Safe for Shared Databases

The tests are read-only by design and safe to run against a shared development database.
