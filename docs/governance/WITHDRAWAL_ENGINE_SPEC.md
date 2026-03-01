# Withdrawal Engine Specification

**Status:** DESIGN (pressure-tested, ready for implementation)
**Phase:** 3+
**Constraints:** Deterministic, idempotent, ledger-backed, Stripe-integrated, TestFlight-safe

---

## CRITICAL ARCHITECTURE DECISION (Must Confirm Before Coding)

### Stripe Object Selection: Transfers API vs Payouts API

**Question:** Are users Stripe Connect connected accounts, or direct customers with bank accounts?

- **If users are Stripe Connect accounts:** Use Transfers API ✅
  - Transfers move funds between Stripe accounts
  - Idempotency key: Stripe-level
  - Webhook: `transfer.created`, `transfer.failed`

- **If users are direct customers (most likely):** Use Payouts API ❌ (Transfers is wrong)
  - Payouts move funds from Stripe balance to customer bank account
  - Idempotency key: Stripe-level
  - Webhook: `payout.created`, `payout.failed`

**Assumption in this spec:** Payouts API (customer bank account withdrawal)
- Update throughout if Transfers applies

---

## 1. Non-Negotiable Invariants

- **Ledger is append-only.** Only INSERTs; never UPDATE or DELETE existing ledger rows.
- **Available balance formula** (critical to prevent double-spend):
  ```
  available_balance =
    SUM(ledger.amount_cents WHERE direction = 'CREDIT')
    - SUM(ledger.amount_cents WHERE direction = 'DEBIT')
    - SUM(wallet_withdrawals.amount_cents WHERE status IN ('REQUESTED', 'PROCESSING'))
  ```
  Frozen funds in REQUESTED/PROCESSING prevent concurrent withdrawals from overshooting.

- **No negative balance.** Validation checks available_balance, not computed balance.
- **Per-user serialization.** All balance operations locked via `SELECT ... FOR UPDATE` on users row.
- **Every withdrawal is idempotent.** Unique idempotency_key at DB level prevents duplicates.
- **No ghost debits.** Ledger DEBIT inserted atomically with status update; transaction all-or-nothing.
- **Stripe outside transaction.** DB commit happens BEFORE Stripe API call. If crash mid-Stripe call, retry logic reconciles.
- **Webhook is idempotent.** Status update uses conditional WHERE clause; replay-safe.

---

## 2. Data Model

### 2.1 New Table: `wallet_withdrawals`

Tracks withdrawal lifecycle from request to settlement.

```sql
CREATE TABLE wallet_withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),

  -- Request details
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  requested_at TIMESTAMP DEFAULT NOW(),

  -- Status lifecycle
  status TEXT NOT NULL CHECK (status IN ('REQUESTED', 'APPROVED', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED')),

  -- Stripe integration
  stripe_transfer_id TEXT UNIQUE,  -- Unique Stripe Transfer ID (if using Transfers)
  stripe_payout_id TEXT UNIQUE,    -- OR Unique Stripe Payout ID (if using Payouts)

  -- Idempotency & audit
  idempotency_key TEXT NOT NULL UNIQUE,
  failure_reason TEXT,
  processed_at TIMESTAMP,

  -- Optimistic concurrency
  version INTEGER DEFAULT 1,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_wallet_withdrawals_user_id_status
  ON wallet_withdrawals(user_id, status);
CREATE INDEX idx_wallet_withdrawals_idempotency_key
  ON wallet_withdrawals(idempotency_key);
```

### 2.2 Ledger Integration (Existing)

Withdrawals insert DEBIT entries into the existing `ledger` table:

```sql
INSERT INTO ledger (
  entry_type,      -- 'WALLET_DEBIT'
  direction,        -- 'DEBIT'
  amount_cents,
  reference_type,   -- 'WALLET'
  reference_id,     -- user_id
  idempotency_key   -- withdrawal-idempotency-key
) VALUES (...)
```

