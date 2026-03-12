# Financial Boundary Rule

**Status**: ENFORCEABLE — AI Worker Governance
**Effective Date**: 2026-03-11
**Severity**: CRITICAL — Direct Impact on User Funds

---

## PURPOSE

Prevent accidental modification of money-critical systems by AI workers.

Financial systems must be treated as **protected infrastructure**. These components directly affect:
- User funds (deposits, withdrawals)
- Wallet balances (real-time visibility)
- Contest entry fees (debit accuracy)
- Payouts (settlement correctness)

### Why This Rule Exists

Financial systems have the highest risk:
- **User Trust**: Incorrect balance → loss of trust
- **Legal Liability**: Incorrect ledger → reconciliation failures
- **Data Integrity**: Mutable ledger → audit trail compromised
- **Idempotency**: Duplicate transactions → double-debit risks

A single accidental change can cause:
- Financial reconciliation errors
- User balance mismatches
- Regulatory compliance violations
- Customer support escalations

This rule prevents AI workers from modifying these systems without explicit architect oversight.

---

## PROTECTED SYSTEMS

### Database Tables (Ledger)

The following tables are **APPEND-ONLY** and cannot be modified except by append operations:

| Table | Purpose | Protection |
|-------|---------|-----------|
| `ledger` | Transaction log for all financial entries | NO UPDATE/DELETE allowed |
| `wallet_deposit_intents` | Stripe deposit tracking | Append-only |
| `wallet_withdrawals` | User withdrawal requests | Append-only status updates only |
| `payout_requests` | Prize claim requests | Append-only |
| `payout_jobs` | Batch payout coordination | Append-only |
| `payout_transfers` | Individual payout distribution | Append-only |
| `financial_reconciliations` | System reconciliation snapshots | Append-only |
| `financial_reconciliation_snapshots` | Ledger snapshot history | Append-only |

**Critical Rule**: No SQL UPDATE or DELETE operations are allowed on these tables except:
- Status transitions (PENDING → PROCESSING → COMPLETED)
- Timestamp updates (processed_at, updated_at)
- Append-only inserts

### API Routes (Financial Endpoints)

The following routes handle money and must maintain contract integrity:

| Route | File | Protection |
|-------|------|-----------|
| `GET /api/wallet` | `backend/routes/wallet.routes.js` | Authentication + balance contract frozen |
| `POST /api/wallet/withdraw` | `backend/routes/withdraw.routes.js` | Withdrawal flow integrity |
| `POST /api/wallet/deposit` | `backend/routes/deposit.routes.js` | Deposit flow integrity |
| `GET /api/wallet/transactions` | `backend/routes/wallet.routes.js` | Ledger history endpoint |
| `POST /api/wallet/deposit/verify` | `backend/routes/deposit.routes.js` | Stripe webhook handling |

**Contract Rules**:
- Response schemas are frozen (cannot add/remove fields)
- Error codes are frozen (cannot change HTTP status meanings)
- Authentication methods are frozen (see WALLET_AUTH_CONTRACT.md)

### Core Services (Financial Logic)

The following services implement financial business logic:

| Service | File | Protection |
|---------|------|-----------|
| Ledger Repository | `backend/repositories/LedgerRepository.js` | Balance computation logic |
| Withdrawal Service | `backend/services/withdrawalService.js` | Withdrawal request handling |
| Deposit Service | `backend/services/depositService.js` | Deposit flow coordination |
| Payout Service | `backend/services/payoutService.js` | Settlement and payouts |
| Custom Contest Service | `backend/services/customContestService.js` | Contest join (with wallet debit) |

**Protected Methods** (cannot be modified without approval):
- `LedgerRepository.getWalletBalance()` — Balance query
- `LedgerRepository.computeWalletBalance()` — Balance computation
- `withdrawalService.initiateWithdrawal()` — Withdrawal validation
- `depositService.processDeposit()` — Deposit coordination
- `payoutService.settlePayouts()` — Payout execution
- `customContestService.joinContest()` — Contest join + debit

---

## FINANCIAL INVARIANTS

### Rule 1: Ledger Immutability

**Statement**: The ledger is append-only. No historical transactions may be modified or deleted.

**Enforcement**:
```sql
-- Allowed: INSERT
INSERT INTO ledger (user_id, entry_type, direction, amount_cents, ...)
VALUES (...);

-- FORBIDDEN: UPDATE
UPDATE ledger SET amount_cents = 5000 WHERE id = '...';

-- FORBIDDEN: DELETE
DELETE FROM ledger WHERE user_id = '...';

-- Allowed: Status transitions (for withdrawal/payout records)
UPDATE wallet_withdrawals SET status = 'COMPLETED' WHERE id = '...';
```

