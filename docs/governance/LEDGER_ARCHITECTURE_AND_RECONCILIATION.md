# Ledger Architecture and Financial Reconciliation

**Status:** FROZEN — Authoritative Governance Document
**Governance Version:** 1
**Last Verified:** 2026-03-11
**Architecture Lock:** ACTIVE (See ARCHITECTURE_LOCK.md)
**Owner:** Architecture
**Last Updated:** 2026-03-07

---

# Purpose

This document defines the architecture and operational model of the 67 Games financial ledger.

It exists to prevent future confusion about:

• how wallet balances are calculated  
• how contest pools work  
• how deposits and withdrawals reconcile with Stripe  
• how to detect and repair corruption  

This document is authoritative for the financial system.

---

# Core Principle

The system follows a **Ledger-First Accounting Model**.

User balances are **not stored as a mutable field**.

Instead they are **derived from the ledger**.

All financial operations are represented as immutable ledger entries.

Ledger entries are **append-only**.

Updates and deletes are forbidden.

---

# Ledger Table Responsibilities

The ledger records every financial movement in the platform.

Examples include:

• wallet deposits  
• wallet withdrawals  
• contest entry fees  
• entry fee refunds  
• prize payouts  
• administrative adjustments  

Each entry includes:

id  
idempotency_key  
user_id (nullable)  
entry_type  
direction (DEBIT or CREDIT)  
amount_cents  
currency  
reference_type  
reference_id  
contest_instance_id (nullable)  
created_at  

The ledger is the **single source of truth** for all balances.

---

# Ledger Entry Semantics

Direction determines balance effect.

CREDIT = money entering a wallet or system liability  
DEBIT = money leaving a wallet or system liability

Example entries:

Wallet deposit:

entry_type: WALLET_DEPOSIT  
direction: CREDIT  

Wallet withdrawal:

entry_type: WALLET_WITHDRAWAL  
direction: DEBIT  

Contest entry:

entry_type: ENTRY_FEE  
direction: DEBIT  

Entry fee refund:

entry_type: ENTRY_FEE_REFUND  
direction: CREDIT  

Prize payout:

entry_type: PRIZE_PAYOUT  
direction: CREDIT  

---

# Wallet Balance Calculation

User wallet balance is computed from ledger rows.

SQL definition:

SUM(
  CASE
    WHEN direction = 'CREDIT' THEN amount_cents
    WHEN direction = 'DEBIT' THEN -amount_cents
  END
)

filtered by:

user_id = target_user

Wallet balances are never stored directly.

---

# Contest Pool Calculation

Contest pools represent money moved from user wallets into contest liability.

Contest pool formula:

ENTRY_FEE (DEBIT)
minus ENTRY_FEE_REFUND (CREDIT)
minus PRIZE_PAYOUT (CREDIT)
plus PRIZE_PAYOUT_REVERSAL (DEBIT)

Example:

Entry fees collected: $100  
Refunds: $20  
Payouts: $50  

Contest pool = $30

---

# Platform Liability Model

The platform has two categories of liability:

1. Wallet Liability
2. Contest Pool Liability

Wallet liability represents money owed to users.

Contest pools represent money temporarily held for contest payouts.

Total platform liability is:

wallet_liability + contest_pools

---

# Funding Sources

Platform funding comes from:

• Stripe deposits
• minus withdrawals

Equation:

deposits - withdrawals

---

# Reconciliation Equation

The system is financially coherent when:

wallet_liability + contest_pools = deposits - withdrawals

This equation must always hold.

If it does not hold, the system has drift.

---

# Stripe Accounting Model

User wallets represent the gross deposit amount.

Stripe processing fees are **not deducted from user wallets**.

Instead:

Stripe balance + Stripe fees = wallet liabilities - platform rake

Stripe fees are treated as a **platform expense**, not a user debit.

---

# Ledger Invariants

The following invariants must always hold.

No negative wallets  
ENTRY_FEE must always be DEBIT  
ENTRY_FEE_REFUND must always be CREDIT  
Ledger entries must include reference_id  
Ledger must be append-only  
Stripe idempotency keys must be unique  
Contest pools cannot be negative  

Violations indicate corruption.

---

# Known Corruption Scenarios

The following issues have occurred during development.

Withdrawal without balance validation  
Orphaned ledger rows  
ENTRY_FEE CREDIT entries created incorrectly  
ENTRY_FEE_REFUND DEBIT entries created incorrectly  
User deletion leaving orphan withdrawals  

These must be detected via reconciliation diagnostics.

---

# Repair Strategy

Ledger history must never be deleted.

Repairs are performed using **compensating ledger entries**.

Example repair:

Illegal withdrawal:

WALLET_WITHDRAWAL DEBIT $100

Repair entry:

ADJUSTMENT CREDIT $100

Net effect restores balance while preserving audit history.

---

# Operational Monitoring

The web-admin financial reconciliation dashboard monitors:

wallet liability  
contest pools  
deposits  
withdrawals  
reconciliation drift  
corruption diagnostics  

Alerts should trigger when drift is detected.

---

# Administrative Actions

Web-admin may support the following repair actions:

repair orphan withdrawals  
convert illegal ENTRY_FEE entries  
freeze negative wallets  
run ledger audit scripts  
export reconciliation reports  

All admin actions must be logged.

---

# Development Rules

Developers must follow these rules:

All financial writes must go through the ledger service.

Ledger writes must include idempotency keys.

Ledger writes must occur inside database transactions.

Contest joins must insert participant and ledger entry atomically.

Withdrawal service must verify balance before writing withdrawal entries.

---

# Conclusion

The ledger system is the financial backbone of the platform.

All balances, contest pools, and reconciliations derive from this table.

By enforcing ledger invariants and monitoring reconciliation, the platform maintains financial correctness and auditability.

