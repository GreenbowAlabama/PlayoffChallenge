# WALLET AUTHENTICATION CONTRACT

**Status**: FROZEN — Critical Financial Path
**Last Updated**: 2026-03-11
**Severity**: CRITICAL — Client Balance Visibility

---

## 1. PURPOSE

The wallet authentication contract is **frozen** because it directly affects financial correctness and real-time client balance visibility.

### Why This Matters

The wallet endpoint is the **only way** iOS clients see their updated balance after joining a contest.

**Flow**:
```
User joins contest
  ↓
contest_participants INSERT succeeds
  ↓
ledger DEBIT entry created (wallet -= entry_fee)
  ↓
iOS calls GET /api/wallet to refresh balance
  ↓
Wallet endpoint auth validates user
  ↓
LedgerRepository computes balance from ledger
  ↓
iOS UI updates with new balance
```

If the wallet endpoint **rejects authentication** at any step, the client cannot refresh and displays **stale cached balance**.

### March 10 Regression

Commit 5cc666e removed JWT Bearer token support from wallet routes, leaving only X-User-Id header.

**Result**:
- iOS client sends: `Authorization: Bearer {token}`
- Wallet endpoint responds: `401 Unauthorized`
- Client balance shows stale value despite ledger debit succeeding
- Appears as if funds were not deducted (they were)

**Duration**: ~7 hours before fix (Mar 10 21:55 → Mar 11 05:00 UTC)

---

## 2. AUTHENTICATION CONTRACT

### Frozen Requirements

Wallet endpoints **MUST** support **BOTH** authentication methods simultaneously:

#### Method 1: Authorization Bearer Token (JWT)

**Header**: `Authorization: Bearer <jwt_token>`

**Extraction**:
```javascript
const token = authHeader.split(' ')[1];
const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
const userId = payload.sub || payload.user_id;
```

**Supported payload fields** (in priority order):
1. `payload.sub` — Standard JWT subject claim
2. `payload.user_id` — Application-specific field

**Used by**: iOS client, external workers

#### Method 2: X-User-Id Header (Direct UUID)

**Header**: `X-User-Id: {uuid}`

**Extraction**:
```javascript
const userId = req.headers['x-user-id'];
```

**Used by**: Internal scripts, testing, server-to-server calls

### Fallback Order (IMMUTABLE)

1. Try Authorization Bearer token first
   - If decode succeeds → use extracted userId
   - If decode fails → continue to step 2
2. Try X-User-Id header
   - If present → use value
   - If not present → continue to step 3
3. Return 401 Unauthorized

**Important**: This order must NEVER change. Changing it breaks existing client assumptions.

### Files Implementing This Contract

- `backend/routes/wallet.routes.js` (lines 27-69)
  - `extractUserId()` middleware
  - **Critical section**: Bearer token decode + fallback logic

- `backend/routes/customContest.routes.js`
  - Line 46-66: extractUserId middleware
  - Must be kept in sync with wallet.routes.js

---

## 3. FINANCIAL INVARIANT

### Balance Computation

Wallet balance is derived (not stored) and computed from ledger:

```sql
SELECT COALESCE(
  SUM(CASE
    WHEN direction = 'CREDIT' THEN amount_cents
    WHEN direction = 'DEBIT' THEN -amount_cents
  END),
  0
) as balance_cents
FROM ledger
WHERE user_id = ?
```

**Source of truth**: `backend/repositories/LedgerRepository.js`
- `getWalletBalance(pool, userId)` — Public API
- `computeWalletBalance(client, userId)` — Transaction context

**Important**: Query filters by `user_id` (NOT reference_type). All ledger entries (ENTRY_FEE, WALLET_DEPOSIT, WALLET_WITHDRAWAL, PAYOUT, etc.) contribute to balance.

### Ledger Entry Types That Affect Balance

| Entry Type | Direction | Reason |
|-----------|-----------|--------|
| ENTRY_FEE | DEBIT | User joins contest, pays fee |
| ENTRY_FEE_REFUND | CREDIT | User leaves contest, gets refund |
| WALLET_DEPOSIT | CREDIT | User adds money via Stripe |
| WALLET_WITHDRAWAL | DEBIT | User cashes out |
| CONTEST_PAYOUT | CREDIT | User wins contest |
| PAYOUT_COMPLETED | CREDIT | Settlement completed |

