# AI Guardrails
## Playoff Challenge — Worker Boundary Protection

**Status:** ACTIVE
**Governance Version:** 1
**Effective Date:** 2026-03-12
**Authority:** Architect Only

---

## Purpose

AI guardrails prevent worker modifications to protected architecture while allowing safe work within approved lanes.

This document provides concrete protection rules and decision trees for workers.

---

## Protected Paths — No Worker Modification Allowed

The following file paths and directories are protected. Workers must never modify them.

### Database Schema

```
backend/db/schema.snapshot.sql       ❌ PROTECTED
backend/db/SCHEMA_REFERENCE.md        ❌ PROTECTED
backend/db/migrations/                ❌ PROTECTED
```

**Why:** Schema changes break data contracts and financial invariants.

**Escalation:** If schema modification is required, respond: `ARCHITECTURE CHANGE REQUIRED`

---

### API Contracts

```
backend/contracts/openapi.yaml        ❌ PROTECTED
backend/contracts/openapi-admin.yaml  ❌ PROTECTED
backend/scripts/freeze-openapi.js     ❌ PROTECTED (read-only reference)
```

**Why:** API changes break client applications (iOS, Web Admin).

**Escalation:** If API shape changes are needed, respond: `ARCHITECTURE CHANGE REQUIRED`

---

### Financial System

```
backend/services/financialReconciliationService.js  ❌ PROTECTED
backend/services/settlementStrategy.js              ❌ PROTECTED
backend/services/walletService.js                   ❌ PROTECTED (ledger ops)
backend/repositories/LedgerRepository.js            ❌ PROTECTED (immutability)
```

**Why:** Financial logic directly affects the reconciliation invariant.

**Escalation:** If ledger or settlement logic needs changes, respond: `ARCHITECTURE CHANGE REQUIRED`

---

### Contest Lifecycle Engine

```
backend/services/contestLifecycleAdvancer.js        ❌ PROTECTED
backend/services/contestLifecycleService.js         ❌ PROTECTED
backend/workers/lifecycleReconcilerWorker.js        ❌ PROTECTED
```

**Why:** Lifecycle changes affect state machine correctness and idempotency.

**Escalation:** If lifecycle logic needs changes, respond: `ARCHITECTURE CHANGE REQUIRED`

---

### Discovery System

```
backend/services/discovery/discoveryService.js      ❌ PROTECTED (structure)
backend/services/discovery/espnDataFetcher.js       ❌ PROTECTED (adapter only)
```

**Why:** Discovery idempotency is critical to deterministic contest generation.

**Note:** Discovery enhancement (7-day tournament window) is **ALLOWED** within idempotency constraints.

**Escalation:** If discovery structure changes, respond: `ARCHITECTURE CHANGE REQUIRED`

### Discovery Contest Creation Fields (CRITICAL GUARDRAIL)

**Forbidden fields during discovery contest creation:**

```
start_time        ❌ FORBIDDEN
end_time          ❌ FORBIDDEN
is_live           ❌ FORBIDDEN
is_locked         ❌ FORBIDDEN
```

**Why:** Discovery must NOT populate lifecycle fields. The lifecycle engine is the sole authority for these fields.

**Correct initialization:**

Discovery-created contests MUST have:
```
status = 'SCHEDULED'
start_time = NULL
is_live = false
is_locked = false
```

**Files to check:**

- `backend/services/discovery/discoveryContestCreationService.js` (lines 668-694)
- `backend/services/discovery/discoveryService.js` (processEventDiscovery function)

**Impact of violation:**

If discovery sets `start_time`, the lifecycle state machine breaks:
1. Contest prematurely transitions SCHEDULED → LIVE when `start_time <= now`
2. Contest cannot be joined (LIVE state is not joinable)
3. Data integrity violation: `tournament_start_time` future but `status = LIVE`

**Repair:** Run `node backend/scripts/repairIncorrectContestStartTimes.js`

