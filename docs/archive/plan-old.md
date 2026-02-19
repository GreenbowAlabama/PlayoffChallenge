GAP-13: Admin Operations for Contest Infrastructure v1 - Service Layer Plan (REVISED)

 Context

 This plan implements five admin service operations to complete GAP-13, respecting the actor
 model and truth table behavior for settlement transitions.

 Why this change is needed:
 The platform currently has incomplete admin operations that don't fully conform to the
 Contest Lifecycle Contract v1. This creates operational gaps where admins cannot properly
 manage contests through their full lifecycle, especially error recovery scenarios.

 Actor Model (Must Be Preserved):
 - SYSTEM: Automated time-driven and settlement-driven transitions
 - ADMIN: Can update time fields and cancel contests, but cannot bypass SYSTEM transition
 validation
 - Transition authority: SYSTEM validates time-gate transitions; ADMIN cannot perform
 SCHEDULED→LOCKED directly

 ADMIN Transitions:
 - SCHEDULED → CANCELLED
 - LOCKED → CANCELLED
 - LIVE → CANCELLED
 - ERROR → CANCELLED
 - ERROR → COMPLETE (with settlement prerequisite)

 SYSTEM Transitions (Admin Can Trigger):
 - SCHEDULED → LOCKED (after admin updates lock_time)
 - LIVE → COMPLETE (via settlement execution)
 - LIVE → ERROR (via settlement failure)
 - ERROR → COMPLETE (via settlement execution inside resolveError)

 ---
 Critical Bug Fix Required

 The existing writeAudit() helper in adminContestService.js has schema mismatches:
 1. Uses column name contest_id but schema requires contest_instance_id
 2. Missing required columns from_status and to_status

 Fixed helper function:

 async function _writeAdminAudit(client, {
   contest_instance_id,  // FIXED: was contest_id
   admin_user_id,
   action,
   reason,
   from_status,          // ADDED: required field
   to_status,            // ADDED: required field
   payload = {}
 }) {
   await client.query(
     `INSERT INTO admin_contest_audit (
       contest_instance_id, admin_user_id, action, reason,
       from_status, to_status, payload
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
     [
       contest_instance_id,
       admin_user_id,
       action,
       reason,
       from_status,
       to_status,
       JSON.stringify(payload)
     ]
   );
 }

 Keep legacy writeAudit() for backward compatibility but mark deprecated.

 ---
 Service Operations to Implement

 All implementations go in /Users/iancarter/Documents/workspace/playoff-challenge/backend/serv
 ices/adminContestService.js.

 1. cancelContestInstance(pool, contestId, adminUserId, reason)

 Purpose: Transition contest to CANCELLED from SCHEDULED, LOCKED, LIVE, or ERROR. COMPLETE is
 terminal and must be rejected.

 Transaction Steps:
 1. BEGIN transaction
 2. SELECT ... FOR UPDATE contest_instances
 3. Check status AFTER lock (not via conditional UPDATE)
 4. If status = COMPLETE:
   - Write audit with from_status='COMPLETE', to_status='COMPLETE', payload={noop: true,
 rejected: true, error_code: 'TERMINAL_STATE'}
   - ROLLBACK
   - Throw error (terminal state cannot transition)
 5. If status = CANCELLED:
   - Write audit with noop=true
   - COMMIT
   - Return noop=true (idempotent)
 6. Explicitly call assertAllowedDbStatusTransition({ fromStatus: contest.status, toStatus:
 'CANCELLED', actor: ACTORS.ADMIN })
 7. UPDATE status to CANCELLED
 8. Write audit with action='cancel_contest'
 9. COMMIT

 Idempotency: Check if already CANCELLED after lock; if so, return noop=true.

 Audit Payload:
 {
   "noop": false
 }

 ---
 2. forceLockContestInstance(pool, contestId, adminUserId, reason)

 Purpose: Force SCHEDULED → LOCKED by updating lock_time to NOW, then using SYSTEM actor to
 perform the transition. ADMIN cannot directly perform SCHEDULED→LOCKED (actor model
 violation).

 Transaction Steps:
 1. BEGIN transaction
 2. SELECT ... FOR UPDATE
 3. Check status AFTER lock
 4. If status = LOCKED:
   - Write audit with noop=true
   - COMMIT
   - Return noop=true (idempotent)
 5. If status ≠ SCHEDULED:
   - Write audit with from_status=current, to_status=current, payload={noop: true, rejected:
 true, error_code: 'INVALID_STATUS'}
   - ROLLBACK
   - Throw error (only SCHEDULED can be force-locked)
 6. UPDATE lock_time to NOW (ADMIN action)
 7. Explicitly call assertAllowedDbStatusTransition({ fromStatus: 'SCHEDULED', toStatus:
 'LOCKED', actor: ACTORS.SYSTEM })
 8. UPDATE status to LOCKED (SYSTEM transition)
 9. Write admin audit with action='force_lock'
 10. COMMIT

 Idempotency: Check if already LOCKED; if so, return noop=true.

 Audit Payload:
 {
   "noop": false,
   "lock_time_set": true,
   "lock_time": "2026-02-11T10:00:00.000Z"
 }

 ---
 3. updateContestTimeFields(pool, contestId, timeFields, adminUserId, reason)

 Purpose: Update lock_time, start_time, end_time with validation. Only allowed in SCHEDULED
 and LOCKED.

 Parameters:
 - timeFields: { lock_time?, start_time?, end_time? } (ISO 8601 strings or null)

 Transaction Steps:
 1. BEGIN transaction
 2. SELECT id, status, lock_time, start_time, end_time ... FOR UPDATE
 3. Check status AFTER lock:
 4. If status NOT IN ('SCHEDULED', 'LOCKED'):
   - Write audit with from_status=current, to_status=current, payload={noop: true, rejected:
 true, error_code: 'INVALID_STATUS'}
   - ROLLBACK
   - Throw error (only SCHEDULED/LOCKED allow time updates)
 5. Lock time immutability: If status='LOCKED' AND timeFields.lock_time differs from existing:
   - Write audit with from_status='LOCKED', to_status='LOCKED', payload={noop: true, rejected:
  true, error_code: 'LOCK_TIME_IMMUTABLE'}
   - ROLLBACK
   - Throw error (lock_time immutable once LOCKED)
 6. Idempotency check: Compare new values to existing; if all unchanged:
   - Write audit with noop=true, no field changes
   - COMMIT
   - Return noop=true
 7. Validate time ordering via timeInvariantValidator.validateContestTimeInvariants() (may
 throw)
 8. Dynamic UPDATE (only changed fields)
 9. Write audit with action='update_time_fields', payload={old_values, new_values, noop:
 false}
 10. COMMIT

 Idempotency: If all values unchanged, write audit with noop=true, skip UPDATE.

 Audit Payload:
 {
   "noop": false,
   "old_values": {
     "lock_time": "2026-02-15T10:00:00Z",
     "start_time": "2026-02-15T12:00:00Z"
   },
   "new_values": {
     "start_time": "2026-02-15T11:00:00Z"
   }
 }

 ---
 4. triggerSettlement(pool, contestId, adminUserId, reason)

 Purpose: Trigger SYSTEM settlement transitions based on truth table. This is NOT just
 manually calling executeSettlement()—it's about triggering the SYSTEM actor logic that checks
  readiness and transitions appropriately.

 Critical Architectural Note:
 settlementStrategy.executeSettlement(contestInstance, pool) manages its own transaction. For
 LIVE → COMPLETE, settlement must be executed BEFORE the status update transaction.

 Truth Table:
 Current Status: LIVE
 Readiness Check: readiness=true
 Resulting Status: COMPLETE
 Settlement Executed?: Yes (BEFORE status update transaction)
 ────────────────────────────────────────
 Current Status: LIVE
 Readiness Check: readiness=false
 Resulting Status: ERROR
 Settlement Executed?: No
 ────────────────────────────────────────
 Current Status: CANCELLED
 Readiness Check: N/A
 Resulting Status: Rejected (409)
 Settlement Executed?: No (invalid transition)
 ────────────────────────────────────────
 Current Status: COMPLETE
 Readiness Check: N/A
 Resulting Status: COMPLETE (noop)
 Settlement Executed?: No (already settled)
 ────────────────────────────────────────
 Current Status: ERROR
 Readiness Check: N/A
 Resulting Status: ERROR (noop)
 Settlement Executed?: No (use resolveError instead)
 ────────────────────────────────────────
 Current Status: SCHEDULED/LOCKED
 Readiness Check: N/A
 Resulting Status: Rejected (409)
 Settlement Executed?: No (invalid transition)
 Implementation Steps:
 1. BEGIN transaction (initial check)
 2. SELECT * ... FOR UPDATE
 3. Check status AFTER lock
 4. If status = COMPLETE: verify settlement exists, write audit with noop=true, COMMIT, return
  noop=true
 5. If status = ERROR: write audit with noop=true, COMMIT, return noop=true (use resolveError
 instead)
 6. If status ∈ {CANCELLED, SCHEDULED, LOCKED}:
   - Write audit with from_status=current, to_status=current, payload={noop: true, rejected:
 true, error_code: 'INVALID_TRANSITION'}
   - COMMIT
   - Return 409 error
 7. If status = LIVE:
   - Check settlementStrategy.isReadyForSettlement(pool, contestId) (read-only check)
   - If readiness=false:
       - Explicitly call assertAllowedDbStatusTransition({ fromStatus: 'LIVE', toStatus:
 'ERROR', actor: ACTORS.SYSTEM })
     - UPDATE status to ERROR
     - Write audit with settlement_failure details
     - COMMIT
     - Return with transitioned_to_error=true
   - If readiness=true:
       - COMMIT current transaction (release lock)
     - Execute settlementStrategy.executeSettlement(contestInstance, pool) (manages own
 transaction)
     - If settlement throws, propagate error (contest remains LIVE)
     - BEGIN new transaction
     - SELECT * FOR UPDATE (reacquire lock)
     - Recheck status (may have changed during settlement execution)
     - If status no longer LIVE, treat as idempotent: write audit with noop=true, COMMIT,
 return
     - Explicitly call assertAllowedDbStatusTransition({ fromStatus: 'LIVE', toStatus:
 'COMPLETE', actor: ACTORS.SYSTEM })
     - UPDATE status to COMPLETE
     - Write admin audit
     - COMMIT
     - Return with settlement_id

 Idempotency: COMPLETE and ERROR return noop=true after initial status check.

 Audit Payload (success):
 {
   "settlement_id": "uuid-here",
   "participant_count": 12,
   "total_pool_cents": 60000,
   "results_sha256": "abc123..."
 }

 Audit Payload (LIVE + not ready → ERROR):
 {
   "settlement_failure": true,
   "error_message": "Settlement not ready: missing scores for participants",
   "transitioned_to_error": true,
   "from_status": "LIVE",
   "to_status": "ERROR"
 }

 Error Response (invalid status, no audit):
 - Status 409 INVALID_TRANSITION for CANCELLED, SCHEDULED, or LOCKED
 - No state mutation, no audit record written

 ---
 5. resolveError(pool, contestId, targetStatus, adminUserId, reason)

 Purpose: Resolve ERROR status to COMPLETE or CANCELLED.

 Parameters:
 - targetStatus: Must be 'COMPLETE' or 'CANCELLED'

 Critical Architectural Note:
 settlementStrategy.executeSettlement(contestInstance, pool) opens its own connection and
 transaction. It cannot be called inside an active transaction (PostgreSQL doesn't support
 nested transactions). Therefore, for ERROR → COMPLETE:
 1. Execute settlement FIRST (outside any transaction)
 2. Then start a new transaction for status update
 3. Verify settlement succeeded (check settlement_records exists)
 4. Update status with ADMIN actor authority

 Implementation Steps:
 1. Validate targetStatus IN ('COMPLETE', 'CANCELLED')
 2. If targetStatus='COMPLETE':
   - Call settlementStrategy.executeSettlement(contestInstance, pool) OUTSIDE transaction
   - If settlement throws, propagate error (contest remains ERROR)
 3. BEGIN transaction
 4. SELECT * ... FOR UPDATE
 5. Check status AFTER lock:
   - If status is no longer ERROR (changed by concurrent operation), treat as idempotent:
 write audit with noop=true, COMMIT, return
   - If already at targetStatus, write audit with noop=true, COMMIT, return
 6. Require status='ERROR' (if not, above checks caught it)
 7. If targetStatus='COMPLETE':
   - Verify settlement_records exists for this contest
   - If not found, throw error (settlement did not complete)
   - Explicitly call assertAllowedDbStatusTransition({ fromStatus: 'ERROR', toStatus:
 'COMPLETE', actor: ACTORS.ADMIN })
 8. If targetStatus='CANCELLED':
   - Explicitly call assertAllowedDbStatusTransition({ fromStatus: 'ERROR', toStatus:
 'CANCELLED', actor: ACTORS.ADMIN })
 9. UPDATE status to targetStatus
 10. Write audit with action='resolve_error'
 11. COMMIT

 Idempotency: Check if already resolved; if so, return noop=true.

 Settlement execution: For COMPLETE, settlement is executed BEFORE the transaction begins. The
  transaction only updates the status after verifying settlement succeeded.

 Audit Payload:
 {
   "noop": false,
   "target_status": "COMPLETE",
   "settlement_executed": true,
   "settlement_id": "uuid-here"
 }

 ---
 Shared Infrastructure

 Error Class

 class AdminOperationError extends Error {
   constructor(message, code = 'ADMIN_OPERATION_FAILED') {
     super(message);
     this.name = 'AdminOperationError';
     this.code = code;
   }
 }

 Error Codes:
 - CONTEST_NOT_FOUND
 - TRANSITION_NOT_ALLOWED
 - INVALID_STATUS
 - SETTLEMENT_REQUIRED
 - SETTLEMENT_FAILED
 - TIME_INVARIANT_VIOLATION
 - LOCK_TIME_IMMUTABLE
 - ADMIN_OPERATION_FAILED

 Dependencies

 const { assertAllowedDbStatusTransition, ACTORS, TransitionNotAllowedError } =
 require('./helpers/contestTransitionValidator');
 const { validateContestTimeInvariants } = require('./helpers/timeInvariantValidator');
 const settlementStrategy = require('./settlementStrategy');

 Module Exports (Updated)

 module.exports = {
   // GAP-13 operations (NEW)
   cancelContestInstance,
   forceLockContestInstance,
   updateContestTimeFields,
   triggerSettlement,
   resolveError,

   // Existing exports (PRESERVE)
   listContests,
   getContest,
   overrideStatus,     // DEPRECATED
   updateLockTime,     // DEPRECATED
   deleteContest,
   writeAudit,         // DEPRECATED
   ADMIN_TRANSITIONS   // DEPRECATED
 };

 ---
 Validation Rules Summary
 Operation: cancelContestInstance
 Allowed From Status: SCHEDULED, LOCKED, LIVE, ERROR
 Actor for Transition: ADMIN
 Settlement Required: No
 ────────────────────────────────────────
 Operation: forceLockContestInstance
 Allowed From Status: SCHEDULED only
 Actor for Transition: SYSTEM (after admin updates lock_time)
 Settlement Required: No
 ────────────────────────────────────────
 Operation: updateContestTimeFields
 Allowed From Status: SCHEDULED, LOCKED
 Actor for Transition: N/A (no status change)
 Settlement Required: No
 ────────────────────────────────────────
 Operation: triggerSettlement
 Allowed From Status: LIVE (others rejected 409)
 Actor for Transition: SYSTEM
 Settlement Required: Yes (if LIVE + ready)
 ────────────────────────────────────────
 Operation: resolveError
 Allowed From Status: ERROR only
 Actor for Transition: ADMIN
 Settlement Required: Yes (if target=COMPLETE)
 ---
 Critical Implementation Notes

 1. All state checks happen AFTER SELECT FOR UPDATE
   - Do NOT rely on conditional UPDATE alone
   - Explicitly check status after lock, then decide action
 2. All admin attempts must write audit records
   - Success: Write audit with operation details
   - Idempotent (noop): Write audit with payload.noop=true
   - Rejected (invalid transition/status): Write audit with payload={noop: true, rejected:
 true, error_code: 'CODE'}, then throw/return error
   - Audit fields: from_status=current, to_status=target (or current if rejected)
   - Audit written BEFORE ROLLBACK/COMMIT for rejected operations
 3. Idempotency via explicit checks
   - Check if operation already completed
   - Write audit with noop=true
   - Return 200 with existing data
 4. Every state mutation must call assertAllowedDbStatusTransition
   - Required for ALL status changes before UPDATE
   - Specify correct actor: ADMIN or SYSTEM
   - Let TransitionNotAllowedError propagate if validation fails
   - Examples:
       - cancelContestInstance: assertAllowedDbStatusTransition({ fromStatus, toStatus:
 'CANCELLED', actor: ACTORS.ADMIN })
     - triggerSettlement LIVE→ERROR: assertAllowedDbStatusTransition({ fromStatus: 'LIVE',
 toStatus: 'ERROR', actor: ACTORS.SYSTEM })
     - resolveError: assertAllowedDbStatusTransition({ fromStatus: 'ERROR', toStatus, actor:
 ACTORS.ADMIN })
 5. Actor model must be preserved
   - forceLockContestInstance: Update lock_time (ADMIN), then transition with SYSTEM
   - triggerSettlement: All transitions use SYSTEM actor
   - resolveError to COMPLETE: Execute settlement OUTSIDE transaction, then transition with
 ADMIN actor
   - resolveError to CANCELLED: Direct ADMIN transition (no settlement)
 6. Settlement execution and transaction boundaries
   - Critical: settlementStrategy.executeSettlement() manages its own transaction and cannot
 be called inside an active transaction
   - Pattern for both operations: Release lock → execute settlement → reacquire lock → verify
 → update
   - triggerSettlement (LIVE + ready): COMMIT initial transaction, execute settlement, BEGIN
 new transaction, recheck status, update to COMPLETE
   - resolveError (ERROR → COMPLETE): Execute settlement first (outside transaction), then
 BEGIN transaction, verify settlement exists, update status
   - If settlement throws, error propagates to caller; contest remains in current state (LIVE
 or ERROR)
 7. Lock time immutability
   - Once status = LOCKED, lock_time cannot be changed
   - Enforced in updateContestTimeFields before time invariant validation

 ---
 Critical Files

 Implementation:
 - /Users/iancarter/Documents/workspace/playoff-challenge/backend/services/adminContestService
 .js - Add 5 operations + fix audit helper

 Dependencies (DO NOT MODIFY):
 - /Users/iancarter/Documents/workspace/playoff-challenge/backend/services/helpers/contestTran
 sitionValidator.js - Transition validation
 - /Users/iancarter/Documents/workspace/playoff-challenge/backend/services/helpers/timeInvaria
 ntValidator.js - Time ordering validation
 -
 /Users/iancarter/Documents/workspace/playoff-challenge/backend/services/settlementStrategy.js
  - Settlement execution
 - /Users/iancarter/Documents/workspace/playoff-challenge/backend/services/helpers/contestLife
 cycleAdvancer.js - SYSTEM transition patterns

 Schema Reference:
 - /Users/iancarter/Documents/workspace/playoff-challenge/backend/db/schema.snapshot.sql -
 Tables: admin_contest_audit, contest_instances, settlement_records

 ---
 Verification Steps

 After implementation:

 1. Unit Tests (create tests/services/adminContestService.gap13.test.js):
   - Each operation: happy path
   - Idempotency (call twice, verify noop=true on second call)
   - Actor model correctness (forceLockContestInstance uses SYSTEM for transition)
   - triggerSettlement truth table coverage (all 6 scenarios)
   - resolveError with settlement execution
   - Lock time immutability
   - Time invariant violations
   - State checks after SELECT FOR UPDATE
 2. Manual Testing:
 const pool = require('./db/pool');
 const adminService = require('./services/adminContestService');

 // Test force lock
 const result = await adminService.forceLockContestInstance(
   pool,
   '<contest-id>',
   '<admin-user-id>',
   'Testing GAP-13 force lock'
 );

 // Verify audit
 const audit = await pool.query(
   'SELECT * FROM admin_contest_audit WHERE contest_instance_id = $1 ORDER BY created_at DESC
 LIMIT 1',
   ['<contest-id>']
 );
 console.log(audit.rows[0]);
 3. Integration Testing:
   - Full lifecycle: SCHEDULED → force lock → triggerSettlement (readiness fail → ERROR) →
 resolveError(COMPLETE with settlement) → COMPLETE
   - Cancellation from each valid state
   - Time field updates in SCHEDULED vs LOCKED
   - Idempotency verification for all operations
 4. Audit Trail Verification:
 SELECT
   action,
   from_status,
   to_status,
   reason,
   payload,
   created_at
 FROM admin_contest_audit
 WHERE contest_instance_id = '<test-contest-id>'
 ORDER BY created_at DESC;

 ---
 Notes

 - Idempotency: All operations are idempotent via explicit state checks after SELECT FOR
 UPDATE
 - Audit on noop: All operations write audit records even when noop=true
 - Actor separation: forceLockContestInstance and triggerSettlement respect SYSTEM actor
 authority
 - Settlement placement: Always executed BEFORE status update to COMPLETE
 - Error propagation: Let TransitionNotAllowedError from validator propagate; wrap with
 AdminOperationError for operation-specific validation
 - No routes yet: This plan covers service layer only. Routes will be implemented separately.
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

 Claude has written up a plan and is ready to execute. Would you like to proceed?

 ❯ 1. Yes, clear context and auto-accept edits (shift+tab)
   2. Yes, auto-accept edits
   3. Yes, manually approve edits
   4. Type here to tell Claude what to change