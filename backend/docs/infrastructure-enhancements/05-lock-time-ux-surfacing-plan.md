# Lock Time UX Surfacing Plan

**Status:** Pre-Demo Implementation (Minimal Risk)
**Version:** 1.0
**Date:** 2026-02-19

## Executive Summary

This plan addresses a contract inconsistency where `lock_time` is present in the Available Contests List response but missing from the Contest Detail response. The iOS app already expects `lock_time` in the detail endpoint but currently fails to decode it.

**Scope:** 1 backend file change, 1 OpenAPI schema update, no iOS changes required.
**Risk Level:** Low (additive-only, backward-compatible)
**Demo Impact:** Enables consistent time-to-lock display across all three contest views

---

## STEP 1: Contract Audit Findings

### Current State

| Endpoint | Response Type | Includes `lock_time` | iOS Decoder |
|----------|---------------|----------------------|-------------|
| GET /api/custom-contests/available | ContestListItem | ✅ Yes (line 966-972) | AvailableContestDTO: ✅ expects it |
| GET /api/custom-contests | ContestListItem | ✅ Yes (line 966-972) | MyContestsViewModel: ✅ decodes it |
| GET /api/custom-contests/:id | ContestDetailResponse | ❌ No (not in OpenAPI) | ContestDetailService: ✅ expects it |

### Key Findings

1. **ContestDetailResponseContract** (Models.swift:810-846)
   - Does NOT declare `lock_time` field
   - iOS service still tries to decode it into DTO ContestDetailResponse (line 160)
   - Creates silent decoding mismatch

2. **Backend Response Mapper**
   - `mapContestToApiResponseForList()` includes `lock_time` (line 248)
   - `mapContestToApiResponse()` does NOT include `lock_time` (lines 118-150)
   - Inconsistency stems from mapper design, not database layer

3. **Database Layer**
   - `lock_time` is selected in all queries (verified in custom contest service)
   - No DB changes required
   - All contest rows include `lock_time` (nullable for unlimited contests)

4. **iOS Readiness**
   - AvailableContestDTO: ✅ already has `lock_time: Date?` (line 14)
   - ContestDetailResponse DTO: ✅ already has `lockTime: Date?` (line 160)
   - MockContest.lockTime: ✅ already set in `toMockContest()` (line 200)
   - ContestDetailResponseContract: ❌ missing field (not used for detail fetch, but blocks contract validation)

### Risk Assessment: SAFE

- Adding optional `lock_time` field to ContestDetailResponse is backward-compatible
- Existing clients ignoring it will continue to work
- No breaking changes to required fields
- No database queries need modification

---

## STEP 2: Minimal Backend Plan

### Change Required

**File:** `/Users/iancarter/Documents/workspace/playoff-challenge/backend/services/helpers/contestApiResponseMapper.js`

**Lines:** 118-150 (mapContestToApiResponse function)

**Action:** Add one line after `end_time` field

```javascript
// BEFORE (lines 127-128):
start_time: contestRow.start_time,
end_time: contestRow.end_time,

// AFTER (lines 127-129):
start_time: contestRow.start_time,
end_time: contestRow.end_time,
lock_time: contestRow.lock_time,
```

### Why This Is Safe

1. **Query-side:** No changes needed. All queries already SELECT `lock_time` from contest_instances table
2. **Route Normalization:** `normalizeContestResponse()` in routes already handles timestamp conversion (line 318)
3. **Backward Compatibility:** Adding optional field doesn't break existing response consumers
4. **Idempotent:** Route normalization is already applied to both list and detail responses

### Change Count

- **Backend Files Touched:** 1 (contestApiResponseMapper.js)
- **Lines Changed:** 1 (additive)
- **DB Queries Changed:** 0

---

## STEP 3: OpenAPI Contract Update

**File:** `/Users/iancarter/Documents/workspace/playoff-challenge/backend/contracts/openapi.yaml`

**Current State (lines 804-908):** ContestDetailResponse schema does not list `lock_time`

**Required Update:**

Add `lock_time` to the properties section of ContestDetailResponse (after `end_time`, before `max_entries`):

```yaml
end_time:
  type: string
  format: date-time
  nullable: true
  description: Optional contest end time (ISO 8601)
lock_time:
  type: string
  format: date-time
  nullable: true
  description: |
    Lock time for this contest (ISO 8601).
    Null for unlimited contests. Filters entries after this time.
    Computed field: time_until_lock is derived from this value.
max_entries:
  type: integer
  ...
```

