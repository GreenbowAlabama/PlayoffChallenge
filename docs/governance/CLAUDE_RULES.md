# CLAUDE RULES — PLAYOFF CHALLENGE (READ FIRST)

This document is a HARD GATE.

Claude must read and follow this before making any changes.
If any rule here conflicts with a suggested action, this file wins.

---

## Governance Location

**All governance documents live under:** `docs/governance/`

If a copy exists elsewhere in the repository, it is obsolete and should be deleted.

Single source of truth prevents drift.

### Governance Document Index

| Document | Purpose |
|----------|---------|
| `CLAUDE_RULES.md` | Global governance, frozen invariants, architecture boundaries, change control |
| `LIFECYCLE_EXECUTION_MAP.md` | Contest state machine transitions, execution primitives, orchestration model |
| `FINANCIAL_INVARIANTS.md` | Wallet debit atomicity, entry fee immutability, idempotency guarantees, error handling |
| `IOS_SWEEP_PROTOCOL.md` | iOS development phases, contract integrity, layer boundary enforcement |
| `ARCHITECTURE_ENFORCEMENT.md` | Design system token enforcement (iOS UI) |

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
- Remove constraints to "make it pass"
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

# 12. FINANCIAL INVARIANTS (PHASE 2 JOIN DEBIT)

## Atomic Wallet Debit on Join

All contest entries with a cost (entry_fee_cents > 0) must atomically debit the user's wallet upon successful participant insertion.

### Join Flow Critical Ordering

**Evidence:** `backend/services/customContestService.js:1023-1224`

Join uses a single database transaction with the following phases:

1. **Lock User Row** (line 1030)
   ```sql
   SELECT id FROM users WHERE id = $1 FOR UPDATE
   ```
   Prevents concurrent wallet mutations by serializing access to the user account.

2. **Lock Contest Row** (line 1041)
   ```sql
   SELECT id, status, max_entries, lock_time, join_token, entry_fee_cents
   FROM contest_instances WHERE id = $1 FOR UPDATE
   ```

3. **Validate Joinable State** (lines 1052-1070)
   - Check join_token exists (contest is published)
   - Check status = 'SCHEDULED' (only open contests joinable)
   - Check lock_time not reached (time-based entry enforcement)

4. **Idempotent Precheck** (lines 1078-1087)
   - If user already in `contest_participants`, return success without debit
   - CRITICAL: Do NOT debit on idempotent path

5. **Capacity Check** (lines 1089-1099)
   - Count current participants
   - Fail if max_entries reached

6. **Compute Wallet Balance** (line 1104)
   - Call `LedgerRepository.computeWalletBalance(client, userId)`
   - Reads ledger aggregating CREDIT - DEBIT for reference_type='WALLET'

7. **Validate Sufficient Funds** (lines 1106-1113)
   - entryFeeCents = contest.entry_fee_cents (instance-level, immutable at join time)
   - If walletBalance < entryFeeCents, return error code `INSUFFICIENT_WALLET_FUNDS`

8. **Insert Participant** (lines 1117-1142)
   - `INSERT INTO contest_participants (contest_instance_id, user_id, joined_at) ... ON CONFLICT DO NOTHING`
   - If insert returns 0 rows (race condition):
     - Recheck participant exists
     - If found, return success (another transaction already debited)
     - If not found, return CONTEST_FULL (capacity exhausted by concurrent join)
   - If insert succeeds (rowCount > 0), proceed to debit

9. **Insert Wallet Debit** (lines 1150-1212)
   - Only executes if participant insert succeeded
   - Uses deterministic idempotency key: `wallet_debit:{contestInstanceId}:{userId}`
   - `INSERT INTO ledger (entry_type='WALLET_DEBIT', direction='DEBIT', idempotency_key, ...) ... ON CONFLICT DO NOTHING`
   - If conflict: verify existing debit matches expected fields
   - Field mismatch triggers invariant violation (hard error, rollback)

10. **Commit** (line 1211)
    - Both participant row (in contest_participants) and debit entry (in ledger) must exist before commit
    - No partial updates

### Entry Fee Creation & Immutability Binding

Entry fee is **user-provided at contest creation**, validated against template bounds, and **immutable at join time**.

**Evidence:** `backend/services/customContestService.js:437,446,470`

```javascript
// Entry fee is user-supplied parameter to createContestInstance
@param {number} input.entry_fee_cents - Entry fee in cents

// Validated against template min/max bounds
validateEntryFeeAgainstTemplate(input.entry_fee_cents, template);

// Stored as instance-level value, not derived from template default
INSERT INTO contest_instances (..., entry_fee_cents, ...)
```