---

### Admin Authorization

```
backend/middleware/adminAuthMiddleware.js           ❌ PROTECTED
backend/routes/admin/                               ❌ PROTECTED (auth layer)
```

**Why:** Admin auth changes expose sensitive operations to unauthorized access.

**Escalation:** If auth logic needs changes, respond: `ARCHITECTURE CHANGE REQUIRED`

---

## Allowed Work Lanes — Worker Modifications OK

The following paths and work types are open for worker modification:

### Backend Services (New Services Only)

```
backend/services/[NEW_SERVICE_NAME].js              ✅ ALLOWED
backend/services/[module]/[NEW_FILE].js             ✅ ALLOWED (if not protected)
```

**Rules:**
- ✅ Create new service files for approved features
- ✅ Follow existing service patterns
- ❌ Do not modify protected service files (list above)
- ❌ Do not modify ledger, settlement, or lifecycle services

**Example (Allowed):**
```javascript
// backend/services/contentService.js (NEW)
exports.getContentForContest = async (pool, contestId) => { ... }
```

---

### Backend Routes (New Routes Only)

```
backend/routes/[NEW_ENDPOINT].js                    ✅ ALLOWED
backend/routes/public/[NEW_FILE].js                 ✅ ALLOWED
```

**Rules:**
- ✅ Create new route files for approved endpoints
- ❌ Do not modify admin routes (protected)
- ❌ Do not change OpenAPI contract
- ❌ Must match OpenAPI spec if endpoint exists

**Example (Allowed):**
```javascript
// backend/routes/content.routes.js (NEW)
router.get('/api/content/:contestId', requireAuth, getContent);
```

---

### Backend Tests

```
backend/tests/                                      ✅ ALLOWED
backend/tests/services/[NEW_TEST].test.js          ✅ ALLOWED
```

**Rules:**
- ✅ Create new test files
- ✅ Modify test fixtures and mocks
- ✅ Update test infrastructure
- ❌ Do not weaken assertions
- ❌ Do not bypass failing tests

---

### iOS Application

```
ios-app/PlayoffChallenge/Contracts/                ✅ ALLOWED (DTO decoding)
ios-app/PlayoffChallenge/ViewModels/               ✅ ALLOWED (presentation logic)
ios-app/PlayoffChallenge/Services/                 ✅ ALLOWED (API clients)
ios-app/PlayoffChallenge/Views/                    ✅ ALLOWED (UI rendering)
```

**Rules:**
- ✅ Update DTO decoders to match OpenAPI
- ✅ Create ViewModels for app features
- ✅ Create Service classes for API calls
- ✅ Create/modify Views for UI
- ❌ Do not modify OpenAPI contract
- ❌ Do not add undocumented API calls
- ❌ Must follow iOS Sweep Protocol

---

### Documentation

```
docs/                                               ✅ ALLOWED
docs/operational/                                  ✅ ALLOWED
docs/production-readiness/                         ✅ ALLOWED
```

**Rules:**
- ✅ Update operational documentation
- ✅ Create runbooks and guides
- ✅ Update troubleshooting guides
- ❌ Do not modify ARCHITECTURE_FREEZE_V1.md (architect only)
- ❌ Do not modify protected governance docs

---

## Worker Decision Tree

When assigned a task, use this decision tree:

