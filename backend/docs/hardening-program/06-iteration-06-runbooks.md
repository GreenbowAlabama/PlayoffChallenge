# Iteration 06 – Operational + Technical Runbooks + Founder Absence Simulation

## Overview

Iteration 06 has three distinct sub-phases that must complete sequentially:

- **06A – Runbook Audit Schema** (Required: runbook_executions table for audit trail)
- **06B – Operational Runbooks Documentation** (Required: Procedures for all failure modes)
- **06C – Founder Absence Simulation** (Required: Technical validation of operational autonomy)

All three phases must complete before Iteration 06 closes.

---

## Objective

Establish step-by-step runbooks for every known failure mode and operational procedure.

Runbooks must:
- Be executable by ops without engineering knowledge
- Include exact commands, no "engineering will handle it"
- Cover all known failure modes from iterations 01-05 (including automatic payout from Iteration 05)
- Be tested in staging before production use
- Include alerting rules and detection procedures
- Enable 30-day autonomy without founder intervention

---

## Phase 06A – Operational Control Plane

### Runbook Execution Endpoints

Phase 06A introduces API endpoints for recording runbook execution. **Ops team has no direct database access.** All runbook logging flows through these endpoints.

#### POST /api/admin/runbooks/start

**Purpose**: Initiate a runbook execution record

**Request**:
```json
POST /api/admin/runbooks/start
Authorization: Bearer <admin-jwt>
Content-Type: application/json

{
  "runbook_name": "payout_transfer_stuck_in_retryable",
  "runbook_version": "1.0.0",
  "executed_by": "ops-user-123",
  "system_state_before": {
    "payout_transfers_stuck": 2,
    "last_scheduler_run": "2026-02-16T19:30:00Z"
  }
}
```

**Response (200 OK)**:
```json
{
  "timestamp": "2026-02-16T20:00:00.000Z",
  "execution_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

**Fields**:
- `runbook_name` (required): Name of runbook being executed
- `runbook_version` (required): Version of runbook (for audit trail)
- `executed_by` (required): Ops user/identifier executing runbook
- `system_state_before` (optional): JSON snapshot of system state before procedure

#### POST /api/admin/runbooks/complete

**Purpose**: Complete a runbook execution record with outcome

**Request**:
```json
POST /api/admin/runbooks/complete
Authorization: Bearer <admin-jwt>
Content-Type: application/json

{
  "execution_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "status": "completed",
  "result_json": {
    "transfers_recovered": 2,
    "scheduler_triggered": true,
    "next_check_interval": 300
  },
  "system_state_after": {
    "payout_transfers_stuck": 0,
    "last_scheduler_run": "2026-02-16T20:05:00Z"
  }
}
```

**Response (200 OK)**:
```json
{
  "timestamp": "2026-02-16T20:05:00.000Z",
  "success": true
}
```

**Fields**:
- `execution_id` (required): ID returned from `/start` endpoint
- `status` (required): One of `completed`, `failed`, `partial`
- `result_json` (optional): JSON result data from runbook execution
- `error_reason` (optional): Error description if status is `failed`
- `system_state_after` (optional): JSON snapshot of system state after procedure

**Status Values**:
- `completed`: Runbook executed successfully, all objectives met
- `failed`: Runbook execution failed, system may be in inconsistent state, escalation required
- `partial`: Runbook partially succeeded (e.g., 2 of 3 stuck transfers recovered)

### Audit Trail Progression

**Important**: Status progression happens in a **single row**. No append-only duplicate rows.

1. `POST /start` creates row with status `in_progress`
2. `POST /complete` updates same row with final status and completion data
3. Single audit record tracks entire lifecycle: start → end, before → after, success/failure

**Query audit trail**:
```sql
SELECT
  id,
  runbook_name,
  executed_by,
  status,
  start_time,
  end_time,
  duration_seconds,
  system_state_before,
  result_json,
  error_reason,
  system_state_after