At join time, the value read is from the contest instance:

```javascript
const entryFeeCents = parseInt(contest.entry_fee_cents, 10);
```

**Key Point:** Template provides min/max bounds, but contest organizer sets the actual entry fee.

### Idempotency Key Format and Uniqueness

**Evidence:** `backend/services/customContestService.js:1148`

Format:
```
wallet_debit:{contestInstanceId}:{userId}
```

Stored in `ledger.idempotency_key` with unique constraint enforcement.

**Evidence:** `backend/db/schema.snapshot.sql:1628`

```sql
ADD CONSTRAINT ledger_idempotency_key_unique UNIQUE (idempotency_key);
```

**Guarantee:** Attempting the same join twice produces:
- One participant row in contest_participants
- One wallet debit row in ledger
- No duplicate ledger entries

### Debit Conflict Verification

If debit insert conflicts (idempotency key already exists):

**Evidence:** `backend/services/customContestService.js:1174-1208`

The service:
1. Queries existing ledger row by idempotency_key
2. Verifies all fields match:
   - entry_type = 'WALLET_DEBIT'
   - direction = 'DEBIT'
   - amount_cents = entryFeeCents
   - reference_type = 'WALLET'
   - reference_id = userId
3. If ANY field mismatches, throws invariant violation error and rolls back

**Consequence:** Field mismatch is a system corruption event. It must be escalated (not silently ignored).

### Test Coverage

**Evidence:** `backend/tests/services/customContest.service.test.js`

Tests verify:
- Sufficient wallet balance → join succeeds, debit inserted
- Insufficient wallet balance → join fails, no debit
- Idempotent join (same user, same contest, second call) → success, single debit
- Race condition: concurrent joins by same user → one succeeds, one returns success without double-debit
- Debit conflict handling → field mismatch detected and escalated

### Error Code

**Evidence:** `backend/services/customContestService.js:1110`

```
JOIN_ERROR_CODES.INSUFFICIENT_WALLET_FUNDS
```

Returned when wallet balance < entry_fee_cents.

---

## Entry Fee Immutability (DB-ENFORCED)

**Current state:** Entry fee immutability is **enforced by DB-level trigger** `prevent_entry_fee_change_after_publish()` in `backend/db/schema.snapshot.sql`.

**Trigger behavior:**
1. Fires on UPDATE of `entry_fee_cents` column only
2. Blocks changes when `join_token IS NOT NULL` (contest is published)
3. Allows changes when `join_token IS NULL` (contest in draft)

**Implementation:**
```sql
-- Function: backend/db/schema.snapshot.sql
CREATE FUNCTION prevent_entry_fee_change_after_publish() RETURNS trigger AS $$
BEGIN
  IF OLD.join_token IS NOT NULL
     AND NEW.entry_fee_cents IS DISTINCT FROM OLD.entry_fee_cents THEN
    RAISE EXCEPTION 'entry_fee_cents is immutable after publish (join_token already set)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: backend/db/schema.snapshot.sql
CREATE TRIGGER trg_prevent_entry_fee_change_after_publish
  BEFORE UPDATE OF entry_fee_cents ON contest_instances
  FOR EACH ROW
  EXECUTE FUNCTION prevent_entry_fee_change_after_publish();
```

**Alignment with invariants:**
- Entry fee is immutable at join time (read from contest_instances.entry_fee_cents)
- No application code mutates entry_fee_cents after publish
- DB layer provides hard enforcement (not just application convention)

---

# 13. DISCOVERY SERVICE LIFECYCLE ORDERING

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

# 16. CORE FINANCIAL & LIFECYCLE INVARIANTS FROZEN STATUS

System state:

- 93+ test suites
- 1995+ passing tests
- Cancellation cascade atomic + idempotent
- Lifecycle ordering enforced (Phase 1 → 2 → 3)
- Settlement strictly scoped by contest_instance_id
- Lock-time SCHEDULED → LOCKED primitive frozen, background poller operational
- Tournament-start LOCKED → LIVE primitive frozen, background poller operational
- Single reconciliation entry point (`reconcileLifecycle()`) enforced
- Public OpenAPI frozen
- Schema snapshot authoritative

## LOCKED State Contract (Financial Boundary)

**Purpose:**
LOCKED represents the financial entry boundary of a contest.

