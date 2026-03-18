# System Invariant Service Architecture

**Status:** OPERATIONAL
**Last Updated:** 2026-03-17
**Owner:** Financial System

---

## Purpose

The SystemInvariantService monitors and validates the financial health of the platform via deterministic queries over the ledger.

All invariant checks must be provable via SELECT-only queries. No mutations. No assumptions.

---

## Contract: Direction-Aware Aggregation

### wallet_liability Calculation

```sql
SELECT COALESCE(SUM(
  CASE
    WHEN direction = 'CREDIT' THEN amount_cents
    WHEN direction = 'DEBIT' THEN -amount_cents
  END
), 0) as total
FROM ledger
WHERE user_id IS NOT NULL
AND entry_type IN (
  'WALLET_DEPOSIT',
  'WALLET_WITHDRAWAL',
  'WALLET_WITHDRAWAL_REVERSAL',
  'ENTRY_FEE',
  'ENTRY_FEE_REFUND',
  'PRIZE_PAYOUT'
);
```

**REQUIRED PROPERTIES:**
1. **Direction-Aware:** CREDIT = add, DEBIT = subtract
2. **Includes Reversals:** WALLET_WITHDRAWAL_REVERSAL (CREDIT) restores funds
3. **Aggregates ALL:** Sums across all ledger entries for all users (not filtered by reference_type)
4. **Deterministic:** Same ledger state always produces same result

---

### withdrawals (Net) Calculation

```sql
SELECT COALESCE(SUM(
  CASE
    WHEN entry_type = 'WALLET_WITHDRAWAL' THEN amount_cents
    WHEN entry_type = 'WALLET_WITHDRAWAL_REVERSAL' THEN -amount_cents
    ELSE 0
  END
), 0) as total
FROM ledger
WHERE entry_type IN ('WALLET_WITHDRAWAL', 'WALLET_WITHDRAWAL_REVERSAL');
```

**REQUIRED PROPERTIES:**
1. **Nets Reversals:** WALLET_WITHDRAWAL amounts minus WALLET_WITHDRAWAL_REVERSAL amounts
2. **Failed Withdrawals Net to Zero:** debit (50000) - reversal (50000) = 0
3. **Successful Withdrawals Contribute:** no reversal = amount is net withdrawal
4. **Deterministic:** Same ledger state always produces same result

---

### Invariant Equation Validation

```
wallet_liability + contest_pools = deposits - net_withdrawals
```

**Check Logic:**
1. Calculate wallet_liability (direction-aware)
2. Calculate contest_pools (entry fees minus refunds)
3. Calculate deposits (WALLET_DEPOSIT CREDIT entries)
4. Calculate net_withdrawals (WALLET_WITHDRAWAL minus WALLET_WITHDRAWAL_REVERSAL)
5. Compute left_side = wallet_liability + contest_pools
6. Compute right_side = deposits - net_withdrawals
7. Calculate difference = |left_side - right_side|

**Status Mapping:**
- difference ≤ $0.01 (epsilon): **BALANCED**
- $0.01 < difference < $1.00: **DRIFT**
- difference ≥ $1.00: **CRITICAL_IMBALANCE**

---

## Withdrawal Reversal Guarantee

**GUARANTEE:** Failed withdrawals MUST net to zero impact on the invariant equation.

**Proof:**
- When withdrawal fails with reversal:
  - wallet_liability includes: original DEBIT (subtract) + REVERSAL CREDIT (add) = net 0 change
  - net_withdrawals includes: DEBIT (add) + REVERSAL (subtract) = net 0
  - Result: Neither wallet_liability nor net_withdrawals change
  - Invariant maintains balance

**Test Coverage:**
- `tests/services/withdrawal.pipeline.test.js` — integration test verifies debit + reversal netting
- `tests/services/systemInvariant.service.test.js` — unit tests verify:
  - Case A: Successful withdrawal (50000 contribution to withdrawals)
  - Case B: Failed withdrawal with reversal (0 contribution to withdrawals)
  - Case C: Mixed withdrawals (successful + failed nets correctly)

---