**Reasoning**: Ledger is the audit trail. Mutating it compromises financial reconciliation.

### Rule 2: Wallet Balance Derivation

**Statement**: Wallet balance is computed exclusively from ledger entries. It is never stored as a mutable field.

**Computation**:
```sql
SELECT COALESCE(
  SUM(CASE
    WHEN direction = 'CREDIT' THEN amount_cents
    WHEN direction = 'DEBIT'  THEN -amount_cents
  END),
  0
) AS balance_cents
FROM ledger
WHERE user_id = ?
```

**Requirements**:
- Filter: `WHERE user_id = ?` (sum all entries for user, all types)
- No reference_type filtering (ENTRY_FEE, WALLET_DEPOSIT, PAYOUT all included)
- No entry_type filtering (all types contribute)
- Result: SUM(CREDIT) - SUM(DEBIT)

**Violation Indicators**:
- Balance query filters by reference_type (e.g., WHERE reference_type='WALLET')
- Balance query excludes entry_type (e.g., WHERE entry_type != 'ENTRY_FEE')
- Balance stored in users or wallets table instead of computed
- Balance not updated when ledger insert succeeds

### Rule 3: Contest Join Atomicity

**Statement**: When a user joins a contest, two operations must succeed atomically:
1. Insert into contest_participants
2. Insert DEBIT into ledger

**Implementation**:
```javascript
// Within single transaction:
INSERT INTO contest_participants (contest_instance_id, user_id, ...)
  ON CONFLICT DO NOTHING
  RETURNING id;

// Only if participant insert succeeded:
INSERT INTO ledger (
  user_id, entry_type='ENTRY_FEE', direction='DEBIT',
  amount_cents=contest.entry_fee_cents, reference_type='CONTEST', ...
)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id;

COMMIT;
```

**Violations**:
- Participant inserted but ledger debit skipped
- Ledger debit inserted but participant failed
- Debit created twice (idempotency failure)
- Debit with wrong amount_cents

### Rule 4: Deposit Ledger Credit

**Statement**: All user wallet deposits must create a corresponding ledger CREDIT entry.

**Types of Deposits**:
- Stripe successful charge → ledger CREDIT
- Bank transfer received → ledger CREDIT
- Promotional bonus → ledger CREDIT (if applicable)

**Requirements**:
- Entry type: WALLET_DEPOSIT
- Direction: CREDIT
- reference_type: WALLET or STRIPE_CHARGE
- amount_cents: from deposit_intents.amount_cents
- Idempotency key: prevent duplicates

### Rule 5: Withdrawal Ledger Debit

**Statement**: All user wallet withdrawals must create a corresponding ledger DEBIT entry.

**Types of Withdrawals**:
- Payout to Stripe → ledger DEBIT
- Cash-out request → ledger DEBIT
- Refund → ledger CREDIT (opposite direction)

**Requirements**:
- Entry type: WALLET_WITHDRAWAL
- Direction: DEBIT
- reference_type: WALLET_WITHDRAWAL or STRIPE_PAYOUT
- amount_cents: from withdrawal_request.amount_cents
- Idempotency key: prevent double-withdrawals

### Rule 6: Wallet API Balance Contract

**Statement**: The wallet API must always return the ledger-derived balance in the expected format.

**Endpoint**: `GET /api/wallet`

**Response Contract**:
```json
{
  "balance_cents": <integer>
}
```

**Guarantees**:
- balance_cents is always present
- balance_cents is always an integer (0 or positive, never negative)
- balance_cents reflects all ledger entries for the user
- Response is computed fresh on each request (no stale cache)

**Violations**:
- Response missing balance_cents field
- Response includes other fields (deprecated but not removed)
- balance_cents is negative
- balance_cents excludes recent ledger entries

---

## AI WORKER SAFETY RULE

### STOP Conditions (Do Not Proceed)

If you are an AI worker and you encounter ANY of these conditions, **STOP immediately**:

- [ ] Task modifies `backend/routes/wallet.routes.js`
- [ ] Task modifies `backend/routes/withdraw.routes.js`
- [ ] Task modifies `backend/routes/deposit.routes.js`
- [ ] Task modifies `backend/repositories/LedgerRepository.js`
- [ ] Task modifies `backend/services/withdrawalService.js`
- [ ] Task modifies `backend/services/depositService.js`
- [ ] Task modifies `backend/services/payoutService.js`
- [ ] Task involves schema changes to `ledger` table
- [ ] Task involves schema changes to `wallet_deposit_intents` table
- [ ] Task involves schema changes to `wallet_withdrawals` table
- [ ] Task involves schema changes to `payout_*` tables
- [ ] Task involves changing wallet balance computation
- [ ] Task involves filtering ledger by reference_type or entry_type
- [ ] Task involves UPDATE or DELETE on ledger
- [ ] Task involves changing wallet API response format
- [ ] Task involves changing withdrawal or payout pipeline
- [ ] Task involves bypassing financial validation

