# PRE-LAUNCH ARCHITECTURE LOCK

**Status:** PRE-LAUNCH ARCHITECTURE LOCK
**Governance Version:** 1
**Last Verified:** 2026-03-12
**Effective Date:** 2026-03-12

---

## System Freeze Declaration

The following core platform systems are **FROZEN** and may not be modified without explicit Architect authorization:

### Financial Ledger System
The financial ledger is the authoritative source of truth for all user balances. It operates under a ledger-first accounting model where balances are derived from immutable ledger entries, never stored as mutable fields.

**Frozen Components:**
- Ledger table structure and semantics
- Entry type definitions (WALLET_DEPOSIT, WALLET_WITHDRAWAL, ENTRY_FEE, ENTRY_FEE_REFUND, PRIZE_PAYOUT, etc.)
- Direction rules (CREDIT/DEBIT semantics)
- Idempotency key uniqueness requirement
- Append-only enforcement (no deletes or updates)

**Authoritative Reference:** `docs/governance/LEDGER_ARCHITECTURE_AND_RECONCILIATION.md`

### Wallet Accounting System
User wallets represent platform liabilities and are computed from ledger entries.

**Frozen Components:**
- Wallet balance derivation formula
- No direct wallet balance mutations
- All balance changes through ledger entries
- Wallet freeze enforcement

**Authoritative Reference:** `docs/governance/FINANCIAL_INVARIANTS.md`

### Contest Lifecycle Engine
Contest state machine defines all valid transitions and terminal states.

**Frozen States:**
- `SCHEDULED` — Contest defined, waiting for lock time
- `LOCKED` — Entry is closed, waiting for tournament start
- `LIVE` — Tournament is active, leaderboards updating
- `COMPLETE` — Tournament ended, scores finalized, payouts calculated
- `CANCELLED` — Organizer cancelled, refunds issued
- `ERROR` — Exceptional state (manual intervention required)

**Frozen Transitions:**
- SCHEDULED → LOCKED (lock_time reached or admin force-lock)
- LOCKED → LIVE (tournament_start_time reached)
- LIVE → COMPLETE (tournament_end_time reached or admin trigger)
- Any state → CANCELLED (organizer or admin action)
- Any state → ERROR (exceptional condition)

**Frozen Semantics:**
- Only lifecycle service mutates contest status
- State transitions are atomic
- State changes are idempotent
- State history is immutable (contest_state_transitions table)

**Authoritative Reference:** `docs/governance/LIFECYCLE_EXECUTION_MAP.md`

### Database Schema
The database schema snapshot is the authoritative definition of all tables, columns, constraints, and relationships.

**Frozen Components:**
- All table structures
- Column definitions and types
- Foreign key relationships
- Unique and primary key constraints
- Check constraints (especially ledger direction and entry type constraints)
- Trigger rules (especially ledger append-only enforcement)
- Index definitions

**Authoritative Reference:** `backend/db/schema.snapshot.sql`

### OpenAPI Contracts
API request/response shapes are frozen and define the contract between backend and clients.

**Frozen Components:**
- Public API contract (openapi.yaml)
  - All endpoint paths
  - All request/response shapes
  - All status codes and error responses
  - All authentication requirements
- Admin API contract (openapi-admin.yaml)
  - All admin endpoints
  - All admin response shapes
  - All admin error codes

**Authoritative Reference:**
- `backend/contracts/openapi.yaml`
- `backend/contracts/openapi-admin.yaml`

### API Contract Freeze System
API contracts are frozen using cryptographic snapshots to ensure immutability and auditability.

**Frozen Components:**
- Contract snapshots stored in `api_contract_snapshots` table
- SHA256 hash uniqueness: each contract name + hash combination is unique
- Append-only versioning: versions increment automatically (v1, v2, v3...)
- Idempotency: freezing the same spec multiple times produces one snapshot
- Audit trail: all contract changes are permanently recorded with timestamps

**Freeze Process:**
```bash
npm run freeze:openapi        # Freeze public API contract (available)
npm run freeze:openapi:admin  # Planned for Phase 2 (not yet implemented)
```

**How Freezing Works:**
1. Generate canonical OpenAPI spec from source
2. Compute SHA256 hash of spec JSON
3. Check if snapshot already exists (contract_name, sha256)
4. If exists → exit successfully (idempotent)
5. If not → compute next version and insert append-only snapshot

**Violation Detection:**
- Contract changes without freezing trigger test failures
- `tests/contracts/openapi-freeze.test.js` enforces contract immutability
- Workers must freeze a new snapshot before deploying API changes

**Authoritative Reference:** `backend/scripts/freeze-openapi.js`

### AI Governance Model
The architecture and governance rules for AI workers are frozen to prevent architectural drift.

**Frozen Components:**
- Governance Authority hierarchy (schema → OpenAPI → code → governance → ops)
- Schema authority (schema.snapshot.sql is authoritative)
- OpenAPI contract authority (openapi.yaml is authoritative)
- AI Worker Rules (no git commands, test-first, absolute paths, edit lane restrictions)
- Entrypoint bootstrap sequence
- Authority escalation procedures

**Authoritative Reference:** `docs/ai/` (AI_ENTRYPOINT.md, AI_WORKER_RULES.md, chief-architect.md)

---

## Reconciliation Invariant (Critical)

The platform must always maintain financial balance:

