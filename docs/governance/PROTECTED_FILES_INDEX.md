# Protected Files Index
## Playoff Challenge — Frozen Architecture Files

**Status:** AUTHORITATIVE
**Governance Version:** 1
**Effective Date:** 2026-03-12
**Authority:** Architect Only

---

## Purpose

This index catalogs all protected files in the repository that AI workers must not modify.

Files on this list are protected because they implement frozen architecture and cannot be changed without explicit architect approval.

---

## How to Use This Index

**For Workers:**
- Before modifying any file, check if it's listed here
- If your file is listed, you must escalate: `ARCHITECTURE CHANGE REQUIRED`
- If uncertain, treat file as protected

**For Architects:**
- Use this index to enforce architecture freeze
- Update when adding/removing protected files
- Maintain as single source of truth for file protection

---

## Database Schema Files

These files define the data contract. Schema changes break financial/lifecycle guarantees.

| File | Protection Level | Reason |
|------|-----------------|--------|
| `backend/db/schema.snapshot.sql` | ❌ PROTECTED | Database structure is authoritative; changes cascade through all systems |
| `backend/db/SCHEMA_REFERENCE.md` | ❌ PROTECTED | Schema documentation must reflect actual schema |
| `backend/db/migrations/` | ❌ PROTECTED | All migration files locked; no new migrations without approval |
| `backend/db/seeds/` | ⚠️ READ-ONLY | Seed data for development; do not modify |

---

## API Contract Files

These files define client-server communication. API changes break iOS and Admin applications.

| File | Protection Level | Reason |
|------|-----------------|--------|
| `backend/contracts/openapi.yaml` | ❌ PROTECTED | Public API contract; changes require snapshot freeze + architect approval |
| `backend/contracts/openapi-admin.yaml` | ❌ PROTECTED | Admin API contract; changes require snapshot freeze + architect approval |
| `backend/scripts/freeze-openapi.js` | ⚠️ READ-ONLY | Freezing script; reference only |
| `backend/scripts/freeze-openapi-admin.js` | ⚠️ READ-ONLY | Planned admin freezing script; reference only |

---

## Financial System Files

These files implement the reconciliation invariant and settlement engine. Modifications directly affect user finances.

| File | Protection Level | Reason |
|------|-----------------|--------|
| `backend/services/financialReconciliationService.js` | ❌ PROTECTED | Implements reconciliation invariant: wallet_liability + contest_pools = deposits - withdrawals |
| `backend/services/settlementStrategy.js` | ❌ PROTECTED | Implements prize distribution and payout logic |
| `backend/services/walletService.js` | ❌ PROTECTED | Wallet balance and ledger operations (ledger parts only) |
| `backend/repositories/LedgerRepository.js` | ❌ PROTECTED | Ledger persistence; append-only enforcement |
| `backend/services/stripeTxService.js` | ❌ PROTECTED | Stripe payment integration; critical for deposits/withdrawals |

---

## Lifecycle Engine Files

These files implement the contest state machine. Changes affect state transitions and determinism.

| File | Protection Level | Reason |
|------|-----------------|--------|
| `backend/services/contestLifecycleAdvancer.js` | ❌ PROTECTED | Core lifecycle state transitions; implements SCHEDULED→LOCKED→LIVE→COMPLETE |
| `backend/services/contestLifecycleService.js` | ❌ PROTECTED | Lifecycle service primitives; ensures deterministic, idempotent transitions |
| `backend/workers/lifecycleReconcilerWorker.js` | ❌ PROTECTED | Background reconciliation engine; manages automatic transitions |
| `backend/services/lifecycleReconciliationService.js` | ❌ PROTECTED | Orchestration for lifecycle transitions |

---

## Discovery System Files

These files implement contest discovery from external providers. Changes affect idempotency.

| File | Protection Level | Reason |
|------|-----------------|--------|
| `backend/services/discovery/discoveryService.js` | ❌ PROTECTED (Structure) | Discovery idempotency is critical; structure frozen |
| `backend/services/discovery/espnDataFetcher.js` | ❌ PROTECTED (Adapter) | ESPN provider adapter; changes affect data reliability |
| `backend/services/discovery/pgaDataFetcher.js` | ⚠️ CONDITIONAL | Provider adapters can be enhanced if idempotency preserved |

**Note:** Discovery enhancement (7-day tournament window) is approved within idempotency constraints.

---

## Admin Authorization Files

These files protect admin operations from unauthorized access. Changes expose sensitive operations.

| File | Protection Level | Reason |
|------|-----------------|--------|
| `backend/middleware/adminAuthMiddleware.js` | ❌ PROTECTED | JWT verification for admin operations; unauthorized access risk |
| `backend/routes/admin/` | ❌ PROTECTED | All admin endpoints; auth layer frozen |

---

## Ledger & Balance Files

These files enforce the ledger-first accounting model. Changes affect financial invariants.

| File | Protection Level | Reason |
|------|-----------------|--------|
| `backend/db/schema.snapshot.sql` (ledger section) | ❌ PROTECTED | Ledger table structure; append-only enforcement |
| `backend/repositories/LedgerRepository.js` | ❌ PROTECTED | Ledger persistence layer; implements immutability |
| `backend/services/walletService.js` (ledger operations) | ❌ PROTECTED | Wallet balance computation from ledger |

---

## Governance & Documentation Files

These files define system rules and boundaries. Changes affect architecture authority.

