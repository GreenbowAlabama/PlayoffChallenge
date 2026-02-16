# Iteration 05 – Automatic Payout Execution

## Objective

Move money to winners automatically and idempotently after settlement completes, with zero operator involvement.

Automatic payout is mandatory before 30-Day Survivability can be declared achieved.

**Success Criteria**:
- Settlement completion automatically triggers payout job
- All transfers execute via Stripe without manual action
- Idempotent retry logic prevents duplicate transfers
- Stripe transfer IDs persisted and auditable
- Ledger entries created for all payouts
- End-to-end staging test passes

---

## Architectural Constraints

### Payout Remains Independent From Contest
- Payout execution must not mutate contest state
- Payout failures do not lock, cancel, or affect contest lifecycle
- Contest → Payout is one-way dependency only
- Contest state machine remains independent

### Stripe Is Sole Payout Rail
- All payouts execute via `stripe.transfers.create()`
- No alternative payment processors
- Stripe account per environment (staging vs. production)
- Direct integration to connected Stripe accounts only

### Execution Must Be Fully Idempotent
- Same settlement → payout_job must produce same transfers
- Duplicate job execution produces no duplicate transfers
- Idempotency key persisted per transfer attempt
- Retry-safe on network failure, Stripe rate limits, timeout

### What This Iteration Does NOT Do
- Modify contest lifecycle states
- Require manual payout submission
- Support custom payout rules or manual amounts
- Implement partial payouts or conditional distribution
- Override settlement payout allocations

---

## SOLID Enforcement

### Single Responsibility Boundaries

**PayoutOrchestrationService**
- Responsibility: Orchestrate settlement completion → payout job creation
- Interface: `async schedulePayoutJob(settlementId, contestId)`
- Does NOT: Execute transfers, interact with Stripe, compute amounts
- Dependencies: SettlementRepository, PayoutJobRepository

**PayoutExecutionService**
- Responsibility: Execute individual payout transfers idempotently
- Interface: `async executePayout(payoutId, idempotencyKey)`
- Does NOT: Create payouts, compute amounts, manage job state
- Dependencies: PayoutsRepository, StripeClient, LedgerRepository

**PayoutJobService**
- Responsibility: Manage job lifecycle (pending → processing → complete/failed)
- Interface: `async processPendingPayoutJobs()`, `async markJobComplete(jobId)`
- Does NOT: Execute transfers, compute payouts
- Dependencies: PayoutJobRepository, PayoutExecutionService

**StripePayoutAdapter**
- Responsibility: Handle Stripe transfer API interaction with retry logic
- Interface: `async createTransfer(amount, destination, idempotencyKey)`
- Does NOT: Decide which users get paid, manage job state
- Dependencies: Stripe SDK only

### Explicit Interfaces (Service Contracts)

**PayoutOrchestrationService.schedulePayoutJob**
```javascript
async schedulePayoutJob(settlementId, contestId) {
  // Input: settlement_id (UUID), contest_id (UUID)
  // Output: { payout_job_id, created_at, status: 'pending' }
  // Side effects: INSERT payout_jobs row; no transfers
  // Idempotency: settlementId is unique; duplicate calls return existing job
}
```

**PayoutExecutionService.executePayout**
```javascript
async executePayout(payoutId, idempotencyKey) {
  // Input: payout_id (UUID), idempotencyKey (string)
  // Output: { stripe_transfer_id, status: 'completed' | 'failed' }
  // Side effects: Call Stripe; INSERT ledger entry; UPDATE payouts row
  // Idempotency: idempotencyKey deduplicates; same key returns cached transfer_id
}
```

**PayoutJobService.processPendingPayoutJobs**
```javascript
async processPendingPayoutJobs() {
  // Input: none
  // Output: { jobs_processed, transfers_created, failures }
  // Side effects: Process all pending jobs; create transfers; update job status
  // Idempotency: Job processing is idempotent; mid-batch failures don't duplicate
}
```

### Dependency Direction