It exists to enforce:
- No new entries
- No withdrawals
- Prize pool frozen
- Lineups frozen (if applicable)

**LOCKED is NOT:**
- A scoring state
- A settlement state
- A UI-mandatory state
- A provider-driven state

## Timestamp Relationship Rule

`lock_time` and `tournament_start_time` MAY be equal.

**Day 1 default:**
```
lock_time = tournament_start_time
```

This is safe because:
- Enforcement is time-based (`now < lock_time`)
- Lifecycle transitions are state-gated (`WHERE status = 'SCHEDULED'`)
- Sequential transitions (SCHEDULED → LOCKED → LIVE) may occur on the same reconciliation tick
- Atomic updates prevent corruption
- Idempotency prevents duplicate transitions

**Equal timestamps do NOT create race conditions.**

## Enforcement Rule (Critical)

Entry enforcement MUST use time-based validation:
```
now < lock_time
```

NOT:
```
status = 'SCHEDULED'
```

Status is descriptive.
Time enforces financial integrity.

**Status must never be used as the sole enforcement mechanism for entry boundaries.**

**Violation of this rule is a financial boundary breach.**

## UI Abstraction Rule

The LOCKED state MAY be abstracted in UI.

**Day 1 UX behavior:**
- Users may see SCHEDULED → LIVE directly
- LOCKED may exist internally without separate UI exposure

**Lifecycle integrity MUST NOT be modified to simplify UI.**

**Infra prevails over UI.**

## Future Separation Allowance

In future contests:
```
lock_time < tournament_start_time
```

This allows:
- Early entry freeze
- Operational buffer
- Advanced contest types
- High-stakes controls

**No schema change required.**
**No lifecycle refactor required.**

This is intentional design.

## Frozen Lifecycle Primitives

### SCHEDULED → LOCKED Transition (Lock Time)

**Contract (Immutable):**

```javascript
async function transitionScheduledToLocked(pool, now)
  → Promise<{ changedIds: uuid[], count: number }>
```

**Semantics:**
- Finds all SCHEDULED contests where `lock_time IS NOT NULL`
- Transitions to LOCKED if `now >= lock_time`
- Inserts atomic transition record: triggered_by = 'LOCK_TIME_REACHED'
- Idempotent: re-calls are safe (already-LOCKED contests skipped)
- Deterministic: uses injected `now`, never raw database clock

**Constraints:**
- Implementation: `backend/services/contestLifecycleService.js`
- Tests: `backend/tests/e2e/contestLifecycleTransitions.integration.test.js` (8 test cases)
- No module dependencies (pure DB-driven)
- Single atomic CTE (UPDATE + INSERT)
- No scope expansion allowed: NO endpoint, NO scheduler, NO background job, NO polling loop

**Execution Authority:**
- Function is called by orchestration layer (Phase 2+)
- Execution binding is NOT part of this frozen layer
- This is a callable primitive, not an automatic trigger

---

### LOCKED → LIVE Transition (Tournament Start Time)

**Contract (Immutable):**

```javascript
async function transitionLockedToLive(pool, now)
  → Promise<{ changedIds: uuid[], count: number }>
```

**Semantics:**
- Finds all LOCKED contests where `tournament_start_time IS NOT NULL`
- Transitions to LIVE if `now >= tournament_start_time`
- Inserts atomic transition record: triggered_by = 'TOURNAMENT_START_TIME_REACHED'
- Idempotent: re-calls are safe (already-LIVE contests skipped)
- Deterministic: uses injected `now`, never raw database clock

**Constraints:**
- Implementation: `backend/services/contestLifecycleService.js`
- Tests: `backend/tests/e2e/contestLifecycleTransitions.integration.test.js` (8 test cases)
- No module dependencies (pure DB-driven)
- Single atomic CTE (UPDATE + INSERT)
- No scope expansion allowed: NO endpoint, NO scheduler, NO background job, NO polling loop

**Execution Authority:**
- Function is called by orchestration layer (Phase 2+)
- Execution binding is NOT part of this frozen layer
- This is a callable primitive, not an automatic trigger

---

## Lifecycle Orchestration Rules (Phase 2C)

**Single Entry Point (Critical):**
- Only `reconcileLifecycle(pool, now)` may call frozen lifecycle primitives
- No direct calls to `transitionScheduledToLocked()` or `transitionLockedToLive()` except from within reconciliation service
- All lifecycle orchestration must go through `lifecycleReconciliationService.js`