**Key:** Same idempotency key links withdrawal request → ledger debit → Stripe transfer.

### 2.3 Configuration Table: `withdrawal_config`

Withdrawal limits and policy (per-environment or global).

```sql
CREATE TABLE withdrawal_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment TEXT NOT NULL UNIQUE,  -- 'sandbox', 'staging', 'production'

  min_withdrawal_cents INTEGER NOT NULL DEFAULT 500,     -- $5.00 minimum
  max_withdrawal_cents INTEGER,                           -- NULL = unlimited

  daily_withdrawal_limit_cents INTEGER,                   -- NULL = unlimited
  max_withdrawals_per_day INTEGER,                        -- NULL = unlimited

  -- Cooldown before first withdrawal (seconds)
  cooldown_seconds INTEGER DEFAULT 0,

  -- Fee model
  withdrawal_fee_cents INTEGER DEFAULT 0,                 -- Platform fee (deducted from amount)

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Example (Sandbox):**
```sql
INSERT INTO withdrawal_config (environment, min_withdrawal_cents, max_withdrawal_cents, withdrawal_fee_cents)
VALUES ('sandbox', 500, 100000, 0);  -- $5 min, $1000 max, no fee
```

### 2.4 Schema Dependencies

- `wallet_withdrawals.user_id` REFERENCES `users(id)` — user must exist
- `wallet_withdrawals.idempotency_key` UNIQUE — prevents duplicate requests
- `ledger.idempotency_key` UNIQUE — prevents duplicate debits
- `ledger.reference_id` = user_id — links withdrawal to wallet ledger

---

## 3. API Surface (Draft)

### 3.1 GET `/api/wallet/balance`

**Scope:** Authenticated (current user)

**Response:**
```json
{
  "balance_cents": 15000,
  "currency": "USD",
  "available_for_withdrawal": true,
  "minimum_withdrawal_cents": 500,
  "maximum_withdrawal_cents": null
}
```

**Notes:**
- `available_for_withdrawal` = `balance_cents > minimum_withdrawal_cents`
- If user has pending withdrawal, may restrict new requests (see phase decisions)

---

### 3.2 POST `/api/wallet/withdrawals` (Create Request)

**Scope:** Authenticated (current user)

**Request:**
```json
{
  "amount_cents": 5000,
  "idempotency_key": "withdrawal-user-2025-01-15-123"  // Client-provided or server-generated (deterministic)
}
```

**Response (201 Created):**
```json
{
  "id": "uuid-1234",
  "user_id": "uuid-user",
  "amount_cents": 5000,
  "status": "REQUESTED",
  "idempotency_key": "withdrawal-user-2025-01-15-123",
  "requested_at": "2025-01-15T10:00:00Z",
  "processed_at": null,
  "stripe_payout_id": null
}
```

**Error Codes:**
- `INSUFFICIENT_BALANCE` — wallet balance - frozen_funds < amount
- `AMOUNT_TOO_SMALL` — amount < withdrawal_config.min_withdrawal_cents
- `AMOUNT_TOO_LARGE` — amount > withdrawal_config.max_withdrawal_cents (if set)
- `BANK_ACCOUNT_NOT_SET` — user has not set up bank account for payouts
- `WITHDRAWAL_PENDING` — user has active withdrawal in PROCESSING (Phase 2 gate; optional for MVP)
- `DUPLICATE_REQUEST` — same idempotency_key already exists
  - If existing is REQUESTED or PROCESSING: return existing (idempotent)
  - If existing is PAID or FAILED: return 409 Conflict (user must use new key)

**Withdrawal Frozen Funds:**
- Amount is frozen as soon as REQUESTED
- Prevents concurrent withdrawals from over-draining wallet
- Only unfrozen if CANCELLED or if FAILED (Phase 2)

---

### 3.3 GET `/api/wallet/withdrawals`

**Scope:** Authenticated (current user)

**Query Parameters:**
- `status` (optional) — filter by status (REQUESTED, APPROVED, PROCESSING, PAID, FAILED)
- `limit` (optional) — default 20, max 100
- `offset` (optional) — pagination

**Response:**
```json
{
  "withdrawals": [
    {
      "id": "uuid-1234",
      "amount_cents": 5000,
      "status": "PAID",
      "requested_at": "2025-01-15T10:00:00Z",
      "processed_at": "2025-01-15T10:05:00Z",
      "stripe_transfer_id": "tr_123abc"
    }
  ],
  "total": 42,
  "limit": 20,
  "offset": 0
}
```

---

### 3.4 POST `/api/wallet/withdrawals/:id/cancel` (Optional)

**Scope:** Authenticated (current user, must own withdrawal)

**Precondition:** Withdrawal in REQUESTED or APPROVED status only

**Response (200 OK):**
```json
{
  "id": "uuid-1234",
  "status": "CANCELLED",
  "cancelled_at": "2025-01-15T10:02:00Z"
}
```

**Error Codes:**
- `WITHDRAWAL_NOT_FOUND` — withdrawal does not exist or not owned by user
- `WITHDRAWAL_NOT_CANCELLABLE` — status is PROCESSING, PAID, or already FAILED/CANCELLED

---

## 4. State Machine

### 4.1 States (MVP: Simplified to 4)

| State | Meaning | Ledger Debited? | Can Transition To |
|-------|---------|-----------------|-------------------|
| REQUESTED | User created request; funds frozen in available_balance | NO | PROCESSING, CANCELLED |
| PROCESSING | Submitted to Stripe; ledger DEBIT inserted; awaiting confirmation | YES | PAID, FAILED |
| PAID | Stripe confirmed payout; funds transferred to bank account | YES | (terminal) |
| FAILED | Stripe payout failed; no reversal yet (Phase 2) | YES | (terminal) |
| CANCELLED | User cancelled before processing; funds unfrozen | NO | (terminal) |

**Design Decision (MVP):** Collapse APPROVED state.
- No compliance gating in Phase 1.
- Immediate transition REQUESTED → PROCESSING on async job (no intermediate state).
- Reduces state surface area; fewer bugs.

### 4.2 Transition Rules (Explicit)

**REQUESTED → PROCESSING (Async Job)**
- Triggered by: Scheduled task or on-demand endpoint
- Preconditions:
  - User row locked (SELECT ... FOR UPDATE)
  - Balance re-validated (paranoia check)
  - Ledger DEBIT inserted (atomically)
  - Status updated to PROCESSING (in same transaction)
- Stripe call happens AFTER transaction commits
- Reversible: NO (ledger already debited)

**PROCESSING → PAID (Stripe Webhook: payout.created)**
- Triggered by: Stripe `payout.created` webhook
- SQL: `UPDATE wallet_withdrawals SET status = 'PAID', stripe_payout_id = $1 WHERE id = $2 AND status = 'PROCESSING'`
- Rows affected = 0: Already handled or invalid; do not error
- Reversible: NO

**PROCESSING → FAILED (Stripe Webhook: payout.failed)**
- Triggered by: Stripe `payout.failed` webhook
- SQL: `UPDATE wallet_withdrawals SET status = 'FAILED', failure_reason = $1 WHERE id = $2 AND status = 'PROCESSING'`
- Rows affected = 0: Already handled; do not error
- Reversible: Manual retry in Phase 2 (credit reversal + new request)

**REQUESTED → CANCELLED (User or Admin)**
- Triggered by: User or admin endpoint
- Preconditions:
  - Verify status IN ('REQUESTED') (cannot cancel if PROCESSING or later)
  - No ledger reversal needed (funds never left wallet)
- SQL: `UPDATE wallet_withdrawals SET status = 'CANCELLED' WHERE id = $1 AND status = 'REQUESTED'`
- Reversible: NO

---

## 5. Atomicity Strategy (Exact SQL)

### 5.1 Create Withdrawal Request

**Endpoint:** `POST /api/wallet/withdrawals`

**Transaction (DB-only):**
```sql
BEGIN TRANSACTION

