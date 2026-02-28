# CLAUDE RULES — PLAYOFF CHALLENGE (READ FIRST)

This document is a HARD GATE.

Claude must read and follow this before making any changes.
If any rule here conflicts with a suggested action, this file wins.

---

Scout's rule - leave the place cleaner than when you arrived.

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

# 11. INGESTION ADAPTER RULES

All ingestion adapters follow the same interface contract:

## computeIngestionKey(contestInstanceId, unit)

**Deterministic Content Hash Requirements:**
- Hash must be content-based, never time/random dependent
- Use SHA-256 over canonicalized JSON
- Canonicalize via `ingestionValidator.canonicalizeJson()`: sorts keys alphabetically, preserves array order
- Include only scoring-relevant fields in the hash input
- Exclude volatile display fields (displayValue, order, etc.)
- Return format: `{provider}_{sport}:{contestInstanceId}:{contentHash}` (64-char hex)

**Payload Normalization Rules (Sport-Specific):**
- PGA ESPN: Hash input = `{ providerEventId, competitors: [{athleteId, rounds:[...]}] }`
  - Sort competitors by athleteId (string)
  - Filter to complete rounds only (18 holes for golf)
  - For each hole: `{ holeNumber, strokes: Math.round(value) }`
- NFL ESPN: Hash input = `{ weekNumber }` (or equivalent sport-specific unit key)

**No Database Access:**
- computeIngestionKey is pure transform
- No DB reads, no DB writes
- Used for idempotency deduplication via work_unit_key unique constraint

## getWorkUnits(ctx)

- Return empty array if ctx missing contestInstanceId
- Otherwise return minimal work unit placeholders for Batch N
- Batch 1: return `[{ providerEventId: null, providerData: null }]`
- Later batches will populate real providerEventId + providerData

## Partial-Round Policy

**Applied uniformly across all sports:**
- Include only fully completed rounds (18 holes for golf, 4 quarters for football, etc.)
- Filter rounds with incomplete data from normalization
- Incomplete rounds are silently excluded, not errors
- This ensures hash stability across partial game states during live events

## Batch 2: Polling Orchestrator Pattern

**For sport adapters requiring external data fetching (e.g., PGA ESPN):**

### Module Structure
- **Adapter** (`services/ingestion/strategies/{adapter}.js`): Pure transformation only
  - `computeIngestionKey(contestInstanceId, unit)` — deterministic hashing
  - `getWorkUnits(ctx)` — returns work unit structure (placeholder or real)
  - `normalizeEspnPayload(data)` — extracts scoring-relevant fields
  - NO ESPN API calls, NO DB reads/writes

- **Orchestrator** (`services/ingestion/orchestrators/{adapter}Orchestrator.js`): External I/O
  - Owns ESPN/external API integration
  - Fetches calendar, leaderboards, other provider data
  - Selects events deterministically
  - Validates provider payload shapes (fail-fast)
  - Builds opaque work units `{ providerEventId, providerData, ... }`
  - Calls `ingestionService.run(contestInstanceId, pool, workUnits)`

### Deterministic Event Selection (PGA ESPN)
- 6-tier algorithm (see `pga-espn-event-selection-mapping.md`)
  - Tier 1: Config override (with validation)
  - Tier 2: Date window overlap
  - Tier 3: Exact normalized name match
  - Tier 4: Substring match
  - Tier 5: Tie-breakers (date diff → earlier → lowest ID)
  - Tier 6: Escalation (return null)
- Year validation MANDATORY: Filter calendar and validate selected event year
- All matching is case-insensitive, punctuation-insensitive
- Never uses array order as tie-breaker (deterministic sorting required)

### ingestionService.run() Extension
**New signature:**
```javascript
async function run(contestInstanceId, pool, workUnits = null)
```

- If `workUnits` provided: Use them directly (from Batch 2+ orchestrator)
- If `workUnits` null: Call `adapter.getWorkUnits(ctx)` for backward compatibility
- Service remains sport-agnostic: only calls adapter functions, no ESPN parsing
- Transaction order locked: compute key → INSERT with dedup → write data → update status

---

# 12. WHEN IN DOUBT

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
