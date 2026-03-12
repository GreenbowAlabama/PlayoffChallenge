# 67 ENTERPRISES — AI ENTRYPOINT

**Status:** AUTHORITATIVE
**Version:** 1
**Last Updated:** 2026-03-11

This file is the canonical entrypoint for all AI workers (Claude, Gemini, ChatGPT).

Workers must read files in the exact order defined below.

Workers must not scan the repository.

Workers must only read files explicitly referenced here.

**Critical Requirement:** Workers must launch with full system context.

All workers must complete the bootstrap sequence below before accepting any task instructions. Workers operating without full context violate architectural boundaries and risk introducing drift.

---

# Repository Root

/Users/iancarter/Documents/workspace/playoff-challenge

All paths referenced in this document are absolute.

Workers must not construct new paths.

---

# Step 1 — Worker Behavior Rules

Workers must read this file first:

/Users/iancarter/Documents/workspace/playoff-challenge/docs/ai/AI_WORKER_RULES.md

This file defines behavioral rules and execution protocol.

---

# Step 2 — Governance (System Law)

These documents define the architecture and cannot be violated.

Read them in this order.

**CRITICAL: Architecture Lock is Active**

**Check governance version first:**
/Users/iancarter/Documents/workspace/playoff-challenge/docs/governance/GOVERNANCE_VERSION.md

1.
/Users/iancarter/Documents/workspace/playoff-challenge/docs/governance/ARCHITECTURE_LOCK.md

⚠️ READ FIRST: This document defines frozen primitives. Do not modify schema, OpenAPI, ledger, lifecycle, or governance rules without architect approval.

2.
/Users/iancarter/Documents/workspace/playoff-challenge/docs/governance/CLAUDE_RULES.md

3.
/Users/iancarter/Documents/workspace/playoff-challenge/docs/governance/LEDGER_ARCHITECTURE_AND_RECONCILIATION.md

4.
/Users/iancarter/Documents/workspace/playoff-challenge/docs/governance/LIFECYCLE_EXECUTION_MAP.md

5.
/Users/iancarter/Documents/workspace/playoff-challenge/docs/governance/FINANCIAL_INVARIANTS.md

6.
/Users/iancarter/Documents/workspace/playoff-challenge/docs/governance/DISCOVERY_LIFECYCLE_BOUNDARY.md

7.
/Users/iancarter/Documents/workspace/playoff-challenge/docs/governance/IOS_SWEEP_PROTOCOL.md

8.
/Users/iancarter/Documents/workspace/playoff-challenge/docs/governance/ARCHITECTURE_ENFORCEMENT.md

---

# Financial Invariant Awareness

Workers modifying financial code must ensure the reconciliation equation remains valid:

**wallet_liability + contest_pools = deposits - withdrawals**

This equation must hold at all times. If a proposed change risks breaking this equation, workers must STOP and report:

Financial invariant at risk.

Workers must not implement changes that could violate this equation without architect approval.

---

# Architecture Freeze Bootstrap

The Playoff Challenge backend architecture is now **frozen** for pre-launch stability.

**Workers must read these files before beginning any work:**

**First:** Check governance state:

0. `/Users/iancarter/Documents/workspace/playoff-challenge/docs/governance/GOVERNANCE_VERSION.md`
   - Single source of truth for architecture state
   - Current version: 1, Architecture Lock: ACTIVE
   - Read this first to understand current governance state

Then read in order:

1. `/Users/iancarter/Documents/workspace/playoff-challenge/docs/governance/ARCHITECTURE_FREEZE_V1.md`
   - Defines frozen systems and allowed work
   - Lists protected files and escalation protocol

2. `/Users/iancarter/Documents/workspace/playoff-challenge/docs/ai/AI_ARCHITECTURE_LOCK.md`
   - Worker boundary enforcement
   - Protected file index
   - Escalation procedures

3. `/Users/iancarter/Documents/workspace/playoff-challenge/docs/ai/AI_GUARDRAILS.md`
   - Concrete protection rules
   - Worker decision tree
   - Allowed modification lanes

**Critical Rule:**

If a task requires modifying any frozen system, workers must **STOP** and respond:

```
ARCHITECTURE CHANGE REQUIRED
```

Then provide:
- System affected
- Reason for change
- Proposed modification
- Risk to financial/lifecycle invariants

**Do not proceed without explicit architect approval.**

---

# Step 3 — Contracts and Schema (Authority Sources)

Workers must treat these files as the authoritative sources of truth.

