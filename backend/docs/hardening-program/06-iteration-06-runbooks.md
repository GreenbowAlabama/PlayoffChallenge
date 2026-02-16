# Iteration 06 – Operational + Technical Runbooks + Founder Absence Simulation

## Objective

Establish step-by-step runbooks for every known failure mode and operational procedure.

Runbooks must:
- Be executable by ops without engineering knowledge
- Include exact commands, no "engineering will handle it"
- Cover all known failure modes from iterations 01-04
- Be tested in staging before production use
- Include alerting rules and detection procedures
- Enable 30-day autonomy without founder intervention

---

## Architectural Constraints

### Runbooks Are Not Code
- Runbooks are documentation; they are executable procedures
- No "ask engineering" steps; every step must be runnable by ops
- Commands are exact; no interpreting instructions
- Each runbook is tested and verified before production

### Runbooks Are Comprehensive
- Every failure mode has a runbook
- Every operational task (backup, restore, config change) has a runbook
- Every escalation path is documented
- Every procedure has success criteria and rollback steps

### Single Source of Truth
- Runbooks are stored in `/backend/docs/runbooks/`
- Each runbook is versioned and dated
- Runbooks are linked from monitoring dashboards
- Changes to runbooks are audited and approved

---

## SOLID Enforcement

### Explicit Procedures
- **Detection**: How to identify the failure (exact metric, log pattern, alert)
- **Diagnosis**: How to confirm the root cause (exact commands, not guesses)
- **Recovery**: Step-by-step procedure to restore service
- **Verification**: How to confirm the fix worked
- **Documentation**: What happened and why (for postmortem)

**Document these procedures** in `/backend/docs/runbooks/` with templates for each type

### No Hidden Knowledge
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

## Data Model Impact

### Schema Changes Required
- `runbook_executions` table: audit trail of every runbook execution
- No custom operational_alerts table; alerts integrate with managed monitoring provider
- No application schema changes; runbooks are documentation and procedures

### Critical Constraint
- Runbook execution is logged with timestamp, who ran it, which step, and result
- This creates an audit trail for all operational procedures
- Postmortems can review exactly what was done and when

### Monitoring and Alerting Infrastructure
- Alerts must integrate with managed monitoring provider (Railway, Datadog, PagerDuty, or equivalent)
- Do NOT create custom `operational_alerts` table; use hosted alerting from your infrastructure provider
- Alerting rules are configured via provider (not database); changes do not require migrations
- This respects the Infrastructure Tooling Constraints: no custom implementations of solved infrastructure problems

### Automatic Payout Runbooks Required
- Iteration 05 (Automatic Payout) must be complete before this iteration starts
- Runbooks now include payout failure modes (transfer failure, partial batch, Stripe outage, etc.)
- Founder Absence Simulation must test end-to-end payout execution without intervention

---

## Contract Impact

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

## Completion Criteria

✓ All known failure modes have runbooks
✓ All operational tasks have runbooks
✓ All escalation procedures are documented
✓ Every runbook step is executable without interpretation
✓ Every runbook is tested in staging
✓ All recovery procedures are verified to work
✓ All rollback procedures are tested
✓ Monitoring and alerting rules are in place
✓ Dashboards display critical operational metrics
✓ Audit trail captures all procedure executions
✓ Postmortem template is ready for use
✓ No "ask engineering" steps remain in runbooks
✓ **Founder Absence Simulation (14-day test in staging)**:
  - Disable all engineering access to production
  - Run ingestion automatically for 14 simulated days
  - Run settlement automatically for all contests
  - Trigger one payment failure and execute refund runbook end-to-end
  - All operations complete without engineering intervention
  - Runbooks cannot close without passing this mandatory test

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
- **All iterations 01-06 are complete**
  - Iteration 01: Masters Config-Driven Golf Engine
  - Iteration 02: Ingestion Validation + Replay
  - Iteration 03: Payment Integration + Ledger Governance
  - Iteration 04: Contract Freeze
  - Iteration 05: Automatic Payout Execution ✓
  - Iteration 06: Operational Runbooks + Founder Absence Simulation ✓
- **30-Day Survivability is achieved**
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
