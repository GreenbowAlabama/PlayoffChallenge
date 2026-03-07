# Continuation Guide — Contest Pool Diagnostics Feature (Mar 7, 2026)

## Current Status

**MVP Phase:** Fixing operational signal visibility in web-admin.

### Completed ✅

1. **Orphaned Funds Fix (SHIPPED)**
   - Backend service: `orphanedFundsService.js` (identifies unrefunded cancelled contests)
   - Web-admin page: `StagingCleanup.tsx` (displays stranded funds, Refund All buttons)
   - Result: $100 in stranded funds manually refunded via UI
   - Dashboard now shows "No contests with orphaned funds found" (signal working)

2. **Permanent Code Fix (SHIPPED)**
   - Added refund logic to `customContestService.deleteContestInstance()` (user-initiated cancellations now auto-refund)
   - Tests: 153/153 passing
   - Both user AND admin cancellation paths now refund participants atomically

3. **Operational UI Principle (DOCUMENTED)**
   - Added Section 21 to `CLAUDE_RULES.md`: "OPERATIONAL UI PRINCIPLE"
   - Rule: Web-admin must be usable by non-technical staff
   - Every signal must answer: What? Why? Impact? Action Path?
   - No CLI diagnostic scripts—everything in web-admin

### In Progress 🔄

**Contest Pool Diagnostics Feature** (following same pattern as orphaned funds)

#### Status: Test-First Phase
- ✅ Test file created: `backend/tests/services/contestPoolDiagnostics.test.js` (READY TO RUN)
- ⏳ Service implementation: `backend/services/contestPoolDiagnosticsService.js` (NOT STARTED)
- ⏳ Admin routes: `backend/routes/admin.contest-pools.routes.js` (NOT STARTED)
- ⏳ Web-admin API client: `web-admin/src/api/contest-pools.ts` (NOT STARTED)
- ⏳ Web-admin page: `web-admin/src/pages/ContestPoolDiagnostics.tsx` (NOT STARTED)

#### Test Coverage (8 tests)
1. Returns empty array when no negative pools exist
2. Identifies payouts exceeding entries (PAYOUTS_EXCEED_ENTRIES)
3. Identifies refunded entries with payouts (REFUNDED_ENTRIES_WITH_PAYOUTS)
4. Classifies no entries with payouts (NO_ENTRIES_WITH_PAYOUTS)
5. Orders results by most negative first
6. Handles contests with no ledger entries
7. Returns detailed ledger breakdown
8. Throws error for non-existent contest

---

## Next Steps (In Order)