Also add `lock_time` to the required fields list (if not already present):
- Check line 781-803 for required array
- `lock_time` should NOT be added to required (it's nullable)

### OpenAPI Change Count

- **Files Touched:** 1 (openapi.yaml)
- **Schema Updates:** 1 (ContestDetailResponse)
- **Breaking Changes:** 0

---

## STEP 4: iOS Implementation (Already Complete)

### No iOS Changes Required

The iOS app is already prepared for this change:

1. **AvailableContestsViewModel** (line 63): Already maps `dto.lock_time`
2. **MyContestsViewModel** (line 33 CodingKey): Already decodes `lock_time`
3. **ContestDetailService** (line 160, 174): Already decodes `lockTime`
4. **MockContest** (line 200): Already sets `lockTime`

### What iOS Already Supports

- Display lock_time consistently in list and detail views via `MockContest.lockTime`
- Compute `timeUntilLock` for SCHEDULED contests (already done in presentationDerivationService)
- Map lock_time to UI state for action enablement (can_join, can_unjoin)

### UI State Mapping Rules (Pre-existing)

| Contest Status | lock_time | UI Display | can_join | can_unjoin |
|---|---|---|---|---|
| SCHEDULED | Future | "Locks in Xh Ym" | True (if before lock) | True (if before lock) |
| SCHEDULED | Past | "Entry closed" | False | False |
| SCHEDULED | NULL | "Entry open" | True | True |
| LOCKED | Any | "Entry closed" | False | False |
| LIVE | Any | "In progress" | False | False |
| COMPLETE | Any | "Final results" | False | False |

### Drift Awareness

Since lifecycle reconciliation is not yet implemented:
- Backend status and lock_time may drift (e.g., status=SCHEDULED but lock_time < now)
- **Source of Truth:** Use `actions.can_join` and `actions.can_unjoin` flags (computed server-side)
- **Display Reference:** `lock_time` shows when entry closes; use for UX context only
- **Action Gating:** Always trust backend actions object, never infer from status + time locally

---

## STEP 5: Execution Summary

### Changes Required

| Component | Scope | Files | Lines | Risk |
|-----------|-------|-------|-------|------|
| **Backend Mapper** | Add `lock_time` to detail response | 1 | +1 line | Very Low |
| **OpenAPI Schema** | Document new field in ContestDetailResponse | 1 | ~5 lines | Very Low |
| **iOS** | None (already prepared) | 0 | 0 | None |

### Validation Strategy

1. **Backend Validation**
   - Run existing unit tests (should pass unchanged)
   - Verify ContestDetailResponseContract fixture includes lock_time
   - Manual test: GET /api/custom-contests/:id should return lock_time field

2. **iOS Validation**
   - Run contract drift tests (should pass with new field)
   - Verify MockContest.lockTime is populated from detail fetch
   - Verify UI displays time-to-lock in detail view

3. **OpenAPI Compliance**
   - Run openapi-freeze test to validate schema
   - Ensure field is optional (not in required array)

### Rollback Strategy

**If issues arise:**

1. **Immediate Rollback**
   - Remove one line from contestApiResponseMapper.js (lock_time assignment)
   - Remove lock_time from openapi.yaml
   - Revert ContestDetailResponseContract if modified
   - No database or migration rollback needed

2. **Risk Mitigation**
   - Additive changes are safe; field is optional
   - Existing clients can ignore new field
   - No breaking changes to contract

### Demo Impact

**Positive:**
- Consistent lock_time display across Available, My Contests, and Detail views
- Clear time-to-lock countdown for users
- Supports future auto-lock lifecycle (when reconciler is implemented)

**No Negative Impact:**
- Clients not using lock_time continue to work
- Response size increase negligible (one datetime field)
- No performance impact (field already in database)

---

## Implementation Checklist

- [ ] Update contestApiResponseMapper.js (1 line addition)
- [ ] Update openapi.yaml schema (lock_time field description + optional)
- [ ] Run backend unit tests to verify no regression
- [ ] Run iOS contract drift tests
- [ ] Manual test: GET /api/custom-contests/:id returns lock_time
- [ ] Verify AvailableContestsView displays time correctly
- [ ] Verify MyContestsView displays time correctly
- [ ] Verify ContestDetailView displays time correctly
- [ ] Commit with co-author tag

---

## Technical Debt Notes

**Future (Post-Demo):**

1. **Lifecycle Reconciliation:** Implement automatic status transitions based on lock_time and settle_time
2. **Contract Unification:** Consolidate ContestDetailResponse and ContestDetailResponseContract
3. **iOS Date Formatting:** Add consistent DateFormatter utility for lock_time display
4. **Drift Monitoring:** Log contests where status != expected(lock_time) for observability

---

## References

- **OpenAPI Contract:** `/backend/contracts/openapi.yaml`
- **Response Mapper:** `/backend/services/helpers/contestApiResponseMapper.js`
- **iOS DTO:** `/ios-app/PlayoffChallenge/Services/ContestDetailService.swift` (line 147-203)
- **CLAUDE.md Rules:** Minimal, additive, backward-compatible, contest-scoped