| File | Protection Level | Reason |
|------|-----------------|--------|
| `docs/governance/ARCHITECTURE_FREEZE_V1.md` | ⚠️ ARCHITECT-ONLY | Freeze policy; only architect can update |
| `docs/governance/ARCHITECTURE_LOCK.md` | ⚠️ ARCHITECT-ONLY | System lock details; only architect can update |
| `docs/governance/GOVERNANCE_VERSION.md` | ⚠️ ARCHITECT-ONLY | Governance version tracking; only architect increments |
| `docs/ai/AI_ARCHITECTURE_LOCK.md` | ⚠️ ARCHITECT-ONLY | Worker boundary enforcement; only architect can update |
| `docs/ai/AI_WORKER_RULES.md` | ⚠️ ARCHITECT-ONLY | Worker execution rules; only architect can update |

---

## Allowed to Modify

The following paths are **open** for worker modification:

| Path | Status | Notes |
|------|--------|-------|
| `backend/services/pgaLeaderboardDebugService.js` | ✅ LOW PROTECTION | Operational diagnostics service for scoring validation; read-only |
| `backend/services/[NEW_SERVICE].js` | ✅ ALLOWED | New service files in approved lanes |
| `backend/routes/[NEW_ENDPOINT].js` | ✅ ALLOWED | New endpoint files (must match OpenAPI) |
| `backend/repositories/` | ✅ ALLOWED | Non-ledger data access patterns |
| `backend/tests/` | ✅ ALLOWED | Test files and test infrastructure |
| `ios-app/PlayoffChallenge/Contracts/` | ✅ ALLOWED | DTO decoders (must match OpenAPI) |
| `ios-app/PlayoffChallenge/ViewModels/` | ✅ ALLOWED | iOS presentation logic |
| `ios-app/PlayoffChallenge/Services/` | ✅ ALLOWED | iOS API clients |
| `ios-app/PlayoffChallenge/Views/` | ✅ ALLOWED | iOS UI components |
| `docs/operational/` | ✅ ALLOWED | Operational documentation |
| `docs/production-readiness/` | ✅ ALLOWED | Production checklist and runbooks |

---

## Protected File Protection Mechanism

Protected files are protected through:

1. **This Index** — Central reference of what's protected
2. **AI Guardrails** — Worker boundary enforcement rules
3. **Code Review** — Architect reviews any modifications
4. **Git History** — Immutable audit trail of changes
5. **Test Governance** — Tests verify architecture constraints

---

## How Architecture Protection Works

```
Worker Attempts Modification
    ↓
Checks Protected Files Index
    ↓
File is protected?
    ├─ YES → Escalate: ARCHITECTURE CHANGE REQUIRED
    └─ NO  → Check AI_GUARDRAILS.md
        ↓
        Modification allowed?
        ├─ YES → Proceed with caution (follow governance)
        └─ NO  → Escalate
            ↓
            Architect Reviews Escalation
            ├─ Approved → Update governance, proceed
            └─ Denied → Explain constraints, suggest alternative
```

---

## Modification Audit Trail

Any modification to protected files will be visible in git history:

```bash
git log --oneline -- backend/services/settlementStrategy.js
```

**All changes to protected files are:**
- Tracked in commit history
- Reviewed by architect
- Documented in governance updates
- Idempotent-validated

---

## Emergency Escalation

If a worker believes a protected file must be modified for an emergency:

**DO NOT modify the file directly.**

Instead, respond immediately:

```
ARCHITECTURE CHANGE REQUIRED — URGENT

System: [System name]
Reason: [Urgent reason]
Impact: [What breaks if not changed]
Proposed: [Specific modification]
Timeline: [Why this is urgent]

Awaiting architect decision.
```

Architect will:
1. Review emergency request
2. Approve or provide alternative
3. Update governance if approved
4. Authorize modification

---

## Cross-Reference by System

### Financial Invariant Protection
- `backend/services/financialReconciliationService.js`
- `backend/repositories/LedgerRepository.js`
- `backend/db/schema.snapshot.sql` (ledger section)

**Governed by:** `docs/governance/LEDGER_ARCHITECTURE_AND_RECONCILIATION.md`

### Contest Lifecycle Protection
- `backend/services/contestLifecycleAdvancer.js`
- `backend/services/contestLifecycleService.js`
- `backend/workers/lifecycleReconcilerWorker.js`

**Governed by:** `docs/governance/LIFECYCLE_EXECUTION_MAP.md`

### Settlement Protection
- `backend/services/settlementStrategy.js`

**Governed by:** `docs/governance/FINANCIAL_INVARIANTS.md`

### API Contract Protection
- `backend/contracts/openapi.yaml`
- `backend/contracts/openapi-admin.yaml`

**Governed by:** `docs/governance/ARCHITECTURE_LOCK.md` (API Contract section)

### Discovery Protection
- `backend/services/discovery/discoveryService.js`

**Governed by:** `docs/governance/DISCOVERY_LIFECYCLE_BOUNDARY.md`

### Admin Authorization Protection
- `backend/middleware/adminAuthMiddleware.js`

**Governed by:** `docs/governance/CLAUDE_RULES.md` § 6

---

## Maintenance Rules

This index must be updated when:

1. **New protected files added** → Add to index with reason
2. **New allowed lanes open** → Add to "Allowed to Modify" section
3. **Architecture changes approved** → Update governance version
4. **Files deprotected** → Document reason and date

**Update Process:**
1. Update PROTECTED_FILES_INDEX.md
2. Update GOVERNANCE_VERSION.md (increment version)
3. Update ARCHITECTURE_FREEZE_V1.md (document change)
4. Commit all governance updates together

---

## Related Documentation

- `docs/ai/AI_GUARDRAILS.md` — Worker guardrail rules
- `docs/ai/AI_ARCHITECTURE_LOCK.md` — Boundary enforcement
- `docs/governance/ARCHITECTURE_FREEZE_V1.md` — Freeze policy
- `docs/governance/ARCHITECTURE_LOCK.md` — System lock details
- `docs/governance/GOVERNANCE_VERSION.md` — Current version

---

**End of Document**