### 1. Run Tests (Verify Failures)
```bash
cd /Users/iancarter/Documents/workspace/playoff-challenge/backend && \
TEST_DB_ALLOW_DBNAME=railway npm test -- --testPathPattern="contestPoolDiagnostics" --runInBand --forceExit
```
Expected: All 8 tests FAIL (service doesn't exist yet)

### 2. Implement Backend Service
**File:** `backend/services/contestPoolDiagnosticsService.js`

**Functions needed:**
```javascript
async function getNegativePoolContests(pool)
  // Returns: Array of contests with negative pool_balance_cents, ordered by most negative first
  // Root cause classification: PAYOUTS_EXCEED_ENTRIES | REFUNDED_ENTRIES_WITH_PAYOUTS | NO_ENTRIES_WITH_PAYOUTS | MIXED

async function getContestPoolDetails(pool, contestId)
  // Returns: { contest_id, contest_name, participant_count, ledger_breakdown: [...], ... }
```

**SQL Pattern:** Similar to `orphanedFundsService.js`
- LEFT JOIN ledger twice (entry fees, prize payouts)
- Calculate net for each category
- Classify root cause based on logic
- Order by most negative first

**Run tests after implementation:**
```bash
TEST_DB_ALLOW_DBNAME=railway npm test -- --testPathPattern="contestPoolDiagnostics" --runInBand --forceExit
```
Expected: All tests PASS

### 3. Create Admin Routes
**File:** `backend/routes/admin.contest-pools.routes.js`

**Endpoints:**
```
GET /api/admin/contest-pools/negative
  → Response: { contests: [...], total_count, total_negative_cents }

GET /api/admin/contest-pools/:contestId/details
  → Response: { contest_id, contest_name, ledger_breakdown, ... }
```

Protected by existing admin middleware.

### 4. Build Web-Admin API Client
**File:** `web-admin/src/api/contest-pools.ts`

**Exports:**
```typescript
export async function getNegativePoolContests(): Promise<...>
export async function getContestPoolDetails(contestId: string): Promise<...>
```

### 5. Create Web-Admin Page
**File:** `web-admin/src/pages/ContestPoolDiagnostics.tsx`

**UI Structure (per Operational UI Principle):**
```
Header: "Contest Pool Analysis — Negative Balances"

Summary Panel
├─ Total Negative Pool Contests: N
├─ Total Negative Amount: $X.XX
└─ [Refresh Button]

Root Cause Breakdown (Stat Cards)
├─ 🔴 Payouts Exceed Entries: N contests
├─ 🟡 Refunded Entries With Payouts: N contests
├─ 🟠 No Entries With Payouts: N contests
└─ Other: N contests

Contests Table (Expandable)
├─ Contest Name | Status | Created | Participants
├─ Entry Fees | Refunds | Payouts | Balance (most negative first)
├─ Root Cause (colored badge with explanation)
└─ [Expand] → Ledger Breakdown Detail

Legend/Help
├─ What does "Payouts Exceed Entries" mean? (Plain English explanation)
├─ Impact: Platform is carrying a loss
└─ Action: ⚠️ Contact engineering if numbers don't match records
```

**Key Rule:** Use plain English explanations per Section 21 (CLAUDE_RULES.md)

---

## Architecture Principles to Follow

### 1. Schema-First
- Query in `backend/db/schema.snapshot.sql` before writing SQL
- Current contest pool calculation includes: ENTRY_FEE, ENTRY_FEE_REFUND, PRIZE_PAYOUT, PRIZE_PAYOUT_REVERSAL

### 2. Test-First
- Tests written BEFORE implementation
- All tests must pass before proceeding
- Tests define the contract

### 3. Operational UI Principle (NEW)
- Every page must be usable by non-technical staff
- Every signal answers: What? Why? Impact? Action Path?
- Use colored badges (🔴 🟡 🟠 🟢) with clear explanations
- No technical jargon without explanation

### 4. Idempotency & Determinism
- Service queries are read-only (no mutations)
- Same inputs → same outputs every time
- Root cause classification must be deterministic

### 5. Governance Compliance
- Follow all rules in `docs/governance/CLAUDE_RULES.md`
- Financial invariants locked (ledger is immutable)
- No schema changes without explicit approval

---

## Key Files & Paths

**Governance:**
- `/docs/governance/CLAUDE_RULES.md` (Section 21: Operational UI Principle)
- `/docs/governance/FINANCIAL_INVARIANTS.md` (ledger structure, balance calculation)

**Backend Services:**
- `/backend/services/orphanedFundsService.js` (REFERENCE PATTERN)
- `/backend/services/financialHealthService.js` (REFERENCE for pool balance calculation)

**Web-Admin (Reference):**
- `/web-admin/src/pages/StagingCleanup.tsx` (REFERENCE UI pattern)
- `/web-admin/src/api/orphaned-funds.ts` (REFERENCE API client pattern)

**Tests:**
- `/backend/tests/services/contestPoolDiagnostics.test.js` (READY TO RUN)

---

## Critical Decisions

### 1. Two-Service Pattern
- **Discovery Service** (what's wrong): `getNegativePoolContests()`
- **Detail Service** (why/how much): `getContestPoolDetails()`
- Mirrors orphaned funds approach

### 2. Root Cause Classification (Deterministic)
```
IF entry_fee_net <= 0 AND prize_net > 0
  → NO_ENTRIES_WITH_PAYOUTS

ELSE IF entry_fee_net > 0 AND prize_net > entry_fee_net
  → PAYOUTS_EXCEED_ENTRIES

ELSE IF entry_fee_refunds > 0 AND prize_net > 0
  → REFUNDED_ENTRIES_WITH_PAYOUTS

ELSE
  → MIXED
```

### 3. UI Information Hierarchy
1. Summary stats (prominently displayed)
2. Root cause breakdown (stat cards)
3. Detailed table (with expand)
4. Plain English explanations (not technical codes)

---

## Testing Command

```bash
# After implementation
cd /Users/iancarter/Documents/workspace/playoff-challenge/backend && \
TEST_DB_ALLOW_DBNAME=railway npm test -- --testPathPattern="contestPoolDiagnostics" --runInBand --forceExit
```

Expected: **8/8 PASS**

---

## Success Criteria

- [ ] All 8 tests passing
- [ ] Backend service deterministic (same inputs → same outputs)
- [ ] Web-admin page displays all negative pool contests
- [ ] Root causes clearly explained in plain English
- [ ] Expandable rows show ledger breakdown
- [ ] No CLI scripts needed (everything in web-admin)
- [ ] Non-technical staff can understand what's wrong without asking engineer

---

## Questions/Blockers

**None currently.** All governance, tests, and patterns are locked. Ready to implement.

---

**Created:** Mar 7, 2026
**Phase:** MVP — Operational Signals in Web-Admin
**Next Checkpoint:** Service tests passing, ready for route implementation