**Background Poller Constraints:**
- Triggered via `startLifecycleReconciler(pool, options)` in `lifecycleReconcilerWorker.js`
- Guarded by `ENABLE_LIFECYCLE_RECONCILER=true` environment variable
- Fixed 30-second interval (configurable via `LIFECYCLE_RECONCILER_INTERVAL_MS`)
- Minimal logging: transition counts only
- Operational layer subject to monitoring and HA hardening (pending)

**No Coupling:**
- Lifecycle orchestration must NOT couple to ingestion, discovery, or domain logic
- Must accept injected time (no raw `NOW()` calls)
- Must remain deterministic and testable

---

## Non-Breaking Rules

New features must NOT:

- Break lifecycle phase ordering (Phase 1 → 2 → 3)
- Mutate LIVE from discovery service
- Call frozen primitives except through `reconcileLifecycle()`
- Modify openapi.yaml silently
- Change schema without snapshot update
- Add scope to contestLifecycleService (must remain pure)
- Create alternative entry points for lifecycle triggers

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
- Lifecycle transition ordering (Phase 1 → 2 → 3)
- Cancellation cascade ordering
- Tournament-start LOCKED → LIVE transition primitive
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

# 19. MUTATION SURFACE SEAL (MANDATORY)

## Contest Instance Status Updates

**Rule (HARD):**

No `UPDATE contest_instances SET status` outside `backend/services/contestLifecycleService.js`.

### Where status mutations ARE allowed:
1. **Bulk transitions** (automatic orchestration):
   - `transitionScheduledToLocked()`
   - `transitionLockedToLive()`
   - `transitionLiveToComplete()`
   - Called ONLY from `lifecycleReconciliationService.js:reconcileLifecycle()`

2. **Single-instance transitions** (admin operations):
   - `transitionSingleLiveToComplete()`
   - `lockScheduledContestForAdmin()`
   - `markContestAsErrorForAdmin()`
   - `resolveContestErrorForAdmin()`
   - `cancelContestForAdmin()`
   - All call `performSingleStateTransition()` internally

3. **Discovery cascade** (provider-initiated):
   - Inline CTE in `discoveryService.js:processDiscovery()` Phase 1
   - Cascades non-COMPLETE instances → CANCELLED

### Where status mutations are FORBIDDEN:
- ❌ `adminContestService.js` (use frozen primitives instead)
- ❌ Direct SQL `UPDATE contest_instances SET status` in any route
- ❌ Direct SQL in any service except `contestLifecycleService.js` and `discoveryService.js`
- ❌ Conditional logic in Views, ViewModels, or Controllers

### Implementation Pattern (All New Admin Mutations)

For any new admin state transition:
```javascript
// Inside contestLifecycleService.js
async function newAdminTransition(pool, now, contestInstanceId) {
  const result = await performSingleStateTransition(
    pool, now, contestInstanceId,
    ['FROM_STATE'],  // allowedFromStates
    'TO_STATE',      // toState
    'ADMIN_REASON',  // triggeredBy
    'Human reason',  // reason
    null,            // callback (if special logic needed, e.g., settlement)
    {
      // extraUpdates: optional field updates bundled atomically
      // Example: { lock_time: 'COALESCE(lock_time, NOW())' }
    }
  );
  return { success: result.success, changed: result.changed };
}

// Inside adminContestService.js
async function adminEndpoint(pool, contestId, adminUserId, reason) {
  // Call frozen primitive
  await newAdminTransition(pool, new Date(), contestId);
  // Write admin audit (separate from lifecycle transition)
}
```

### Enforcement

**Test Guard:** See `backend/tests/governance/mutation-surface-seal.test.js`
- Fails CI if direct status UPDATE found in admin service
- Scans for `UPDATE contest_instances SET status` outside frozen layer
- Exceptions: Only allowed in `contestLifecycleService.js` and `discoveryService.js`

---

# 20. iOS SWEEP PROTOCOL (MANDATORY)

All iOS development must follow the structured sweep batching model defined in:

**`docs/governance/IOS_SWEEP_PROTOCOL.md`** (Authoritative for client work)

This section reinforces the protocol's governance binding and non-negotiable rules.

## Pre-Sweep Gate (Mandatory)

