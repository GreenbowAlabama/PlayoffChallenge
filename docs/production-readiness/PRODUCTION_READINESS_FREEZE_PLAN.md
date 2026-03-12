# Production Readiness & System Freeze Plan
67 Enterprises – Playoff Challenge Platform

Version: V1  
Purpose: Define the ordered steps required to stabilize, document, and freeze the system for production readiness.

This plan ensures:

- Financial safety
- System stability
- Governance accuracy
- AI development discipline
- Operational readiness

After completion the platform enters:

PRODUCTION_FREEZE_V1

---

# Phase 0 — System Baseline

## 0a Run Full Regression Suite

Goal: establish system baseline before freeze.

Run tests for:

- backend unit tests
- wallet tests
- contest lifecycle tests
- discovery tests
- withdrawal pipeline tests
- admin endpoints

Output results to:

docs/testing/REGRESSION_RESULTS_V1.md

Include:

- passed tests
- failed tests
- skipped tests
- accepted risks

---

## 0b Fix Critical Issues Safely

Critical issues include anything affecting:

- financial integrity
- ledger correctness
- contest creation
- contest joining
- lineup submission
- user onboarding

Rules:

- minimal safe fixes only
- no architectural refactors
- no feature additions

---

## 0c Document Known Issues

Create:

docs/release/KNOWN_ISSUES_V1.md

Format:

Issue  
Impact  
Workaround  
Planned Fix  

Purpose: prevent scope creep during stabilization.

---

# Phase 1 — Contest Engine Freeze

## 1 Freeze Discovery / Contest Creation

Lock the behavior of:

- template scoping
- entry fee ladder
- unique contest tier index
- idempotent discovery
- post-commit field initialization
- contest naming conventions

Freeze components:

- discovery worker
- contest_templates
- contest_instances creation pipeline

System milestone:

CONTEST_ENGINE_V1_FROZEN

---

## 2 Fix Lineup 400 and Freeze Player Pipeline

Resolve lineup submission error caused by empty contest field.

### Root Cause

When `field_selections.selection_json.primary` is empty, lineup submission fails validation with HTTP 400.

### Solution Implemented

Added guard in `entryRosterService.submitPicks()` at line 203-207:

```javascript
if (!validatedField || validatedField.length === 0) {
  throw Object.assign(
    new Error('Contest field not initialized'),
    ERROR_CODES.CONTEST_NOT_SCHEDULED
  );
}
```

Also verified `ingestionService.populateFieldSelections()` has invariant check at line 110-114 to prevent empty field persistence.

### Contest Field Validation

Before freezing the player pipeline, verify every SCHEDULED contest has a populated field:

```sql
SELECT ci.id,
       ci.status,
       COALESCE(jsonb_array_length(fs.selection_json->'primary'), 0) AS player_count
FROM contest_instances ci
LEFT JOIN field_selections fs ON ci.id = fs.contest_instance_id
WHERE ci.status = 'SCHEDULED'
AND (
      fs.selection_json IS NULL
      OR jsonb_array_length(fs.selection_json->'primary') = 0
);
```

**Expected result:** 0 rows.

If any rows are returned, field population failed. Run ingestion to populate fields before launch.

### System Invariant

**CRITICAL INVARIANT:** For all contests where `contest_instances.status = 'SCHEDULED'`:

```
jsonb_array_length(field_selections.selection_json->'primary') > 0
```

**Violation consequence:** Lineup submissions will fail with "Contest field not initialized" error.

**Enforcement:**
- Ingestion guard prevents empty fields from being written
- Submission guard prevents users from submitting lineups to contests with empty fields

After fix, freeze:

- player ingestion
- contest_field_selections
- contest_picks
- lineup validation
- lock-time enforcement

Verify flows:

- join contest
- save lineup
- edit lineup
- duplicate player prevention
- lock enforcement

---

# Phase 2 — User System Freeze

## 3 Freeze New User Onboarding

Verify flow:

- Apple login
- user creation
- wallet creation
- first deposit
- contest join

Freeze endpoints:

/api/users  
authentication system  
wallet initialization  

---

# Phase 3 — Contest UX Freeze

## 4 Freeze Contest View

Verify:

- contest details
- leaderboard rendering
- contest rules
- entry counts
- lock countdown

Freeze APIs:

- contest detail endpoint
- leaderboard endpoint
- rules endpoint

Client becomes:

presentation-only UI

---

# Phase 4 — Web Admin Completion

## 5 Complete Web Admin Operations

Required admin tools:

- Create contest
- Adjust entry tiers
- Feature marketing contest
- Refund entry
- Cancel contest
- Replay discovery
- Run reconciliation
- View financial dashboards
- User lookup

After completion:

WEB_ADMIN_V1_FROZEN

No new admin capabilities without governance review.

---

# Phase 5 — Financial System Hardening

## 6 Enhance Stripe Withdraw Integration

