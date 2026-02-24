# Bug #4: DEF Removal Not Working - Root Cause Analysis

## Reported Issue
- User (Chad) tries to remove Ravens DEF from lineup
- App shows confirmation dialog
- After confirming "Remove", Ravens DST still shows in UI
- Extra "+ Add DEF" row appears

## Investigation Results

### ✅ Backend DELETE Endpoint - WORKING CORRECTLY
**Endpoint:** `DELETE /api/picks/:pickId`
**Location:** `backend/server.js:2394-2412`

**Test Results:**
```bash
curl -X DELETE "https://playoffchallenge-production.up.railway.app/api/picks/0a669f3a-fd47-4fff-8b65-de0ee864086a"

Response: {"success": true, "deletedPick": {...}}
```

✅ Backend successfully deletes from database
✅ Returns proper success response
✅ Pick verified deleted from `picks` table

### ❌ iOS removePlayer() Function - **BUG FOUND**

**Location:** `ios-app/PlayoffChallenge/Views/LineupView.swift:767-770`

**Current Implementation:**
```swift
func removePlayer(playerId: String, position: String) {
    currentLineup.removeAll { $0.id == playerId && $0.position == position }
    checkForChanges()
}
```

**The Problem:**
1. ❌ Only removes player from local `currentLineup` array
2. ❌ Does NOT call DELETE API endpoint
3. ❌ Does NOT remove from `picks` array
4. ❌ Deletion is not persisted to backend

**What Happens:**
1. User taps X button → confirmation dialog appears
2. User confirms → `removePlayer()` called
3. Player removed from `currentLineup` (UI state)
4. **BUT** player still exists in `picks` array (loaded from API)
5. User taps "Save Lineup"
6. `submitLineup()` only submits players in `currentLineup`
7. **Backend still has the deleted pick** because no DELETE was called
8. Next time lineup loads, the "deleted" pick reappears!

## Root Cause

The `LineupView` uses a **"staging area" pattern**:
- `picks` = picks loaded from API (source of truth)
- `currentLineup` = local edits (staging area)
- "Save Lineup" button submits `currentLineup` to backend

**The bug:** `removePlayer()` only removes from the staging area (`currentLineup`), but never deletes from the backend. The `submitLineup()` function only **adds** picks, it doesn't **delete** removed picks.

## Fix Required

### Option A: Call DELETE API in removePlayer() (Recommended)

**Change removePlayer() to:**
```swift
func removePlayer(pick: Pick) async {  // Change signature to accept Pick object
    guard let userId = userId else { return }

    do {
        // Delete from backend
        try await APIService.shared.deletePick(pickId: pick.id, userId: userId)

        // Remove from local arrays
        currentLineup.removeAll { $0.id == pick.playerId }
        picks.removeAll { $0.id == pick.id }

        checkForChanges()
    } catch {
        errorMessage = "Failed to remove player: \(error.localizedDescription)"
        showError = true
    }
}
```

**Update the call site (line 438):**
```swift
Button("Remove", role: .destructive) {
    Task {
        await viewModel.removePlayer(pick: pick)  // Pass full pick object
    }
}
```

### Option B: Track Deletions and Submit on Save

Add a `deletedPickIds` array and delete them in `submitLineup()`:
```swift
@Published var deletedPickIds: Set<UUID> = []

func removePlayer(pick: Pick) {
    currentLineup.removeAll { $0.id == pick.playerId }
    deletedPickIds.insert(pick.id)
    checkForChanges()
}

func submitLineup() async {
    // ... existing code to submit picks ...

    // Delete removed picks
    for pickId in deletedPickIds {
        try await APIService.shared.deletePick(pickId: pickId, userId: userId)
    }
    deletedPickIds.removeAll()

    await loadData(userId: userId)
}
```

## Recommendation

**Use Option A** (immediate DELETE) because:
1. ✅ Simpler implementation
2. ✅ Immediate feedback - deletion persists right away
3. ✅ No risk of losing track of deletions
4. ✅ Consistent with how MyPickView handles deletions

**Option B** requires more state management and could lose deletions if the app crashes before "Save Lineup".

## Testing Checklist

After implementing fix:
- [ ] Remove a player → verify it disappears from UI
- [ ] Close app and reopen → verify player stays removed
- [ ] Check database → verify pick is deleted
- [ ] Remove multiple players → verify all deletions work
- [ ] Test with different positions (QB, RB, WR, TE, K, DEF)
- [ ] Test error handling (network failure, etc.)

## Impact

**Current State:** Users cannot remove players from lineup - deletions don't persist
**After Fix:** Users can properly manage their lineup by adding/removing players
**Severity:** HIGH - blocking core functionality

---

## Additional Notes

The old `MyPickView.swift` has a correct implementation of `deletePick()` (line 544-562) that:
1. Calls the DELETE API
2. Removes from local picks array
3. Removes from liveScores map
4. Returns success/failure

The new `LineupView.swift` should follow the same pattern.