```
SettlementComplete (event)
    ↓
PayoutOrchestrationService (schedule job)
    ↓
PayoutJobService (periodic job runner)
    ↓
PayoutExecutionService (execute transfers)
    ↓
StripePayoutAdapter (Stripe integration)
```

No circular dependencies. Direction is always downward.

### No Hidden Coupling

- PayoutExecutionService does not call PayoutJobService
- PayoutJobService does not import PayoutOrchestrationService
- Services use repositories for state, not direct service calls
- All dependencies are injected at construction

---

## Data Model Impact

### Schema Changes Required

**payouts Table**
```sql
CREATE TABLE payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id UUID NOT NULL REFERENCES contest_instances(id),
  user_id UUID NOT NULL REFERENCES users(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  rank INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  stripe_transfer_id TEXT,
  idempotency_key UUID NOT NULL UNIQUE,
  error_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  UNIQUE (contest_id, user_id)
);

CREATE INDEX payouts_contest_status_idx ON payouts(contest_id, status);
CREATE INDEX payouts_stripe_transfer_id_idx ON payouts(stripe_transfer_id);
```

**payout_jobs Table**
```sql
CREATE TABLE payout_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id UUID NOT NULL,
  contest_id UUID NOT NULL REFERENCES contest_instances(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'complete', 'failed')),
  payouts_total INTEGER NOT NULL,
  payouts_completed INTEGER NOT NULL DEFAULT 0,
  payouts_failed INTEGER NOT NULL DEFAULT 0,
  error_reason TEXT,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  UNIQUE (settlement_id)
);

CREATE INDEX payout_jobs_contest_status_idx ON payout_jobs(contest_id, status);
CREATE INDEX payout_jobs_created_at_idx ON payout_jobs(created_at);
```

### Critical Constraints

**Immutability**
- Once `stripe_transfer_id` is set, it cannot change
- `payouts.status` transitions are one-way: pending → processing → completed (or failed)
- Failed payouts can be retried only by creating new job; original row remains unchanged

**Uniqueness**
- One payout row per winner per contest: `UNIQUE(contest_id, user_id)`
- One idempotency key per payout attempt: `UNIQUE(idempotency_key)`
- Settlement ID maps to one payout job: `UNIQUE(settlement_id)`

**No Partial Payouts**
- All payouts for a settlement succeed or all fail together (job-level transaction)
- Individual transfer failures don't affect other payouts
- Failed payouts create ledger entries marking failure reason

---

## Contract Impact

### Breaking Changes
None. Payout execution is new; no existing contracts change.

### New Contracts

**Settlement Complete Event** (triggered from settlementStrategy.js)
```javascript
{
  event: 'settlement_complete',
  settlement_id: UUID,
  contest_id: UUID,
  winners: [
    { user_id: UUID, rank: 1, amount_cents: 5000 },
    { user_id: UUID, rank: 2, amount_cents: 3000 }
  ],
  total_payout_cents: 8000,
  timestamp: ISO8601
}
```

**Internal Payout Job Status** (admin diagnostics only)
```javascript
GET /admin/payout-jobs/:contestId
{
  job_id: UUID,
  settlement_id: UUID,
  status: 'pending' | 'processing' | 'complete' | 'failed',
  payouts_total: 2,
  payouts_completed: 2,
  payouts_failed: 0,
  created_at: ISO8601,
  completed_at: ISO8601,
  payouts: [
    {
      payout_id: UUID,
      user_id: UUID,
      amount_cents: 5000,
      status: 'completed',
      stripe_transfer_id: 'tr_1234',
      error_reason: null
    }
  ]
}
```

---

## Validation Rules

### Payout Creation Validation
- Settlement must be in COMPLETE state
- Winners list must match settlement output (rank + user_id + amount)
- Amount per winner must be > 0 cents
- User must exist in database
- Contest must exist and be COMPLETE

### Transfer Execution Validation
- Stripe account must be connected for contest's destination
- Destination account must be valid (connected Stripe account)
- Amount must be in valid range for Stripe (1 cent to max currency limit)
- Idempotency key must be UUID format
- Transfer cannot be retried if already completed

### Job-Level Validation
- Settlement → payout job mapping is 1:1
- All payouts in job must be for same contest
- Job processing is atomic at transaction level

