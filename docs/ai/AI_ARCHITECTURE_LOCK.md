# AI Architecture Lock
## Playoff Challenge — Worker Boundary Enforcement

**Status:** ACTIVE
**Governance Version:** 1
**Effective Date:** 2026-03-12
**Authority:** Architect Only

---

## Purpose

This document defines the boundary between AI worker authority and architect-protected architecture.

Workers must understand:
- Which systems are frozen and untouchable
- Which files are protected from modification
- When and how to escalate for architecture changes

---

## Frozen Architecture Systems

The following core systems are **frozen** and cannot be modified by workers without explicit architect approval.

### 1. Database Schema

**Authority:** `/Users/iancarter/Documents/workspace/playoff-challenge/backend/db/schema.snapshot.sql`

**Status:** FROZEN

**Rules:**
- No schema modifications
- No table structure changes
- No column additions or removals
- No constraint modifications
- No trigger modifications
- No index changes

**If required:**
Stop and respond: `ARCHITECTURE CHANGE REQUIRED`

---

### 2. Financial Ledger System

**Authority:** `docs/governance/LEDGER_ARCHITECTURE_AND_RECONCILIATION.md`

**Status:** FROZEN

**Rules:**
- Ledger is append-only
- No UPDATE on ledger rows
- No DELETE on ledger rows
- Wallet balances never mutated directly
- All balance changes through ledger entries only
- Repairs use compensating ledger entries

**Critical Invariant:**
```
wallet_liability + contest_pools = deposits - withdrawals
```

**If changes required:**
Stop and escalate. Financial modifications require architect approval.

---

### 3. Contest Lifecycle Engine

**Authority:** `docs/governance/LIFECYCLE_EXECUTION_MAP.md`

**Status:** FROZEN

**Protected Files:**
- `backend/services/contestLifecycleAdvancer.js`
- `backend/workers/lifecycleReconcilerWorker.js`
- `backend/services/contestLifecycleService.js`

**Frozen Guarantees:**
- Deterministic state transitions
- Idempotent transitions
- Settlement executes exactly once
- contest_state_transitions is append-only
- No duplicate settlements

**States (Immutable):**
- SCHEDULED
- LOCKED
- LIVE
- COMPLETE
- CANCELLED
- ERROR

**If changes required:**
Stop and escalate. Lifecycle changes require architect approval.

---

### 4. Settlement Engine

**Authority:** `docs/governance/FINANCIAL_INVARIANTS.md`

**Status:** FROZEN

**Protected Files:**
- `backend/services/settlementStrategy.js`

**Frozen Guarantees:**
- Settlement is atomic
- Payouts are deterministic
- Settlement cannot execute twice
- Prize distributions are immutable once settled

**If changes required:**
Stop and escalate. Settlement modifications require architect approval.

---

### 5. OpenAPI Contract

**Authority:** `/Users/iancarter/Documents/workspace/playoff-challenge/backend/contracts/openapi.yaml`

**Status:** FROZEN

**Rules:**
- No endpoint path changes
- No request/response shape modifications
- No status code changes
- No error response format changes
- No authentication requirement changes

**Freezing Mechanism:**
API contracts are frozen using cryptographic snapshots stored in `api_contract_snapshots` table with SHA256 hash uniqueness.

**If changes required:**
1. Update `backend/contracts/openapi.yaml` with new endpoints/schemas
2. Run: `npm run freeze:openapi` (creates append-only snapshot with auto-incrementing version)
3. Update test expected hash: `backend/tests/contract-freeze.test.js` (line 40)
   - Get new hash from freeze command output or `sha256sum backend/contracts/openapi.yaml`
   - Update `expectedHash` variable with new value
   - Add comment noting date and reason for hash change
4. Verify test passes: `TEST_DB_ALLOW_DBNAME=railway npm test tests/contract-freeze.test.js`
5. Commit: snapshot in database + updated test expected hash + updated openapi.yaml
6. Deploy after architect approval

**Idempotency:**
- `npm run freeze:openapi` can be run multiple times safely
- If snapshot already exists for that hash, exits with success (no duplicate created)
- Safe for CI/CD pipelines

