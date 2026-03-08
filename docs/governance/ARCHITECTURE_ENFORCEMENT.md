# Architecture Enforcement

This document tracks enforcement guardrails introduced to maintain design system authority and prevent architectural drift.

---

## Phase 6 — Radius Token Enforcement (CLOSED)

### Summary
Complete migration of all numeric corner radius literals to centralized design tokens. Established first enforcement guard to prevent regression.

### Migration Details
- **Total instances migrated:** 37 files across Views, Components, and Services
- **Token compliance:** 100% of `.cornerRadius()` calls now use `DesignTokens.Radius`
- **RoundedRectangle compliance:** 100% of `RoundedRectangle(cornerRadius:)` calls use token values

### Intentional Exceptions
- **LineupView.swift, line 289:** 2px decorative micro-radius preserved for specific visual treatment

### Enforcement
- **CI Guard:** `ios-app/scripts/enforce-radius-tokens.sh`
- **Trigger:** Detects numeric literals in `.cornerRadius()` calls
- **Scope:** Excludes `DesignTokens.Radius` usage and documented exceptions
- **Failure mode:** CI exits with error on violation

### Definition of Done
✓ All numeric radius literals eliminated
✓ 100% token-driven corner radius system
✓ No layout drift introduced
✓ No modifier reordering
✓ Shadow integrity preserved
✓ Design system authority enforced
✓ CI guard in place

### Enforcement Rule (Going Forward)
**Numeric `.cornerRadius()` usage is forbidden.**
All corner radius values must come from `DesignTokens.Radius`.

Violations will fail CI and must be corrected before merge.

---

## Phase 6C — Spacing & Padding Normalization (CLOSED)

### Summary
Complete migration of all numeric spacing and padding literals to centralized design tokens. Established second enforcement guard to prevent regression of spacing standardization.

### Migration Details
- **Total instances migrated:** 85+ spacing and padding normalizations
- **Files modified:** 19 Views across core views, helpers, utilities, and components
- **Token compliance:** 100% of mapped spacing values (4,6,8,12,16,20,24) now use `DesignTokens.Spacing`
- **Padding compliance:** 100% of `.padding()` directional calls use token values

### Token Mapping
| Token | Value | Usage |
|-------|-------|-------|
| `DesignTokens.Spacing.xxs` | 4 | Extra-tight spacing (23 usages) |
| `DesignTokens.Spacing.xs` | 6 | Tight spacing (8 usages) |
| `DesignTokens.Spacing.sm` | 8 | Small spacing (11 usages) |
| `DesignTokens.Spacing.md` | 12 | Medium spacing (20 usages) |
| `DesignTokens.Spacing.lg` | 16 | Large spacing (17 usages) |
| `DesignTokens.Spacing.xl` | 20 | Extra-large spacing (13 usages) |
| `DesignTokens.Spacing.xxl` | 24 | Double extra-large spacing (1 usage) |

### Intentional Exceptions (Documented)
- **spacing: 0** (9 usages) — Stacked layouts where no separation is needed
- **spacing: 2** (8 usages) — Tightly grouped items (not tokenized)
- **spacing: 3** (3 usages) — Custom interior spacing for specific components
- **spacing: 10** (3 usages) — Non-standard context-specific spacing
- **spacing: 15** (4 usages) — Non-standard context-specific spacing
- **spacing: 30** (2 usages) — Section breaks (larger than xxl, not in standard token set)

These exceptions are allowed because they are context-specific and do not fit standard spacing intervals.

### Enforcement
- **CI Guard:** `ios-app/scripts/enforce-spacing-tokens.sh`
- **Trigger:** Detects numeric literals in `spacing:` and `.padding()` calls
- **Scope:** Blocks mapped values (4,6,8,12,16,20,24) unless using `DesignTokens.Spacing`
- **Exceptions:** Allows 0,2,3,10,15,30 as documented context-specific values
- **Failure mode:** CI exits with error on violation

### Definition of Done
✓ All numeric spacing/padding literals eliminated (mapped values)
✓ 100% token-driven spacing system
✓ No layout drift introduced
✓ No modifier reordering
✓ No spacing degradation in compact views
✓ Design system authority enforced
✓ CI guard in place

### Enforcement Rule (Going Forward)
**Numeric spacing/padding usage for standardized values is forbidden.**
All mapped spacing values (4,6,8,12,16,20,24) must come from `DesignTokens.Spacing`.

Exception values (0,2,3,10,15,30) are allowed for documented context-specific spacing only.

Violations of mapped values will fail CI and must be corrected before merge.

---

## Phase X — Financial Ledger Enforcement (CRITICAL)

### Purpose

Prevent financial corruption and unauthorized mutation of wallet balances.

The ledger is the single source of truth for all financial state. This enforcement layer ensures no code bypasses ledger operations or directly mutates balances.

### Rules

#### 1. Ledger rows are append-only

Ledger entries must never be updated or deleted.

Corrections must be implemented using compensating ledger entries.

**Forbidden patterns:**
```sql
UPDATE ledger SET ...
DELETE FROM ledger WHERE ...
```

**Correct pattern:**
```sql
INSERT INTO ledger (..., entry_type, direction, ...)
VALUES (..., 'ADJUSTMENT', 'CREDIT', ...)
```

---

#### 2. Wallet balances must never be mutated directly

Wallet balances must always be computed from ledger entries.

Direct balance mutation is forbidden.

**Forbidden patterns:**
```sql
UPDATE users SET balance = ...
UPDATE wallets SET balance = ...
```

**Correct pattern:**
```javascript
// Balance is always computed from ledger
const balance = SUM(CREDIT - DEBIT) WHERE user_id = $1
```

---

#### 3. Financial writes must be atomic

All ledger mutations must occur inside a single database transaction.

Operations that involve multiple writes (e.g. participant insert + ledger debit) must commit or rollback together.

**Forbidden pattern:**
```javascript
// ❌ BAD: Two separate transactions
await insertParticipant(pool, ...);
await insertLedgerDebit(pool, ...);
```

**Correct pattern:**
```javascript
// ✅ GOOD: Single transaction
const client = await pool.connect();
await client.query('BEGIN');
try {
  await insertParticipant(client, ...);
  await insertLedgerDebit(client, ...);
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
}
```

---

#### 4. Idempotency keys are mandatory

Every ledger mutation must include a deterministic idempotency_key.

This ensures duplicate operations cannot create multiple financial entries.

**Forbidden pattern:**
```javascript
// ❌ BAD: No idempotency key
INSERT INTO ledger (user_id, amount_cents, ...)
VALUES (userId, 100, ...)
```

**Correct pattern:**
```javascript
// ✅ GOOD: Deterministic idempotency key
const idempotencyKey = `entry_fee:${contestInstanceId}:${userId}`;
INSERT INTO ledger (user_id, amount_cents, idempotency_key, ...)
VALUES (userId, 100, idempotencyKey, ...)
```

---

#### 5. Financial invariant protection

Workers must not introduce logic that violates the reconciliation invariant:

**wallet_liability + contest_pools = deposits - withdrawals**

If a change risks violating this equation, the worker must stop and escalate.

**Invariant Check:**
```javascript
// Before any financial change, verify
const walletLiability = SUM(ledger entries WHERE user_id IS NOT NULL);
const contestPools = SUM(entry_fees) - SUM(refunds);
const deposits = SUM(wallet deposits);
const withdrawals = SUM(wallet withdrawals);

if (walletLiability + contestPools !== deposits - withdrawals) {
  throw new Error('Reconciliation invariant violated');
}
```

---


