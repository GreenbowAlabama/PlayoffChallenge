# FINANCIAL MODEL — PLAYOFF CHALLENGE

## Core Reconciliation Equation

```
Deposits − Withdrawals = Wallet Liability + Contest Pools
```

The ledger net (all credits minus debits) must equal the sum of wallet liability and contest pools. This is the authoritative reconciliation invariant.

---

## Money Flow Through the System

```
User Deposits (Stripe)
    │
    ▼
Wallet Liability
(User funds held in platform wallets)
    │
    ├─→ WALLET_DEPOSIT ledger entries
    │   (money enters user wallets)
    │
    ▼
Contest Entry Fees
(User enters contest, pays entry)
    │
    ├─→ ENTRY_FEE ledger entries (debits from wallet)
    │   WALLET_DEBIT (atomic wallet withdrawal)
    │
    ▼
Contest Pools
(Entry fees accumulate in contest accounting)
    │
    ├─→ ENTRY_FEE ledger entries (credits to pool)
    │   Pool balance = entry fees − refunds − payouts
    │
    ▼
Prize Payouts
(Settlement calculates and distributes prizes)
    │
    ├─→ PRIZE_PAYOUT ledger entries (debits from pool)
    │
    ▼
Wallet Liability
(Prize money returns to user wallets)
    │
    ├─→ WALLET_DEPOSIT ledger entries
    │   (money credits back to wallets)
    │
    ▼
User Withdrawals (Stripe)
    │
    ├─→ WALLET_WITHDRAWAL ledger entries
    │
```

---

## Domain Separation

The financial system is split into two mutually exclusive domains:

### Wallet Domain
**Purpose:** Track user funds in platform wallets

**Ledger Entry Types:**
- `WALLET_DEPOSIT` — User funds a wallet (CREDIT)
- `WALLET_WITHDRAWAL` — User withdraws from wallet (DEBIT)
- `WALLET_WITHDRAWAL_REVERSAL` — Reversal of withdrawal (CREDIT)
- `WALLET_DEBIT` — Atomic debit when entering contest (DEBIT)

**Calculation:**
```
wallet_liability = SUM(WALLET_DEPOSIT CREDIT)
                 - SUM(WALLET_WITHDRAWAL DEBIT)
                 + SUM(WALLET_WITHDRAWAL_REVERSAL CREDIT)
                 - SUM(WALLET_DEBIT DEBIT)
```

### Contest Domain
**Purpose:** Track entry fees and prize allocations within contests

**Ledger Entry Types:**
- `ENTRY_FEE` — Entry fee collected (DEBIT from wallet, CREDIT to pool)
- `ENTRY_FEE_REFUND` — Refund of entry fee (CREDIT back to wallet)

**Calculation:**
```
contest_pool = SUM(ENTRY_FEE CREDIT)
             - SUM(ENTRY_FEE_REFUND DEBIT)
```

**Note:** PRIZE_PAYOUT and related entries are part of the settlement domain, not contest pool accounting.

---

## Reconciliation Model

### The Invariant

At any point in time, the platform must satisfy:

```
ledger_net = deposits − withdrawals
           = wallet_liability + contest_pools
```

Where:
- `ledger_net` = SUM(all CREDIT entries) − SUM(all DEBIT entries)
- `deposits` = SUM(WALLET_DEPOSIT CREDIT entries)
- `withdrawals` = SUM(WALLET_WITHDRAWAL DEBIT entries)
- `wallet_liability` = net of wallet-domain entries
- `contest_pools` = net of contest-domain entries

### What This Means

1. **Stripe Balance** must cover all liabilities:
   ```
   Stripe Balance ≥ Wallet Liability
   ```

2. **Ledger is the source of truth**, not Stripe:
   - Stripe balance fluctuates (pending, available, clearing delays)
   - Ledger is deterministic and immutable
   - Reconciliation ensures ledger accurately reflects Stripe activity

3. **Domains are separate**, never double-counted:
   - Wallet liability is what we owe users
   - Contest pools are internal accounting for contest settlement
   - A user's entry fee creates a debit in wallet but credit in pool
   - These are two sides of the same transaction, not additive

---

## Platform Float

The amount of platform funds available for operations:

```
platform_float = Stripe Balance − Wallet Liability
```

**Note:** Contest pools are NOT subtracted. They are internal accounting that will eventually resolve when settlements complete.

---

## Financial Integrity Checks

### 1. Ledger Integrity
```
SUM(CREDIT entries) − SUM(DEBIT entries) = calculated net
```

Ensures the ledger is self-consistent.

### 2. Domain Balance
```
wallet_liability + contest_pools = ledger_net
```

Ensures all ledger entries are properly classified into one of the two domains.

### 3. Liquidity Coverage
```
Stripe Balance ÷ Wallet Liability ≥ 1.05
```

A 5% buffer above wallet liability ensures we can cover unexpected Stripe delays.

### 4. Reconciliation Check
```
wallet_liability = deposits − withdrawals
```

Ensures wallet accounting matches Stripe cash flow.

---

## Settlement and Adjustments

Settlement is a separate domain (PRIZE_PAYOUT, PRIZE_PAYOUT_REVERSAL entries) that:
- Debits contest pools (removes funds from contest)
- Credits wallet liability (returns funds to users)

Example settlement flow:
1. Contest has pool balance of $1000 (entry fees)
2. Settlement calculates payouts
3. `PRIZE_PAYOUT` entries debit the pool, credit the ledger
4. `WALLET_DEPOSIT` entries credit user wallets
5. Pool balance decreases, wallet liability increases
6. Net reconciliation remains balanced

---

## Anomalies

### Negative Pool Contests
Indicates payouts exceeded entry fees collected. Root causes:
- Refunds issued but payouts not reversed
- Payout calculation error
- Incomplete ledger recording

### Orphaned Funds
User wallet balances with no active contests. Requires:
- Investigation of root cause
- Manual refund/adjustment if appropriate
- Ledger correction entry

### Ledger Imbalance
Credits and debits don't net correctly. Indicates:
- Data corruption
- Missing ledger entries
- System bug

**Action:** Stop, investigate, never modify ledger directly. Use compensating entries only.

---

## Design Principles

1. **Ledger is append-only and immutable** — corrections use compensating entries
2. **Double-entry bookkeeping** — every transaction has a debit and credit
3. **Domain separation prevents double-counting** — wallet and contest are mutually exclusive
4. **Stripe is the cash source** — ledger must reconcile to Stripe activity
5. **Deterministic and replayable** — same inputs always produce same ledger
6. **Idempotent operations** — re-running settlement doesn't create duplicates

---

## For Developers

When adding financial operations:

1. **Identify the domain** — wallet, contest, or settlement
2. **Choose entry types** — from the approved list only
3. **Create both debit and credit** — ledger requires both sides
4. **Update reconciliation** — ensure invariant still holds
5. **Test with fixed test data** — replay against golden snapshots
6. **Never modify wallet balances** — always use ledger entries
7. **Never assume single contest** — all queries must be contest-scoped

---

## References

- `CLAUDE_RULES.md` — Governance rules and frozen invariants
- `FINANCIAL_INVARIANTS.md` — Wallet debit atomicity and settlement rules
- `backend/services/financialHealthService.js` — Reconciliation implementation
- `backend/db/schema.snapshot.sql` — Ledger table structure
