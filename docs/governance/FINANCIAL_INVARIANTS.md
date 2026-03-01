# Financial Invariants — Wallet Debit & Entry Fee Immutability

**Purpose:** Define atomic guarantees for contest entry fees and wallet mutations. These rules are frozen and tested.

**Status:** FROZEN (enforced by tests and database constraints)

---

## 1. Atomic Join Debit Ordering (Phase 2)

### Contract

When a user joins a contest with entry_fee_cents > 0, the following must execute atomically:

1. User row locked (`SELECT ... FOR UPDATE`)
2. Contest row locked and state validated
3. Participant insert succeeds
4. Wallet debit insert succeeds with matching idempotency key
5. All or nothing: both rows exist, or transaction rolls back

### Implementation

**File:** `backend/services/customContestService.js:1023-1224`

```javascript
async function joinContest(pool, contestInstanceId, userId) {
  // 1. Lock user (line 1030)
  // SELECT id FROM users WHERE id = $1 FOR UPDATE

  // 2. Lock contest (line 1041)
  // SELECT ... FROM contest_instances WHERE id = $1 FOR UPDATE

  // 3. Validate state (lines 1052-1070)
  // 4. Idempotent precheck (lines 1078-1087) — no debit if already joined
  // 5. Capacity check (lines 1089-1099)
  // 6. Wallet balance check (lines 1101-1113)
  // 7. Participant insert (lines 1117-1142) — only if all checks pass
  // 8. Wallet debit insert (lines 1150-1212) — only if participant insert succeeds
  // 9. Commit (line 1211)
}
```

### Critical Properties

**Atomicity:** Single transaction, all-or-nothing

**Idempotency:**
- Same join twice = one participant + one debit
- Idempotency key ensures no duplicates: `wallet_debit:{contestInstanceId}:{userId}`