Before any iOS implementation work, Claude must read:
- docs/governance/CLAUDE_RULES.md (this file)
- docs/governance/LIFECYCLE_EXECUTION_MAP.md
- backend/contracts/openapi.yaml
- ios-app/PlayoffChallenge/Contracts/* (all DTOs)
- ios-app/PlayoffChallenge/ViewModels/* (all ViewModels)
- ios-app/PlayoffChallenge/Services/* (all Services)

**No implementation before this read.**

## Sweep Execution Rules

All iOS changes must follow the 5-sweep model:
1. **Sweep 1** — Contract & Domain Integrity (MANDATORY)
2. **Sweep 2** — Lineup & Lock Enforcement (MANDATORY)
3. **Sweep 3** — Leaderboards (MANDATORY)
4. **Sweep 4** — Payment Automation Surface (MANDATORY)
5. **Sweep 5** — UX & Cosmetic Hardening (OPTIONAL)

Each sweep must:
- [ ] Run `swift build` (zero warnings)
- [ ] Run `swift test` (all tests pass)
- [ ] Fix until green
- [ ] File Gap Report
- [ ] Update relevant documentation

**Exit Criteria:** No iOS changes complete until `swift build` and `swift test` pass.

## Layer Boundary Enforcement

### Forbidden Crossings

- **DTO Mutation:** No modification without OpenAPI alignment
- **DTO in State:** No DTOs in `@Published` properties (convert to Domain in ViewModel init)
- **Service Calls in Views:** All Service calls must be in ViewModel only
- **Business Logic in Views:** Decision logic belongs in ViewModel or Domain layer
- **Client-Side Financial Math:** No payout calculation, score recalculation, or capacity math in iOS
- **Status-Only Enforcement:** Entry gates must use `lock_time`, never status alone
  - Correct: `canJoin = (now < lock_time) && status == "SCHEDULED"`
  - Forbidden: `canJoin = status == "SCHEDULED"`

### Contest Type Abstraction

- Contest `type` field defines behavior (e.g., "PGA", "NFL")
- ViewModels must remain sport-agnostic
- Domain layer enforces contest-specific rules
- Views must never hardcode type-specific logic

## Non-Negotiable Rules

### 1. No UI-Driven Lifecycle Modification

The lifecycle primitives (SCHEDULED→LOCKED→LIVE→COMPLETE) are frozen in the backend.

**Forbidden:**
- iOS Views cannot request state changes (e.g., "Force LIVE button")
- iOS ViewModels cannot bypass backend checks
- iOS logic cannot decide when to transition contests
- UI simplification must NOT modify backend invariants

**Allowed:**
- Display lifecycle state based on backend response
- Show transitions visually (status badges, button state)
- Interpret frozen lifecycle states for UX purposes

**Violation Example:**
```swift
// ❌ FORBIDDEN: UI proposing state change
button.action = {
  await contestService.forceContestLive(contestId)
}
```

**Correct Pattern:**
```swift
// ✅ ALLOWED: Display frozen state
let isLive = contest.status == "LIVE"
button.isEnabled = isLive && !contest.isSettled
```

### 2. Backend Invariants Override UX Simplification

If backend enforces:
- Time-based lock gates (lock_time)
- Capacity limits (max_entries)
- Status-based permissions (can_join in actions)
- Snapshot-based leaderboards (COMPLETE uses settlement only)

**Then iOS must enforce them too, even if UX becomes complex.**

Example: If backend requires `lock_time < tournament_start_time` for some contest types, iOS cannot simplify this away by hiding LOCKED state.

### 3. Gap Reporting is Mandatory

At end of each sweep, Claude must document:
- Contract gaps (missing fields, undocumented variations)
- Architecture boundary gaps (boundary violations found)
- Contest-type behavior gaps (type-specific logic discovered)
- UI/Backend assumption drift (what UI assumes vs. what backend provides)
- Recommended next sweep (based on gaps found)

See `docs/governance/IOS_SWEEP_PROTOCOL.md` § 5 for format.

### 4. Documentation Updates Before Finishing Session

Every session must:
- [ ] Update ViewModel comments with findings
- [ ] Document contest-type rules if discovered
- [ ] Update architecture docs if boundaries clarified
- [ ] Note all gaps in appropriate files

**Forbidden:** Silently leaving ambiguity in code or docs.

## Snapshot Rendering Rule

- **LIVE Leaderboard:** Use dynamic standings from API (can refresh)
- **COMPLETE Leaderboard:** Use settlement_snapshot ONLY (immutable)

**Selection Logic:** In ViewModel based on status, not View.

**Forbidden:** Client-side score recalculation or payout math.

---

This file is a governance lock.

If you are Claude, you must follow this.

No exceptions.