-- 1. Lock user row (serialize all balance operations)
SELECT id FROM users WHERE id = $1 FOR UPDATE;

-- 2. Compute available balance from ledger (fresh, no cache)
SELECT COALESCE(
  SUM(CASE
    WHEN direction = 'CREDIT' THEN amount_cents
    WHEN direction = 'DEBIT' THEN -amount_cents
  END),
  0
) as balance_cents
FROM ledger
WHERE reference_type = 'WALLET' AND reference_id = $1;

-- 3. Compute frozen funds (pending withdrawals)
SELECT COALESCE(SUM(amount_cents), 0) as frozen_cents
FROM wallet_withdrawals
WHERE user_id = $1 AND status IN ('REQUESTED', 'PROCESSING');

-- 4. Validate: available_balance >= amount + existing_frozen
-- Application logic: available = balance_cents - frozen_cents
-- if available < withdrawal_amount → return INSUFFICIENT_BALANCE

-- 5. Validate constraints from withdrawal_config
-- if amount < min_withdrawal_cents → return AMOUNT_TOO_SMALL
-- if amount > max_withdrawal_cents → return AMOUNT_TOO_LARGE

-- 6. Insert withdrawal request (status = REQUESTED)
INSERT INTO wallet_withdrawals (
  user_id, amount_cents, status, idempotency_key, requested_at
) VALUES ($1, $2, 'REQUESTED', $3, NOW());

