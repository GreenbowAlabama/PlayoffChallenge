# Financial Control Tower

**Status:** AUTHORITATIVE
**Governance Version:** 1
**Last Verified:** 2026-03-11
**Owner:** Operations & Architecture
**Last Updated:** 2026-03-07

---

# Purpose

The Financial Control Tower is the operational surveillance and repair system for the ledger-first accounting model.

It exists to:

• Monitor financial health in real-time
• Detect corruption signals before they cascade
• Enable repair operations using only safe patterns
• Maintain the reconciliation invariant as an operational reality
• Provide a runbook for financial operations

This document defines what the web-admin financial dashboard and CLI tools must implement.

---

# Core Principle

The Financial Control Tower is **read-heavy surveillance** combined with **ledger-only repair**.

It observes the ledger, detects anomalies, and issues compensating entries. It never directly mutates balances or deletes history.

---

# Reconciliation Monitoring

## Primary Invariant Check

The system must continuously verify:

**wallet_liability + contest_pools = deposits - withdrawals**

### Definitions

**wallet_liability** =
```sql
SUM(
  CASE
    WHEN direction = 'CREDIT' THEN amount_cents
    WHEN direction = 'DEBIT' THEN -amount_cents
  END
)
FROM ledger
WHERE user_id IS NOT NULL
```

**contest_pools** =
```sql
SUM(amount_cents)
FROM ledger
WHERE entry_type = 'ENTRY_FEE' AND direction = 'DEBIT'
MINUS
SUM(amount_cents)
FROM ledger
WHERE entry_type IN ('ENTRY_FEE_REFUND', 'PRIZE_PAYOUT') AND direction = 'CREDIT'
```

**deposits** =
```sql
SUM(amount_cents)
FROM ledger
WHERE entry_type = 'WALLET_DEPOSIT' AND direction = 'CREDIT'
```

**withdrawals** =
```sql
SUM(amount_cents)
FROM ledger
WHERE entry_type = 'WALLET_WITHDRAWAL' AND direction = 'DEBIT'
```

### Reconciliation Drift Detection

**Alert Level: CRITICAL**

If the equation does NOT hold:

reconciliation_drift =
  ABS((wallet_liability + contest_pools) - (deposits - withdrawals))

**Action:**
- Alert operations immediately
- Flag contest as under audit
- Pause settlement operations for affected contests
- Escalate to lead architect

---

## Wallet Health Monitoring

### 1. Negative Wallet Detection

**Alert Level: CRITICAL**

Any user with:
```sql
SUM(
  CASE WHEN direction = 'CREDIT' THEN amount_cents
       WHEN direction = 'DEBIT' THEN -amount_cents
  END
) < 0
```

indicates either:
• Withdrawal without balance validation
• Ledger corruption
• System bug

**Action:**
- Freeze user account immediately
- Block new contest entries
- Escalate to operations
- Prepare repair (ADJUSTMENT CREDIT entry)

### 2. Orphaned Withdrawal Detection

**Alert Level: HIGH**

Withdrawals without corresponding user:

```sql
SELECT * FROM ledger
WHERE entry_type = 'WALLET_WITHDRAWAL'
AND user_id NOT IN (SELECT id FROM users)
```

**Action:**
- Document orphaned withdrawal amount
- Create ADJUSTMENT CREDIT to restore balance to system
- Investigate root cause (user deletion? import error?)

### 3. Balance Threshold Monitoring

**Alert Level: WARNING**

Track distribution:
- Users with wallet > $500 (high value accounts)
- Users with wallet < $0.01 (dust)
- Wallets trending downward rapidly

**Action:**
- Log for audit trail
- Investigate high-value accounts for abuse patterns
- Monitor dust accumulation for reconciliation drift

---

## Contest Pool Health Monitoring

### 1. Pool Conservation Check

For each contest instance:

```sql
contest_entry_pool =
  SUM(amount_cents) WHERE entry_type = 'ENTRY_FEE'
  MINUS
  SUM(amount_cents) WHERE entry_type = 'ENTRY_FEE_REFUND'

SELECT contest_instance_id,
       SUM(amount_cents) as total_payouts
FROM ledger
WHERE entry_type = 'PRIZE_PAYOUT'
GROUP BY contest_instance_id
HAVING SUM(amount_cents) > contest_entry_pool
```

**Alert Level: CRITICAL**

If any payout exceeds the pool, settlement violated the invariant.

