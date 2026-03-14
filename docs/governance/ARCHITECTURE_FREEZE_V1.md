# 67 Enterprises — Platform Architecture Freeze
Playoff Challenge System

Version: V1
Status: ACTIVE
Authority: Architect Only
Date: 2026

---

# PURPOSE

The Playoff Challenge backend architecture is now **frozen**.

The system has completed stabilization phases:

• Contest Lifecycle Engine verification
• Ledger Integrity verification
• Discovery idempotency audit
• OpenAPI contract freeze
• Full backend regression run

All critical platform invariants have been verified.

From this point forward:

NO WORKER (Claude, Gemini, or other AI agents) may modify platform architecture without explicit Architect authorization.

---

# ARCHITECTURE FREEZE SCOPE

The following systems are now frozen.

Workers are **not allowed to modify them**.

---

# 1 — DATABASE SCHEMA

Authoritative sources:

backend/db/schema.snapshot.sql  
backend/db/SCHEMA_REFERENCE.md

Freeze rules:

• No schema changes
• No column additions
• No column removals
• No constraint changes
• No index modifications
• No trigger modifications

If a schema change is required:

Architect approval is mandatory.

---

# 2 — FINANCIAL LEDGER SYSTEM

Ledger invariant:

wallet_liability + contest_pools = deposits - withdrawals

Frozen rules:

• Ledger remains append-only
• No UPDATE on ledger rows
• No DELETE on ledger rows
• Wallet balances never mutated directly
• Financial repairs must use compensating ledger entries

Relevant files:

backend/services/financialReconciliationService.js  
backend/services/settlementStrategy.js  
backend/services/walletService.js  

---

# 3 — CONTEST LIFECYCLE ENGINE

Lifecycle states:

SCHEDULED  
LOCKED  
LIVE  
COMPLETE  
CANCELLED  
ERROR

Frozen guarantees:

• Deterministic transitions
• Idempotent transitions
• Settlement executes exactly once
• contest_state_transitions is append-only
• Settlement cannot execute twice

Relevant files:

backend/services/contestLifecycleAdvancer.js
backend/workers/lifecycleReconcilerWorker.js

## Contest Lifecycle Join Rule (Invariant)

**Rule:** can_join must be false for all contest states except SCHEDULED.

**Implementation:**

```javascript
// LIVE, LOCKED, COMPLETE, CANCELLED, ERROR → can_join = false
// SCHEDULED (if space available, user not entered, lock time future) → can_join = true
const can_join =
  contestRow.status === 'SCHEDULED' &&
  lockTimeMs !== null &&
  nowMs < lockTimeMs &&
  (max_entries === null || entry_count < max_entries) &&
  user_has_entered === false
```

**Files:** backend/services/presentationDerivationService.js (line ~60)

**Guarantee:** The status check ensures LIVE and other non-SCHEDULED states automatically return can_join=false, preventing late entries into active contests.

---

# 4 — DISCOVERY SYSTEM

Discovery is now considered stable.

Frozen guarantees:

• Discovery idempotent
• Template uniqueness enforced
• Contest instance uniqueness enforced
• Safe replay of discovery cycles

Relevant files:

backend/services/discovery/discoveryService.js  
backend/services/discovery/espnDataFetcher.js

---

# 5 — OPENAPI CONTRACT

Authoritative source:

backend/contracts/openapi.yaml

Frozen guarantees:

• Response shapes must match OpenAPI
• No undocumented endpoints
• No contract drift allowed

All client applications depend on this contract.

---

# 6 — ADMIN AUTHORIZATION SYSTEM

Frozen rules:

• JWT verification required
• Admin middleware must run before admin routes
• req.adminUser must be populated
• Non-admin access must be rejected

Relevant files:

backend/middleware/adminAuthMiddleware.js  
backend/routes/admin/

---

# ALLOWED CHANGES AFTER FREEZE

Workers may only implement the following:

### 1 — iOS Bug Fixes
Client-side issues only.

Examples:

• UI rendering
• View logic
• Presentation bugs
• ViewModel issues

Workers may NOT modify backend behavior for iOS fixes.

---

### 2 — Production Readiness Checklist

Workers may fix:

• documentation issues
• missing safety checks
• logging improvements
• test infrastructure problems

Workers may NOT modify platform architecture.

---

### 3 — Discovery Enhancement (Forward Tournament Window)

Approved enhancement:

Discovery should detect tournaments starting **within 7 days** so the Home screen always has upcoming contests.

This must:

• remain idempotent
• not modify schema
• not modify lifecycle engine

---

### 4 — Player Tier Logic

iOS only.

Tier logic based on Vegas odds.

Example:

Tier 1: #1–#5  
Tier 2: #6–#10  
Tier 3: #11–#15  
Tier 4: #16–#25  
Tier 5: #26–#40  
Tier 6: #41–#60  
Tier 7: #61+

This is **client presentation logic** only.

---

### 5 — Contest Scoring Visualization

Workers may implement scoring display logic.

Scoring rules already defined.

No backend modifications required.

---

### 6 — Payout Display

Workers may implement payout visualization.

Rules:

Platform rake: 13.5%

Remaining pot distribution:

1st place — 70%  
2nd place — 20%  
3rd place — 10%

Settlement logic is already verified.

---

# PROHIBITED CHANGES

Workers must NOT:

• Modify schema
• Modify ledger logic
• Modify lifecycle engine
• Modify settlement system
• Modify OpenAPI contract
• Modify admin auth system
• Introduce new backend services
• Introduce new tables

---

# WORKER ESCALATION PROTOCOL

If a worker believes a frozen system must change:

They must STOP and respond:

ARCHITECTURE CHANGE REQUIRED.

Then explain:

• system affected
• reason
• proposed modification
• risk to financial invariant

The worker must NOT proceed without Architect approval.

---

# GOAL OF FREEZE

This freeze allows the team to safely complete:

• iOS client stabilization
• production readiness checklist
• discovery enhancement
• launch preparation

without risking architectural drift.

---

# AUTHORITY

Architect approval required for:

• schema changes
• lifecycle modifications
• settlement modifications
• API contract changes
• financial system changes

Workers are not permitted to override this freeze.

---

END OF DOCUMENT