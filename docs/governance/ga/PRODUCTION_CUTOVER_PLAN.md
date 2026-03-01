# Production Cutover Plan

**System:** Playoff Challenge — Fantasy Sports Platform
**Cutover Owner:** Ian Carter
**Cutover Date:** TBD (pending GA readiness approval)
**Expected Duration:** 6 hours (Phases 0-4), plus 48-hour monitoring window
**Rollback Owner:** Ian Carter
**Communication Channel:** Ops Slack #playoff-challenge-ga

---

## Phase 0: Release Freeze

**Duration:** 30 minutes before Phase 1 start
**Owner:** Ian Carter

### Step 0.1: Code Freeze

- [ ] Merge all pending PRs (if any) to main branch
- [ ] Tag release commit: `ga-launch-YYYY-MM-DD`
- [ ] Verify no uncommitted changes in production deployments
- [ ] Confirm backend and iOS versions match expected GA release

**Command:**
```bash
git log -1 --oneline
git show-ref --tags | grep ga-launch
```

### Step 0.2: Notification to Stakeholders

- [ ] Notify ops team via Slack: "GA Cutover starting in 30 minutes"
- [ ] Notify monitoring team: "Escalation procedures active"
- [ ] Notify customer support: "New production system launching"
- [ ] Confirm all team members available during cutover window

### Step 0.3: Backup All Production Data

- [ ] Trigger full database backup (Railway)
- [ ] Verify backup completion and integrity
- [ ] Export backup to external storage (if required by ops)
- [ ] Document backup location and restore procedure

**Command:**
```bash
# Railway backup
railway backup:create --project <project-id>
railway backup:list --project <project-id>
```

### Step 0.4: Pre-Cutover Health Check

```bash
# 1. Backend health check
curl -X GET https://api.playoffchallenge.com/health
# Expected: 200 OK

# 2. Database connectivity
psql $DATABASE_URL -c "SELECT NOW();"
# Expected: Current timestamp

# 3. Stripe API connectivity
curl -X GET https://api.stripe.com/v1/account \
  -u sk_live_...:
# Expected: 200 OK, account details

# 4. Monitoring dashboards accessible
# Verify: Stripe dashboard, Railway logs, Database metrics

# 5. Webhook endpoint responding
curl -X GET https://api.playoffchallenge.com/health
# Expected: 200 OK
```

**STOP if any health check fails. DO NOT proceed to Phase 1.**

---

## Phase 1: Backend Confirmation

**Duration:** 45 minutes
**Owner:** Ian Carter

### Step 1.1: Verify Backend Deployment

- [ ] Confirm backend version: `git rev-parse --short HEAD` matches ga-launch tag
- [ ] Confirm NODE_ENV=production
- [ ] Confirm DATABASE_URL points to production database
- [ ] Confirm STRIPE_SECRET_KEY set to sk_live_... (not sk_test_...)
- [ ] Confirm STRIPE_WEBHOOK_SECRET set to whsec_live_... (not whsec_test_...)
- [ ] Confirm ENABLE_LIFECYCLE_RECONCILER=true (background poller enabled)

**Command:**
```bash
# SSH to Railway production
railway shell

# Verify environment
echo "NODE_ENV: $NODE_ENV"
echo "DATABASE_URL: ${DATABASE_URL:0:30}..." (redacted)
echo "STRIPE_SECRET_KEY: ${STRIPE_SECRET_KEY:0:10}..." (redacted)
```

### Step 1.2: Verify Database Schema

- [ ] Confirm schema.snapshot.sql applied (all migrations current)
- [ ] Verify all tables exist: contest_instances, contest_participants, wallets, ledger, settlement_records
- [ ] Verify all triggers active: prevent_contest_state_transitions_mutation, api_contract_snapshots_no_update_delete
- [ ] Verify unique constraints: (user_id, contest_instance_id) on contest_participants

**Command:**
```bash
psql $DATABASE_URL <<EOF
-- Check migrations applied
SELECT COUNT(*) FROM migrations;

-- Check tables exist
SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';

-- Check triggers
SELECT trigger_name FROM information_schema.triggers WHERE trigger_schema='public';

-- Check unique constraint
SELECT constraint_name FROM information_schema.table_constraints
  WHERE table_name='contest_participants' AND constraint_type='UNIQUE';
EOF
```

### Step 1.3: Verify Stripe Configuration