```
Task Assigned
    ↓
Does task involve modifying backend services?
    ├─ YES → Is it a protected service? (see PROTECTED PATHS)
    │   ├─ YES → ESCALATE: ARCHITECTURE CHANGE REQUIRED
    │   └─ NO  → OK to proceed (create new service or modify non-protected)
    └─ NO  → Continue

Does task involve modifying database schema?
    ├─ YES → ESCALATE: ARCHITECTURE CHANGE REQUIRED
    └─ NO  → Continue

Does task involve modifying OpenAPI contract?
    ├─ YES → ESCALATE: ARCHITECTURE CHANGE REQUIRED
    └─ NO  → Continue

Does task involve modifying iOS code?
    ├─ YES → Follow iOS Sweep Protocol (docs/governance/IOS_SWEEP_PROTOCOL.md)
    └─ NO  → Continue

Does task involve creating new features in allowed lanes?
    ├─ YES → OK to proceed (following governance rules)
    └─ NO  → Continue

Does task involve bug fixes in allowed lanes?
    ├─ YES → OK to proceed (following governance rules)
    └─ NO  → Continue

Unknown or unclear?
    └─ ESCALATE: Describe task and ask for guidance
```

---

## File-Specific Guardrail Rules

### backend/services/financialReconciliationService.js

```
Status:  ❌ PROTECTED
Type:    Financial System
Changes: ❌ FORBIDDEN

Rule: This file implements the reconciliation invariant.

Allowed:
  • Reading for understanding
  • Referencing in documentation

Forbidden:
  • Modifying balance calculation logic
  • Changing reconciliation equation
  • Modifying ledger sum queries
  • Changing error detection

If modification needed:
  → ESCALATE: ARCHITECTURE CHANGE REQUIRED
```

---

### backend/services/settlementStrategy.js

```
Status:  ❌ PROTECTED
Type:    Settlement Engine
Changes: ❌ FORBIDDEN

Rule: This file implements prize distribution and payout logic.

Allowed:
  • Reading for understanding
  • Referencing in documentation
  • Displaying settlement results (iOS/Admin)

Forbidden:
  • Modifying payout formulas
  • Changing percentage calculations
  • Modifying atomic settlement guarantees
  • Changing rake logic

If modification needed:
  → ESCALATE: ARCHITECTURE CHANGE REQUIRED
```

---

### backend/services/contestLifecycleAdvancer.js

```
Status:  ❌ PROTECTED
Type:    Lifecycle Engine
Changes: ❌ FORBIDDEN

Rule: This file implements the state machine and lifecycle transitions.

Allowed:
  • Reading for understanding
  • Referencing state names
  • Displaying status to users (iOS/Admin)

Forbidden:
  • Modifying state transitions
  • Adding new states
  • Changing transition conditions
  • Modifying idempotency logic

If modification needed:
  → ESCALATE: ARCHITECTURE CHANGE REQUIRED
```

---

### backend/services/discovery/discoveryService.js

```
Status:  ❌ PROTECTED (structure only)
Type:    Discovery System
Changes: ⚠️  CONDITIONAL

Rule: Discovery structure is frozen. Enhancement is allowed within constraints.

PROTECTED (❌):
  • discovery idempotency mechanism
  • template binding logic
  • instance creation cascade
  • uniqueness constraint enforcement

ALLOWED (✅) — Discovery Enhancement:
  • Extending tournament detection window to 7 days
  • Modifying tournament_start_time filter (provider-side)
  • Adding new provider data fields (if schema-compatible)
  • Improving performance (same idempotency guarantee)

Constraints:
  • Must remain idempotent
  • Cannot modify schema
  • Cannot modify lifecycle engine
  • Must not break existing contests

If uncertain about modification:
  → Ask for architect guidance
```

---

### backend/services/helpers/contestApiResponseMapper.js

```
Status:  ✅ ALLOWED (modifiable for API responses)
Type:    API Response Mapper
Changes: ✅ CONDITIONAL (data-driven only)

Rule: Sport derivation is backend-authoritative. Client contracts depend on correct sport values.

ALLOWED (✅):
  • Deriving sport from template_type using deriveSportFromTemplateType helper
  • Including sport in API responses
  • Removing deprecated template_sport field
  • Updating contest action derivation (can_join logic)
  • Modifying response payload structure (if OpenAPI updated)

FORBIDDEN (❌):
  • Adding template_sport field to responses
  • Inferring sport on backend
  • Leaving sport derivation to clients
  • Modifying without updating OpenAPI contract

Constraint:
  • All changes must update backend/contracts/openapi.yaml
  • Must update iOS contracts (ContestDetailResponseContract, ContestListItemDTO)
  • Must run: npm run freeze:openapi

Guardrail:
  Workers must never add template_sport fields to API responses.
  Sport must be derived exclusively from template_type.
```