```
wallet_liability + contest_pools = deposits - withdrawals
```

This equation is FROZEN and must be preserved by all operations.

**Definitions:**
- `wallet_liability` = Sum of user wallet balances (ledger entries where user_id IS NOT NULL)
- `contest_pools` = Sum of entry fees minus refunds and payouts
- `deposits` = Sum of Stripe deposits (WALLET_DEPOSIT entries)
- `withdrawals` = Sum of user withdrawals (WALLET_WITHDRAWAL entries)

**Violation Detection:** Any deviation indicates corruption and requires immediate investigation and compensating entries.

---

## Frozen Primitive Enforcement

Workers must NOT modify:

### Financial Primitives
- ❌ Ledger entry semantics
- ❌ Wallet balance calculation logic
- ❌ Reconciliation equation
- ❌ Idempotency key generation
- ❌ Direction encoding (CREDIT/DEBIT)

### Lifecycle Primitives
- ❌ Contest state definitions
- ❌ State transition rules
- ❌ Atomic transaction boundaries
- ❌ Idempotency guarantees

### Schema Primitives
- ❌ Ledger table structure
- ❌ Contest instances table
- ❌ Wallet balance or liability columns
- ❌ Trigger enforcement rules

### API Contract Primitives
- ❌ Endpoint paths
- ❌ Request/response shapes
- ❌ Error response formats
- ❌ Authentication requirements

### Governance Primitives
- ❌ Authority hierarchy
- ❌ Schema authority declarations
- ❌ Worker rule enforcement
- ❌ Entrypoint bootstrap sequence

---

## Worker Escalation Protocol

If a task requires modification of frozen primitives, workers must STOP and respond:

```
ARCHITECTURE LOCK ACTIVE — ARCHITECT APPROVAL REQUIRED
```

Workers must NOT:
- Implement the change without architect authorization
- Create workarounds that modify frozen primitives indirectly
- Modify tests to suppress failures related to frozen primitives
- Assume architect approval from previous similar tasks

---

## Architect Authorization Process

To modify frozen primitives:

1. **Engineer requests change** with business justification
2. **Architect reviews** against financial invariants and platform constraints
3. **Architect explicitly approves** and documents the rationale
4. **Worker implements** with architect-provided guidance
5. **All changes** update ARCHITECTURE_LOCK.md version and Last Verified date

---

## Authority Sources (Not Modifiable)

These files are authoritative and define the system:

**Database Schema:**
- `/Users/iancarter/Documents/workspace/playoff-challenge/backend/db/schema.snapshot.sql`

**API Contracts:**
- `/Users/iancarter/Documents/workspace/playoff-challenge/backend/contracts/openapi.yaml`
- `/Users/iancarter/Documents/workspace/playoff-challenge/backend/contracts/openapi-admin.yaml`

**Governance Documents:**
- `/Users/iancarter/Documents/workspace/playoff-challenge/docs/governance/CLAUDE_RULES.md`
- `/Users/iancarter/Documents/workspace/playoff-challenge/docs/governance/LEDGER_ARCHITECTURE_AND_RECONCILIATION.md`
- `/Users/iancarter/Documents/workspace/playoff-challenge/docs/governance/FINANCIAL_INVARIANTS.md`
- `/Users/iancarter/Documents/workspace/playoff-challenge/docs/governance/LIFECYCLE_EXECUTION_MAP.md`
- `/Users/iancarter/Documents/workspace/playoff-challenge/docs/ai/AI_ENTRYPOINT.md`
- `/Users/iancarter/Documents/workspace/playoff-challenge/docs/ai/AI_WORKER_RULES.md`

---

## Scope of Freeze

This freeze is a FREEZE DOCUMENT, not a feature-permission document.

**Its purpose:** Prevent unintended modification of core platform primitives.

**It does NOT grant permissions.** All work proceeds under normal governance:

- Non-primitive operational documentation may be updated
- Implementation work that does not modify frozen primitives may proceed under normal governance
- Any change that touches schema, OpenAPI, ledger semantics, lifecycle states, or governance rules requires Architect approval

When in doubt, escalate to the Architect.

---

## Lock Duration

**Effective:** 2026-03-12 (pre-launch)
**Review Schedule:** After launch, governance will be reviewed for Phase 2 expansion
**Modification Policy:** Only architect can authorize frozen primitive changes

---

## System Architecture Under Lock

```
Platform Architecture
│
├─ Financial System (FROZEN)
│  ├─ Ledger (append-only)
│  ├─ Wallet Accounting (derived)
│  └─ Reconciliation (equation enforced)
│
├─ Contest Engine (FROZEN)
│  ├─ Lifecycle State Machine
│  ├─ Atomic Transitions
│  └─ Settlement Primitives
│
├─ API Layer (FROZEN)
│  ├─ OpenAPI Contracts
│  ├─ Request/Response Shapes
│  └─ Error Handling
│
├─ Schema (FROZEN)
│  ├─ Table Definitions
│  ├─ Constraints
│  └─ Trigger Rules
│
└─ AI Governance (FROZEN)
   ├─ Authority Hierarchy
   ├─ Worker Rules
   └─ Entrypoint Bootstrap
```

---

## Conclusion

This architecture lock protects the financial integrity and lifecycle stability of the platform through pre-launch freeze.

Future workers must respect these frozen boundaries and escalate any changes that would violate them.