**Action:**
- Immediate investigation
- Determine if settlement code is broken
- If broken, disable auto-settlement
- Escalate to lead engineer

### 2. Refund Without Entry Fee Detection

**Alert Level: HIGH**

```sql
SELECT * FROM ledger l
WHERE l.entry_type = 'ENTRY_FEE_REFUND'
AND NOT EXISTS (
  SELECT 1 FROM ledger
  WHERE entry_type = 'ENTRY_FEE'
  AND reference_id = l.reference_id
  AND user_id = l.user_id
)
```

Refunds without corresponding entry fee indicate:
• Manual admin error
• Orphaned ledger row
• Import corruption

**Action:**
- Document the mismatch
- Create compensating ENTRY_FEE DEBIT (or ADJUSTMENT)
- Investigate root cause

### 3. Settlement Binding Verification

For each contest in COMPLETE state:

```sql
SELECT contest_instance_id FROM contest_instances
WHERE status = 'COMPLETE'
AND settlement_snapshot_id IS NULL
```

Completed contests without snapshot binding indicate:
• Settlement executed without snapshot
• Governance violation
• Potential for re-runs

**Action:**
- Flag as anomalous
- Verify settlement occurred only once
- Investigate why snapshot was missing

---

## Orphan Ledger Entry Detection

**Alert Level: MEDIUM**

Ledger entries that reference non-existent rows:

```sql
-- Entry referencing deleted contest
SELECT * FROM ledger l
WHERE l.reference_type = 'CONTEST'
AND l.reference_id NOT IN (SELECT id FROM contest_instances)

-- Entry referencing deleted user (if possible)
SELECT * FROM ledger l
WHERE l.user_id NOT IN (SELECT id FROM users)
```

**Action:**
- Log for audit
- Create ADJUSTMENT entry if balance was affected
- Investigate why deletion occurred

---

# Stripe Reconciliation Model

The platform must reconcile with Stripe's view of funds.

## Stripe Financial Equation

```
stripe_balance + stripe_fees = wallet_liabilities + contest_pools - platform_rake
```

### Definitions

**stripe_balance** = Stripe account balance (from Stripe API)

**stripe_fees** = Cumulative Stripe processing fees (from Stripe API)

**wallet_liabilities** = SUM(wallet deposits minus withdrawals)

**contest_pools** = Locked entry fees awaiting settlement

**platform_rake** = Platform's take from contests (if any)

### Reconciliation Check

When syncing with Stripe:

1. Fetch `stripe_balance` and `stripe_fees` from Stripe API
2. Compute `wallet_liabilities` from ledger
3. Compute `contest_pools` from ledger
4. Verify equation holds (within $0.01 tolerance)

If equation does NOT hold:
- Log discrepancy amount
- Alert operations (Stripe sync error or ledger corruption)
- Defer withdrawal processing until resolved

---

# Admin Repair Operations

The web-admin tool may perform specific repair operations **only** using compensating ledger entries.

## Allowed Repair Operations

### 1. ADJUSTMENT Ledger Entry

**Purpose:** Correct balance errors using compensating entries

**Usage:**
```sql
INSERT INTO ledger (
  user_id,
  entry_type,
  direction,
  amount_cents,
  currency,
  reference_type,
  reference_id,
  idempotency_key,
  created_at
)
VALUES (
  $1,                                    -- user_id (affected user)
  'ADJUSTMENT',                          -- entry_type
  CASE WHEN correction_is_credit THEN 'CREDIT' ELSE 'DEBIT' END,
  abs(correction_amount_cents),
  'USD',
  'SYSTEM',                              -- reference_type
  'admin-repair-'||gen_random_uuid(),   -- reference_id (unique per repair)
  'adjustment:'||user_id||':'||timestamp,-- idempotency_key
  now()
)
```

**Who can issue:** Ops lead, verified via admin JWT

**Audit:** Every ADJUSTMENT entry logged with:
- Admin user ID who approved repair
- Reason for repair
- Amount and direction
- Affected user

---

### 2. ENTRY_FEE_REFUND

**Purpose:** Refund a contest entry fee (e.g., contest cancelled, invalid entry)

**Preconditions:**
- Original ENTRY_FEE debit exists
- Contest status is not COMPLETE or PAID_OUT
- Entry exists in contest_participants

