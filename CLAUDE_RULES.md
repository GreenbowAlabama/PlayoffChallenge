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

# 12. DISCOVERY SERVICE LIFECYCLE ORDERING

## Template State Transitions

The discovery service must enforce strict ordering when handling template state changes:

### Phase 1: Provider State Changes (Cancellation)
**Runs first, independent of instance state.**

When `normalized.status = 'CANCELLED'`:
1. Update `contest_templates.status` to 'CANCELLED' (idempotent: WHERE status != 'CANCELLED')
2. Cascade to contest_instances:
   - Update all instances where `status NOT IN ('COMPLETE', 'CANCELLED')` to 'CANCELLED'
   - Insert contest_state_transitions with `triggered_by = 'PROVIDER_TOURNAMENT_CANCELLED'`
   - Use CTE with FOR UPDATE lock for atomicity
3. Return early if template already CANCELLED (idempotent: rowCount = 0)

**Invariant:** Cancellation must execute BEFORE metadata freeze check.
Even if LOCKED instances exist, cancellation proceeds.
Metadata freeze only blocks name updates (unless cascade occurred).

### Phase 2: Metadata Freeze (Post-LOCKED)
**Runs after provider state changes.**

When ANY instance is LOCKED, LIVE, or COMPLETE:
- Block name/metadata updates
- Allow-list: cancellation cascade (Phase 1) may have already occurred
- Return early: `updated = false` (unless cancellation updated = true from Phase 1)

### Phase 3: Metadata Updates (Pre-LOCKED)
**Runs only if no LOCKED instances and no cancellation.**

When NO LOCKED instances and provider status is NOT CANCELLED:
- Safe to update: name (if changed)
- Deterministic: compare currentName vs normalized.name

## Transaction Guarantees

- All three phases execute within same transaction (BEGIN → COMMIT/ROLLBACK)
- Atomicity: Either all changes commit or all rollback
- No partial state: Instance cascade and transitions are all-or-nothing
- Ordering constraint: Provider changes → Metadata freeze → Metadata updates

## Idempotency Rules

1. **Cancellation Idempotency**
   - Repeated CANCELLED discovery: template update rowCount = 0 → no cascade → updated = false
   - Zero duplicate transitions inserted
   - Cascade CTE ensures only actually-changed instances get transitions

2. **Metadata Update Idempotency**
   - Repeated SCHEDULED discovery: nameChanged = false → no name update → updated = false
   - Re-discoveries with same name produce zero changes

3. **Test Isolation**
   - Use unique provider_tournament_id per test (generated, not hardcoded)
   - Cleanup in afterEach using parameterized provider_id
   - Prevents state contamination between tests

## Admin OpenAPI Documentation

**Current state:** Admin endpoints (`/api/admin/*`) are excluded from `openapi.yaml` by design.
The public contract in `openapi.yaml` documents only client-facing routes.

**Planned:** A separate `contracts/openapi-admin.yaml` should be created to document admin discovery endpoints, but does not exist yet.
This would preserve the separation between public iOS client contract and internal admin tooling.

---

# 13. WHEN IN DOUBT

Ask for:
- schema.snapshot.sql
- openapi.yaml
- failing test output
- architecture docs

Do not guess.

---

# 14. GOLDEN COPIES (CONTRACT & SCHEMA FREEZE)

This system now has authoritative "golden" sources of truth.
They are not optional. They are not advisory. They are contracts.

## 14.1 Public API Contract (Client-Facing)

**Golden file:**
`backend/contracts/openapi.yaml`

This file defines the public contract consumed by the iOS client.

Rules:

- Any modification requires:
  1. Explicit spec update
  2. Updated hash in `tests/openapi-freeze.test.js`
  3. Clear justification in commit message
- Admin endpoints (`/api/admin/*`) MUST NOT appear in this file.
- Public contract changes are version-impacting decisions.

Enforcement:

- `tests/openapi-freeze.test.js`
- `tests/contract-freeze.test.js`

If a freeze test fails, the client contract has been broken.

No silent edits.
No undocumented field additions.

## 14.2 Database Schema (Authoritative Snapshot)

**Golden file:**
`backend/db/schema.snapshot.sql`

This file is the canonical structural representation of the database.

It must reflect:

- Tables
- Columns
- CHECK constraints
- Defaults
- Indexes
- Foreign keys
- Status fields (including contest_templates.status)

Rules:

- Any migration that changes structure MUST:
  1. Apply migration
  2. Regenerate snapshot
  3. Commit migration + updated snapshot together
- Snapshot drift is architectural corruption.

If schema changes and snapshot does not, the change is incomplete.

# 15. FAST FEEDBACK PROTOCOL (MANDATORY)

Claude must prefer narrow feedback before full-suite validation.

## Tier 1 — Discovery Surface

cd backend && \
ADMIN_JWT_SECRET=test-admin-jwt-secret \
TEST_DB_ALLOW_DBNAME=railway \
npm test -- tests/discovery/ --runInBand --forceExit

## Tier 2 — Settlement Surface

cd backend && \
ADMIN_JWT_SECRET=test-admin-jwt-secret \
TEST_DB_ALLOW_DBNAME=railway \
npm test -- tests/e2e/pgaSettlementInvariants.test.js --runInBand --forceExit

## Tier 3 — Full Backend Validation

cd backend && \
ADMIN_JWT_SECRET=test-admin-jwt-secret \
TEST_DB_ALLOW_DBNAME=railway \
npm test -- --forceExit

Never skip freeze tests.
Never commit with failing invariant tests.

# 16. CORE FINANCIAL & LIFECYCLE INVARIANTS FROZEN STATUS (POST DAY 7)

System state:

- 92 test suites
- 1978+ passing tests
- Cancellation cascade atomic + idempotent
- Lifecycle ordering enforced
- Settlement strictly scoped by contest_instance_id
- Public OpenAPI frozen
- Schema snapshot authoritative

New features must NOT:

- Break lifecycle phase ordering
- Mutate LIVE from discovery
- Modify openapi.yaml silently
- Change schema without snapshot update

# 17. SYSTEM MATURITY MATRIX (Governance Layer)

This matrix defines the authoritative separation between frozen core invariants and evolving systems.

This section prevents language drift across governance documents.

---

## Four Independent Maturity Axes

| Axis | Status | Governance Level | Meaning |
|------|--------|------------------|---------|
| Core Financial & Lifecycle Invariants | ✅ FROZEN | PROTECTED | Settlement math, snapshot binding, lifecycle ordering, cancellation cascade are locked by tests. Changes require governance review. |
| Tournament Discovery Automation | 🔄 IN PROGRESS | EVOLVING | External worker, auto-template generation, marketing contest creation. Must NOT mutate frozen invariant layer. |
| Contract Versioning Runtime | 🔄 IN PROGRESS | STRUCTURAL | OpenAPI spec frozen; runtime multi-version routing + middleware not yet implemented. |
| Monitoring + GA Gate | ❌ PENDING | OPERATIONAL | Alerts, dashboards, GA validation checklist not yet fully operational. |

---

## Critical Rule

"Frozen" applies ONLY to:

- Settlement math invariants
- Snapshot immutability and binding
- Lifecycle transition ordering
- Cancellation cascade ordering
- Deterministic replay guarantees
- Terminal COMPLETE enforcement

It does NOT apply to:

- Discovery automation
- Auto-template generation
- Version routing infrastructure
- Monitoring tooling
- Force-complete endpoint implementation

---

## Change Control Boundary

The following layers must NEVER bypass the Frozen Invariants:

- Discovery Service
- Auto-template creation
- Marketing contest automation
- Monitoring triggers
- Admin endpoints

If any evolving system attempts to:

- Modify settlement math
- Bypass snapshot binding
- Override lifecycle ordering
- Mutate COMPLETE contests

It is considered a governance violation.

---

## GA Definition

GA readiness requires ALL four axes operational.

Core invariants alone do not constitute GA readiness.

---

## Document Alignment Rule

All governance docs must reference this matrix when using terms like:

- "Frozen"
- "Hardened"
- "Complete"
- "Infrastructure Locked"
- "Ready"

If a document implies full-system freeze, it must explicitly clarify axis scope.

---

# 18. ADMIN OPENAPI (DEFERRED)

Admin endpoints are intentionally excluded from openapi.yaml.

A future `contracts/openapi-admin.yaml` may document them separately.

---

This file is a governance lock.

If you are Claude, you must follow this.

No exceptions.
