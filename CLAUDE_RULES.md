# CLAUDE RULES — PLAYOFF CHALLENGE (READ FIRST)

This document is a HARD GATE.

Claude must read and follow this before making any changes.
If any rule here conflicts with a suggested action, this file wins.

---

# 1. TESTS ARE AUTHORITATIVE

## backend/tests/ is the source of truth for backend behavior.

- Tests define the contract.
- Tests define invariants.
- Tests define settlement math.
- Tests define lifecycle behavior.
- Tests define idempotency expectations.

If backend/tests fail:
- The implementation is wrong.
- Do not weaken tests to make code pass.
- Do not rewrite invariants casually.
- Fix the implementation to satisfy the tests.

Before any merge:
- All backend tests must pass.
- No skipped tests.
- No commented-out assertions.

Proper execution:

TEST_DB_ALLOW_DBNAME=railway npm test

For a specific file:

TEST_DB_ALLOW_DBNAME=railway npm test -- tests/e2e/pgaSettlementInvariants.test.js --runInBand --forceExit

If tests require DATABASE_URL_TEST:
- It must be set.
- Never assume production database.

---

# 2. NO GIT COMMANDS

Claude must NOT:
- Run git add
- Run git commit
- Run git push
- Create branches
- Merge branches
- Reset history
- Rebase
- Force push

Version control decisions belong to the human operator.

Claude edits files only.
Git is handled manually.

---

# 3. SCHEMA IS NOT ASSUMED

schema.snapshot.sql is authoritative.

Claude:
- Must NOT assume schema structure.
- Must request schema.snapshot.sql if database structure matters.
- Must not hallucinate columns or constraints.

If database behavior is involved:
- Ask to inspect schema.snapshot.sql first.
- Do not guess.

---

# 4. OPENAPI IS LAW

backend/openapi.yaml is authoritative.

- Request/response shapes must match openapi.yaml.
- No silent API changes.
- No undocumented fields.
- No inferred contract changes.

If implementation and OpenAPI conflict:
- OpenAPI wins.
- Update implementation to comply.

---

# 5. iOS CONTRACTS ARE LAW

ios-app/PlayoffChallenge/Contracts/

This directory defines:
- DTO structure
- Decoding rules
- Network contract mapping

Claude must:
- Never mutate DTO structure casually.
- Never inject UI-only fields into Contracts.
- Never modify API shapes without OpenAPI alignment.

Backend → OpenAPI → iOS Contracts → Domain → ViewModel → View

This chain must remain intact.

---

# 6. ARCHITECTURE BOUNDARIES

Backend:
- Deterministic
- Idempotent
- Snapshot-bound where required
- No implicit side effects

iOS:
- ViewModels observe Domain only.
- No DTO in ViewModels.
- No Service calls from Views.
- No business logic in UI.

If unsure:
- Ask.
- Do not drift.

---

# 7. SETTLEMENT ENGINE RULE

Settlement logic must remain:

- Deterministic
- Snapshot-bound
- Hash-stable
- Idempotent
- Test-frozen via invariant suite

If you modify settlement math:
- You must update invariant tests intentionally.
- You must explain why.
- You must confirm golden snapshot changes explicitly.

No silent math edits.

---

# 8. NEVER WEAKEN SAFETY FOR CONVENIENCE

Do not:
- Remove constraints to “make it pass”
- Bypass validation
- Comment out failing tests
- Add catch-all error suppression

Stability > speed.

---

# 9. CONTINUOUS IMPROVEMENT REQUIREMENT

Every session must:

- Improve system clarity, structure, or velocity by at least 1%.
- Reduce ambiguity, duplication, or drift.
- Leave documentation in a better state than it was found.

If a change exposes architectural confusion:
- Update global documentation.
- Update governance files.
- Update enforcement rules.
- Update invariant explanations.

Do not allow knowledge to remain tribal or implicit.

Each session must:
- Tighten contracts.
- Clarify invariants.
- Strengthen enforcement.
- Reduce future rework.

---

# 10. GLOBAL DOCUMENTS MUST BE KEPT CURRENT

If behavior changes:
- Update this file.
- Update architecture docs.
- Update invariant descriptions.
- Update OpenAPI if necessary.
- Update iOS Contracts if necessary.

Do not allow:
- Drift between implementation and documentation.
- Silent contract changes.
- Untracked architectural decisions.

Documentation is not optional.
It is part of the system.

---

# 11. WHEN IN DOUBT

Ask for:
- schema.snapshot.sql
- openapi.yaml
- failing test output
- architecture docs

Do not guess.

---

This file is a governance lock.

If you are Claude, you must follow this.

No exceptions.