### Critical Dependency Chain

```
Ledger (immutable)
  ↓
LedgerRepository.getWalletBalance()
  ↓
wallet.routes.js GET /api/wallet
  ↓
extractUserId() authentication
  ↓
iOS client receives balance
  ↓
UI renders updated balance
```

**If ANY link breaks**:
- Authentication fails → 401 → Client shows stale balance
- Balance query filters wrong entries → Wrong balance shown
- Client cannot refresh → Balance appears incorrect

---

## 4. DO NOT MODIFY WITHOUT ARCHITECT REVIEW

### Frozen Sections

The following changes **REQUIRE explicit architect approval** before proceeding:

#### Wallet Routes (`backend/routes/wallet.routes.js`)

**Frozen lines**: 27-69 (extractUserId middleware)

DO NOT:
- Remove JWT Bearer token support
- Remove X-User-Id header support
- Change fallback order
- Modify UUID validation
- Change response codes (401, 400)

**Safe changes**:
- Add logging (if guarded by env var)
- Update comments/documentation
- Add new endpoints (must use same extractUserId)

#### Ledger Balance Computation (`backend/repositories/LedgerRepository.js`)

**Frozen functions**:
- `getWalletBalance(pool, userId)`
- `computeWalletBalance(client, userId)`

DO NOT:
- Change `WHERE` clause filters
- Add reference_type or entry_type filters
- Exclude any ledger entry type
- Change return type

**Safe changes**:
- Improve performance (with same logic)
- Add caching (with invalidation)
- Update documentation

#### Wallet API Response Contract

**Frozen endpoint**: `GET /api/wallet`

**Response format MUST be**:
```json
{
  "balance_cents": <number>
}
```

DO NOT:
- Add/remove fields
- Change field names
- Change data types
- Modify response code behavior

### Approval Process

If you need to modify wallet authentication, balance logic, or the wallet API:

1. STOP before making any changes
2. Document the reason for the change
3. Create an issue with:
   - Regression test case (proves old behavior was wrong)
   - New test case (proves new behavior is correct)
   - Impact analysis (client compatibility)
4. Request architect review
5. Wait for approval
6. Update this document if contract changes

---

## 5. AI WORKER SAFETY RULE

### STOP Conditions (Do Not Proceed)

If you are an AI worker and you encounter any of these:

- [ ] Task mentions removing authentication support from wallet routes
- [ ] Task mentions filtering ledger balance by reference_type
- [ ] Task mentions changing wallet API response fields
- [ ] Code review shows wallet.routes.js extractUserId simplified
- [ ] Code shows wallet balance computed without user_id filter
- [ ] You are asked to "clean up" wallet authentication code
- [ ] You see commit removing JWT or X-User-Id support

**ACTION**: STOP. Do not edit. Do not test. Do not commit.

### Required Response

If any STOP condition is met:

```
WALLET AUTH CONTRACT FROZEN

This task requires modification to:
- backend/routes/wallet.routes.js (extractUserId)
- backend/repositories/LedgerRepository.js (balance computation)
- wallet API contract

Wallet authentication is frozen per WALLET_AUTH_CONTRACT.md.

Stopping work and requesting architect approval.
```

### Escalation

Document:
1. Which STOP condition was met
2. What change was requested
3. Why the change might be necessary
4. Link to this governance document

Request architect approval before proceeding.

---

## 6. VERIFICATION COMMANDS

### Tournament Config Invariant

**Purpose**: Verify that discovery created tournament_configs for all contest_instances.

```sql
-- Expected result: 0 (no orphaned contests)
SELECT COUNT(*) as orphaned_contests
FROM contest_instances ci
LEFT JOIN tournament_configs tc
  ON tc.contest_instance_id = ci.id
WHERE tc.id IS NULL
  AND ci.status = 'SCHEDULED';
```

**If result > 0**: Discovery pipeline broken, tournament_configs not created.

