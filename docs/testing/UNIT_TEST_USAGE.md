# Unit Test Usage — Infrastructure + iOS

This document defines how unit tests are executed across the platform.

No wrappers. No agents. No custom runners.

Always use native tooling.

────────────────────────────────────────
Backend (Node / Infrastructure)
Location:
  /Users/iancarter/Documents/workspace/playoff-challenge/backend

Primary Command:
  npm test

What it does:
  - Sets NODE_ENV=test
  - Runs Jest in single-threaded mode (--runInBand)
  - Executes all unit + sentinel tests
  - Enforces regression safety across:
      - Strategy dispatch
      - Settlement idempotency
      - OpenAPI contract presence
      - Registry enforcement

Optional (target a specific test file):
  npm test -- --testPathPattern="pattern_here"

Required Before:
  - Any commit
  - Any merge
  - Any architectural change
  - Any contract modification

Do NOT:
  - Use custom test agents
  - Use unit-test-runner
  - Run Jest directly
  - Bypass npm test

Regression standard:
  All tests must pass.
  Skip count must remain stable unless intentionally modified.

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
  - ViewModel logic
  - Contract decoding
  - Business rule invariants

Required Before:
  - Any core logic change
  - Any model change
  - Any contract response modification

Do NOT:
  - Use Xcode-only test runs as source of truth
  - Skip swift test before committing core changes

────────────────────────────────────────
Golden Rule

If tests fail:
  Stop.
  Fix the failure.
  Do not bypass.

Unit tests are infrastructure guardrails, not suggestions.