**Usage:**
```sql
INSERT INTO ledger (
  user_id,
  entry_type,
  direction,
  amount_cents,
  currency,
  reference_type,
  reference_id,
  contest_instance_id,
  idempotency_key,
  created_at
)
VALUES (
  $1,                                           -- user_id
  'ENTRY_FEE_REFUND',                          -- entry_type
  'CREDIT',                                     -- always CREDIT
  entry_fee_cents,                              -- must match original fee
  'USD',
  'CONTEST',
  contest_instance_id,
  contest_instance_id,
  'refund:'||contest_instance_id||':'||user_id,-- deterministic key
  now()
)
```

**Audit:** Logged with contest ID, user ID, reason

---

### 3. CONTEST_CANCEL_REFUND

**Purpose:** Refund all entry fees when a contest is cancelled

**Preconditions:**
- Contest status changed to CANCELLED
- No payouts issued yet

**Operation:**
```sql
BEGIN TRANSACTION;

-- For each participant with ENTRY_FEE debit:
INSERT INTO ledger (user_id, entry_type, direction, ...)
SELECT
  p.user_id,
  'CONTEST_CANCEL_REFUND',
  'CREDIT',
  fee.amount_cents,
  ...
FROM contest_participants p
JOIN ledger fee ON fee.reference_id = p.contest_instance_id
                AND fee.user_id = p.user_id
                AND fee.entry_type = 'ENTRY_FEE'
WHERE p.contest_instance_id = $1;

COMMIT;
```

**Audit:** Logged with contest ID, refund count, total amount

---

## Forbidden Repair Operations

**The following operations are NEVER allowed:**

```
DELETE FROM ledger;
UPDATE ledger SET ...;
UPDATE users SET balance = ...;
UPDATE wallets SET balance = ...;
```

**Rationale:** Ledger history is immutable. All corrections use compensating entries. Direct mutations erase audit trail and make corruption undetectable.

---

# Web-Admin Responsibilities

## Dashboard Views

The web-admin financial control tower must provide:

### 1. Reconciliation Status Panel

**Displayed:**
- Current value: `wallet_liability + contest_pools`
- Current value: `deposits - withdrawals`
- Drift: ABS(difference)
- Last reconciliation check: timestamp
- Status: ✅ BALANCED or ❌ DRIFT DETECTED

**Refresh interval:** 30 seconds

**Alert trigger:** Drift > $1.00

---

### 2. Wallet Health Dashboard

**Metrics:**
- Total users: count
- Users with negative balance: count (🚨 CRITICAL)
- Highest wallet balance: USD amount + user ID
- Lowest wallet balance: USD amount + user ID
- Average wallet balance: USD amount
- Orphaned withdrawals: count

**Actions available:**
- View user ledger history
- Create ADJUSTMENT entry
- Flag account for review

---

### 3. Contest Pool Dashboard

**Per contest instance:**
- Entry fee collected: USD
- Refunds issued: USD
- Payouts issued: USD
- Pool remaining: USD
- Status: OPEN / LOCKED / LIVE / COMPLETE / CANCELLED / ERROR

**Alerts:**
- 🚨 Payout exceeds pool
- ⚠️  Pool negative
- ⚠️  Refund without entry fee

**Actions available:**
- View contest participants and entries
- View settlement history
- Trigger manual settlement (if not auto-settled)
- Cancel contest (with refunds)

---

### 4. Stripe Reconciliation Panel

**Displayed:**
- Stripe account balance: USD
- Stripe cumulative fees: USD
- Ledger wallet liability: USD
- Ledger contest pools: USD
- Expected Stripe balance: USD (calculated)
- Actual Stripe balance: USD
- Reconciliation drift: USD

**Status:**
- ✅ RECONCILED
- ⚠️  PENDING (sync in progress)
- ❌ DRIFT (investigation required)

**Actions available:**
- Trigger manual Stripe sync
- View sync history and logs

---

### 5. Recent Transactions Log

**Displayed:**
- Last 100 ledger entries (most recent first)
- Columns: Timestamp | User | Entry Type | Amount | Direction | Reference | Status

**Filters:**
- By user ID
- By entry type (ENTRY_FEE, PAYOUT, ADJUSTMENT, etc.)
- By contest instance
- By date range

**Actions:**
- View full entry details
- View related entries (e.g., entry fee + payout for same user)

---

## Repair Operations UI

### ADJUSTMENT Entry Creation

**Form:**
- Select affected user (autocomplete)
- Select entry type: "ADJUSTMENT"
- Select direction: CREDIT or DEBIT
- Enter amount (cents)
- Enter reason (free text)
- Add comment (optional)