**Race Condition Handling:**
- Participant insert uses `ON CONFLICT DO NOTHING`
- If race occurs (another transaction inserted participant first):
  - Return success (don't debit again)
  - Existing transaction already handled the debit
- If participant insert fails due to capacity (not race):
  - Return `CONTEST_FULL` error

**Test Evidence:**
- `backend/tests/services/customContest.service.test.js` — sufficient funds, insufficient funds, idempotency, race conditions

---

## 2. Wallet Balance Computation (Read-Only)

### Contract

Wallet balance is computed as the sum of all CREDIT and DEBIT entries where:
- `reference_type = 'WALLET'`
- `reference_id = user_id`
- No filtering by contest or status

**Formula:**
```
balance = SUM(
  CASE WHEN direction = 'CREDIT' THEN amount_cents
       WHEN direction = 'DEBIT' THEN -amount_cents
  END
)
```

### Implementation

**File:** `backend/repositories/LedgerRepository.js:129-150`

```javascript
async function getWalletBalance(pool, userId) {
  const result = await pool.query(
    `SELECT COALESCE(
       SUM(CASE
         WHEN direction = 'CREDIT' THEN amount_cents
         WHEN direction = 'DEBIT' THEN -amount_cents
       END),
       0
     ) as balance_cents
     FROM ledger
     WHERE reference_type = 'WALLET'
     AND reference_id = $1::UUID`,
    [userId]
  );

  return parseInt(result.rows[0].balance_cents, 10);
}
```

### Critical Properties

**Read-Only:** No mutations, safe under concurrent inserts

**Aggregate-Based:** SUM() is atomic; no row-level locking needed

**Deterministic:** Same inputs (user_id, ledger state) always produce same output

**Test Evidence:**
- `backend/tests/wallet/wallet-balance.empty.test.js`
- `backend/tests/wallet/wallet-balance.with-deposits.test.js`
- `backend/tests/wallet/wallet-balance.mixed-credit-debit.test.js`

---

## 3. Idempotency Key Format & Uniqueness

### Format

```
wallet_debit:{contestInstanceId}:{userId}
```

### Uniqueness Enforcement

**Evidence:** `backend/db/schema.snapshot.sql:1628`

```sql
ADD CONSTRAINT ledger_idempotency_key_unique UNIQUE (idempotency_key);
```

### Invariant

- Only ONE ledger entry per (contestInstanceId, userId) pair
- Idempotency key is deterministic: same contest + same user = same key
- Attempting join twice produces one debit row

### Test Evidence

- `backend/tests/services/customContest.service.test.js` — "idempotent join produces single debit"

---

## 4. Debit Conflict Verification

### Scenario

Join debit insert conflicts (idempotency key already exists). This means:
- Another transaction already debited this user for this contest
- We must verify the existing debit matches expected values

### Verification

**Evidence:** `backend/services/customContestService.js:1174-1208`

When conflict occurs:
1. Query existing ledger row by idempotency_key
2. Verify ALL fields:
   - `entry_type = 'WALLET_DEBIT'`
   - `direction = 'DEBIT'`
   - `amount_cents = entryFeeCents` (exact match)
   - `reference_type = 'WALLET'`
   - `reference_id = userId`

3. If ANY field mismatches:
   - Throw invariant violation error
   - Rollback transaction
   - Escalate (this is corruption, not a normal conflict)

### Rationale

If a conflicting idempotency key exists but the amount differs (e.g., `amount_cents = 100` vs expected `250`), this indicates:
- Stale code that computed a different fee
- Database corruption
- Logic error in fee validation

This must NOT be silently ignored. It must be escalated.

### Test Evidence

- `backend/tests/services/customContest.service.test.js` — "debit conflict with field mismatch throws error"

---

## 5. Entry Fee Creation & Immutability

### Creation

Entry fee is **user-provided at contest creation time**, validated against template bounds.

**Evidence:** `backend/services/customContestService.js:437-520`

```javascript
async function createContestInstance(pool, organizerId, input) {
  // input.entry_fee_cents is REQUIRED and user-supplied
  if (input.entry_fee_cents === undefined || input.entry_fee_cents === null) {
    throw new Error('entry_fee_cents is required');
  }

  // Validated against template min/max bounds
  validateEntryFeeAgainstTemplate(input.entry_fee_cents, template);

  // Stored as instance value (not derived from template default)
  INSERT INTO contest_instances (..., entry_fee_cents, ...)
  VALUES (..., input.entry_fee_cents, ...)
}
```

**Key Point:** Template bounds are constraints, not defaults. Organizer chooses the fee within bounds.

### Immutability at Join Time

Entry fee is **immutable at join time**. The value used for debit is the instance-level fee, never recomputed.

**Evidence:** `backend/services/customContestService.js:1103`

```javascript
const entryFeeCents = parseInt(contest.entry_fee_cents, 10);
// This value is read once, locked, and never refetched
```

### DB-Level Enforcement (LOCKED)

**Status:** ✅ DB-enforced via trigger `prevent_entry_fee_change_after_publish()`

Entry fee immutability is **enforced at the database layer** after publish (join_token is set).

**Function:** `public.prevent_entry_fee_change_after_publish()`

**Trigger:** `trg_prevent_entry_fee_change_after_publish`

**Enforcement:**
```sql
CREATE FUNCTION prevent_entry_fee_change_after_publish() RETURNS trigger AS $$
BEGIN
  IF OLD.join_token IS NOT NULL
     AND NEW.entry_fee_cents IS DISTINCT FROM OLD.entry_fee_cents THEN
    RAISE EXCEPTION
      'entry_fee_cents is immutable after publish (join_token already set)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_entry_fee_change_after_publish
  BEFORE UPDATE OF entry_fee_cents ON contest_instances
  FOR EACH ROW
  EXECUTE FUNCTION prevent_entry_fee_change_after_publish();
```

**Trigger Behavior:**
- Fires on `UPDATE` of `entry_fee_cents` column only
- If `join_token IS NOT NULL` (contest is published) and `entry_fee_cents` changes:
  - Transaction raises exception
  - Update is blocked
  - No partial state
- If `join_token IS NULL` (contest not published), updates are allowed

**Evidence:** `backend/db/schema.snapshot.sql` — trigger definition present

---

## 6. Error Codes

### INSUFFICIENT_WALLET_FUNDS

**Code:** `JOIN_ERROR_CODES.INSUFFICIENT_WALLET_FUNDS`

**Evidence:** `backend/services/customContestService.js:1110`

Returned when:
```javascript
if (walletBalance < entryFeeCents) {
  return {
    joined: false,
    error_code: JOIN_ERROR_CODES.INSUFFICIENT_WALLET_FUNDS,
    reason: 'Wallet balance is insufficient to enter this contest'
  };
}
```

**iOS Behavior:**
- Observe this error in join response
- Display user-friendly message: "Insufficient wallet balance"
- Allow user to deposit funds or join different contest

---

## 7. Test Infrastructure

### mockPool Function Predicates

Tests can use flexible query matching via function predicates.

**Evidence:** `backend/tests/mocks/mockPool.js:56-66`

```javascript
mockPool.setQueryResponse(
  // Function predicate: matches if function returns true
  q => q.includes('FROM users') && q.includes('FOR UPDATE'),
  // Response for matching queries
  { rows: [mockUser], rowCount: 1 }
);
```

**Benefit:** Multi-line SQL remains stable under reformatting (no brittle regex required)

---

## 8. Invariant Violations (Hard Failures)

The following are NOT errors to be handled gracefully. They are system corruptions:

### Debit Field Mismatch
- Existing idempotency key with different amount or type
- **Action:** Throw error, rollback, escalate
- **Reason:** Indicates stale code or data corruption

### User Not Found
- User row lock fails (user does not exist or was deleted mid-transaction)
- **Action:** Throw error, rollback, return clean error to client
- **Reason:** Indicates state corruption or race with user deletion

### Contest Not Found
- Contest row lock fails (contest deleted mid-transaction)
- **Action:** Throw error, rollback, return clean error to client
- **Reason:** Indicates state corruption or race with contest deletion

These are NOT normal errors. They indicate system failures requiring investigation.

---

## 9. Monitoring & Observability

### Metrics to Track

- Wallet balance distribution (histogram)
- Join success rate (by contest)
- Debit conflict frequency (should be rare)
- Invariant violation frequency (should be zero)
- Insufficient funds rejection rate

### Alerts

Trigger alert if:
- Debit conflict rate > 0.1% (indicates idempotency issues)
- Invariant violations > 0 (indicates corruption)
- Join transaction timeouts > 5% (indicates lock contention)

---

## 10. Version Control & Change Log

### Frozen Primitives

- ✅ `joinContest()` — locked by tests, no further changes without governance review
- ✅ `computeWalletBalance()` — locked by tests, deterministic only
- ✅ Ledger unique constraint on idempotency_key — locked by schema

### Evolving

- 🔄 Wallet deposit/withdrawal endpoints (Phase 3+)

---

## 11. References

### Related Governance Docs

- `docs/governance/CLAUDE_RULES.md` § 12 (Financial Invariants)
- `docs/governance/IOS_SWEEP_PROTOCOL.md` § 1.1 (Financial Boundary Rule)

### Code Evidence

- `backend/services/customContestService.js` — joinContest implementation
- `backend/repositories/LedgerRepository.js` — wallet balance computation
- `backend/tests/services/customContest.service.test.js` — test suite
- `backend/db/schema.snapshot.sql` — schema constraints

### Test Suites

- `customContest.service.test.js` — join flow, wallet validation, idempotency
- `wallet-balance.*.test.js` — balance computation
- Payment and settlement tests — interaction with wallet state