---

### backend/services/ingestion/ (Ingestion Strategy)

```
Status:  ✅ ALLOWED (service implementation)
Type:    Ingestion Pipeline
Changes: ✅ CONDITIONAL (event semantics frozen)

Rule: Ingestion services are modifiable for adapters (ESPN, etc.).
      Event granularity semantics are FROZEN.

ALLOWED (✅):
  • Creating new ingestion strategy adapters
  • Implementing getWorkUnits(), ingestWorkUnit(), upsertScores()
  • Adding new event_type values (player_pool, scoring, etc.)
  • Modifying how data is fetched and normalized
  • Adding validation logic

FROZEN (❌):
  • Changing ingestion_event granularity model
  • Creating per-record events instead of per-payload snapshots
  • Modifying event deduplication by payload_hash
  • Changing ON CONFLICT DO NOTHING idempotency

CRITICAL GUARDRAIL: Event Granularity Invariant

One ingestion_event = One provider payload snapshot.

Correct:
  • 123 golfers in scoreboard → 1 ingestion_event (full field)
  • Leaderboard with 50 scores → 1 ingestion_event (full leaderboard)

Incorrect:
  • 123 golfers → 123 ingestion_events ❌ VIOLATION
  • 50 scores → 50 ingestion_events ❌ VIOLATION

Rationale:
  • Deduplication by payload_hash fails if per-record
  • Worker safety (repeated runs) breaks if per-record
  • Settlement snapshot boundaries lost if per-record
  • Append-only ledger becomes fragmented

If implementing ingestion adapter:
  1. Fetch all records from provider
  2. Normalize to domain model
  3. Create ONE ingestion_event with full payload
  4. Use ON CONFLICT (contest_instance_id, payload_hash) DO NOTHING
  5. Reference docs/architecture/DATA_INGESTION_MODEL.md

See:
  • docs/architecture/DATA_INGESTION_MODEL.md (Event Granularity Invariant)
  • docs/architecture/ESPN-PGA-Ingestion.md (PLAYER_POOL Snapshot Event)
  • backend/services/ingestion/strategies/pgaEspnIngestion.js (reference impl)

Example (pgaEspnIngestion.js, handleFieldBuildIngestion):
  ✅ Creates 1 event for entire field snapshot
  ✅ Uses payload_hash for deduplication
  ✅ Includes full golfer list in payload
  ✅ Uses ON CONFLICT DO NOTHING
```

---

### backend/contracts/openapi.yaml

```
Status:  ❌ PROTECTED
Type:    API Contract
Changes: ⚠️  CONDITIONAL (with process)

Rule: API shapes are frozen. Changes require governance process.

To modify OpenAPI:
  1. Update backend/contracts/openapi.yaml
  2. Verify backend implementation matches new shape
  3. Run: npm run freeze:openapi
  4. Commit snapshot to git
  5. Verify all clients (iOS, Admin) updated
  6. Deploy after architect approval

DO NOT:
  • Deploy OpenAPI changes without freezing snapshot
  • Modify contracts without updating backend routes
  • Introduce undocumented response fields

If modification needed:
  → Follow freeze process (see ARCHITECTURE_LOCK.md)
```

---

### backend/db/schema.snapshot.sql

```
Status:  ❌ PROTECTED
Type:    Database Schema
Changes: ❌ FORBIDDEN

Rule: Database schema is the foundation of all data contracts.

Allowed:
  • Reading for understanding
  • Referencing column names
  • Understanding constraints

Forbidden:
  • Any schema modifications
  • Adding columns
  • Removing columns
  • Changing data types
  • Modifying constraints
  • Modifying triggers
  • Adding tables

If modification needed:
  → ESCALATE: ARCHITECTURE CHANGE REQUIRED
```

