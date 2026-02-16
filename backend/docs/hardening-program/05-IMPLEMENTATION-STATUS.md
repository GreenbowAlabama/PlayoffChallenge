# Iteration 05B - Automatic Payout Implementation Status

## Overview
Iteration 05B implements the core automatic payout service infrastructure. This document tracks what was implemented and what remains.

**Status**: PARTIAL IMPLEMENTATION
- ✅ Database schema deployed (migrations complete)
- ✅ Service layer implemented and tested
- ✅ Repository layer for data access
- ⏳ Destination account lookup (TODO - requires Stripe account setup)
- ⏳ Scheduler wiring to server (TODO - requires server integration)
- ⏳ End-to-end integration tests (TODO - requires full environment setup)

---

## What Was Implemented

### 1. Repositories (Complete)

**PayoutJobsRepository.js**
- `insertPayoutJob()` - Create new payout job
- `findBySettlementId()` - Idempotency check
- `findById()` - Fetch job by ID
- `findPendingOrProcessing()` - For scheduler queries
- `updateStatus()` - Transition job state
- `updateCounts()` - Mark job complete with counts

**PayoutTransfersRepository.js**
- `insertTransfers()` - Batch create transfers (idempotent via ON CONFLICT)
- `findByJobId()` - Fetch all transfers for job
- `findPendingByJobId()` - Query non-terminal transfers
- `claimForProcessing()` - Acquire row lock for execution
- `markProcessing()` - Increment attempt_count
- `markCompleted()` - Set stripe_transfer_id
- `markRetryable()` - Transition to retryable with error reason
- `markFailedTerminal()` - Mark as no-retry
- `countTerminalByJobId()` - Check if job is complete

### 2. Services (Complete)

**StripePayoutAdapter.js**
- `createTransfer()` - Call Stripe with idempotency key
- Error classification:
  - **Transient**: timeout, ECONNRESET, 429, 5xx
  - **Permanent**: 4xx validation, invalid account, permission errors
- Returns: `{ success, transferId }` or `{ success: false, classification, reason }`

**PayoutOrchestrationService.js**
- `schedulePayoutForSettlement()` - Idempotent job scheduling
- Validates settlement and winners
- Creates payout_job and expands transfers in atomic transaction
- Handles race conditions on settlement_id uniqueness

**PayoutExecutionService.js**
- `executeTransfer()` - Execute single transfer with full transaction
- Claim transfer (SELECT ... FOR UPDATE)
- Increment attempt_count exactly once
- Call Stripe adapter
- Classify error and transition state
- Insert ledger entry for all outcomes
- Uses deterministic idempotency key: `payout:<transfer_id>`

**PayoutJobService.js**
- `processJob()` - Process all pending/retryable transfers in a job
- Status transitions: pending → processing → complete
- Terminal state detection: mark complete when all transfers terminal
- Batch processing with configurable limits
- `processPendingJobs()` - Find and process all non-complete jobs

**adminJobs.service.js (Extended)**
- `runPayoutScheduler()` - Callable scheduler function
- Integration point for background job runner

### 3. Tests (Complete)

**payoutOrchestration.test.js**
- Settlement → payout_job idempotency
- Winner validation
- Input validation
- Deterministic idempotency keys

**stripePayoutAdapter.test.js**
- Successful transfer creation
- Idempotency key usage
- Transient error classification (timeout, 429, 5xx)
- Permanent error classification (4xx, invalid account)
- Error reason extraction

**payoutExecution.test.js**
- Transfer execution flow
- Claim and lock behavior
- Attempt count increment
- Successful completion with ledger entry
- Transient error handling (retryable)
- Permanent error handling (failed_terminal)
- Max attempts exhaustion
- Transaction rollback on error
- Deterministic idempotency key validation

**payoutJob.test.js**
- Job status transitions
- Batch transfer processing
- Mixed success/failure handling
- Batch size limits
- Job completion on all transfers terminal
- Error handling and aggregation
- Multiple job processing

---

## What Remains (TODO)

### 1. Destination Account Lookup
**File**: `services/PayoutExecutionService.js:200`

Current: Placeholder throws "Destination account lookup not yet implemented"

Required:
- Query `user_stripe_accounts` (or equivalent) table
- Get user's connected Stripe account ID for contest
- Return `acct_*` account ID for Stripe transfer

This blocks actual Stripe transfer execution but doesn't block testing infrastructure.

### 2. Scheduler Wiring
**File**: `server.js` (not yet modified)

Required:
- Fetch database pool
- Call `adminJobs.runPayoutScheduler(pool)` periodically
- Register job with `adminJobs.registerJob()`
- Update job status after each run with `adminJobs.updateJobStatus()`
- Recommended: Every 5 minutes (300 seconds)

Example:
```javascript
const adminJobs = require('./services/adminJobs.service');
const pool = require('./db/pool'); // or however pool is initialized

adminJobs.registerJob('payout-scheduler', { interval_ms: 300000 });

setInterval(async () => {
  adminJobs.markJobRunning('payout-scheduler');
  const result = await adminJobs.runPayoutScheduler(pool);
  adminJobs.updateJobStatus('payout-scheduler', { success: result.success });
}, 300000);
```

