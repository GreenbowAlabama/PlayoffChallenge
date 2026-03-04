# Contest Cancellation Refund Spec v1 (Wallet Ledger Safe)

Purpose
- Cancel a contest and refund all paid entry fees back to user wallets
- Preserve ledger correctness under retries, crashes, concurrent admin actions, and lifecycle workers
- Never touch Stripe during cancellation (no card refunds)

Non goals
- Do not refund deposits back to cards on cancellation
- Do not settle or pay prizes for a cancelled contest

Core invariants
1. No Stripe calls on cancellation
- Cancellation is an internal wallet operation only (ledger credits)

2. Refund only if the user actually paid the entry fee
- A refund is allowed only if an ENTRY_FEE DEBIT ledger row exists for (contest_instance_id, user_id)
- This prevents minting money from partial join failures or inconsistent participant rows

3. Idempotent per user per contest
- Refund ledger insert must be idempotent using a stable idempotency key
- Re-running cancellation must not double credit any wallet

4. Two phase cancellation
- Never finalize contest as CANCELLED unless refunds are complete
- If refunding fails mid-run, the contest must not reach CANCELLED

5. No settlement after cancellation
- Once cancellation begins, settlement for that contest must be blocked
- Cancellation must win races against settlement lifecycle transitions

Dangerous edge case this spec prevents
- Participant exists, but entry fee debit never occurred (or was rolled back) and cancellation blindly credits a refund anyway.
Example failure modes:
- Join flow inserts contest_participants, then fails before ledger ENTRY_FEE insert (or crashes)
- Admin inserted participant for testing
- A retry created participant but debit was prevented by idempotency mismatch or transaction abort
If cancellation refunds without verifying the original debit exists, the user receives free wallet funds.
Those funds can be withdrawn later, creating real platform loss.

This spec enforces: no refund unless a matching ENTRY_FEE debit exists.

Required existing data assumptions
- contest_instances has:
  - id
  - status
- contest_participants has:
  - contest_instance_id
  - user_id
- ledger table exists and is append-only with:
  - entry_type
  - direction
  - amount_cents
  - reference_type
  - reference_id
  - idempotency_key
  - user_id or reference_id keyed to user (current implementation uses reference_id = user_id for computeWalletBalance)
- LedgerRepository.computeWalletBalance(client, userId) exists and sums by reference_id = userId (current implementation)

Ledger contract for entry fee
- Join debit:
  - entry_type = 'ENTRY_FEE'
  - direction = 'DEBIT'
  - reference_type = 'CONTEST'
  - reference_id = contestInstanceId
  - idempotency_key = entry_fee:{contestInstanceId}:{userId}
  - amount_cents = entry_fee_cents

Ledger contract for cancellation refund
- Refund credit:
  - entry_type = 'ENTRY_FEE_REFUND'
  - direction = 'CREDIT'
  - reference_type = 'CONTEST'
  - reference_id = contestInstanceId
  - idempotency_key = entry_fee_refund_cancel:{contestInstanceId}:{userId}
  - amount_cents = entry_fee_cents
Notes:
- The refund amount must equal the original entry fee cents for that contest
- The refund must only be created if the matching ENTRY_FEE debit exists

Cancellation algorithm (authoritative)
Input
- contestInstanceId
- now (Date)

Output
- { success: true } only when cancellation is fully complete and refunds are done

Step 0: Acquire contest lock
- Begin transaction
- SELECT contest_instances WHERE id = $1 FOR UPDATE
- If not found, throw CONTEST_NOT_FOUND
- If status is COMPLETE, reject (cannot cancel completed contests)
- If status is CANCELLED, return success (idempotent)
- If status is in a terminal settlement-complete state, reject
- Keep row lock for duration of cancellation state changes

