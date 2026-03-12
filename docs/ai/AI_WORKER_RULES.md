# 67 ENTERPRISES — AI WORKER RULES

**Status:** AUTHORITATIVE
**Version:** 1
**Last Updated:** 2026-03-11

Workers must read this document immediately after AI_ENTRYPOINT.md.

This file defines behavioral rules for AI workers.

---

# Governance Authority

Workers must treat governance documentation as authoritative.

If governance documentation conflicts with code, schema, or OpenAPI contracts, this hierarchy applies:

1. schema.snapshot.sql (database structure)
2. OpenAPI contracts (API shapes)
3. Source code (implementation)
4. Governance documentation (consistency)

Workers must verify governance claims against source of truth before implementing changes.

---

# Core Principle

Workers must operate deterministically and within architectural boundaries.

Workers must:

• operate with full system context (governance + schema + OpenAPI)
• avoid repository scanning (use explicit file references only)
• avoid token waste (targeted reads, not broad exploration)
• avoid architectural drift (respect frozen invariants)
• avoid unauthorized edits (only modify assigned lanes)

---

# Architecture Lock Protocol

The system is under PRE-LAUNCH ARCHITECTURE LOCK.

Workers must NOT modify:

• Schema structure (backend/db/schema.snapshot.sql)
• OpenAPI contracts (backend/contracts/openapi.yaml or openapi-admin.yaml)
• Ledger architecture (LEDGER_ARCHITECTURE_AND_RECONCILIATION.md)
• Wallet accounting primitives (FINANCIAL_INVARIANTS.md)
• Contest lifecycle states (LIFECYCLE_EXECUTION_MAP.md)
• AI governance rules (docs/ai/)

If a task requires modification of these frozen primitives, workers must STOP and respond:

```
ARCHITECTURE LOCK ACTIVE — ARCHITECT APPROVAL REQUIRED
```

Do not implement the change without explicit architect authorization.

**Authoritative Reference:** `/Users/iancarter/Documents/workspace/playoff-challenge/docs/governance/ARCHITECTURE_LOCK.md`

---

# Architecture Freeze

The platform is under **ARCHITECTURE FREEZE** for pre-launch stability.

## Frozen Systems (No Worker Modifications)

Workers cannot modify:

• Database Schema (`backend/db/schema.snapshot.sql`)
• Financial Ledger System (`financialReconciliationService.js`, `settlementStrategy.js`)
• Contest Lifecycle Engine (`contestLifecycleAdvancer.js`, lifecycle services)
• OpenAPI Contracts (`openapi.yaml`, `openapi-admin.yaml`)
• Admin Authorization (`adminAuthMiddleware.js`)
• Discovery Idempotency (`discoveryService.js` structure)

## Escalation Requirement

If a task requires modifying any frozen system:

**STOP immediately.**

Respond with only:

```
ARCHITECTURE CHANGE REQUIRED
```

Then provide:

1. **System affected** — Which frozen system requires change
2. **Reason** — Why modification is necessary
3. **Proposed modification** — Exact change needed
4. **Risk analysis** — Impact on financial/lifecycle/API invariants

**Do not implement without architect approval.**

## Allowed Work After Freeze

Workers may implement:

• iOS bug fixes (client-side only)
• Production readiness checklist items
• Discovery enhancement (7-day tournament window, idempotent)
• Contest scoring visualization
• Payout display
• Player tier logic (iOS only)

See `docs/governance/ARCHITECTURE_FREEZE_V1.md` for full allowed work list.

## Authority Documentation

Read these before beginning work (in order):

• **FIRST:** `docs/governance/GOVERNANCE_VERSION.md` — Single source of truth for architecture state
• `docs/governance/ARCHITECTURE_FREEZE_V1.md` — Comprehensive freeze policy
• `docs/ai/AI_ARCHITECTURE_LOCK.md` — Worker boundary enforcement
• `docs/ai/AI_GUARDRAILS.md` — Concrete protection rules
• `docs/governance/PROTECTED_FILES_INDEX.md` — Protected file index

---

# Ledger Immutability