---

## What "Protected" Means

A protected file is one where:

1. **Changes affect multiple systems** — modification cascades through platform
2. **Financial impact** — changes could violate reconciliation invariant
3. **Determinism required** — changes could affect idempotency guarantees
4. **Client contracts** — changes break iOS, Admin, or external API consumers
5. **Architecture boundary** — file represents a frozen architectural decision

Protected files have explicit architect approval for any changes.

---

## Escalation Checklist

Use this checklist before escalating:

- [ ] I've identified the protected file/system
- [ ] I've documented which frozen system is affected
- [ ] I've explained why the change is necessary
- [ ] I've considered alternative approaches (approved lanes)
- [ ] I'm ready to wait for architect approval
- [ ] I've responded with: `ARCHITECTURE CHANGE REQUIRED`

---

## Common Escalation Scenarios

### Scenario 1: "I need to add a new fee calculation"

**Status:** Requires escalation

**Reason:** Affects financial reconciliation invariant

**Response:**
```
ARCHITECTURE CHANGE REQUIRED

System: Financial Ledger
Reason: New fee calculation affects reconciliation equation
Proposal: Add entry_type for X, direction Y, update settlement logic
Risk: May violate wallet_liability + contest_pools = deposits - withdrawals
```

---

### Scenario 2: "I need to add a new contest state"

**Status:** Requires escalation

**Reason:** Affects lifecycle state machine

**Response:**
```
ARCHITECTURE CHANGE REQUIRED

System: Contest Lifecycle Engine
Reason: New state changes state machine topology
Proposal: Add PENDING_SETTLEMENT state before COMPLETE
Risk: Changes idempotent transition guarantees, settlement execution logic
```

---

### Scenario 3: "I need to change when contests lock"

**Status:** Requires escalation

**Reason:** Affects lifecycle engine

**Response:**
```
ARCHITECTURE CHANGE REQUIRED

System: Contest Lifecycle Engine
Reason: Changes lock timing logic
Proposal: Lock at tournament_start_time instead of lock_time
Risk: Affects existing contest behavior, may break iOS app expectations
```

---

### Scenario 4: "I need to add a new API endpoint"

**Status:** Depends on complexity

**If endpoint reads only:**
- ✅ Allowed in approved lane
- Must update OpenAPI contract
- Must freeze contract snapshot

**If endpoint modifies financial/lifecycle state:**
- ❌ Requires escalation
- Needs architect review

---

### Scenario 5: "I need to modify how payouts are calculated"

**Status:** Requires escalation

**Reason:** Affects settlement engine

**Response:**
```
ARCHITECTURE CHANGE REQUIRED

System: Settlement Engine
Reason: Changes payout calculation
Proposal: Change rake from 13.5% to 15%
Risk: Affects all historical and future contests
```

---

## How to Respond When Uncertain

If you're unsure whether a file is protected or if a modification is allowed:

**Do Not Guess**

Instead, respond to the user:

```
I need architect guidance on this task.

The modification affects [system name], which may be protected.

Before proceeding, I need explicit confirmation that:
1. [Specific change] is approved
2. [System] allows this modification
3. No financial/lifecycle invariants are violated

Can architect clarify whether this work is in approved lanes?
```

---

## Reference Documents

- `docs/ai/AI_ARCHITECTURE_LOCK.md` — Full architecture lock documentation
- `docs/governance/ARCHITECTURE_FREEZE_V1.md` — Freeze policy and allowed work
- `docs/governance/PROTECTED_FILES_INDEX.md` — Index of all protected files
- `docs/governance/ARCHITECTURE_LOCK.md` — System lock details

---

**End of Document**