COMMIT
```

**No Stripe call inside transaction.**

**Key Property:**
- User lock serializes concurrent requests
- Frozen funds (REQUESTED + PROCESSING) prevent double-spend
- Ledger DEBIT NOT yet inserted (happens in step 5.2)

---

### 5.2 Process Withdrawal (Async Job)

**Trigger:** Scheduled task or on-demand endpoint

**Transaction (DB-only):**
```sql
BEGIN TRANSACTION

-- 1. Lock user row
SELECT id FROM users WHERE id = $1 FOR UPDATE;

-- 2. Fetch withdrawal in REQUESTED state
SELECT id, amount_cents, idempotency_key, user_id
FROM wallet_withdrawals
WHERE id = $2 AND user_id = $1 AND status = 'REQUESTED'
FOR UPDATE;

-- If no rows: withdrawal was cancelled or already processed; return gracefully

-- 3. Re-validate balance (paranoia check; should not fail)
SELECT COALESCE(
  SUM(CASE
    WHEN direction = 'CREDIT' THEN amount_cents
    WHEN direction = 'DEBIT' THEN -amount_cents
  END),
  0
) as balance_cents
FROM ledger
WHERE reference_type = 'WALLET' AND reference_id = $1;

-- Verify: balance >= withdrawal.amount_cents

-- 4. Insert ledger DEBIT (atomic with status update)
INSERT INTO ledger (
  entry_type, direction, amount_cents, reference_type, reference_id, idempotency_key
) VALUES ('WALLET_DEBIT', 'DEBIT', $3, 'WALLET', $1, $4);

-- 5. Update withdrawal status to PROCESSING
UPDATE wallet_withdrawals
SET status = 'PROCESSING', processed_at = NOW()
WHERE id = $2;

COMMIT
```

**After COMMIT, before Stripe call:**

```javascript
// 6. Call Stripe API (OUTSIDE transaction)
const payout = await stripe.payouts.create(
  {
    amount: withdrawal.amount_cents,
    currency: 'usd',
    destination: user.stripe_bank_account_id,
    statement_descriptor: 'Playoff withdrawal'
  },
  {
    // Idempotency key: matches DB idempotency_key
    idempotencyKey: withdrawal.idempotency_key
  }
);