- [ ] Confirm Stripe account in LIVE mode (not TEST mode)
- [ ] Confirm webhook endpoint registered: POST /api/webhooks/stripe
- [ ] Confirm webhook events subscribed: charge.succeeded, charge.failed, charge.refunded
- [ ] Test webhook signature verification (resend test event, verify processing)
- [ ] Confirm Stripe API version locked (check dashboard → API reference)

**Command (Stripe Dashboard):**
1. Navigate to Developers → API Keys
2. Verify Secret Key starts with sk_live_
3. Navigate to Webhooks
4. Verify endpoint: https://api.playoffchallenge.com/api/webhooks/stripe
5. Verify subscribed events

**Command (Test Webhook):**
```bash
# In Stripe Dashboard: Webhooks → Sent events → Select recent event → Resend

# Verify in logs:
# Expected: Webhook processed successfully
```

### Step 1.4: Verify Lifecycle Reconciler

- [ ] Confirm reconciler enabled: ENABLE_LIFECYCLE_RECONCILER=true
- [ ] Confirm reconciliation interval: 30 seconds (or configured value)
- [ ] Monitor logs for reconciliation runs: "Reconciling contest lifecycle..."
- [ ] Verify no errors in reconciliation logs

**Command:**
```bash
# Check recent logs
railway logs --follow | grep -i "reconcil"

# Expected: Reconciliation logs appearing every 30 seconds
```

### Step 1.5: Test API Endpoints (Smoke Test)

```bash
# GET /api/custom-contests (list contests)
curl -X GET https://api.playoffchallenge.com/api/custom-contests \
  -H "Authorization: Bearer <TEST_JWT>"
# Expected: 200 OK, contests array (may be empty)

# GET /health
curl -X GET https://api.playoffchallenge.com/health
# Expected: 200 OK

# GET /openapi.yaml
curl -X GET https://api.playoffchallenge.com/openapi.yaml
# Expected: 200 OK, OpenAPI spec
```

**STOP if any endpoint fails. DO NOT proceed to Phase 2.**

---

## Phase 2: iOS Release Build

**Duration:** 30 minutes
**Owner:** Ian Carter (or iOS Lead)

### Step 2.1: Verify iOS Build Configuration

- [ ] Confirm AppEnvironment.baseURL = https://api.playoffchallenge.com (production)
- [ ] Confirm no hardcoded test or staging URLs
- [ ] Confirm iOS deployment target: 14.0 or higher
- [ ] Confirm bundle identifier: com.playoffchallenge.ios

**File:** ios-app/PlayoffChallenge/Core/Network/AppEnvironment.swift
```swift
static var shared: AppEnvironment {
  #if DEBUG
    return AppEnvironment(baseURL: URL(string: "http://localhost:3000")!)
  #else
    return AppEnvironment(baseURL: URL(string: "https://api.playoffchallenge.com")!)
  #endif
}
```

### Step 2.2: Build Release Archive

```bash
cd ios-app/PlayoffChallenge

# Clean build
xcodebuild clean

# Build archive for App Store distribution
xcodebuild archive \
  -scheme PlayoffChallenge \
  -configuration Release \
  -archivePath build/PlayoffChallenge.xcarchive

# Verify archive created
ls -lh build/PlayoffChallenge.xcarchive
```

**Expected:** Archive file created without errors

### Step 2.3: Export IPA for TestFlight

```bash
# Export provisioning
xcodebuild -exportArchive \
  -archivePath build/PlayoffChallenge.xcarchive \
  -exportOptionsPlist ExportOptions.plist \
  -exportPath build/

# Verify IPA created
ls -lh build/*.ipa
```

### Step 2.4: Upload to TestFlight (Internal Testing)

- [ ] Log in to App Store Connect
- [ ] Navigate to TestFlight → Internal Testing
- [ ] Upload IPA from Phase 2.3
- [ ] Wait for App Store processing (5-10 minutes)
- [ ] Verify build status: Ready to Test

**Do NOT distribute to external testers yet.**

### Step 2.5: Internal QA Verification