**Violation Detection:**
- Test automatically detects contract drift via hash mismatch
- If test fails, follow steps above to update hash
- If hash mismatch is unexpected, investigate code changes first

## Contest API Response Contract v1.1 Update

**Change:** Added `template_sport` field to contest detail response

**Details:**
- Field: `template_sport` (string)
- Type: `GOLF`, `NFL`, etc.
- Endpoint: `GET /api/custom-contests/{id}`
- Location in response: Root level (alongside `template_type`)
- Example: `{ "template_sport": "GOLF", "template_type": "PGA_DAILY" }`

**Purpose:**
Enables clients (iOS app) to deterministically route sport-specific logic without inferring from template type.

**Backwards Compatibility:**
✅ Safe additive change. Clients not using this field continue to work.

**Implementation:**
- Database field: `contest_templates.sport`
- Added to SELECT in `customContestService.getContestInstance()` and `getContestInstanceByToken()`
- Mapped in `contestApiResponseMapper.mapContestToApiResponse()` and `mapContestToApiResponseForList()`
- Already documented in `openapi.yaml` (line 1416-1418)

---

### 6. Admin Authorization System

**Authority:** `docs/governance/CLAUDE_RULES.md § 6`

**Status:** FROZEN

**Protected Files:**
- `backend/middleware/adminAuthMiddleware.js`
- `backend/routes/admin/*`

**Frozen Guarantees:**
- JWT verification required
- Admin middleware enforced on all admin routes
- req.adminUser properly populated
- Non-admin access rejected

**If changes required:**
Stop and escalate. Auth modifications require architect approval.

---

### 7. Discovery Idempotency Constraints

**Authority:** `docs/governance/DISCOVERY_LIFECYCLE_BOUNDARY.md`

**Status:** FROZEN

**Protected Files:**
- `backend/services/discovery/discoveryService.js`

**Frozen Guarantees:**
- Discovery is idempotent
- Template uniqueness enforced via provider_tournament_id
- Contest instance uniqueness enforced
- Safe replay of discovery cycles

**If changes required:**
Stop and escalate. Discovery structure changes require architect approval.

---

### 8. Authentication System

**Authority:**
- Backend: `backend/services/userJwt.js`
- iOS: `ios-app/PlayoffChallenge/Services/AuthService.swift`

**Status:** OPERATIONAL

**System:**
The platform uses JWT bearer authentication issued by backend auth endpoints and consumed by iOS client.

**Backend Token Issuance:**
Tokens are issued by authentication endpoints:
- POST /api/users (Apple Sign In)
- POST /api/auth/register (Email/password signup)
- POST /api/auth/login (Email/password login)