### Wallet Ledger Verification

**Purpose**: Verify ledger entries were created for contest join.

```sql
-- Check recent wallet activity for a user
SELECT
  id,
  entry_type,
  direction,
  amount_cents,
  reference_type,
  reference_id,
  created_at
FROM ledger
WHERE user_id = :<user_id>
ORDER BY created_at DESC
LIMIT 10;
```

**Expected for contest join**:
- Recent ENTRY_FEE with direction=DEBIT
- reference_type='CONTEST'
- amount_cents = contest entry_fee_cents

### Wallet Balance Query Verification

**Purpose**: Verify balance computation includes all ledger entries.

```sql
-- Check if balance includes contest debits
SELECT
  SUM(CASE
    WHEN direction = 'CREDIT' THEN amount_cents
    WHEN direction = 'DEBIT' THEN -amount_cents
  END) as computed_balance,
  (SELECT COUNT(*) FROM ledger WHERE user_id = :<user_id> AND direction = 'DEBIT') as debit_count,
  (SELECT COUNT(*) FROM ledger WHERE user_id = :<user_id> AND direction = 'CREDIT') as credit_count
FROM ledger
WHERE user_id = :<user_id>;
```

**Balance should be**: credits_sum - debits_sum

If balance is wrong:
1. Check WHERE clause filters (should be user_id only)
2. Verify all DEBIT entries are included
3. Verify all CREDIT entries are included

### Authentication Flow Verification

**Purpose**: Verify wallet endpoint accepts both auth methods.

```bash
# Test 1: X-User-Id header (should return 200)
curl -H "X-User-Id: <uuid>" https://api.example.com/api/wallet
# Expected: 200 { "balance_cents": <number> }

# Test 2: JWT Bearer token (should return 200)
curl -H "Authorization: Bearer <jwt>" https://api.example.com/api/wallet
# Expected: 200 { "balance_cents": <number> }

# Test 3: No auth (should return 401)
curl https://api.example.com/api/wallet
# Expected: 401 { "error": "Authentication required" }

# Test 4: Invalid JWT (should fall back to check X-User-Id, then 401)
curl -H "Authorization: Bearer invalid.token.format" https://api.example.com/api/wallet
# Expected: 401 { "error": "Authentication required" }
```

---

## 7. REVISION HISTORY

| Date | Author | Change | Reason |
|------|--------|--------|--------|
| 2026-03-11 | Architect | Created (v1.0) | Prevent Mar 10 regression recurrence |

---

## 8. REFERENCES

### Related Governance Documents

- `CLAUDE_RULES.md` — Global governance (Section 6: Architecture Boundaries)
- `FINANCIAL_INVARIANTS.md` — Ledger immutability and wallet balance rules
- `IOS_SWEEP_PROTOCOL.md` — iOS client authentication expectations

### Related Code

- `backend/routes/wallet.routes.js` (lines 27-69, 76-105)
- `backend/repositories/LedgerRepository.js` (getWalletBalance, computeWalletBalance)
- `backend/tests/routes/wallet.routes.test.js`
- `ios-app/PlayoffChallenge/Services/WalletService.swift` (uses Authorization header)

### Incidents

- **2026-03-10 21:55 UTC**: Commit 5cc666e removed JWT support
- **2026-03-10 22:54 UTC**: User reported balance not updating after join
- **2026-03-11 04:00 UTC**: Root cause identified (missing JWT decode)
- **2026-03-11 05:00 UTC**: Fix applied (both auth methods restored)
- **2026-03-11 06:00 UTC**: This governance document created

---

## QUESTIONS?

If you have questions about this contract:

1. **Can I change the fallback order?** NO. Changing it breaks client assumptions.
2. **Can I add a third auth method?** YES, but only if it doesn't remove JWT or X-User-Id.
3. **Can I filter balance by reference_type?** NO. Balance must include all ledger entries per user.
4. **Can I remove JWT support to simplify code?** NO. This breaks production iOS clients.
5. **Can I change the response fields?** NO. Clients depend on { balance_cents }.

**When in doubt, request architect approval.**
