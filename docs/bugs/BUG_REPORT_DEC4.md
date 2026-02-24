# Bug Report - December 4, 2025
## Week 14 (Conference Round) Testing

### Bug #1: Default Tab Loading Divisional Instead of Conference ✅ FIXED

**Issue:**
- My Lineup tab defaults to "Divisional" tab instead of "Conference" tab
- Even after setting current_playoff_week to 14, the app still defaulted to Divisional

**Root Cause:**
- Database value `current_playoff_week` was set to **14** (NFL week) instead of **3** (playoff week)
- The app uses `current_playoff_week` to determine which tab to show
- Playoff weeks are: 1 = Wild Card, 2 = Divisional, 3 = Conference, 4 = Super Bowl

**Fix Applied:**
```sql
UPDATE game_settings SET current_playoff_week = 3 WHERE id = '3c26a0d5-9401-43b8-b040-85724dff4e95';
```

**Location:** Database `game_settings` table
**Status:** ✅ FIXED
**Verification:** `GET /api/game-config` now returns `current_playoff_week: 3`

---

### Bug #2: Multiplier Reset to 1x After Saving Lineup ⚠️ CRITICAL BUG

**Issue:**
- When saving lineup in Conference tab, all players reset to 1x multiplier
- Players with 3x or 2x multipliers lose their advancement bonuses

**Root Cause:**
Backend API endpoint `POST /api/picks` has UPSERT logic that overwrites multiplier:

**Backend Code (server.js:2334-2343):**
```javascript
const result = await pool.query(`
  INSERT INTO picks (id, user_id, player_id, week_number, position, multiplier, consecutive_weeks, locked, created_at)
  VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 1, false, NOW())
  ON CONFLICT (user_id, player_id, week_number)
  DO UPDATE SET
    position = $4,
    multiplier = $5,  // ❌ BUG: Overwrites existing multiplier
    created_at = NOW()
  RETURNING *
`, [userId, pick.playerId, weekNumber, pick.position, pick.multiplier || 1]);
```

**iOS Code (APIService.swift:369-394):**
```swift
func submitPick(userId: UUID, playerId: String, position: String, weekNumber: Int) async throws -> Pick {
    let body: [String: Any] = [
        "userId": userId.uuidString,
        "playerId": playerId,
        "position": position,
        "weekNumber": weekNumber
        // ❌ BUG: Does not send multiplier!
    ]
    // ...
}
```

**The Problem:**
1. iOS app calls `submitPick()` without sending the current `multiplier` value
2. Backend receives `null` for multiplier
3. Backend defaults to `pick.multiplier || 1` (line 2343)
4. UPSERT `DO UPDATE SET multiplier = $5` overwrites the existing 3x or 2x value with 1x

**Fix Required:**
Two options:

**Option A: Fix Backend (Recommended)**
Change the UPSERT to ONLY update multiplier if explicitly provided:
```javascript
DO UPDATE SET
  position = $4,
  multiplier = COALESCE($5, picks.multiplier),  // Keep existing if not provided
  created_at = NOW()
```

**Option B: Fix iOS App**
Send the current multiplier from the Pick object:
```swift
let body: [String: Any] = [
    "userId": userId.uuidString,
    "playerId": playerId,
    "position": position,
    "weekNumber": weekNumber,
    "multiplier": multiplier  // Add this
]
```

**Location:**
- Backend: `/backend/server.js:2334-2343`
- iOS: `/ios-app/PlayoffChallenge/Services/APIService.swift:369-394`

**Status:** ⚠️ CRITICAL - Needs immediate fix before real users test
**Impact:** All players lose multiplier progression when editing lineups

---

### Bug #3: RB Not Showing After Adding Until Save/Refresh 🔍 NEEDS INVESTIGATION

**Issue:**
- Adding James Cook (RB) shows "2/2" indicator
- James Cook is NOT visible in the UI
- Only shows existing RB (Bijan)
- After saving, James Cook appears correctly

**Hypothesis:**
- Likely an iOS UI state management issue
- The Pick object is added to state, but the View is not refreshing
- May be related to SwiftUI `@State` or `@Published` not triggering view updates

**Location:** iOS app UI code (MyPickView.swift or PlayerSelectionView.swift)
**Status:** 🔍 NEEDS INVESTIGATION
**Impact:** Confusing UX, but data is correct after save

---

### Bug #4: DEF Removal Not Working 🔍 NEEDS INVESTIGATION

**Issue:**
- Tapping X on Ravens DST shows confirmation dialog
- After confirming deletion, Ravens DST still shows in UI
- An additional "Add DEF" row appears below
- Hypothesis: Backend DELETE call failed or wasn't executed

**Backend Endpoint (server.js:2394-2412):**
```javascript
app.delete('/api/picks/:pickId', async (req, res) => {
  const { pickId } = req.params;
  const result = await pool.query(
    'DELETE FROM picks WHERE id = $1 RETURNING *',
    [pickId]
  );
  // ...
})
```

**iOS Code (APIService.swift:396-408):**
```swift
func deletePick(pickId: UUID, userId: UUID) async throws {
    let url = URL(string: "\(baseURL)/api/picks/\(pickId.uuidString)?userId=\(userId.uuidString)")!
    var request = URLRequest(url: url)
    request.httpMethod = "DELETE"
    // ...
}
```

**Investigation Needed:**
1. Check if DELETE request is actually sent to backend
2. Check if backend returns success but doesn't actually delete from DB
3. Check if iOS updates local state after successful DELETE
4. Check network logs for API call/response

**Location:**
- Backend: `/backend/server.js:2394-2412`
- iOS: `/ios-app/PlayoffChallenge/Services/APIService.swift:396-408`
- iOS UI: Likely MyPickView.swift or similar

**Status:** 🔍 NEEDS INVESTIGATION
**Impact:** Users cannot remove players from lineup

---

## Summary

| Bug | Severity | Status | Fix Required |
|-----|----------|--------|--------------|
| #1: Default tab wrong | Low | ✅ FIXED | Database update |
| #2: Multiplier reset | **CRITICAL** | ⚠️ OPEN | Backend OR iOS code change |
| #3: RB not showing | Medium | 🔍 INVESTIGATE | iOS UI debugging |
| #4: DEF removal fails | High | 🔍 INVESTIGATE | Backend/iOS debugging |

## Recommendations

1. **IMMEDIATE:** Fix Bug #2 (multiplier reset) - this breaks the core game mechanic
2. **HIGH PRIORITY:** Investigate Bug #4 (deletion not working) - blocking users from managing lineup
3. **MEDIUM PRIORITY:** Debug Bug #3 (RB display) - confusing UX but data is correct

## Testing Notes

- Current week set to 3 (Conference Round) ✅
- 7 eliminated players available for real user testing ✅
- Bot users have no bye team players ✅
- Multiplier distribution before save: 189 @ 3x, 11 @ 2x, 1 @ 1x ✅