**Response:**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "token": "eyJhbGc..."
}
```

**JWT Payload Claims:**
- `sub` = user.id
- `user_id` = user.id
- `email` = user.email

**Token Signing:**
- Algorithm: HS256
- Secret: `process.env.JWT_SECRET`
- Expiration: 24h

**iOS Client Implementation:**
- **AuthService** owns auth state:
  - Stores JWT token in `authToken` property
  - Persists to UserDefaults under key `authToken`
  - Exposes via `currentAuthToken()` method
  - Exposes user ID via `currentUserId()` for backward compatibility
- **APIService** remains stateless:
  - Requests token from `AuthService.shared.currentAuthToken()`
  - Sends `Authorization: Bearer <jwt>` header
  - Sends `X-User-Id` header for backward compatibility
  - Does not store tokens directly

**Protected Files:**
- Backend:
  - `backend/services/userJwt.js`
  - `backend/server.js` (auth endpoints)
- iOS:
  - `ios-app/PlayoffChallenge/Services/AuthService.swift`
  - `ios-app/PlayoffChallenge/Services/APIService.swift`
  - `ios-app/PlayoffChallenge/Models/Models.swift` (User struct)

**If changes required:**
Authentication modifications require architect approval.

---

## Protected Files Index

The following files are protected and must never be modified without architect approval:

**Database & Schema:**
- `backend/db/schema.snapshot.sql`
- `backend/db/` (all migration files)

**Financial System:**
- `backend/services/financialReconciliationService.js`
- `backend/services/settlementStrategy.js`
- `backend/services/walletService.js` (ledger operations only)

**Lifecycle Engine:**
- `backend/services/contestLifecycleAdvancer.js`
- `backend/services/contestLifecycleService.js`
- `backend/workers/lifecycleReconcilerWorker.js`

**API Contracts:**
- `backend/contracts/openapi.yaml`
- `backend/contracts/openapi-admin.yaml`

**Discovery System:**
- `backend/services/discovery/discoveryService.js`
- `backend/services/discovery/espnDataFetcher.js` (structure only)

**Admin Authorization:**
- `backend/middleware/adminAuthMiddleware.js`

---

## Worker Escalation Protocol

If a worker determines that a frozen system requires modification:

### Step 1: STOP Implementation

Do not proceed with the change.

### Step 2: Respond with Escalation

Respond with only:

```
ARCHITECTURE CHANGE REQUIRED
```

### Step 3: Provide Impact Analysis

Document:
- **System affected:** Which frozen system requires change
- **Reason:** Why the change is necessary
- **Proposed modification:** What exactly needs to change
- **Risk to invariant:** How this affects financial/lifecycle/API guarantees
- **Data impact:** Will existing data be affected?

### Step 4: Wait for Architect Approval

Do not implement until architect explicitly approves.

### Step 5: Update Governance

After approval, architect will update:
- GOVERNANCE_VERSION.md (version increment)
- ARCHITECTURE_FREEZE_V1.md (change summary)
- This file (updated effective date)
- AI_ARCHITECTURE_LOCK.md (frozen systems list)

---

## Allowed Worker Modifications

Workers **may** modify files in these lanes:

### Backend Services Layer (Non-Frozen)

- `backend/services/` (new services for approved work)
- `backend/routes/` (new routes for approved endpoints)
- `backend/repositories/` (data access patterns)
- `backend/tests/` (test infrastructure)

**Constraint:** Cannot modify frozen service files listed above.

### iOS Application Layer

- `ios-app/PlayoffChallenge/Contracts/` (DTO decoding, must match OpenAPI)
- `ios-app/PlayoffChallenge/ViewModels/` (presentation logic)
- `ios-app/PlayoffChallenge/Services/` (API calls only, no business logic)
- `ios-app/PlayoffChallenge/Views/` (UI rendering only)

**Constraint:** Cannot modify OpenAPI contract. Must consume it as-is.

### Documentation & Governance

- `docs/` (operational documentation only)
- `docs/governance/` (non-frozen governance sections)
- `docs/ai/` (AI guidance only)

**Constraint:** Cannot modify ARCHITECTURE_FREEZE_V1.md without architect approval.

---

## Failure Mode: What Happens if Worker Violates Lock?

If a worker attempts to modify a protected file:

1. **Code Review:** Architect rejects pull request
2. **CI/Tests:** May fail due to governance violations
3. **Git History:** Changes are visible (immutable audit trail)
4. **Authority Escalation:** Architecture lock is reinforced

**Workers are personally accountable for respecting this lock.**

---

## How to Know When Architecture Change Is Required

Workers should escalate if:

- [ ] A task requires modifying schema.snapshot.sql
- [ ] A task requires modifying OpenAPI contract shapes
- [ ] A task requires changing ledger semantics
- [ ] A task requires modifying lifecycle states or transitions
- [ ] A task requires changing settlement logic
- [ ] A task requires changing admin auth behavior
- [ ] A task requires modifying discovery idempotency

If ANY of the above is true: **ESCALATE IMMEDIATELY**

---

## Reference Links

- `docs/governance/ARCHITECTURE_FREEZE_V1.md` — Comprehensive freeze documentation
- `docs/governance/PROTECTED_FILES_INDEX.md` — Full index of protected files
- `docs/governance/GOVERNANCE_VERSION.md` — Current governance version
- `docs/governance/ARCHITECTURE_LOCK.md` — System lock details
- `docs/governance/CLAUDE_RULES.md` — Global governance rules

---

## Effective Until

This lock remains active until explicitly updated by architect with:

1. Version increment in GOVERNANCE_VERSION.md
2. Updated effective date in ARCHITECTURE_LOCK.md
3. Change summary documenting authorization

---

**End of Document**