// 7. Note stripe_payout_id (for webhook correlation)
// Application caches this but does NOT update DB yet
// (webhook updates DB when payout.created arrives)
```

**Key Design Choice:**
- **Ledger DEBIT inserted BEFORE Stripe call** (pessimistic reserve)
- If Stripe call crashes mid-request: withdrawal is PROCESSING, ledger shows debit, retry via webhook or manual process
- If Stripe succeeds: payout_id is known; webhook will confirm PAID status
- **No optimistic double-charge:** Idempotency key ensures Stripe is idempotent; retry is safe

---

### 5.3 Webhook Handler (Stripe: payout.created)

**Trigger:** Stripe sends webhook event `payout.created`

**Transaction:**
```sql
BEGIN TRANSACTION

-- 1. Verify webhook signature (application layer, not DB)
-- Stripe-Signature header validated against webhook secret

-- 2. Parse event and extract payout object

-- 3. Fetch withdrawal by idempotency_key (deterministic lookup)
SELECT id, user_id, status
FROM wallet_withdrawals
WHERE idempotency_key = $1
FOR UPDATE;

-- 4. Idempotent status update (only if currently PROCESSING)
UPDATE wallet_withdrawals
SET status = 'PAID', stripe_payout_id = $2, updated_at = NOW()
WHERE id = $3 AND status = 'PROCESSING';

-- If rows_affected = 0:
--   Already PAID (webhook replayed), or invalid status
--   Do not error; log and return 200 OK

COMMIT
```

**Webhook Replay Safety:**
- Stripe may send webhook multiple times (retries)
- Status update with `AND status = 'PROCESSING'` is idempotent
- Second replay finds status already PAID; UPDATE affects 0 rows; no error
- Ledger was debited only once (single idempotency_key)

---

### 5.4 Webhook Handler (Stripe: payout.failed)

**Transaction:**
```sql
BEGIN TRANSACTION

-- Similar to payout.created, but different status

UPDATE wallet_withdrawals
SET status = 'FAILED', failure_reason = $1, updated_at = NOW()
WHERE id = $2 AND status = 'PROCESSING';

-- If rows_affected = 0: Already handled; do not error

COMMIT
```

**No ledger reversal in Phase 1.**
- Ledger debit remains (funds are "stuck")
- Phase 2: Add manual credit entry to reverse failed withdrawal
- Phase 2: Allow user to retry as new request

---

### 5.5 Cancellation (User or Admin)

**Endpoint:** `POST /api/wallet/withdrawals/:id/cancel`

**Transaction:**
```sql
BEGIN TRANSACTION

-- 1. Lock user row
SELECT id FROM users WHERE id = $1 FOR UPDATE;

-- 2. Verify ownership and status
SELECT id, user_id, status
FROM wallet_withdrawals
WHERE id = $2
FOR UPDATE;

-- If status NOT IN ('REQUESTED'): Cannot cancel
-- Error: WITHDRAWAL_NOT_CANCELLABLE

-- 3. Cancel (status REQUESTED means no ledger debit yet)
UPDATE wallet_withdrawals
SET status = 'CANCELLED', updated_at = NOW()
WHERE id = $2;