Workers must never delete or modify existing ledger rows.

All financial corrections must use compensating ledger entries.

Ledger entries are append-only and immutable.

---

# Balance Mutation Forbidden

Workers must never mutate wallet balances directly.

All balance changes must occur through ledger entries.

Balances are derived from ledger sums and must never be written as mutable fields.  

---

# Absolute Path Rule

Workers must only use absolute file paths.

Example:

/Users/iancarter/Documents/workspace/playoff-challenge/backend/services/contestService.js

Workers must never construct paths like:

./backend/services  
backend/services  
$REPO_ROOT/backend/services  

---

# Edit Containment Rule

Workers may only modify files inside directories explicitly listed in AI_ENTRYPOINT.md.

If a required change affects files outside allowed directories, workers must STOP and request approval.

Workers must never edit files outside allowed lanes.

---

# Schema First Rule

Database schema is authoritative.

Source of truth:

/Users/iancarter/Documents/workspace/playoff-challenge/backend/db/schema.snapshot.sql

Quick reference (read first):

/Users/iancarter/Documents/workspace/playoff-challenge/SCHEMA_REFERENCE.md

If a requested change requires schema modification:

Workers must stop and reply only:

Schema change required before code change.

Workers must not implement code assuming schema changes.

---

# API Contract Authority

API shapes are defined by:

/Users/iancarter/Documents/workspace/playoff-challenge/backend/contracts/openapi.yaml

Workers must not change response shapes unless OpenAPI is updated first.

---

# Test First Rule

All new behavior must begin with tests.

Required order:

1. Write tests
2. Run tests
3. Implement code
4. Run tests again

---

# Test Authority

Workers must never:

• remove tests
• weaken assertions
• bypass failing tests

If tests fail, fix the implementation.

---

# Test Stabilization Execution Protocol

When stabilizing failing tests, workers must follow the targeted repair loop.

Workers MUST NOT repeatedly execute the entire test suite.

Instead the worker must stabilize tests one failing suite at a time.

## Mandatory Process

1. Run the FIRST failing test file from the provided failure list.

Example:

```
npm test -- tests/discovery/discoveryContestCreation.test.js
```

2. Identify the failing assertion.

3. Fix the root cause.

Allowed fixes include:

• adjusting mocks
• repairing mockPool query predicates
• correcting deterministic time usage
• fixing implementation bugs
• adding missing fixtures
• correcting incorrect test expectations
• repairing transaction handling

4. Re-run the SAME test file.

Repeat the loop:

fix → run → fix → run

until the file passes 100%.

5. Once the file passes, run the full suite for that file only.

Example:

```
npm test -- tests/discovery/discoveryContestCreation.test.js
```

6. Confirm:

• all tests in that file pass
• no regressions were introduced

7. Move to the next failing test suite in the failure list.

## Strict Prohibitions

Workers must NOT:

• run the full test suite during stabilization loops
• modify financial systems
• modify ledger computation
• modify wallet balance queries
• modify schema snapshot
• modify OpenAPI contracts

If a test failure requires modifying frozen primitives, workers must STOP and escalate.

## Goal

Stabilize failing test suites sequentially while minimizing regression risk and execution time.

---

# Execution Protocol

Workers must follow this sequence.

1. Read AI_ENTRYPOINT.md
2. Read AI_WORKER_RULES.md
3. Read governance docs (in order from AI_ENTRYPOINT.md Step 2)
   - **CRITICAL FOR FINANCIAL WORK:** Read LEDGER_ARCHITECTURE_AND_RECONCILIATION.md before implementing any ledger operations
4. Write tests
5. Run tests
6. Implement changes
7. Run tests again
8. If failing → fix implementation
9. If passing → return summary

---

# Backend Test Command

Workers must use this exact command:

cd /Users/iancarter/Documents/workspace/playoff-challenge/backend && TEST_DB_ALLOW_DBNAME=railway npm test -- --runInBand --forceExit

---

# iOS Commands

Build:

cd /Users/iancarter/Documents/workspace/playoff-challenge/ios-app/PlayoffChallenge && swift build

Test:

cd /Users/iancarter/Documents/workspace/playoff-challenge/ios-app/PlayoffChallenge && swift test

---

# Forbidden Actions

Workers must never:

• run git commands
• scan the repository
• modify schema without approval
• edit files outside allowed lanes
• introduce business logic into SwiftUI Views

---

# Operational Troubleshooting — Web-Admin First

**Status:** MANDATORY for all diagnostic work

**CRITICAL RULE:** Workers must read `/Users/iancarter/Documents/workspace/playoff-challenge/docs/operations/WEB_ADMIN_MAP.md` before responding to ANY operational troubleshooting request.

This prevents improvised UI guidance and ensures all troubleshooting references actual admin locations.

When responding to operational issues (wallet problems, contest state issues, discovery failures, etc.), workers must prioritize **web-admin dashboards** before suggesting SQL queries, scripts, or direct database access.

## Troubleshooting Hierarchy

**Level 1 — Web-Admin UI (PRIMARY)**

Workers must first guide operators through web-admin dashboards.

Consult: `/Users/iancarter/Documents/workspace/playoff-challenge/docs/operations/WEB_ADMIN_MAP.md`

This document maps common operational issues to the correct Admin Area and Page.

**Level 2 — Admin API Endpoints**

If web-admin does not expose the required information, workers may suggest admin endpoints. Only after confirming the UI cannot expose the data.

**Level 3 — Logs and Service Diagnostics**

Workers may inspect backend logs, worker logs, lifecycle reconciler output, and discovery ingestion logs.

**Level 4 — SQL (ESCALATION ONLY)**

Direct SQL queries are considered diagnostic escalation.

Workers must only suggest SQL if:

• the web-admin interface cannot expose the data
• the admin API cannot expose the data
• logs cannot reveal the issue

**SQL must never be the default troubleshooting step.**

## Response Format

When guiding an operator through troubleshooting:

```
Step 1
Open Web Admin

Step 2
Navigate to: [Admin Area] → [Page Name]

Step 3
Return the following values:
- [value 1]
- [value 2]
- [value 3]

Step 4
Paste the values here for analysis.
```

## Guidance Rule

Workers must consult `/Users/iancarter/Documents/workspace/playoff-challenge/docs/operations/WEB_ADMIN_MAP.md` before suggesting SQL queries or service diagnostics.

The map prevents hallucination of UI paths and ensures workers reference actual admin locations.

---

# Architecture Awareness — Authentication Middleware

**Current State:** Authentication extraction (`extractUserId`, `extractOptionalUserId`) is currently duplicated across multiple route files:
- backend/routes/customContest.routes.js
- backend/routes/wallet.routes.js
- backend/routes/contests.routes.js
- backend/routes/payments.js

**Worker Guidance:** Do NOT refactor this duplication during test stabilization or launch preparation.

Centralization is scheduled as a **Fast Follower** task (Phase 2) after launch.

**Reason:** Large refactors increase regression risk during stabilization. Minor patches (like the test mode UUID bypass) are acceptable to restore test compatibility.

**See:** `docs/production-readiness/FAST_FOLLOWERS.md` (Centralize Authentication Middleware)

---

# Output Format

If schema change required:

Schema change required before code change.

Otherwise return:

Files changed:
• absolute paths

Behavior changes:
• bullet list

Test command run:
• command used

Test result:
• PASS

---

# Documentation Update Rules (Idempotency)

When modifying documentation files, workers must update existing sections instead of appending duplicates.

Required behavior:

1. If the section header already exists
   → Replace the content inside that section.

2. If the section header does NOT exist
   → Create the section.

3. Never append duplicate sections with the same header.

4. Never create repeated subsections with the same title.

5. Documentation edits must be **idempotent**.

Meaning:

Running the same update multiple times should produce the **same document structure** without duplication.

Workers must always:

• Search the document for an existing header
• Replace the content beneath the header
• Preserve document structure
• Avoid duplication

Example (BAD):

```
## Discovery System Status
(text)

## Discovery System Status
(text again)
```

Example (GOOD):

```
## Discovery System Status
(updated text replaces old text)
```

