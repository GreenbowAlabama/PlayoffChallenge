# Backend Test Suite — Execution & Safety Rules

This directory contains all backend unit, integration, contract, and end-to-end tests.

The test harness enforces strict database safety rules to prevent accidental execution
against staging or production databases.

────────────────────────────────────────
Database Safety Guard

The test runner will EXIT if:

- The database name does NOT contain the word "test"
- AND explicit override is NOT provided

This prevents accidental destructive operations.

Current environment setup:

DATABASE_URL_TEST = Test database
DATABASE_URL      = Staging database

If your test DB name does NOT include "test" (e.g., "railway"),
you MUST run tests with explicit opt-in:

    TEST_DB_ALLOW_DBNAME=railway npm test

Without this override, the suite will exit immediately.

────────────────────────────────────────
Standard Test Command

Run full suite:

    TEST_DB_ALLOW_DBNAME=railway npm test

Run specific file:

    TEST_DB_ALLOW_DBNAME=railway npm test -- tests/path/to/file.test.js

────────────────────────────────────────
Golden Rules

- Never bypass database guard logic
- Never run tests against staging or production
- All tests must pass before commit
- If a test fails, fix it properly — do not disable

────────────────────────────────────────
Template Uniqueness Invariant

contest_templates enforces:

    UNIQUE (sport, template_type)
    WHERE is_active = true

All test-created templates MUST explicitly set:

    is_active = false

Only production fixtures or specific tests may activate templates.

This preserves real production constraints during test execution.

────────────────────────────────────────

The test suite is an infrastructure guardrail.
Treat failures as architectural signal, not noise.