### Silent Failures Not Allowed
- Transfer failure includes explicit error reason
- Failed job logged with full Stripe error response
- Ledger entries created for all failures (status='failed')
- No silent skipping of failed payouts

---

## Determinism Guarantees

### Is Output Reproducible?
**Answer**: Yes. Given identical settlement output + contest configuration, payout amounts are deterministic. Transfers themselves are idempotent; same idempotency key always produces same Stripe transfer ID.

### Settlement Replay Safety
**Answer**: Yes, with caveats:
- Re-running settlement does not create new payouts (settlement → job is 1:1)
- Re-executing payout job is safe (idempotency keys prevent duplicates)
- If payout job already completed, re-running it is no-op
- Stripe transfer IDs are deterministic per idempotency key

### External State Dependencies
**Answer**: Stripe transfer success depends on:
- Connected Stripe account validity (can fail if account suspended)
- Destination account validity (can fail if recipient removed from platform)
- Stripe API availability (can fail on Stripe outage)

These are acceptable external dependencies. Failure modes are documented and recoverable.

---

## Idempotency and Side-Effect Review

### Does this iteration introduce state mutation?
**Answer**: Yes.
- **Payouts table**: Insert rows for each winner with `status='pending'`
- **Payout jobs table**: Insert job row with `status='pending'`
- **Ledger entries**: Insert rows recording successful/failed transfers
- **Payouts table**: Update `status`, `stripe_transfer_id`, `completed_at`

### Are idempotency keys required?
**Answer**: Yes. Critical for Stripe transfer deduplication.
- **Idempotency key generation**: `UUID.v4()` per payout attempt
- **Idempotency key persistence**: Stored in `payouts.idempotency_key`
- **Duplicate detection**: Check if idempotency_key already exists before calling Stripe
- **Cached result return**: Same key returns previously-created transfer_id without new Stripe call

### Are retries bounded and explicit?
**Answer**: Yes.
- **Retry trigger**: Job status = 'failed'; operator explicitly creates new payout_jobs row
- **Retry count**: No automatic retries within single job. Failed job must be manually resubmitted.
- **Bounded execution**: Each job processes all payouts once; no infinite loops
- **Errors not retried**: Validation errors (user not found) not retried; require manual investigation

### Are external calls timeout-controlled?
**Answer**: Yes.
- **Stripe timeout**: 30 seconds (configurable)
- **On timeout**: Transfer marked as 'failed' with `error_reason='stripe_timeout'`
- **Retry logic**: Operator can resubmit job; idempotency key prevents duplicate transfer

### Are all side effects isolated from pure computation?
**Answer**: Yes.
- **Pure computation**: Settlement strategy computes payout amounts only (no Stripe, no DB writes)
- **Orchestration layer**: PayoutOrchestrationService triggers payout creation on settlement complete (side effect)
- **Execution layer**: PayoutExecutionService calls Stripe and writes ledger (side effect)
- **Separation**: Computing payouts (pure) is separate from creating payouts (side effect) is separate from executing transfers (side effect)

---

## Failure Modes

### Transfer Failure (Stripe Error)
**Description**: Stripe API rejects transfer request (account suspended, invalid amount, rate limit).

**Detection**: `stripe.transfers.create()` throws error; transfer marked 'failed'; error logged.

**Recovery**: Review Stripe error reason. If recoverable (rate limit), wait and retry job. If not (account suspended), escalate to ops.

**Verification**: Check `payout_jobs.error_reason` and `payouts.error_reason` in database. Ledger shows 'failed' status.

### Partial Batch Execution
**Description**: Job processes some payouts successfully, then fails mid-batch.

**Detection**: `payout_jobs.payouts_completed < payouts_total`; job status = 'failed'.

**Recovery**: Investigate failure reason. If transient (timeout), resubmit entire job; idempotency keys prevent re-charging successful payouts. If permanent, manual investigation required.

**Verification**: Compare `payout_jobs.payouts_completed` to expected count. Check ledger for all attempted transfers.