### Required Response

If ANY STOP condition is met, respond with:

```
FINANCIAL BOUNDARY RULE ACTIVATED

This task requires modification to protected financial infrastructure:
[list which STOP conditions were met]

Protected systems require architect approval per FINANCIAL_BOUNDARY_RULE.md

Stopping work and requesting architect approval.

Link: docs/governance/FINANCIAL_BOUNDARY_RULE.md
```

### Forbidden Actions

AI workers must NOT:

- **Modify ledger schema** — Append-only table cannot change
- **Change wallet balance computation** — Ledger sum is the only source of truth
- **Add UPDATE/DELETE to ledger** — History must be immutable
- **Bypass financial validation** — All money flows must be validated
- **Remove idempotency checks** — Duplicates cause double-debits
- **Change error handling in payment flows** — Silent failures break reconciliation
- **Cache wallet balance** — Balance must be live from ledger

---

## ARCHITECT APPROVAL REQUIRED FOR

The following changes require explicit architect approval before implementation:

### Schema Changes

- [ ] Any modification to `ledger` table structure
- [ ] Any modification to `wallet_deposit_intents` table
- [ ] Any modification to `wallet_withdrawals` table
- [ ] Any modification to `payout_requests`, `payout_jobs`, `payout_transfers`
- [ ] Any modification to `financial_reconciliation*` tables
- [ ] New indexes on financial tables
- [ ] Partition strategy changes on ledger

### Query Logic Changes

- [ ] Modifications to ledger balance computation (WHERE clause)
- [ ] Changes to wallet API query logic
- [ ] Changes to withdrawal validation
- [ ] Changes to deposit coordination
- [ ] Changes to payout settlement logic
- [ ] Changes to financial reconciliation queries

### API Contract Changes

- [ ] Adding fields to wallet API response
- [ ] Removing fields from wallet API response
- [ ] Changing wallet API response types
- [ ] Changing withdrawal endpoint behavior
- [ ] Changing deposit endpoint behavior
- [ ] Changing error codes or HTTP status meanings

### Pipeline Changes

- [ ] Modification to contest join → ledger debit flow
- [ ] Changes to deposit → ledger credit flow
- [ ] Changes to withdrawal → ledger debit flow
- [ ] Changes to payout settlement
- [ ] Changes to refund logic
- [ ] Changes to financial reconciliation

### Migration Changes

- [ ] Any migration touching financial tables
- [ ] Data migrations on ledger (even read-only analysis)
- [ ] Schema rollbacks on financial tables

---

## VERIFICATION QUERIES

### Query 1: Ledger Integrity Check

**Purpose**: Verify ledger entries are well-formed and not corrupted.

```sql
-- Check for invalid ledger entries
SELECT COUNT(*) as invalid_entries
FROM ledger
WHERE direction NOT IN ('CREDIT', 'DEBIT')
   OR amount_cents < 0
   OR user_id IS NULL
   OR entry_type IS NULL
   OR created_at IS NULL;

-- Expected result: 0
```

**If result > 0**: Ledger has corrupted entries. Investigate and report to architect.

### Query 2: Wallet Balance Calculation Reference

**Purpose**: Verify balance computation includes all entry types.

```sql
-- Get actual balance for a user from ledger
SELECT
  user_id,
  SUM(CASE
    WHEN direction = 'CREDIT' THEN amount_cents
    WHEN direction = 'DEBIT'  THEN -amount_cents
  END) AS computed_balance,
  COUNT(CASE WHEN direction = 'CREDIT' THEN 1 END) as credit_count,
  COUNT(CASE WHEN direction = 'DEBIT' THEN 1 END) as debit_count
FROM ledger
WHERE user_id = :<user_id>
GROUP BY user_id;

-- Expected: computed_balance = SUM(CREDIT) - SUM(DEBIT)
```

### Query 3: Ledger Entry Type Distribution

**Purpose**: Verify all expected entry types are present and correct.

```sql
-- Check entry type distribution
SELECT
  entry_type,
  direction,
  COUNT(*) as count,
  SUM(amount_cents) as total_cents
FROM ledger
GROUP BY entry_type, direction
ORDER BY entry_type, direction;

-- Expected: ENTRY_FEE entries should have direction='DEBIT'
--           WALLET_DEPOSIT entries should have direction='CREDIT'
--           PAYOUT entries should have direction='CREDIT'
```

### Query 4: Contest Join Atomicity Check

**Purpose**: Verify contest joins created corresponding ledger debits.