- [ ] Install build from TestFlight on test device
- [ ] Verify app connects to production API (https://api.playoffchallenge.com)
- [ ] Test login flow
- [ ] Test contest listing
- [ ] Verify no hardcoded test data
- [ ] Verify error messages display correctly

**STOP if any QA test fails. DO NOT proceed to Phase 3.**

---

## Phase 3: Smoke Test (Production System)

**Duration:** 45 minutes
**Owner:** Ian Carter

### Step 3.1: Create Smoke Test Contest

```bash
# Create test contest as organizer
TEST_CONTEST=$(curl -X POST https://api.playoffchallenge.com/api/custom-contests \
  -H "Authorization: Bearer <TEST_ORGANIZER_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "contest_name": "Smoke Test Contest",
    "entry_fee_cents": 1000,
    "max_entries": 10,
    "lock_time": "'$(date -u -d '+2 hours' +'%Y-%m-%dT%H:%M:%SZ')'",
    "tournament_start_time": "'$(date -u -d '+3 hours' +'%Y-%m-%dT%H:%M:%SZ')'",
    "tournament_end_time": "'$(date -u -d '+4 hours' +'%Y-%m-%dT%H:%M:%SZ')'",
    "type": "PGA",
    "payout_structure": {}
  }' | jq -r '.id')

echo "Smoke test contest: $TEST_CONTEST"
```

### Step 3.2: Test Contest Join Flow

```bash
# Get test contest detail
curl -X GET https://api.playoffchallenge.com/api/custom-contests/$TEST_CONTEST \
  -H "Authorization: Bearer <TEST_USER_JWT>" | jq '.status, .actions.can_join'
# Expected: "SCHEDULED", true

# Join contest
IDEMPOTENCY_KEY="smoke-test-join-$(date +%s)"

curl -X POST https://api.playoffchallenge.com/api/custom-contests/$TEST_CONTEST/join \
  -H "Authorization: Bearer <TEST_USER_JWT>" \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
# Expected: 200 OK, user_has_entered: true
```

### Step 3.3: Verify Wallet Deduction

```bash
# Check wallet balance
curl -X GET https://api.playoffchallenge.com/api/wallets/me \
  -H "Authorization: Bearer <TEST_USER_JWT>" | jq '.balance'
# Expected: reduced by entry fee amount
```

### Step 3.4: Verify Leaderboard Endpoint

```bash
# Get leaderboard (only available if contest is LIVE or COMPLETE)
curl -X GET https://api.playoffchallenge.com/api/custom-contests/$TEST_CONTEST/leaderboard \
  -H "Authorization: Bearer <TEST_USER_JWT>" | jq '.status'
# Expected: 200 OK (or 422 if not yet LIVE/COMPLETE)
```

### Step 3.5: Monitor for Errors

```bash
# Check backend logs for errors
railway logs --follow | grep -i "error\|exception"

# Expected: No errors in smoke test operations
```

**STOP if any smoke test fails. Debug and fix before Phase 4.**

---

## Phase 4: Public Activation

**Duration:** 30 minutes
**Owner:** Ian Carter

### Step 4.1: Update iOS App Store Configuration

- [ ] In App Store Connect: Update external description to reflect GA launch
- [ ] Update app keywords if applicable
- [ ] Confirm pricing tier set correctly (TBD)
- [ ] Confirm app ratings and content rating set

### Step 4.2: Submit iOS App for Review (External Release)

- [ ] Navigate to App Store Connect → TestFlight → External Testing
- [ ] Create new group for external testing (or skip if direct App Store release)
- [ ] Add external testers (if needed for soft launch)
- [ ] Submit for review (if external release)

**OR if Direct App Store Release:**

- [ ] Navigate to App Store Connect → iOS App
- [ ] Verify release notes
- [ ] Submit version for App Store review
- [ ] Expected review time: 24-48 hours

### Step 4.3: Prepare Public API Documentation

- [ ] Verify OpenAPI spec available: https://api.playoffchallenge.com/openapi.yaml
- [ ] Publish API documentation (if available)
- [ ] Confirm all endpoint descriptions match behavior

### Step 4.4: Enable Public Contest Creation

**Current state:** Only organizers with tokens can create contests.

- [ ] Verify contest creation endpoint is functional
- [ ] Confirm any throttling or rate limits in place
- [ ] Test contest creation as new user

### Step 4.5: Publish Release Notes

- [ ] Publish blog post or release notes
- [ ] Announce GA launch on social channels (if applicable)
- [ ] Send email to waitlist users (if applicable)
- [ ] Update website to reflect GA status

### Step 4.6: Go-Live Confirmation

- [ ] Verify iOS app live on App Store (visible to public)
- [ ] Verify backend API receiving live traffic
- [ ] Confirm all monitoring dashboards showing live data

---

## Phase 5: 48-Hour Monitoring Window

**Duration:** 48 hours after Phase 4 completion
**Owner:** Ian Carter (with ops team)

### Continuous Monitoring

Monitor the following every 15 minutes for 48 hours:

#### Backend Health

```bash
# API health check
curl -X GET https://api.playoffchallenge.com/health

# Expected: 200 OK consistently
# Alert if: 5xx errors, timeouts, unavailable
```

#### Database State

```bash
# Monitor key metrics
psql $DATABASE_URL <<EOF
-- Contest count
SELECT COUNT(*) as contest_count FROM contest_instances WHERE created_at >= NOW() - INTERVAL '48 hours';

-- Participant count
SELECT COUNT(*) as participant_count FROM contest_participants WHERE created_at >= NOW() - INTERVAL '48 hours';

-- Wallet balance integrity
SELECT MIN(balance) as min_balance, MAX(balance) as max_balance FROM wallets;
-- Expected: min_balance >= 0, max_balance > 0

-- Negative balance check (ALERT if any)
SELECT COUNT(*) FROM wallets WHERE balance < 0;
-- Expected: 0
EOF
```

#### Stripe Integration

```bash
# Monitor Stripe charges
# In Stripe Dashboard:
# 1. Navigate to Payments → Charges
# 2. Filter by created in past 48 hours
# 3. Monitor for failed charges or refunds
# 4. Check error rate

# Expected: <5% failure rate for valid charges
```

#### Wallet Ledger Integrity

```bash
psql $DATABASE_URL <<EOF
-- Check for ledger inconsistencies
SELECT wallet_id,
       (SELECT SUM(CASE WHEN operation_type IN ('DEPOSIT', 'PAYOUT') THEN amount_cents ELSE -amount_cents END)
        FROM ledger l2 WHERE l2.wallet_id = l1.wallet_id) as ledger_sum,
       (SELECT balance FROM wallets WHERE id = l1.wallet_id) as wallet_balance
FROM ledger l1
GROUP BY wallet_id
HAVING (SELECT SUM(CASE WHEN operation_type IN ('DEPOSIT', 'PAYOUT') THEN amount_cents ELSE -amount_cents END)
        FROM ledger l2 WHERE l2.wallet_id = l1.wallet_id)
       != (SELECT balance FROM wallets WHERE id = l1.wallet_id);
-- Expected: Empty result set (all balances reconcile)
EOF
```

#### Settlement Operations

```bash
# Monitor settlement queue
psql $DATABASE_URL <<EOF
SELECT COUNT(*) as pending_settlements FROM contest_instances WHERE status = 'LIVE' AND tournament_end_time < NOW();

-- If pending > 0, settlement may be lagging
-- Expected: 0 (all completed contests settled)
EOF
```

#### Error Rate Monitoring

```bash
# Check application error rate
railway logs --filter="error" | wc -l

# Expected: < 10 errors per hour under normal load
```

#### Customer Support Alerts

- [ ] Monitor support channel for user-reported issues
- [ ] Escalate any financial issues immediately
- [ ] Log all user-reported bugs for post-GA review

### Critical Alerts (Immediate Escalation)

**ALERT IMMEDIATELY IF:**

1. **Negative wallet balance detected**
   - Action: Identify affected users, manually correct balances
   - Rollback decision: Possible data recovery required

2. **Stripe webhook delivery failure (consecutive 5+ events)**
   - Action: Check webhook endpoint health, Stripe dashboard status
   - Escalation: Retry webhook manually if safe

3. **Settlement stuck (contests LIVE past tournament_end_time + 30 min)**
   - Action: Check reconciler logs, trigger manual settlement
   - Escalation: Investigate settlement failure root cause

4. **Database connection pool exhausted**
   - Action: Increase pool size (if ops allows), restart backend
   - Escalation: Implement query optimization to reduce connections

5. **API response time > 5 seconds (p95)**
   - Action: Check database load, query performance
   - Escalation: Identify slow queries, optimize if possible

6. **Unplanned app crashes reported by users (>5 reports)**
   - Action: Collect crash logs, identify common pattern
   - Escalation: Determine if backend or iOS issue

### Daily Check-ins (During 48-hour window)

- [ ] Day 1 (End of Day 1): Review logs, monitor dashboards, confirm no issues
- [ ] Day 2 (End of Day 2): Final review, confirm system stable

### Post-48-Hour Assessment

- [ ] Compile summary of issues encountered (if any)
- [ ] Document any manual interventions taken
- [ ] Review all alerts and false positives
- [ ] Confirm system ready for ongoing operations

---

## Emergency Rollback Plan

**Invoke if:** Critical data loss, widespread financial issues, or system unavailability occurs.

**Rollback Owner:** Ian Carter

### Rollback Decision Criteria

**ROLLBACK IMMEDIATELY IF:**

- Negative wallet balance > 5 users affected
- Settlement math incorrect (verified by audit)
- Stripe charges not matching ledger entries (>10 discrepancies)
- System unavailability > 30 minutes
- Data corruption detected in contest or wallet tables

### Rollback Steps

#### Step 1: Disable Public Access (Kill Switch)

```bash
# Disable iOS app access (backend kill switch)
# Add environment variable: KILLSWITCH_JOIN_ENDPOINT=true
# This will return 503 Service Unavailable on all join attempts

railway set KILLSWITCH_JOIN_ENDPOINT=true

# Expected: All join requests fail with 503
curl -X POST https://api.playoffchallenge.com/api/custom-contests/:id/join
# Expected: 503 Service Unavailable
```

#### Step 2: Notify Users

- [ ] Post-service status page: "System temporarily unavailable for maintenance"
- [ ] Notify iOS users (push notification if available)
- [ ] Post on social channels: "We're investigating an issue"

#### Step 3: Restore Database from Backup

```bash
# Determine last known good backup
railway backup:list --project <project-id>

# Restore from backup (Railway process)
railway backup:restore --backup-id <backup-id>

# Verify database restored
psql $DATABASE_URL -c "SELECT COUNT(*) FROM contest_instances;"
```

#### Step 4: Revert Code Changes (If Necessary)

```bash
# If backend bug caused issue:
git revert <ga-launch-commit-hash>
git push origin main

# Redeploy from main
railway deploy --source main
```

#### Step 5: Verify Database Integrity Post-Restore

```bash
psql $DATABASE_URL <<EOF
-- Check for negative balances
SELECT COUNT(*) FROM wallets WHERE balance < 0;

-- Verify foreign key integrity
SELECT COUNT(*) FROM contest_participants WHERE user_id NOT IN (SELECT id FROM users);

-- Verify settlement records
SELECT COUNT(*) FROM settlement_records WHERE contest_instance_id NOT IN (SELECT id FROM contest_instances);

-- If any of the above return non-zero, data corruption detected
EOF
```

#### Step 6: Resume Operations (Or Stay Down)

**If data integrity verified:**

- [ ] Remove KILLSWITCH_JOIN_ENDPOINT
- [ ] Notify users: "System restored, normal operation resumed"
- [ ] Monitor closely for 24 hours

**If data corruption detected:**

- [ ] Escalate to database administrator
- [ ] Consider restoring earlier backup
- [ ] Prepare for manual data recovery

#### Step 7: Post-Mortem

- [ ] Document root cause of failure
- [ ] Identify what monitoring/alerts would have caught this
- [ ] Create action items to prevent recurrence
- [ ] Schedule post-mortem meeting with team

---

## Cutover Sign-Off

### Pre-Cutover Approval

- [ ] Infrastructure lead: _________________________ (Signature/Date)
- [ ] Backend lead: _________________________ (Signature/Date)
- [ ] iOS lead: _________________________ (Signature/Date)
- [ ] Product lead: _________________________ (Signature/Date)
- [ ] Finance: _________________________ (Signature/Date)

### Cutover Completion

**Cutover Owner (Ian Carter):**

**Cutover Start Time:** ________________

**Phase 1 Complete:** ________________

**Phase 2 Complete:** ________________

**Phase 3 Complete:** ________________

**Phase 4 Complete:** ________________

**Cutover End Time:** ________________

**Overall Status:** SUCCESS / PARTIAL / FAILED

### 48-Hour Monitoring Completion

**Day 1 Status:** _________________________ (GOOD / ISSUES)

**Day 2 Status:** _________________________ (GOOD / ISSUES)

**Issues Encountered:** _________________________________________________________________

**Manual Interventions:** _________________________________________________________________

**Final Assessment:** SYSTEM STABLE FOR PRODUCTION / NEEDS FURTHER WORK

**Signed:** _________________________ (Ian Carter)

**Date:** _________________