**Validation:**
- Amount > 0
- Reason is not empty
- User exists
- Requires second admin to approve (if balance-affecting)

**Confirmation:**
Before submit, display:
- Current wallet balance before adjustment
- Adjustment amount and direction
- New wallet balance after adjustment
- Reconciliation impact

**After submit:**
- Confirm ledger entry created
- Display new reconciliation status
- Log admin user ID and timestamp

---

### Contest Refund

**Preconditions check:**
- Contest is CANCELLED or status allows refund
- Entry fees were collected
- Payouts not issued

**Operation:**
- For each participant with entry fee, issue ENTRY_FEE_REFUND
- Display: "Refunding X participants, total $Y"
- Confirm before committing

**After completion:**
- Show refund ledger entries created
- Display updated wallet balances for affected users
- Update reconciliation dashboard

---

### Negative Wallet Resolution

**UI for ops reviewing a flagged negative wallet:**

- Display user ID and account summary
- Show ledger history (ordered by date)
- Identify which transaction caused negative balance
- Suggested action: "Issue ADJUSTMENT CREDIT for $X"
- Explanation: "Withdrawal without balance validation"
- Confirm and execute repair

**After repair:**
- Verify wallet is now >= 0
- Confirm reconciliation is restored
- Log repair action

---

## Corruption Detection & Escalation

### Automated Alerts

The system must continuously detect and alert on:

| Signal | Severity | Action |
|--------|----------|--------|
| Reconciliation drift > $1 | CRITICAL | Page on-call ops, stop settlements |
| Negative wallet detected | CRITICAL | Freeze account, alert ops |
| Payout exceeds pool | CRITICAL | Rollback settlement, investigate |
| Orphaned withdrawal | HIGH | Flag for review, prepare repair |
| Refund without entry fee | HIGH | Flag for review, prepare repair |
| Settlement without snapshot | HIGH | Flag for review, audit settlement |
| Stripe sync drift > $5 | HIGH | Flag for review, investigate |

### Escalation Path

1. **Ops Dashboard Alert** (auto)
2. **Slack Notification** (auto, to #financial-alerts)
3. **PagerDuty Page** (if CRITICAL, to on-call ops)
4. **Manual Investigation** (ops + engineer)
5. **Repair Execution** (ops with engineer oversight)
6. **Post-Mortem** (engineering team)

---

# Operational Runbook

## Weekly Reconciliation Check

**Every Monday 9am:**

1. Run reconciliation query
2. Verify equation holds (within tolerance)
3. Review alerts from past week
4. Document any anomalies
5. Escalate if drift detected

---

## Monthly Financial Audit

**First week of month:**

1. Export full ledger for month
2. Verify all transactions are documented
3. Spot-check Stripe deposits match ledger
4. Verify all contests settled correctly
5. Identify any orphaned entries
6. Prepare summary for executive review

---

## After Each Settlement

**Immediately after contest settlement:**

1. Verify payout total <= pool amount
2. Verify all ledger entries inserted (atomic)
3. Confirm contest moved to COMPLETE
4. Check reconciliation equation still holds
5. Alert if any condition fails

---

# References

### Related Governance Docs

- `docs/governance/LEDGER_ARCHITECTURE_AND_RECONCILIATION.md` — Ledger design
- `docs/governance/FINANCIAL_INVARIANTS.md` — Atomic join, idempotency
- `docs/governance/ARCHITECTURE_ENFORCEMENT.md` — No direct mutations rule
- `docs/governance/LIFECYCLE_EXECUTION_MAP.md` — Settlement invariants

### Backend Services

- `backend/services/ledgerService.js` — Ledger insertion
- `backend/services/settlementService.js` — Settlement execution
- `backend/repositories/LedgerRepository.js` — Ledger queries
- `backend/routes/wallet.routes.js` — Wallet endpoints

### Web Admin

- `web-admin/pages/financial/reconciliation.tsx` — Reconciliation dashboard
- `web-admin/pages/financial/wallets.tsx` — Wallet health view
- `web-admin/pages/financial/contests.tsx` — Contest pools view
- `web-admin/services/reconciliationService.ts` — Reconciliation queries
- `web-admin/services/repairService.ts` — Repair operations

---

# Conclusion

The Financial Control Tower transforms the ledger from a silent audit trail into an active surveillance system.

By monitoring reconciliation, detecting corruption signals, and enabling safe repairs, operations can maintain financial integrity without requiring code changes.

This document defines the operational discipline that backs the architectural discipline of the ledger-first model.