### Webhook Delay
**Description**: Settlement completes but payout job not triggered immediately (async event lag).

**Detection**: Monitor settlement_complete event processing lag. Alert if > 60 seconds.

**Recovery**: Payout scheduler runs periodically (every 5 minutes). Delayed jobs will be processed on next scheduler run.

**Verification**: Check `payout_jobs.created_at` timestamp. Should be within 5 minutes of settlement completion.

### Idempotency Conflict
**Description**: Two requests attempt to create transfer with same idempotency key but different amounts.

**Detection**: Stripe API validation error; second request rejected.

**Recovery**: Stripe prevents this. If it happens, data consistency issue. Escalate to engineering.

**Verification**: Check `payouts.idempotency_key` uniqueness. Verify only one transfer per key.

### Stripe API Outage
**Description**: Stripe API completely unavailable; all transfer attempts fail.

**Detection**: `stripe.transfers.create()` consistently fails with connection error. Payout job marked 'failed'.

**Recovery**: Wait for Stripe API recovery. Resubmit payout job when Stripe is healthy. Idempotency keys ensure no duplicates.

**Verification**: Confirm Stripe status page shows recovery. Retry payout job; verify transfers complete.

### Destination Account Invalid
**Description**: Recipient's Stripe account no longer connected or suspended.

**Detection**: Stripe error: "Invalid recipient account" or "Account suspended".

**Recovery**: Operator must contact recipient, verify account status, update connection if needed. Retry payout.

**Verification**: Check Stripe dashboard for account status. Confirm account connection restored before retry.

### User Not Found During Payout Creation
**Description**: Settlement claims winner (user_id), but user record was deleted.

**Detection**: Foreign key constraint violation during payout creation.

**Recovery**: Investigate why user was deleted post-settlement. This should not happen. Escalate.

**Verification**: Query users table for user_id. Verify audit trail shows deletion.

---

## Unit Test Requirements

### Idempotency Tests

**Test: Duplicate execution with same idempotency key returns same transfer**
- Input: Execute same payout twice with identical idempotency key
- Expected: First call creates transfer; second call returns cached transfer ID without Stripe call
- Verification: Verify only one Stripe call; both returns are identical

**Test: Different idempotency key creates new transfer**
- Input: Execute payout twice with different idempotency keys
- Expected: Both calls create distinct transfers
- Verification: Verify two distinct transfer IDs

**Test: Duplicate job execution is safe**
- Input: Trigger same payout_job_id twice
- Expected: Second execution is no-op (job already completed); no duplicate transfers
- Verification: Verify transfer count unchanged; ledger unchanged

### Failure Recovery Tests

**Test: Mid-batch failure recovery**
- Input: Job with 3 payouts; 2nd payout fails
- Expected: 1st succeeds, 2nd fails, 3rd succeeds (continues despite failure)
- Verification: payouts_completed=2, payouts_failed=1; ledger shows all three attempts

**Test: Retry after transient failure**
- Input: Job fails with timeout; resubmit same job
- Expected: Retried payouts skip already-completed ones; retry only failed ones
- Verification: Only failed payout retried; ledger shows retry attempt

**Test: Permanent failure (invalid account)**
- Input: Job with payout to invalid Stripe account
- Expected: Transfer fails; error reason logged; job marked failed
- Verification: payouts.error_reason='Account invalid'; ledger entry shows failure

### Validation Tests

**Test: Reject payout if settlement not complete**
- Input: Attempt to create payout_job for settlement in LIVE state
- Expected: Validation error; no job created
- Verification: payout_jobs table unchanged

**Test: Enforce unique constraint (one payout per user per contest)**
- Input: Attempt to create second payout for same user + contest
- Expected: Unique constraint violation; second payout rejected
- Verification: Only one payout row exists

**Test: Validate amount > 0**
- Input: Attempt to create payout with 0 cents
- Expected: Validation error; payout rejected
- Verification: payouts table unchanged

### Ledger Audit Tests

**Test: Ledger entry created for successful transfer**
- Input: Successful payout execution
- Expected: Ledger row with type='payout_success', status='completed'
- Verification: Query ledger; find matching entry