COMMIT
```

**Key Property:**
- Only REQUESTED can be cancelled (funds never left wallet)
- PROCESSING and beyond are irreversible (ledger already debited)

---

## 6. Stripe Integration Plan

### 6.1 Object Choice: Transfers vs Payouts (CRITICAL DECISION)

**Question:** Are users Stripe Connect connected accounts, or direct customers?

| Aspect | Transfers API | Payouts API |
|--------|---------------|------------|
| **Use case** | Account-to-account transfers (Stripe Connect) | Customer-to-bank withdrawals |
| **Target audience** | Other Stripe businesses | Direct customers with bank accounts |
| **Setup** | User has Stripe account; becomes connected account | Platform holds funds; user provides bank account |
| **Webhooks** | `transfer.created`, `transfer.failed` | `payout.created`, `payout.failed` |
| **Sandbox testing** | Yes, test connected accounts | Yes, test bank accounts |
| **Sandbox timing** | Hours to days | 1-5 business days (or instant in test) |

**Decision for MVP:** Use **Payouts API** (assumption: users are direct customers with bank accounts)
- Funds move from Stripe balance to user's bank account
- User provides bank account via Stripe dashboard or API (setup phase)
- Idempotency key: deterministic per withdrawal
- Webhooks: `payout.created` (success), `payout.failed` (failure)

**If Transfers applies** (users are Stripe Connect accounts):
- Change all `payout.X` to `transfer.X`
- Change bank account reference to `destination` (Stripe Connect account ID)
- Timing and confirmation logic remain the same

### 6.2 Idempotency Key Format

```
withdrawal:{user_id}:{wallet_withdrawal_id}
```

Example: `withdrawal:9a8c1234-5678-90ab-cdef-1234567890ab:7f6e5432-1098-7654-3210-fedcba987654`

**Properties:**
- Deterministic: same withdrawal → same key (no randomness)
- Unique: per withdrawal instance
- Forwarded to Stripe via `Idempotency-Key` header
- Stripe guarantees: same key = same payout (prevents double-charge on retry)
- Matches `wallet_withdrawals.idempotency_key` exactly

---

### 6.3 Webhook Handling (Payout Events)

**Stripe Webhook Events:**
- `payout.created` — payout succeeded; funds transferred to bank
- `payout.failed` — payout failed (e.g., invalid bank account, insufficient balance)

**Webhook Endpoint:**
```
POST /api/webhooks/stripe/payouts
X-Stripe-Signature: <signed payload>
```

**Webhook Processing (from Section 5.3):**
```sql
-- 1. Verify webhook signature
-- 2. Extract payout object from event
-- 3. Fetch withdrawal by idempotency_key
-- 4. Idempotent status update: IF status = 'PROCESSING' THEN SET status = 'PAID'
-- 5. If rows_affected = 0: Already handled; log and return 200 OK
```

**Idempotency:**
- Stripe may retry webhook (network failure, etc.)
- Same idempotency_key → same withdrawal ID
- Status update with `WHERE status = 'PROCESSING'` is idempotent
- Replay: second webhook finds status already PAID; UPDATE affects 0 rows; no error

**Failure Handling:**
- If webhook processing crashes: Stripe retries (exponential backoff, ~3 days)
- If withdrawal not found: log and return 200 OK (possible race, not critical)
- If withdrawal is not PROCESSING: log warning; do not update (inconsistent state)

---

### 6.4 Stripe API Call (Process Step)

**Payout Creation:**
```javascript
const payout = await stripe.payouts.create(
  {
    amount: withdrawal.amount_cents,
    currency: 'usd',
    destination: user.stripe_bank_account_id,  // Must be saved during user onboarding
    statement_descriptor: 'Playoff withdrawal'
  },
  {
    idempotencyKey: withdrawal.idempotency_key  // Deterministic, matches DB
  }
);