## Implementation: /backend/services/systemInvariantService.js

### checkFinancialInvariant()

**File:** `backend/services/systemInvariantService.js:124-267`

**Queries (in order):**
1. wallet_liability (direction-aware aggregation over user entries)
2. contest_pools (entry fees minus refunds)
3. active_contest_pools (for monitoring, not invariant calculation)
4. deposits (WALLET_DEPOSIT entries)
5. net_withdrawals (WALLET_WITHDRAWAL minus WALLET_WITHDRAWAL_REVERSAL)
6. entry breakdown (for diagnostics)

**Return Structure:**
```javascript
{
  status: 'BALANCED' | 'DRIFT' | 'CRITICAL_IMBALANCE' | 'ERROR',
  timestamp: ISO-8601,
  invariant_equation: 'wallet_liability + contest_pools = deposits - net_withdrawals',
  values: {
    wallet_liability_cents: number,
    contest_pools_cents: number,
    deposits_cents: number,
    withdrawals_cents: number,
    left_side_cents: number,
    right_side_cents: number,
    difference_cents: number
  },
  details: {
    entry_count_by_type: { ... },
    active_contest_pools_total_cents: number,
    anomalies: [ { type, difference_cents, message } ]
  }
}
```

---

## Rule: All Financial Invariants Provable via Deterministic Queries

**REQUIREMENT:** Every invariant check must be executable as a pure SELECT query over the ledger.

**Enforcement:**
- ✅ wallet_liability = SELECT SUM(CASE WHEN direction...) (deterministic)
- ✅ net_withdrawals = SELECT SUM(CASE WHEN entry_type...) (deterministic)
- ✅ deposits = SELECT SUM(amount) WHERE entry_type = 'WALLET_DEPOSIT' (deterministic)
- ✅ contest_pools = SELECT SUM(CASE WHEN entry_type...) (deterministic)

**Forbidden:**
- ❌ Inference from worker states (indirect, not deterministic)
- ❌ Computed balances from mutable columns (mutability violates ledger principle)
- ❌ Assumptions about payment processor state (external state, not provable)

---

## Testing

### Integration Test: withdrawal.pipeline.test.js

Test: "reconciliation invariant: debit + reversal pair nets to zero withdrawals"

Verifies:
1. WALLET_WITHDRAWAL DEBIT inserted at REQUESTED
2. WALLET_WITHDRAWAL_REVERSAL CREDIT inserted on FAILED
3. Net withdrawal calculation: 50000 - 50000 = 0
4. User balance fully restored: 100000 (unchanged)

**Proof:** Running against real database, proving ledger behavior end-to-end

### Unit Tests: systemInvariant.service.test.js

**Case A:** Successful withdrawal
```
wallet_liability=50000, deposits=100000, net_withdrawals=50000
Equation: 50000 + 0 = 100000 - 50000 ✓ BALANCED
```

**Case B:** Failed withdrawal with reversal
```
wallet_liability=100000, deposits=100000, net_withdrawals=0
Equation: 100000 + 0 = 100000 - 0 ✓ BALANCED
```

**Case C:** Mixed withdrawals (successful + failed)
```
wallet_liability=100000, deposits=200000, net_withdrawals=100000
Equation: 100000 + 0 = 200000 - 100000 ✓ BALANCED
```

**Proof:** All three scenarios verify the invariant holds with direction-aware aggregation

---

## Authority References

### Governance Documents
- `docs/governance/FINANCIAL_INVARIANTS.md` — wallet debit & entry fee immutability
- `docs/governance/LEDGER_ARCHITECTURE_AND_RECONCILIATION.md` — ledger mutation rules

### Implementation
- `backend/services/systemInvariantService.js` — checkFinancialInvariant function
- `backend/tests/services/withdrawal.pipeline.test.js` — integration test
- `backend/tests/services/systemInvariant.service.test.js` — unit tests

### Code Evidence
- Query at lines 127-144 (wallet_liability, direction-aware)
- Query at lines 183-193 (net_withdrawals, debit minus reversal)
- Test cases at lines 71-130 (withdrawal scenarios A, B, C)
