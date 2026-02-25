# Backend Tests — Infrastructure & Financial Guardrails

This directory contains all backend unit and regression tests.

These tests protect:

- Contest lifecycle state transitions
- Settlement determinism
- Idempotent financial behavior
- Ledger invariants
- Strategy dispatch
- OpenAPI contract alignment
- Eligibility enforcement
- Payment flow integrity

────────────────────────────────────────
Authoritative Command

Always run tests using:

    npm test

Do NOT:

- Run Jest directly
- Use custom runners
- Bypass npm test
- Modify skip counts casually

`npm test` is the only approved entry point.

────────────────────────────────────────
What Tests Protect

Tests enforce:

- Atomic wallet deduction + entry creation
- 10% service fee retention correctness
- Idempotent settlement execution
- Replay-safe Stripe webhook handling
- Append-only ledger behavior
- No negative balances
- Eligibility hard rejection
- Contest state auto-transition safety
- Rules version snapshot consistency

These are revenue-critical invariants.

────────────────────────────────────────
When Tests Must Be Run

Before:

- Any commit
- Any merge
- Any lifecycle change
- Any settlement logic change
- Any wallet logic change
- Any contract modification
- Any eligibility enforcement change

If tests fail:

Stop.
Fix.
Do not bypass.

────────────────────────────────────────
Regression Standard

- All tests must pass.
- Skip count must remain stable unless intentionally modified.
- New financial paths require new tests.
- No mutation of settlement logic without coverage.

────────────────────────────────────────
Golden Rule

Backend tests are financial infrastructure guardrails.

They are not optional.
They are not advisory.

Revenue integrity depends on them.