FROM runbook_executions
ORDER BY start_time DESC;
```

---

## Phase 06A – Runbook Audit Schema

### Decision: runbook_executions Table Implementation

**Question**: Does Iteration 06 require a `runbook_executions` table for audit trail?

**Answer**: YES. The `runbook_executions` table is required in Iteration 06.

**Table Purpose**: Every runbook execution must be logged with:
- Timestamp
- Operator (who ran it)
- Which runbook executed
- Which step within the runbook
- Result (success, failure, partial)
- Outcome state (before/after)

This creates an audit trail essential for postmortem analysis.

### Schema Changes Required (06A)

**runbook_executions Table**
```sql
CREATE TABLE runbook_executions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  runbook_name text NOT NULL,
  runbook_version text NOT NULL,
  executed_by text NOT NULL,
  status text NOT NULL,
  execution_phase text,
  phase_step integer,
  start_time timestamp with time zone DEFAULT now() NOT NULL,
  end_time timestamp with time zone,
  duration_seconds integer,
  result_json jsonb,
  error_reason text,
  system_state_before jsonb,
  system_state_after jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT runbook_executions_duration_seconds_check CHECK ((duration_seconds >= 0)),
  CONSTRAINT runbook_executions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text, 'failed'::text, 'partial'::text])))
);

CREATE INDEX idx_runbook_executions_created_at
  ON runbook_executions(created_at);

CREATE INDEX idx_runbook_executions_runbook_name
  ON runbook_executions(runbook_name);

CREATE INDEX idx_runbook_executions_status
  ON runbook_executions(status);
```

### Scheduler Behavior

**Test Environment**: The payout scheduler is disabled in test environments (`NODE_ENV = 'test'`). This prevents background jobs from interfering with unit tests and integration tests. Manual E2E verification in staging uses real scheduler execution.

**Implementation**: Server.js implements environment check:
```javascript
if (process.env.NODE_ENV !== 'test') {
  // Scheduler runs every 5 minutes in production and staging
  setInterval(async () => {
    // Process payout jobs
  }, 300000);
}
```

**Why This Matters**:
- **Test determinism**: Scheduler silence prevents unexpected state mutations during test execution
- **Predictable test behavior**: Tests complete when they end, not when background jobs finish
- **Future contributors**: Explains why scheduler is not mentioned in test documentation

---

### Constraints (06A)
- Append-only: No edits to runbook_executions rows after creation
- Complete audit trail: Every execution step is logged before moving to next step
- Before/after state snapshots: capture system state to verify recovery worked
- No silent partial recovery: If any step fails, the entire execution is marked `failed` and escalation required

### Completion Criteria (06A)
✓ `runbook_executions` table created and migrated to staging
✓ Table includes all required fields for full audit trail
✓ Indexes are in place for query performance
✓ Schema snapshot updated to include new table

---

## Phase 06B – Operational Runbooks Documentation

### Objective

Document step-by-step executable procedures for all failure modes.

### Constraints

### Runbook Documentation Constraints

**Runbooks Are Not Code**
- Runbooks are documentation; they are executable procedures
- No "ask engineering" steps; every step must be runnable by ops
- Commands are exact; no interpreting instructions
- Each runbook is tested and verified before production

**Runbooks Are Comprehensive**
- Every failure mode has a runbook (including Iteration 05 payout failures)
- Every operational task (backup, restore, config change) has a runbook
- Every escalation path is documented
- Every procedure has success criteria and rollback steps

**Single Source of Truth**
- Runbooks are stored in `/backend/docs/runbooks/`
- Each runbook is versioned and dated
- Runbooks are linked from monitoring dashboards
- Changes to runbooks are audited and approved (via runbook_executions table)

---

### SOLID Enforcement (06B)

**Explicit Procedures**
- **Detection**: How to identify the failure (exact metric, log pattern, alert)
- **Diagnosis**: How to confirm the root cause (exact commands, not guesses)
- **Recovery**: Step-by-step procedure to restore service
- **Verification**: How to confirm the fix worked
- **Documentation**: What happened and why (for postmortem)

**Document these procedures** in `/backend/docs/runbooks/` with templates for each type.

**No Hidden Knowledge**
- Every procedure is documented with inputs and outputs
- Every command includes the exact syntax and expected output
- Every conditional (if X, then Y) is explicit
- Every role requirement (ops vs. engineering) is explicit

### Dependency Direction
```
Runbook → Documented Procedure
       → Exact Command
       → Verification Step
       → Rollback (if needed)
