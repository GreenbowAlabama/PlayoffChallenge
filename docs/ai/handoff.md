# Implementation Handoff

**Date:** 2025-12-23
**Role:** Worker
**Type:** Bug Fix - Default Week Selection

---

## Objective

Fix initial "My Picks" tab load to default to the current playoff week, ensuring picks are visible immediately for Apple review.

---

## Current State

- User picks exist with `week_number = 16` (int)
- `game_settings.current_playoff_week = 16`
- `game_settings.playoff_start_week = 19`
- Week tabs display playoff round names (Wildcard, Divisional, Conference, Super Bowl)
- Initial load has no selected week → picks visible
- Selecting "Wildcard" tab filters for week 19 → picks disappear (mismatch)

---

## Root Cause

- Test mode uses `current_playoff_week = 16` but playoff tabs map to weeks 19-22
- Initial nil selection bypasses strict filtering
- Selecting any tab applies strict week filter that doesn't match test data

---

## Discovery Steps (Execute in Order)

**Step 1: Find the "My Picks" view file**
- Grep for: `"My Picks"` in `ios-app/PlayoffChallenge/Views/**/*.swift`
- Expected: One primary view file
- Read only the first ~50 lines to identify the struct/class name

**Step 2: Locate selectedWeek state variable**
- Grep in that file for: `selectedWeek` or `@State.*week`
- Read only the 5-10 lines around the state declaration
- Confirm type (Int? or String? or custom type)

**Step 3: Find where week tabs are rendered**
- Grep in same file for: `Wildcard` or `TabView` or `Picker.*week`
- Read only that specific section (~10-20 lines)
- Identify how weeks are mapped to tabs

**Step 4: Locate settings fetch**
- Grep for: `current_playoff_week` or `currentPlayoffWeek`
- Should find where game_settings are loaded
- Read only the property definition and assignment

---

## What to Change

**Single change location: My Picks view onAppear or init**

Add default selection logic:
```swift
.onAppear {
    if selectedWeek == nil {
        selectedWeek = settingsService.currentPlayoffWeek ?? 16
    }
}
```

**Or if using init:**
```swift
init() {
    _selectedWeek = State(initialValue: settingsService.currentPlayoffWeek ?? 16)
}
```

**Validation check before applying:**
- Does selectedWeek initialize to nil currently? (confirm with targeted read)
- Is currentPlayoffWeek accessible from this view? (grep for settings access)
- If not accessible, may need to pass as parameter or fetch on load

---

## What NOT to Change

- Do not redesign the tab structure
- Do not change playoff week mapping globally (production expects 19-22)
- Do not add new backend endpoints
- Do not modify how picks are stored

---

## Test Data Setup (for Apple Review)

Ensure your test database has:
- At least one complete lineup for week 16 (1 QB, 2 RB, 3 WR, 1 TE, 1 K, 1 DEF)
- `game_settings.current_playoff_week = 16`
- `game_settings.is_week_active = true`

---

## Validation Steps

1. Fresh app launch → navigate to "My Picks"
2. **Verify Week 16 tab is pre-selected/highlighted**
3. **Verify Week 16 picks are immediately visible**
4. Tap Week 17 tab → should show empty state (no picks yet)
5. Tap back to Week 16 → picks remain visible
6. Repeat for other week tabs → empty states are acceptable

---

## Edge Cases

- If `current_playoff_week` is null → default to `playoff_start_week`
- If no picks exist for current week → show empty state (don't crash)

---

## Success Criteria

- Apple reviewer lands on a populated "My Picks" view with zero taps required
- Week navigation works smoothly
- No disappearing picks on tab selection

---

**Status:** Ready for Worker implementation