**Test: Ledger entry created for failed transfer**
- Input: Failed payout execution
- Expected: Ledger row with type='payout_failure', error_reason set
- Verification: Query ledger; find matching entry with failure details

**Test: Ledger is append-only**
- Input: Update payout status after ledger entry created
- Expected: New ledger entries created; old entries never modified
- Verification: Query ledger audit trail; no edits in history

### Stripe Integration Tests

**Test: Stripe transfer created with correct destination**
- Input: Payout for user with stripe_account_id set
- Expected: `stripe.transfers.create()` called with correct destination
- Verification: Mock Stripe; verify call parameters

**Test: Idempotency key sent to Stripe**
- Input: Payout with idempotency_key
- Expected: `stripe.transfers.create()` called with header `Idempotency-Key`
- Verification: Mock Stripe; verify header present

**Test: Timeout handled gracefully**
- Input: Stripe timeout during transfer
- Expected: Error caught; payout marked failed; ledger entry created
- Verification: payouts.status='failed', error_reason='stripe_timeout'

---

## Completion Criteria

✓ **PayoutOrchestrationService** implemented and tested
  - Creates payout_jobs on settlement complete
  - Handles settlement → payout mapping (1:1)

✓ **PayoutExecutionService** implemented and tested
  - Executes transfers idempotently
  - Persists idempotency keys
  - Creates ledger entries

✓ **PayoutJobService** implemented and tested
  - Processes pending jobs
  - Marks jobs complete/failed
  - Handles mid-batch failures

✓ **StripePayoutAdapter** implemented and tested
  - Calls `stripe.transfers.create()` with idempotency key
  - Handles Stripe errors gracefully
  - Respects timeouts

✓ **Database schema updated**
  - `payouts` table created with proper constraints
  - `payout_jobs` table created with proper constraints
  - Indexes created for query performance
  - Foreign keys enforce referential integrity

✓ **Scheduled job registered in server.js**
  - Payout scheduler runs every 5 minutes
  - Job status visible in `/admin/jobs` diagnostics
  - Job execution logged and auditable

✓ **All unit tests pass**
  - Idempotency tests verify no duplicate transfers
  - Failure mode tests cover all documented failures
  - Ledger audit tests verify append-only compliance
  - Stripe integration tests verify correct API calls

✓ **Settlement integration complete**
  - Settlement completion event triggers payout job creation
  - Payout job created with all winners from settlement
  - Amounts match settlement output

✓ **Automatic payout verified in staging**
  - End-to-end test: settlement → payout job → transfers complete
  - Idempotent retry verified: re-running payout job creates no duplicate transfers
  - Stripe transfer IDs persisted and auditable
  - Ledger entries created for all payouts (success + failure)

✓ **Schema snapshot updated and committed**

✓ **Documentation complete**
  - CLAUDE.md files updated for payout services
  - Service contracts documented
  - Failure modes documented
  - Recovery procedures documented

---

## Lessons Learned

*To be completed upon iteration closure*

### What Worked
(Document successes)

### What Was Harder Than Expected
(Document surprises)

### Assumptions We Purged
(Document implicit behaviors we discovered and removed)

### Failures Discovered During Testing
(Document any failure modes found that weren't anticipated)

### Idempotency Challenges
(Document any idempotency edge cases encountered)

---

## Program Completion

Once this iteration closes:
- **30-Day Survivability is now achievable**
  - Automatic payout is complete
  - Manual operator payout execution is no longer required
  - Contest lifecycle is fully autonomous: creation → scoring → settlement → payout
- **Iteration 06 (Operational Runbooks) can proceed**
  - Runbooks now document payout failure recovery
  - Founder Absence Simulation can verify end-to-end autonomy including payout
- **Next work**: Iteration 06 (runbooks + founder absence simulation)

---

## Maintenance

After iteration closure:

- **Monitor transfer success rate**: Alert if > 5% failures
- **Review Stripe error logs**: Identify patterns in failures
- **Audit ledger quarterly**: Verify no missing payouts
- **Update payout runbooks**: Based on discovered failure modes