### 3. Integration Tests
**Files**: Not yet created

Required:
- End-to-end test with real database
- Settlement completion → automatic payout job creation
- Job processing with mocked Stripe
- Verify transfers, ledger entries, and state transitions
- Verify deterministic re-runs produce no duplicates

### 4. Documentation Updates

**Completed**:
- This implementation status file (05-IMPLEMENTATION-STATUS.md)

**Pending**:
- Update DECISION-LOG.md with implementation decisions
- Update LESSONS-LEARNED.md with learnings
- Add runbook for operational monitoring

---

## Architecture Decisions

### 1. Idempotency Strategy
- **Settlement → Job**: UNIQUE constraint on settlement_id prevents duplicate jobs
- **Job → Transfers**: ON CONFLICT (contest_id, user_id) prevents duplicate transfers
- **Transfer → Stripe**: Stripe idempotency key = `payout:<transfer_id>` (deterministic, not random)
- **Ledger entries**: `idempotency_key = ledger:payout:<transfer_id>:<attempt_number>`

### 2. Error Classification
- **Transient**: Automatic retry via `retryable` state; scheduler re-queues
- **Permanent**: Immediate `failed_terminal`; manual intervention required
- **Max attempts**: Automatic transition to `failed_terminal` when attempt_count ≥ max_attempts

### 3. Job Completion Logic
- Job is `complete` when ALL transfers are in terminal state (`completed` OR `failed_terminal`)
- No separate `failed` status at job level
- Mixed results (some succeeded, some failed) = job is still `complete`

### 4. Concurrency Model
- **Job-level**: UNIQUE settlement_id prevents duplicate job creation
- **Transfer-level**: SELECT ... FOR UPDATE SKIP LOCKED for safe concurrent processing
- **Idempotency**: Database constraints + Stripe idempotency key prevent duplicates

### 5. Transaction Boundaries
- Each transfer execution is atomic: claim + execute + ledger in single transaction
- Job creation + transfer expansion in single transaction
- Rollback on any error; no partial rows survive

---

## SQL Patterns Used

### Transfer Claim (SELECT ... FOR UPDATE)
```sql
SELECT id, ... FROM payout_transfers
WHERE id = $1
  AND status IN ('pending','retryable')
  AND stripe_transfer_id IS NULL
  AND attempt_count < max_attempts
FOR UPDATE;
```

### Idempotent Transfer Creation
```sql
INSERT INTO payout_transfers (...)
VALUES (...)
ON CONFLICT (contest_id, user_id) DO NOTHING
RETURNING ...;
```

### Terminal Count Check
```sql
SELECT
  SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
  SUM(CASE WHEN status = 'failed_terminal' THEN 1 ELSE 0 END) as failed,
  COUNT(*) as total
FROM payout_transfers
WHERE payout_job_id = $1;
```

### Ledger Idempotency
```sql
INSERT INTO ledger (..., idempotency_key, ...)
VALUES (...)
ON CONFLICT (idempotency_key) DO NOTHING;
```

---

## Environment Requirements

### Required
- PostgreSQL 12+ (for gen_random_uuid())
- Stripe API key (for testing, but service doesn't require it without destination account)
- Node.js 14+ (for async/await)

### Optional
- Redis (not used in this iteration; added for future scheduler scaling)

---

## Known Limitations

1. **Destination Account Lookup**: Currently placeholder; blocks actual Stripe calls
2. **Scheduler**: Not yet wired to server; manual testing only
3. **Concurrency**: Safe for multiple scheduler instances but not tested at scale
4. **Monitoring**: No metrics/instrumentation yet; job status only in admin registry
5. **Partial Payouts**: Not supported; all winners must be paid or none; no partial distributions

---

## Testing Checklist

- [x] Unit tests for repositories
- [x] Unit tests for services
- [x] Unit tests for error classification
- [x] Unit tests for idempotency
- [x] Unit tests for state transitions
- [x] Unit tests for transaction handling
- [ ] Integration tests with real database
- [ ] End-to-end tests with Stripe mock
- [ ] Concurrency tests (multiple scheduler instances)
- [ ] Performance tests (batch sizes, throughput)

---

## Next Steps

1. **Implement destination account lookup**
   - Requires coordination with Stripe account setup
   - May need new migration for user_stripe_accounts table

2. **Wire scheduler to server**
   - Add setInterval in server.js
   - Register with adminJobs
   - Log execution

3. **Create integration tests**
   - Test with real database
   - Mock Stripe API
   - Verify full flow

4. **Update documentation**
   - Add to DECISION-LOG.md
   - Add to LESSONS-LEARNED.md
   - Add operational runbook

5. **Deploy to staging**
   - Run migrations
   - Deploy service code
   - Enable scheduler
   - Monitor first executions

---

## Rollback Plan

If issues discovered:
1. Disable scheduler (comment out setInterval)
2. No data cleanup needed (append-only ledger)
3. Manually retry failed transfers once fixed
4. Re-run migrations if schema changes needed

---

## References

- Database schema: `migrations/20260216_05_automatic_payout.sql`
- API documentation: `docs/hardening-program/05-iteration-05-automatic-payout.md`
- DECISION-LOG.md: Implementation decisions
