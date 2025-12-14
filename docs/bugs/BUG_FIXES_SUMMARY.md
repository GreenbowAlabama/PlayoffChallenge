# Bug Fixes Summary - December 4, 2025

## ✅ FIXED Issues

### Bug #1: Default Tab Loading Divisional Instead of Conference
**Status:** ✅ FIXED
**Fix:** Updated `current_playoff_week` in database from 14 → 3
**Verification:** API now returns `current_playoff_week: 3`

### Bug #2: Multiplier Reset to 1x After Saving Lineup
**Status:** ✅ FIXED
**Root Cause:** Backend UPSERT was overwriting multipliers when iOS app didn't send multiplier value
**Fix:** Updated `POST /api/picks` UPSERT logic with COALESCE:
- INSERT: `COALESCE($5, 1.0)` - new picks default to 1x
- UPDATE: `COALESCE($5, picks.multiplier)` - existing picks preserve multiplier

**Commits:**
- `5439fe6` - Initial fix (preserved UPDATE, broke INSERT)
- `831a0f3` - Complete fix (both INSERT and UPDATE work)

**Testing:**
- ✅ Existing picks preserve multipliers (3x → 3x)
- ✅ New picks default to 1.0x
- ✅ Deployed to production

### Bug #2b: Ian's Week 14 Picks Showing 1x Multipliers
**Status:** ✅ FIXED
**Root Cause:** Ian's picks were saved BEFORE the multiplier fix was deployed (at 23:48 on Dec 4)
**Fix:** Manual database update for the 5 continuing players:
```sql
UPDATE picks SET multiplier = 3.0, consecutive_weeks = 3
WHERE user_id = '160797bf-7fc6-430c-b8d4-903c69ddad5c'
  AND week_number = 14
  AND player_id IN ('SEA', '11533', '9509', '9493', '9488');
```

**Results:**
- ✅ 5 continuing players now show 3x (SEA DEF, Aubrey, Bijan, Puka, Jaxon)
- ✅ 3 new players correctly show 1x (Josh Allen, James Cook, Travis Kelce)
- ✅ API returns correct multipliers

---

## 🔍 NEEDS INVESTIGATION

### Bug #3: RB Not Showing After Adding Until Save/Refresh
**Status:** 🔍 NEEDS iOS DEBUGGING
**Issue:** James Cook doesn't appear in UI immediately after adding
**Hypothesis:** SwiftUI state management not triggering view update
**Impact:** Confusing UX, but data is correct after save
**Location:** iOS app UI code (MyPickView.swift or PlayerSelectionView.swift)

### Bug #4: DEF Removal Not Working
**Status:** 🔍 NEEDS INVESTIGATION
**Issue:** Ravens DST still shows after deletion confirmation
**Hypothesis:** DELETE API call may not execute or iOS doesn't update local state
**Impact:** Users can't remove players
**Investigation Needed:**
1. Check if DELETE request is sent to backend
2. Check if backend successfully deletes from DB
3. Check if iOS updates local state after DELETE
4. Review network logs

**Backend Endpoint:** `DELETE /api/picks/:pickId` (server.js:2394-2412)
**iOS Code:** `APIService.deletePick()` (APIService.swift:396-408)

### Bug #5: My Lineup Shows "No Picks Yet" on Initial Login
**Status:** 🔍 NEEDS iOS FIX
**Root Cause:** Race condition in iOS app initialization

**The Problem:**
1. `LineupViewModel` initializes with `selectedWeek = 12`, `currentWeek = 12`
2. `loadData()` is called → filters picks for week 12 (hardcoded default)
3. `loadCurrentWeek()` completes asynchronously → updates to week 3
4. User already sees "No picks" because data was loaded for wrong week

**Code Location:** `/ios-app/PlayoffChallenge/Views/LineupView.swift`
- Line 564: `@Published var selectedWeek: Int = 12` (hardcoded default)
- Line 565: `@Published var currentWeek: Int = 12` (hardcoded default)
- Line 592-605: `loadCurrentWeek()` loads actual week asynchronously
- Line 686: `self.picks = allPicks.filter { $0.weekNumber == selectedWeek }` (filters before week updates)

**Workaround:** Tapping any week tab triggers reload with correct week

**Fix Required:** Ensure `loadCurrentWeek()` completes BEFORE `loadData()` is called
**Suggested Fix:**
```swift
func loadInitialData(userId: UUID) async {
    await loadCurrentWeek()  // Wait for this to complete
    await loadData(userId: userId)  // Then load data with correct week
}
```

---

## Summary Table

| Bug | Severity | Status | Fix Location |
|-----|----------|--------|--------------|
| #1: Default tab wrong | Low | ✅ FIXED | Database |
| #2: Multiplier reset | **CRITICAL** | ✅ FIXED | Backend |
| #2b: Ian's 1x multipliers | High | ✅ FIXED | Database |
| #3: RB not showing | Medium | 🔍 INVESTIGATE | iOS UI |
| #4: DEF removal fails | High | 🔍 INVESTIGATE | Backend/iOS |
| #5: No picks on login | Medium | 🔍 INVESTIGATE | iOS (race condition) |

---

## Testing Notes

**Current Week:** 3 (Conference Round) ✅
**Ian's Week 14 Picks:** All multipliers correct ✅
**Bot Users:** No bye team players ✅
**API Endpoints:** All returning correct data ✅

**Remaining Work:**
1. Fix iOS race condition (Bug #5) - initialization order
2. Debug RB display issue (Bug #3) - state management
3. Debug DEF deletion issue (Bug #4) - network/state debugging