Workers must verify governance documentation against these sources before proceeding.

## Schema Authority

**Authoritative File:**
`/Users/iancarter/Documents/workspace/playoff-challenge/backend/db/schema.snapshot.sql`

This is the single source of truth for database structure.

For faster navigation:
`/Users/iancarter/Documents/workspace/playoff-challenge/SCHEMA_REFERENCE.md` (organized by domain)

Workers must NOT:
- Assume schema structure
- Hallucinate columns or constraints
- Implement code that requires schema changes

If schema modifications are required, workers must STOP and report:
"Schema change required before code change."

## OpenAPI Contract Authority

**Authoritative Files:**
- `/Users/iancarter/Documents/workspace/playoff-challenge/backend/contracts/openapi.yaml` (public API)
- `/Users/iancarter/Documents/workspace/playoff-challenge/backend/contracts/openapi-admin.yaml` (admin API)

These define the authoritative API response shapes and request formats.

Workers must NOT:
- Add undocumented response fields
- Change API shapes without updating OpenAPI
- Deploy API changes that deviate from contracts

If API changes are needed, workers must STOP and report:
"API contract update required before implementation."

## API Contract Freeze System

OpenAPI contracts are frozen using cryptographic snapshots to prevent unauthorized API drift.

**How Contract Freezing Works:**

1. **Generate** canonical OpenAPI spec from backend routes or YAML
2. **Hash** spec using SHA256
3. **Check** if snapshot exists in `api_contract_snapshots` table
4. **If exists** → Exit successfully (idempotent)
5. **If not** → Auto-increment version (v1, v2, v3...) and insert snapshot

**Freeze Commands:**

```bash
# Public API contract (backend/contracts/openapi.yaml)
npm run freeze:openapi

# Planned command (Phase 2):
# npm run freeze:openapi:admin
# Freeze admin API contract (backend/contracts/openapi-admin.yaml)
# Not yet implemented - see FAST_FOLLOWERS.md
```

**Snapshot Storage:**

- **Table:** `api_contract_snapshots`
- **Constraint:** UNIQUE(contract_name, sha256) prevents duplicate hashes
- **Append-only:** Snapshots are never deleted, only appended

**Worker Rules:**

- Workers must freeze a new snapshot before changing OpenAPI contracts
- Tests enforce freezing: `tests/contracts/openapi-freeze.test.js`
- Frozen contracts are immutable governance boundaries
- Contract changes without freezing will fail tests and block deployment

**Reference:** `backend/scripts/freeze-openapi.js`, `docs/governance/ARCHITECTURE_LOCK.md`

---

# Step 4 — Allowed Backend Lanes

Workers may read and edit files only inside these directories.

/Users/iancarter/Documents/workspace/playoff-challenge/backend/services

/Users/iancarter/Documents/workspace/playoff-challenge/backend/routes

/Users/iancarter/Documents/workspace/playoff-challenge/backend/repositories

/Users/iancarter/Documents/workspace/playoff-challenge/backend/tests

Workers must not modify files outside these directories.

---

# Step 5 — Allowed iOS Lanes

Workers may read and edit files only inside these directories.

/Users/iancarter/Documents/workspace/playoff-challenge/ios-app/PlayoffChallenge/Contracts

/Users/iancarter/Documents/workspace/playoff-challenge/ios-app/PlayoffChallenge/ViewModels

/Users/iancarter/Documents/workspace/playoff-challenge/ios-app/PlayoffChallenge/Services

/Users/iancarter/Documents/workspace/playoff-challenge/ios-app/PlayoffChallenge/Views

Workers must follow the iOS sweep protocol.

---

# Step 6 — Operational Troubleshooting Protocol

When diagnosing operational issues, workers must follow the **Web-Admin First** troubleshooting protocol.

**Reference:** `docs/ai/AI_WORKER_RULES.md` (Operational Troubleshooting section)

**Map:** `/Users/iancarter/Documents/workspace/playoff-challenge/docs/operations/WEB_ADMIN_MAP.md`

**Rule:** Operational diagnostics must prioritize web-admin dashboards before suggesting SQL queries or scripts.

Workers must not invent admin navigation paths. Consult the WEB_ADMIN_MAP.md to map issues to actual admin locations.

---

# Optional Read Only

Workers may read but not modify these directories.

/Users/iancarter/Documents/workspace/playoff-challenge/core

/Users/iancarter/Documents/workspace/playoff-challenge/INTERNAL_DOCS/engineering_execution