Guarantees required:

- idempotent withdrawals
- ledger consistency
- safe retries
- no double withdrawals

Rules:

- withdraw blocked if Stripe account not connected
- withdraw blocked if insufficient funds
- ledger reversal on failure

Freeze components:

wallet_withdrawals  
payout_jobs  
payout_transfers  
withdraw pipeline  

---

# Phase 6 — Edge Case Validation

## 7 Test Delete User With Funds

Test scenarios:

- user with wallet balance
- user with contest entries
- user with pending withdrawal
- user with ledger history

Expected rule:

Users with ledger entries cannot be deleted.

Freeze behavior.

---

# Phase 7 — Governance Documentation Consolidation

## 8 Consolidate Governance Docs into System Towers

Reorganize governance documentation into towers.

Structure:

docs/governance/

01-platform-architecture  
02-contest-engine  
03-financial-ledger  
04-discovery-system  
05-user-system  
06-admin-operations  
07-api-contracts  
08-client-lock  
09-ai-governance  
10-production-runbooks  

Each tower contains:

architecture.md  
system-invariants.md  
operational-rules.md  
data-models.md  

Goal:

documentation must match the running system exactly.

No speculative documentation.

---

# Phase 8 — System Blueprint Diagram

## 9 Create System Landscape Blueprint

Create a high-level system diagram matching the governance towers.

Location:

docs/architecture/system-landscape-blueprint.md

The blueprint must show:

- iOS Client
- Web Admin
- Backend API
- Discovery Worker
- Contest Engine
- Financial Ledger
- Stripe Integration
- Database

The diagram should illustrate:

- system components
- integration points
- high level data flows
- financial flows
- event pipelines

Usage model:

Engineers and AI agents can open:

LEFT → blueprint diagram  
RIGHT → governance documents  

and follow the system architecture visually.

The diagram must always remain aligned with governance documentation.

---

# Phase 9 — AI Governance Improvements

## 10 Update docs/ai Files

Enhance documentation in:

docs/ai/

Specifically:

AI_ENTRYPOINT.md  
AI_WORKER_RULES.md  
CLAUDE_RULES.md  

Ensure they reference tower governance docs.

Example references:

Contest Engine → docs/governance/02-contest-engine  
Financial Ledger → docs/governance/03-financial-ledger  
Discovery System → docs/governance/04-discovery-system  
Admin Operations → docs/governance/06-admin-operations  

Purpose:

AI agents must always read canonical architecture documentation.

---

# Phase 10 — AI Development Workflow

## 11 Document AI Development Workflow

Create:

docs/ai/AI_DEVELOPMENT_WORKFLOW.md

Define the standard development process.

### Step 1 — Architecture Planning

Open ChatGPT and paste the Chief Architect prompt.

Purpose:

- design the implementation plan
- evaluate architecture impact
- define system changes

---

### Step 2 — Launch Claude Worker

Launch Claude using repository launch scripts.

Example:

./scripts/launch_claude_worker.sh

Claude loads governance docs before performing work.

---

### Step 3 — Claude Implementation

Claude performs development tasks:

- create unit tests
- implement code changes
- update affected modules

Rules:

- unit tests first
- governance compliance required
- peer review required for every change

---

### Step 4 — Governance Synchronization

After a feature completes:

Revisit governance documentation to prevent drift.

Update:

- tower governance docs
- system blueprint diagram
- operational runbooks

Goal:

documentation always reflects system reality.

---

# Phase 11 — AI Launch Script Enhancements

## 12 Improve Claude / AI Launch Scripts

Update launch scripts to enforce governance loading.

Scripts should:

- validate repository path
- load AI entrypoint
- load worker rules
- load tower governance docs
- confirm architecture alignment

Required boot order:

AI_ENTRYPOINT.md  
AI_WORKER_RULES.md  
CLAUDE_RULES.md  
tower governance docs  

This guarantees AI agents operate within the correct architecture.

---

# Phase 12 — Observability Freeze

## 13 Standardize Logging

Logs must exist for:

- contest joins
- lineup submissions
- wallet deposits
- withdraw attempts
- ledger entries
- discovery runs
- admin actions

Once logging format stabilizes:

LOGGING_SCHEMA_V1_FROZEN

---

# Phase 13 — Production Runbooks

## 14 Create Operational Runbooks

Create:

docs/runbooks/

Runbooks must include:

- replay discovery
- reconcile ledger
- repair contest pools
- resolve payout failures
- restart workers
- fix ingestion failures

Purpose:

operations can run the platform without engineering intervention.

---

# Final System State

When all phases complete:

PRODUCTION_FREEZE_V1

System state becomes:

- contest engine frozen
- financial ledger frozen
- withdraw pipeline frozen
- admin operations frozen
- API contracts frozen
- governance documentation aligned
- system blueprint documented
- AI governance aligned

The platform is now production ready.