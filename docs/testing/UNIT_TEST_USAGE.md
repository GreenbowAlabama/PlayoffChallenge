# Unit Test Usage — Infrastructure + iOS

This document defines how unit and integration tests are executed across the platform.

No wrappers. No agents. No custom runners.

Always use native tooling with explicit environment configuration.

────────────────────────────────────────
Backend (Node / Infrastructure)
Location:
  /Users/iancarter/Documents/workspace/playoff-challenge/backend

Primary Command (Railway Test DB):

  TEST_DB_ALLOW_DBNAME=railway npm test

What it does:
  - Sets NODE_ENV=test
  - Requires DATABASE_URL_TEST to be defined
  - Enforces DATABASE_URL_TEST ≠ DATABASE_URL
  - Enforces host:port separation between test and staging
  - Requires explicit opt-in for non-"test" DB names
  - Runs Jest in single-threaded mode (--runInBand)
  - Executes all:
      - Unit tests
      - Integration tests
      - Settlement invariant tests
      - Lifecycle enforcement tests
      - Contract freeze tests
      - Idempotency guards
      - FK enforcement validation

Optional (target a specific test file):

  TEST_DB_ALLOW_DBNAME=railway npm test -- path/to/test.file.js

Or:

  TEST_DB_ALLOW_DBNAME=railway npm test -- \
    backend/tests/integration/example.test.js

Deep debug (detect hanging handles):

  TEST_DB_ALLOW_DBNAME=railway npx jest --runInBand --detectOpenHandles

Required Before:
  - Any commit
  - Any merge
  - Any architectural change
  - Any schema change
  - Any contract modification
  - Any settlement logic change
  - Any contest template modification

Do NOT:
  - Disable FK constraints
  - Seed random templates manually
  - Run against staging as test DB
  - Run without TEST_DB_ALLOW_DBNAME when using Railway
  - Bypass npm test
  - Use custom test agents
  - Silence failing invariants

Regression Standard:
  - All tests must pass.
  - Failure count must be zero.
  - Skip count must remain stable unless intentionally modified.
  - Invariant tests must remain green.
  - Settlement replay must remain deterministic.

The test DB is authoritative for automated validation.
Staging is NOT the test harness.

────────────────────────────────────────
iOS Core (Swift Package)
Location:
  /Users/iancarter/Documents/workspace/playoff-challenge/core

Build:

  swift build

Run Tests:

  swift test

What it covers:
  - Strategy dispatch correctness
  - ViewModel state transitions
  - Contract decoding safety
  - Business rule invariants
  - Registry enforcement
  - Deterministic model behavior

Required Before:
  - Any core logic change
  - Any model modification
  - Any DTO change
  - Any OpenAPI contract modification
  - Any contest type wiring change

Do NOT:
  - Rely solely on Xcode UI test runs
  - Skip swift test before committing
  - Modify models without running contract decoding tests

The Swift package test suite is the single source of truth for core logic validation.

────────────────────────────────────────
Golden Rule

If tests fail:
  Stop.
  Fix the failure.
  Do not bypass.
  Do not weaken constraints.
  Do not remove assertions.

Unit and integration tests are infrastructure guardrails.
They protect settlement correctness, financial integrity, and contract stability.

Passing tests are a deployment requirement, not a suggestion.