Step 1: Freeze the contest against settlement
- Ensure lifecycle worker cannot settle this contest while cancel is running
- Minimum requirement: enforce a status transition path that settlement logic refuses once cancellation begins
Implementation options without schema changes:
A) If you already have a cancellation primitive, call it in a transaction with row lock held
B) If status transitions are sealed, use the frozen primitive that marks cancellation-in-progress if available
If there is no distinct in-progress status, keep the row lock and perform refunds, then set CANCELLED in the same transaction. Do not release between.

Step 2: Enumerate participants
- SELECT user_id FROM contest_participants WHERE contest_instance_id = $1
- This list is the refund target set

Step 3: Refund each participant safely (per participant transaction with user lock)
For each userId:
- Start a new transaction (or keep in same transaction if safe for contention; per-user transaction is fine)
- Lock the user row used by join/withdraw flows:
  - SELECT id FROM users WHERE id = $1 FOR UPDATE

- Verify the user actually paid:
  - SELECT amount_cents FROM ledger
    WHERE entry_type = 'ENTRY_FEE'
      AND direction = 'DEBIT'
      AND reference_type = 'CONTEST'
      AND reference_id = $contestInstanceId
      AND idempotency_key = entry_fee:{contestInstanceId}:{userId}
    LIMIT 1
If missing:
  - Do not refund
  - Record this as a cancellation refund anomaly and fail the entire cancellation (recommended)
Rationale:
  - This indicates a broken join invariant that must be repaired before finalizing cancellation
  - If you continue, you risk silent financial drift

- Insert refund credit idempotently:
  - INSERT INTO ledger (... ENTRY_FEE_REFUND CREDIT ...)
    ON CONFLICT (idempotency_key) DO NOTHING
  - Then verify idempotency correctness:
    - Query by idempotency_key and ensure amount_cents matches expected and reference_id matches userId rules

- Commit

Step 4: Verify refund completeness before CANCELLED
- Compute expected refund count:
  - Count participants
- Compute actual refund count:
  - Count ledger rows with idempotency_key prefix entry_fee_refund_cancel:{contestInstanceId}:
    - If no prefix search is available, query by:
      entry_type = 'ENTRY_FEE_REFUND'
      reference_type = 'CONTEST'
      reference_id = contestInstanceId
- Ensure:
  - refunded_count == participant_count
If not:
  - Do not mark contest CANCELLED
  - Throw invariant violation and surface error
This prevents partial cancellation completion.

Step 5: Finalize cancellation state
- Update contest_instances to CANCELLED using the sealed primitive or the allowed mutation path
- Commit contest transaction

Failure behavior
- Any failure in refunding or verification must prevent marking contest CANCELLED
- Cancellation should surface an error so an operator can retry safely
- Retrying is safe because:
  - refund ledger inserts are idempotent
  - contest row lock prevents concurrent cancel operations
  - finalization only happens after verification

Concurrency notes
- Join vs cancel race:
  - Contest lock (FOR UPDATE) ensures join sees a consistent state
  - Join flow should reject once cancellation has begun (by status)
- Withdraw vs cancel:
  - User row locks ensure withdrawal and refund cannot interleave inconsistently
- Settlement vs cancel:
  - Cancellation must block settlement by status or by holding contest lock until status is CANCELLED

Unit tests required (minimum)
1) Cancelling refunds all participants exactly once
- 100 participants
- Each has ENTRY_FEE debit
- After cancel, each has exactly one ENTRY_FEE_REFUND credit

2) Idempotent cancel retry
- Run cancel twice
- No duplicate refunds (count remains 100)

3) Partial join failure protection
- Participant exists but missing ENTRY_FEE debit
- Cancellation must fail and must not mark contest CANCELLED

4) Settlement race protection
- If contest is COMPLETE, cancellation is rejected
- If cancellation begins, settlement path must not run afterward

Operational note for Chad
- Stripe fees occur at deposit time
- Cancellation refunds are internal wallet credits only
- No additional Stripe fee is incurred by cancellation
- Platform must only send funds back out via Stripe on explicit user withdrawal