// Note payout.id for webhook correlation (but don't update DB yet)
// Webhook will confirm status when payout.created arrives
```

**If Transfers API (alternative):**
```javascript
const transfer = await stripe.transfers.create(
  {
    amount: withdrawal.amount_cents,
    currency: 'usd',
    destination: user.stripe_account_id,  // Connected account ID, not bank account
    transfer_data: { amount: withdrawal.amount_cents }
  },
  {
    idempotencyKey: withdrawal.idempotency_key
  }
);
```

---

## 7. Test Plan

### 7.1 Unit Tests

**File:** `backend/tests/services/withdrawalService.test.js`

- **Balance validation:**
  - Reject if amount > balance
  - Accept if amount == balance
  - Reject if amount < minimum
  - Reject if amount > maximum (if set)

- **Idempotency:**
  - Same idempotency_key returns existing withdrawal (no new row)
  - Different keys create separate rows

- **Ledger interaction:**
  - Create withdrawal → no ledger entry (REQUESTED/APPROVED only)
  - Process withdrawal → ledger DEBIT inserted atomically
  - Process withdrawal → status = PROCESSING after debit

---

### 7.2 Concurrency Tests

**File:** `backend/tests/services/withdrawalService.concurrency.test.js`

- **Two concurrent withdrawals from same user:**
  - First gets balance lock; second queues
  - Each withdraws independently
  - No double-debit or negative balance

- **Concurrent process + user cancel:**
  - Process wins lock; cancel sees PROCESSING, throws error
  - OR cancel wins lock; process sees CANCELLED, skips

---

### 7.3 Idempotency Tests

**File:** `backend/tests/services/withdrawalService.idempotency.test.js`

- **Create idempotent:**
  - Same request twice → same withdrawal returned
  - Status: REQUESTED, no ledger debit

- **Process idempotent:**
  - Stripe API succeeds; process again → same transfer_id, status = PAID
  - Ledger debit already exists; second process skips insert

- **Webhook idempotent:**
  - Webhook arrives twice → status = PAID both times (idempotent UPDATE)
  - No duplicate ledger entries

---

### 7.4 Webhook Tests

**File:** `backend/tests/webhooks/stripeTransferWebhook.test.js`

- **Valid signature:**
  - Webhook signature verified via Stripe secret
  - Event processed

- **Invalid signature:**
  - 401 Unauthorized
  - Event ignored

- **Replay safety:**
  - Webhook sent twice → status updated once (idempotent)

- **Missing withdrawal:**
  - Webhook references unknown transfer_id
  - Log warning; do not fail

---

## 8. Operational Runbook (TestFlight Validation)

### 8.1 Pre-Launch Checklist (Admin)

- [ ] Create Stripe test account or use existing sandbox
- [ ] Set up connected account in Stripe dashboard
  - Enable transfers (not default; requires explicit permission)
  - Note: Connected account ID saved in environment
- [ ] Configure test bank account in Stripe dashboard
  - Use test account number: `000123456789` (Stripe test account)
  - Verify webhook endpoint URL registered in Stripe dashboard
- [ ] Create test user in app with wallet balance
- [ ] Create test withdrawal request
- [ ] Monitor webhook delivery in Stripe dashboard
- [ ] Verify withdrawal status transitions in app

### 8.2 Sandbox Testing Steps

1. **Create withdrawal:**
   - User creates withdrawal request (status = REQUESTED)
   - Verify idempotency: retry returns same withdrawal

2. **Process withdrawal:**
   - Run async job manually (or wait for cron)
   - Withdrawal status = PROCESSING
   - Verify ledger DEBIT inserted

3. **Monitor webhook:**
   - Stripe sends `transfer.created` event
   - Webhook handler receives and processes
   - Withdrawal status = PAID

4. **Failure scenario:**
   - Create withdrawal with insufficient connected account balance
   - Process withdrawal → Stripe rejects
   - Webhook delivers `transfer.failed`
   - Withdrawal status = FAILED
   - Allow user to retry or cancel

5. **Idempotency validation:**
   - Replay webhook manually → status idempotent (remains PAID)
   - Process async job twice → no duplicate ledger entries

### 8.3 Deployment Gates

- [ ] All withdrawal tests pass
- [ ] Webhook signature validation passes
- [ ] Idempotency verified (no duplicate transfers)
- [ ] Balance invariants hold (no negative balances)
- [ ] Stripe sandbox transfer succeeds end-to-end

---

## 8. Fee Model (Explicit)

### 8.1 Withdrawal Fee Policy (MVP)

**Configuration:** `withdrawal_config.withdrawal_fee_cents`

**Default:** `0` (no fee in Phase 1)

**When enabled (Phase 1.5+):**
- User requests withdrawal of `amount_cents`
- Platform deducts `withdrawal_fee_cents` from amount
- Ledger records two entries:
  1. Debit user: `amount_cents` (full requested amount)
  2. Credit platform fee account: `withdrawal_fee_cents`
- Payout to user bank account: `amount_cents - withdrawal_fee_cents`

**Example (with fee):**
- User requests: $100 (10,000 cents)
- Withdrawal fee: $1 (100 cents)
- Ledger: Debit user 10,000 cents; Credit platform 100 cents
- Bank payout: 9,900 cents

**In MVP:** `withdrawal_fee_cents = 0` (no fee)
- Ledger: Debit user `amount_cents`
- Bank payout: `amount_cents` (same)

**Explicit:** No withdrawal fee in Phase 1. Document if changed.

---

## 9. Known Decisions & Deferred Work

### 9.1 MVP Scope (Phase 3)

**Locked:**
- Ledger-based available balance (prevents double-spend)
- Per-user row locking (serializes all balance operations)
- Pessimistic reserve (debit before Stripe call)
- Webhook idempotency (status-gated UPDATE)
- Payouts API (user bank accounts)
- No withdrawal fee (Phase 1)
- REQUESTED → PROCESSING → PAID/FAILED/CANCELLED (simplified state machine)
- Idempotency via deterministic key (user_id + wallet_withdrawal_id)

### 9.2 Phase 2+ Enhancements

- **Manual approval gate:** Add if compliance requires human review
- **Failure reversal:** Ledger credit reversal for FAILED payouts (currently no reversal)
- **Withdrawal fee:** `withdrawal_config.withdrawal_fee_cents` (currently 0)
- **Tax reporting:** 1099 integration (accounting phase)
- **Admin dashboard:** Withdrawal management UI
- **Rate limiting:** Daily cap, max per transaction, cooldown window (currently in config but not enforced)
- **Fraud detection:** Risk scoring on withdrawals

### 9.3 Pre-Implementation Checklist

**Must confirm before coding Phase 3:**

- [ ] **Stripe object decision:** Payouts API or Transfers API?
  - Confirm users are direct customers with bank accounts (Payouts) vs Stripe Connect accounts (Transfers)

- [ ] **Withdrawal limits:**
  - Confirm min/max per transaction
  - Confirm daily cap if any
  - Confirm cooldown window if any

- [ ] **Fee model:**
  - Confirm no fee in Phase 1 (document explicitly if changed)

- [ ] **Bank account setup:**
  - How do users provide bank account? (Stripe dashboard or app API?)
  - Who sets up the platform's Stripe payout account?

- [ ] **Webhook endpoint:**
  - Where is `/api/webhooks/stripe/payouts` deployed?
  - Is it accessible from Stripe (public URL)?

- [ ] **Stripe credentials:**
  - Stripe Secret Key location (environment variable)?
  - Webhook secret location?
  - Connected account ID (if applicable)?

### 9.4 Assumptions

- **Stripe account:** Already created and verified
- **Bank account destination:** User provides via onboarding (Phase 3 or Phase 2)
- **Webhook endpoint:** Publicly accessible HTTPS endpoint
- **Idempotency key:** Deterministic (server-generated from user_id + withdrawal_id)

---

## 10. References

### Related Governance Docs
- `docs/governance/FINANCIAL_INVARIANTS.md` — Wallet join atomicity (similar pattern)
- `docs/governance/CLAUDE_RULES.md` — Determinism & idempotency rules

### Code Structure
- Service: `backend/services/withdrawalService.js` (not yet created)
- Tests: `backend/tests/services/withdrawalService.test.js` (not yet created)
- Webhook: `backend/webhooks/stripeTransferWebhook.js` (not yet created)
- Model: `backend/models/WalletWithdrawal.js` (not yet created)

### Stripe Documentation
- [Stripe Transfers API](https://stripe.com/docs/api/transfers)
- [Stripe Webhooks](https://stripe.com/docs/webhooks)
- [Idempotency in Stripe](https://stripe.com/docs/api/idempotent_requests)