```
Runbooks are self-contained; no runbook depends on another.

---

## Phase 06B – Operational Runbooks Documentation (continued)

### Monitoring and Alerting Infrastructure (06B)

**Constraints**:
- Alerts must integrate with managed monitoring provider (Railway, Datadog, PagerDuty, or equivalent)
- Do NOT create custom `operational_alerts` table; use hosted alerting from your infrastructure provider
- Alerting rules are configured via provider (not database); changes do not require migrations
- This respects the Infrastructure Tooling Constraints: no custom implementations of solved infrastructure problems

### Automatic Payout Runbooks Required (06B)

**Critical Dependency**:
- Iteration 05 (Automatic Payout) must be complete before Iteration 06 begins
- Runbooks now include payout failure modes: transfer failure, partial batch, Stripe outage, destination account invalid, user deleted post-settlement, idempotency conflicts
- Founder Absence Simulation must test end-to-end payout execution without intervention

**Payout Runbooks Must Cover**:
- Detection of failed payout transfers
- Diagnosis of retryable vs. terminal failures
- Recovery procedure for transient payout failures (automatic retry)
- Manual intervention procedure for permanent payout failures
- Audit trail verification (ledger entries for all payout attempts)

**Payout Runbooks Published**:
- [Payout Transfer Stuck in Retryable State](./runbooks/payout-transfer-stuck-retryable.md)

---

## Phase 06C – Founder Absence Simulation

### Objective

Validate that the entire platform operates autonomously for 14 consecutive simulated days without any founder or engineering intervention.

### Technical Definition: Founder Absence Simulation

**What Is It**:
A staged test in a production-like environment where all founder access is explicitly revoked, and automated systems must complete a full contest lifecycle without manual intervention.

**Measurable Constraints**:

1. **No Direct Production Database Access**
   - Founder cannot execute SQL queries or run migrations during simulation
   - All database state changes must happen via application layer
   - Database access is monitored; any manual access fails the test

2. **No Manual Stripe Dashboard Interventions**
   - Founder cannot manually create, modify, or cancel Stripe payment intents
   - Founder cannot manually initiate refunds or transfers
   - Founder cannot adjust Stripe webhook configurations
   - All payment and payout operations must occur via automated application logic

3. **No Code Deploys or Configuration Changes**
   - No new code can be deployed during simulation
   - No environment variable changes
   - No database configuration updates
   - System must operate on production-deployed code and committed configuration

4. **No Manual State Repairs**
   - No running corrective SQL scripts
   - No manual ledger entries or adjustments
   - No triggering of internal functions via admin endpoints (except those exposed for normal operations)
   - Only runbook procedures are permitted (and they must not require engineering knowledge)

5. **All Contest Lifecycle Stages Must Complete Via Automated Systems**
   - **SCHEDULED** → **LOCKED**: Automatic on configured lock time
   - **LOCKED** → **LIVE**: Automatic on ingestion completion + configured start time
   - **LIVE** → **COMPLETE**: Automatic on tournament completion signal from provider (or explicit end time)
   - **COMPLETE** → Settlement execution (automatic via scheduler)
   - **Settlement Complete** → Payout execution (automatic via scheduler)

6. **All Ingestion Operations Automated**
   - Provider score updates ingested automatically
   - Ingestion validation must not require manual review
   - Corrections must be applied via documented ingestion procedures only
   - Scoring replay must run automatically

7. **All Failure Recovery Automated or Runbook-Driven**
   - Transient failures (network, API timeouts) must retry automatically
   - Permanent failures must trigger documented runbook procedures (executable by ops)
   - Escalation to engineering only if a failure has no matching runbook
   - No "ask founder to debug this" steps

### Test Scenario

**Duration**: 14 simulated days (compressed to ~3 hours real time)

**Sequence**:
1. Create 3-5 contests with varied configurations (different prize pools, entry fees, participant counts)
2. Lock contests automatically
3. Trigger contests to LIVE state
4. Inject 2-3 simulated rounds of score updates via provider API
5. Intentionally trigger 1-2 failure modes:
   - One payout transfer fails with transient error (timeout)
   - One webhook duplicate arrives (to test idempotency)
   - One payment webhook delayed (to test eventual consistency)
6. Verify runbooks successfully recover all failures
7. Complete all contests
8. Execute settlement for all contests
9. Execute payouts for all contests
10. Verify all winners received correct amounts
11. Verify audit trail is complete and accurate

**Success Criteria**:
- ✓ No founder intervention required at any point
- ✓ All contests completed SCHEDULED → LOCKED → LIVE → COMPLETE → SETTLED → PAID_OUT
- ✓ All injected failures were recovered via runbooks
- ✓ All ledger entries correct and auditable
- ✓ All payout transfers executed (or marked terminal failed)
- ✓ Audit trail shows every operation with timestamp and reason
- ✓ Admin dashboards reflect real-time state accurately
- ✓ No errors requiring database access to resolve

**Failure Criteria** (test fails if any of these occur):
- ✗ Founder access required at any point
- ✗ Any manual database edit needed
- ✗ Runbook procedure fails when executed exactly as documented
- ✗ Ingestion validation fails silently (no error logged)
- ✗ Payment or payout requires manual Stripe intervention
- ✗ Audit trail has gaps or missing entries
- ✗ Payout execution requires manual trigger
- ✗ System enters ERROR state with no documented recovery

### Execution Checklist (06C)

**Before Starting Simulation**:
- [ ] All Iteration 05 (Automatic Payout) services are deployed to staging
- [ ] All Iteration 06B runbooks are tested in staging (at least once per procedure)
- [ ] Monitoring dashboards are active and reporting
- [ ] runbook_executions table is created and tested
- [ ] Founder access is explicitly revoked (verified by access control audit)
- [ ] Engineering on-call is muted for non-emergency issues (test only)

**During Simulation**:
- [ ] All state transitions logged in real-time
- [ ] No manual interventions recorded (access audit clean)
- [ ] Runbooks executed for all injected failures
- [ ] All runbook steps produce expected output
- [ ] runbook_executions table populated for each procedure

**After Simulation**:
- [ ] All contests completed (no stuck states)
- [ ] All winners paid out correctly (audit trail verified)
- [ ] No data inconsistencies discovered
- [ ] Audit trail is complete (no gaps)
- [ ] Postmortem review completed (what went wrong, what worked)

### Completion Criteria (06C)

✓ **Founder Absence Simulation** passes with zero engineering intervention
✓ All documented runbooks successfully execute in sequence without failure
✓ All contest lifecycle stages complete automatically
✓ All payout transfers either complete or transition to failed_terminal with documented reason
✓ Audit trail is append-only and complete
✓ 14-day simulation completes without system entering ERROR state
✓ Ledger reconciliation shows correct balances for all participants
✓ No data corrections required; system is self-healing

**If Simulation Fails**:
- Document the failure mode (which step failed and why)
- Add runbook for the failure mode (or fix existing runbook if it failed)
- Re-run simulation once fix is deployed
- Iteration 06 cannot close until simulation passes

---

## Contract Impact (06B)

### Breaking Changes (None)
- Runbooks do not change API contracts
- Runbooks may depend on admin endpoints (documented in iteration 03)
- Operational changes are isolated to procedures, not code

### Documentation Requirements
- **Failure Mode Runbook**: Detect → Diagnose → Recover → Verify → Document
- **Operational Task Runbook**: Prerequisites → Steps → Verification → Rollback
- **Escalation Procedure**: When to escalate, to whom, with what information
- **Postmortem Template**: What happened, why, what we changed

---

## Runbook Categories

### Failure Mode Runbooks
1. **Ingestion Lag Exceeds Threshold**
   - Detection: Metric ingestion_lag_seconds > 3600
   - Diagnosis: Check provider API status; review ingestion service logs
   - Recovery: Restart ingestion service; re-run settlement
   - Verification: Lag returns to normal; scores are correct

2. **Settlement Fails Mid-Run**
   - Detection: Alert settlement_status = FAILED
   - Diagnosis: Review settlement_audit table for error_json
   - Recovery: Review validation errors; fix data; re-run settlement
   - Verification: Settlement completes; no duplicate scores

3. **Contest Lock Failed**
   - Detection: Alert contest_status_transition_failed; SCHEDULED → LOCKED failed
   - Diagnosis: Review lock transition logs; check for pending ingestion events
   - Recovery: Force lock transition (authorized admin only); audit trail preserved
   - Verification: Contest is LOCKED; no new ingestion accepted

4. **Score Discrepancy Detected**
   - Detection: Automated audit finds score_version mismatch
   - Diagnosis: Compare settlement_audit runs; review ingestion events
   - Recovery: Replay settlement from correct checkpoint; audit trail preserved
   - Verification: Scores match expected values; audit trail is complete

5. **Database Connection Failure**
   - Detection: Alert db_connection_pool_exhausted or db_connection_timeout
   - Diagnosis: Check connection pool metrics; review slow queries
   - Recovery: Restart connection pool; if persists, scale database
   - Verification: Connections normalize; requests complete successfully

6. **Authentication Service Unavailable**
   - Detection: Alert auth_service_timeout or auth_service_error_rate > 5%
   - Diagnosis: Check auth service health; review network connectivity
   - Recovery: Failover to backup auth service; or pause auth-required features
   - Verification: Authentication succeeds; valid users can log in

### Operational Task Runbooks
1. **Backup Contest Data**
   - Prerequisites: Contest is COMPLETE or CANCELLED
   - Steps: Export contest tables; encrypt archive; store to backup location
   - Verification: Archive integrity verified; restore test passes
   - Rollback: No rollback needed; backups are read-only

2. **Restore Contest from Backup**
   - Prerequisites: Contest restore is authorized; data loss is confirmed
   - Steps: Restore tables from backup; verify data integrity; run audit
   - Verification: Contest state matches backup timestamp; all scores present
   - Rollback: Restore from most recent pre-incident backup

3. **Deploy Configuration Change**
   - Prerequisites: Configuration change is approved; staging tested
   - Steps: Publish config to staging; validate in staging; publish to production
   - Verification: Config is active; no scoring errors; all tests pass
   - Rollback: Revert to previous config version; alert ops

4. **Restart Services**
   - Prerequisites: Reason for restart is documented; maintenance window approved
   - Steps: Drain connections; stop service; wait for shutdown; start service
   - Verification: Service is healthy; all dependencies connected
   - Rollback: Restart previous version if needed

5. **Scale Database**
   - Prerequisites: Database metrics show sustained high usage; capacity plan approved
   - Steps: Initiate scaling operation; monitor migration; verify connections
   - Verification: Database is responding; no connection timeouts; queries are fast
   - Rollback: Rollback to previous size if performance degrades

### Escalation Runbooks
1. **When to Escalate to Engineering**
   - Any failure without a matching runbook
   - Any runbook step that fails when executed exactly as written
   - Any error code not in enumerated error registry
   - Any data inconsistency that audit trail cannot explain

2. **Escalation Information**
   - Alert time and type
   - All diagnostic outputs (logs, metrics, audit trail)
   - Steps attempted and their results
   - Current system state and affected contests

### Environment Promotion Runbook

**Prerequisite**: All iterations (01-05, including Automatic Payout) are complete. Staging deployment is tested and stable.

**Promotion Checklist** (Execute in order; stop on any failure):

1. **Confirm staging schema snapshot matches**
   - Command: `pg_dump -h staging-db staging_db > /tmp/current-staging.sql`
   - Compare: `diff -u /backend/db/schema.snapshot.sql /tmp/current-staging.sql`
   - Expected: No differences (or only comments/timestamps)
   - If diff: Investigate schema drift; resolve before promotion

2. **Confirm OpenAPI schema regenerated**
   - Command: Run schema generation script (e.g., `npm run openapi:generate`)
   - Expected: Output matches committed schema in `/backend/docs/api/openapi.json`
   - If diff: Update schema, commit, reject promotion until merged

3. **Confirm no breaking API changes**
   - Compare committed OpenAPI schema from previous release tag
   - Identify removed endpoints, renamed fields, changed types
   - Expected: No breaking changes (only additive, optional fields)
   - If breaking changes: Document version bump; confirm mobile app is updated before promotion

4. **Confirm Stripe environment separation**
   - Verify `STRIPE_API_KEY_PROD` != `STRIPE_API_KEY_STAGING`
   - Verify `STRIPE_WEBHOOK_SECRET_PROD` != `STRIPE_WEBHOOK_SECRET_STAGING`
   - Verify ingestion endpoints use production provider URL (not staging)
   - Expected: All environment variables are production-scoped
   - If wrong: Do not promote; fix configuration

5. **Confirm ingestion endpoint environment separation**
   - Verify `INGESTION_ENDPOINT_URL_PROD` points to production provider
   - Verify `INGESTION_ENDPOINT_URL_STAGING` points to staging provider
   - Verify code selects correct endpoint based on `NODE_ENV`
   - Expected: Staging and production use different provider endpoints
   - If same endpoint: Do not promote; fix configuration

6. **Confirm all tests pass**
   - Command: `npm test` (full suite)
   - Expected: All tests passing (0 failures)
   - If failures: Resolve in staging; do not promote broken code

7. **Confirm deployment checklist**
   - Verify rollback procedure documented
   - Verify rollback database snapshot is committed (from previous release)
   - Verify monitoring dashboards are connected
   - Verify escalation team is on-call

**Promotion Action**:
   - Create production release from staging branch
   - Tag with semantic version (e.g., `v2.3.0`)
   - Deploy to production
   - Monitor ingestion lag, settlement status, error rate for 1 hour
   - If issues: Execute rollback runbook (not included here; separate runbook required)

### Database Snapshot Ritual

**At start of iteration**:
   - Review current `/backend/db/schema.snapshot.sql`
   - Document baseline (schema version, date, commit hash)
   - Note any pending migrations

**At end of iteration** (before closure):
   1. Run: `pg_dump -h staging-db staging_db > /backend/db/schema.snapshot.sql`
   2. Edit header comment to include: iteration number, date, major changes summary
   3. Example header:
      ```sql
      -- Iteration 03: Payment Integration
      -- Generated: 2026-02-13
      -- Changes: Added payments, payment_events, ledger_entries tables
      -- Commit: staging branch HEAD
      ```
   4. Commit snapshot to version control: `git add /backend/db/schema.snapshot.sql && git commit -m "docs: update schema snapshot iteration 03"`
   5. Verify file is committed before iteration closure

**Snapshot review** (in PR):
   - Reviewer examines schema diff
   - Verify all table additions are necessary
   - Verify no unexpected migrations are present
   - Verify indexes are created for foreign keys
   - Approve schema changes as part of PR review

**Why**: Snapshot is the source of truth for rollback. Production incidents require rapid schema restoration. Snapshot must match deployed database at all times. If snapshot drifts, rollback becomes uncertain.

---

## Validation Rules

### Runbook Validation (Before Production Use)
1. Every step is executable without interpretation
2. Every command has exact syntax and expected output documented
3. Every conditional is explicit (if X, then Y; if not X, then Z)
4. Every role requirement is clear (ops, engineering, admin)
5. Recovery brings system to documented state
6. Rollback reverses all changes from runbook execution

### Runbook Testing
1. Runbooks are tested in staging with production-like data
2. Each step is verified to produce expected output
3. Recovery and rollback procedures are tested
4. Postmortem documentation is complete

### Silent Failures Not Allowed
- Failed runbook steps are logged and escalated
- Partial recovery is not acceptable; rollback if any step fails
- All procedures are auditable and reversible

---

## Monitoring and Alerting

### Metrics to Monitor
- `ingestion_lag_seconds`: Time since last successful ingestion
- `settlement_duration_seconds`: Time to complete settlement
- `settlement_status`: Last settlement run status
- `contest_status_transitions_failed`: Failed state transitions
- `score_audit_mismatches`: Score discrepancies detected
- `database_connection_pool_available`: Available connections
- `auth_service_error_rate`: Percentage of auth failures
- `error_budget_remaining`: Budget of acceptable errors for the month

### Alerting Rules
- `ingestion_lag_seconds > 3600`: Critical; escalate to ops
- `settlement_status = FAILED`: Critical; escalate to ops and engineering
- `contest_status_transitions_failed > 0`: Warning; review logs
- `score_audit_mismatches > 0`: Critical; escalate to ops and engineering
- `database_connection_pool_available < 5`: Warning; investigate queries
- `auth_service_error_rate > 5%`: Critical; escalate to ops
- `error_budget_remaining < 10%`: Warning; review error trends

### Dashboards
- **Operational Dashboard**: Current system status, active alerts, recent escalations
- **Contest Status Dashboard**: All active contests, their states, ingestion lag
- **Audit Trail Dashboard**: Recent operations, runbook executions, state changes
- **Error Trends Dashboard**: Error rate, top errors, error budget burn rate

---

## Completion Criteria (All Phases)

### Phase 06A – Runbook Audit Schema
✓ `runbook_executions` table created with all required fields
✓ Append-only constraint enforced (no edits after creation)
✓ Indexes created for query performance
✓ Schema snapshot updated and committed

### Phase 06B – Operational Runbooks Documentation
✓ All known failure modes (01-05 iterations) have runbooks
✓ All operational tasks have runbooks
✓ All escalation procedures are documented
✓ Every runbook step is executable without interpretation
✓ Every runbook is tested in staging (at least once)
✓ All recovery procedures are verified to work
✓ All rollback procedures are tested
✓ Monitoring and alerting rules are in place
✓ Dashboards display critical operational metrics
✓ Postmortem template is ready for use
✓ No "ask engineering" steps remain in runbooks
✓ All Iteration 05 payout failure modes have documented runbooks:
  - Transient payout failures (timeout, rate limit, 5xx)
  - Terminal payout failures (invalid account, 4xx validation)
  - Partial batch execution (mixed success/failure)
  - Stripe API outage
  - Webhook delays
  - User deleted post-settlement

### Phase 06C – Founder Absence Simulation
✓ 14-day staging simulation completes without founder/engineering access
✓ No manual database edits during simulation
✓ No manual Stripe dashboard interventions
✓ No code deploys or configuration changes during simulation
✓ All runbooks executed successfully when needed
✓ All contest lifecycle stages completed automatically (SCHEDULED → LOCKED → LIVE → COMPLETE → SETTLED → PAID_OUT)
✓ All injected failures recovered via documented procedures
✓ Payout transfers executed automatically (either completed or failed_terminal with logged reason)
✓ Audit trail is complete and append-only
✓ Ledger reconciliation shows correct final balances
✓ Zero engineering intervention required during entire 14-day simulation

---

## Iteration 06 Closure Gate

**Iteration 06 cannot close until ALL of the following are true:**
1. Phase 06A: `runbook_executions` table created and tested
2. Phase 06B: All runbooks documented, tested, and passing
3. Phase 06C: Founder Absence Simulation passes with zero intervention

If Phase 06C fails:
- Document the failure mode
- Create or update runbook for that mode
- Deploy fix to staging
- Re-run simulation
- Repeat until Phase 06C passes

---

## Lessons Learned

*To be completed upon iteration closure*

### What Worked
(Document successes)

### What Was Harder Than Expected
(Document surprises)

### Assumptions We Purged
(Document implicit behaviors we discovered and removed)

### Operational Gaps Identified
(Document any failure modes found during testing that weren't anticipated)

### Runbook Coverage Assessment
(Document confidence level that all failure modes are covered)

---

## Payment and Payout Failure Modes (New to Iteration 06)

### Payment-Related Runbooks
- Webhook signature validation failure
- Duplicate payment webhook processing
- Payment intent orphaned (created but no webhook)
- Refund request from user
- Chargeback received from Stripe

### Payout-Related Runbooks (from Iteration 05)
- Stripe transfer failure (account suspended, invalid amount)
- Partial batch execution (some payouts succeed, others fail)
- Webhook delay (settlement complete but payout not triggered)
- Idempotency conflict (duplicate request with different amount)
- Stripe API outage
- Destination account invalid
- User deleted post-settlement

See iteration 03 (Payment Integration) for payment failure definitions.
See iteration 05 (Automatic Payout) for payout failure definitions.

---

## Program Completion

Once this iteration closes:
- **All iterations 01-06 are complete** (prerequisite for survivability claim)
  - Iteration 01: Masters Config-Driven Golf Engine ✓
  - Iteration 02: Ingestion Validation + Replay ✓
  - Iteration 03: Payment Integration + Ledger Governance ✓
  - Iteration 04: Contract Freeze ✓
  - Iteration 05: Automatic Payout Execution (must complete all three blockers)
  - Iteration 06: Operational Runbooks + Founder Absence Simulation (current)
- **30-Day Survivability is achieved** (once all iterations 01-06 are complete, and Founder Absence Simulation passes)
  - All automatic systems verified working without manual intervention
  - Founder Absence Simulation passed: 14-day staging simulation with zero engineering access
  - All failure modes have documented recovery procedures
  - Payout execution is automatic and idempotent
- **Governance is locked in place**
- **This program becomes the foundation for all future changes**

---

## Maintenance

After program completion:
- **Quarterly Review**: Review all runbooks against actual incidents
- **Annual Update**: Update based on new failure modes discovered
- **Postmortem Integration**: Update runbooks based on incident postmortems
- **Metric Review**: Adjust alerting thresholds based on production data