```sql
-- Find contests joined without ledger entries
SELECT
  ci.id as contest_id,
  cp.user_id,
  ci.entry_fee_cents,
  COUNT(l.id) as ledger_entries
FROM contest_instances ci
JOIN contest_participants cp ON cp.contest_instance_id = ci.id
LEFT JOIN ledger l ON l.reference_id = ci.id
                  AND l.user_id = cp.user_id
                  AND l.entry_type = 'ENTRY_FEE'
GROUP BY ci.id, cp.user_id, ci.entry_fee_cents
HAVING COUNT(l.id) = 0;

-- Expected result: 0 rows (all joins have ledger entries)
```

### Query 5: Wallet Deposit Verification

**Purpose**: Verify all deposit intents have corresponding ledger credits.

```sql
-- Find deposits without ledger credits
SELECT
  wdi.id as deposit_id,
  wdi.user_id,
  wdi.amount_cents,
  COUNT(l.id) as ledger_entries
FROM wallet_deposit_intents wdi
LEFT JOIN ledger l ON l.reference_id = wdi.id
                  AND l.user_id = wdi.user_id
                  AND l.entry_type = 'WALLET_DEPOSIT'
                  AND l.direction = 'CREDIT'
WHERE wdi.status = 'SUCCEEDED'
GROUP BY wdi.id, wdi.user_id, wdi.amount_cents
HAVING COUNT(l.id) = 0;

-- Expected result: 0 rows (all successful deposits have ledger credits)
```

### Query 6: Idempotency Key Check

**Purpose**: Verify idempotency keys prevent duplicate transactions.

```sql
-- Check for duplicate idempotency keys (should not exist)
SELECT
  idempotency_key,
  COUNT(*) as occurrences,
  SUM(CASE WHEN direction = 'DEBIT' THEN amount_cents ELSE 0 END) as total_debits,
  SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents ELSE 0 END) as total_credits
FROM ledger
WHERE idempotency_key IS NOT NULL
GROUP BY idempotency_key
HAVING COUNT(*) > 1;

-- Expected result: 0 rows (idempotency keys are unique)
```

---

## ESCALATION PROCESS

If you discover a financial system issue:

1. **Do NOT modify code** to fix it
2. **Document the issue**:
   - What is wrong (e.g., ledger entry missing)
   - How you discovered it (verification query)
   - Impact (which users affected)
3. **Report to architect**:
   - Create issue with tag `financial-critical`
   - Attach query results
   - Do NOT propose code changes
4. **Wait for architect review**
5. **Architect will**:
   - Investigate root cause
   - Determine if ledger repair needed
   - Design fix (may require migration or reconciliation)
   - Request AI worker to implement fix

---

## REVISION HISTORY

| Date | Author | Change | Reason |
|------|--------|--------|--------|
| 2026-03-11 | Architect | Created (v1.0) | Establish financial boundary rule for AI workers |

---

## REFERENCES

### Related Governance Documents

- `WALLET_AUTH_CONTRACT.md` — Wallet authentication frozen contract
- `FINANCIAL_INVARIANTS.md` — Ledger architecture and reconciliation rules
- `CLAUDE_RULES.md` — Global governance (Section 8: Never Weaken Safety)

### Related Code

- `backend/repositories/LedgerRepository.js`
- `backend/routes/wallet.routes.js`
- `backend/services/customContestService.js` (joinContest)
- `backend/services/withdrawalService.js`
- `backend/services/depositService.js`

### Incidents

- **2026-03-03 13:11 UTC**: Ledger balance query filter changed to reference_type (regression)
- **2026-03-04 08:20 UTC**: Fix applied, balance query reverted to user_id
- **2026-03-10 21:55 UTC**: Wallet auth simplified, removed JWT support
- **2026-03-11 04:00 UTC**: User reported balance not updating
- **2026-03-11 06:00 UTC**: Root cause identified, fix applied
- **2026-03-11 07:00 UTC**: This governance rule created

---

## QUICK REFERENCE

### Protected Areas

| Area | Protection |
|------|-----------|
| Ledger table | Append-only, no UPDATE/DELETE |
| Wallet API | Contract frozen, authentication required |
| Balance computation | Must sum all ledger entries by user |
| Contest join | Must create participant + ledger debit atomically |
| Deposit flow | Must create ledger CREDIT |
| Withdrawal flow | Must create ledger DEBIT |

### When to STOP

- Modifying wallet routes
- Changing balance computation
- Modifying ledger schema
- Updating withdrawal/payout logic
- Any financial table migration

### What to Do

1. STOP (do not modify)
2. Document the issue
3. Request architect approval
4. Wait for guidance
5. Implement only after approval

**Remember**: Financial systems affect user trust and legal compliance. Caution always wins.
