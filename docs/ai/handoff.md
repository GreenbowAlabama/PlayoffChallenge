# Handoff: App Store Build Compliance & Bug Fixes

## Objective
Enforce payment requirements for TestFlight, exclude admin UI from App Store builds, fix positional limit propagation, and remove all monetization language from App Store builds.

## Current State
- Build flag `TESTFLIGHT` exists but is not fully utilized
- Backend enforces payment at `POST /api/picks` (server.js:3617-3630)
- Admin UI gated by user property, not build flag
- Positional limits stored in `game_settings` table and propagate correctly
- Heavy monetization language in 4 view files
- App Store build must be free-to-enter, free-to-play

---

## Fix 1: Exclude Admin UI from App Store Build

**What**: Compile-time gate Admin Panel using TESTFLIGHT flag
**Where**:
- `ios-app/PlayoffChallenge/Views/ProfileView.swift:117-123` (navigation link)
- Any deep link handlers for admin routes

**Implementation**:
```swift
// Wrap admin navigation in compile-time check
#if TESTFLIGHT
if authService.isAdmin {
    Section {
        NavigationLink(destination: AdminView()) {
            Label("Admin Panel", systemImage: "gear")
        }
    }
}
#endif
```

**Validation**: App Store build has no admin navigation visible

---

## Fix 2: Enforce Payment Before Team Creation (TestFlight Only)

**What**: Add client-side payment check before allowing pick submission
**Where**: `ios-app/PlayoffChallenge/Views/PlayerSelectionView.swift` (save/submit logic)

**Backend already enforces**: `server.js:3617-3630` checks `users.paid`
**Client check needed**: Before allowing user to submit picks, check `authService.hasPaid`

**Implementation**:
Add check in save handler - if `!authService.hasPaid`, show alert: "Payment required to create team"

**App Store behavior**: Skip check entirely (all users treated as paid)

**Validation**:
- TestFlight: Unpaid user (`users.paid = false`) cannot submit picks
- App Store: All users can submit picks

---

## Fix 3: Remove Monetization Language (App Store Build Only)

**What**: Compile-time remove all payment/prize references using TESTFLIGHT flag
**Where**:
- `ios-app/PlayoffChallenge/Views/RulesView.swift`
  - Line 20: Remove "Payouts" tab picker option
  - Line 32: Remove PayoutsTab from TabView
  - Line 83: Remove PaymentHandlesSection
  - Lines 312-510: Exclude PayoutsTab, PaymentHandlesSection, PayoutRow structs

- `ios-app/PlayoffChallenge/Views/HomeView.swift`
  - Lines 22, 54-73: Exclude PaymentBanner entirely

- `ios-app/PlayoffChallenge/Views/ProfileView.swift`
  - Lines 70-111: Exclude "Payment Status" section
  - Lines 93, 220: Remove payment references

- `ios-app/PlayoffChallenge/Views/AdminView.swift`
  - Lines 195-243: Wrap "Payment Settings" in `#if TESTFLIGHT`

**Implementation Pattern**:
```swift
#if TESTFLIGHT
    Text("Payouts").tag(2)  // TestFlight only
#endif
```

**Validation**:
- Grep for "pay", "prize", "money", "payout" in App Store build strings
- Should find zero matches in user-facing text

---

## Fix 4: Verify Positional Limits Propagation

**What**: Confirm WR limit of 3 works end-to-end
**Where**:
- Backend: `game_settings.wr_limit` (schema.sql:101, default = 3)
- API: `GET /api/settings` (server.js:3813, line 3646)
- iOS: `PlayerSelectionView.swift:455` (reads `settingsResult.wrLimit`)
- Rules: `RulesView.swift:118` (displays `settings.wrLimit`)

**Current behavior**: Limits already propagate correctly from backend → client

**Issue to investigate**: User reported WR "hard-limited to 2" but code shows default of 3. Check database value:
```sql
SELECT wr_limit FROM game_settings;
```

**If database has `wr_limit = 2`**: Update to 3 via admin panel or SQL
**If database has `wr_limit = 3`**: Code is correct, issue may be resolved

**Validation**:
1. Set `wr_limit = 3` in game_settings
2. Rules tab shows "3 Wide Receivers"
3. Can select 3 distinct WRs in PlayerSelectionView

---

## Fix 5: Verify Washington Defense Availability

**What**: Confirm Washington defense appears for all playoff teams
**Where**:
- Backend: `server.js:3498-3502` (filters by `available = true`)
- Database: `players` table, `position = 'DEF'`

**Current logic**: All defenses with `available = true` and `is_active = true` are shown

**Likely issue**: Only Washington has `available = true` in database

**Validation**:
```sql
SELECT team, available, is_active FROM players WHERE position = 'DEF';
```

**If only Washington is available**: This is likely intentional for this season
**No code changes needed**: Backend correctly returns all available defenses

---

## App Store Build Checklist

Before submission:
1. ✅ Admin UI compile-time excluded
2. ✅ No payment enforcement (all users can play)
3. ✅ Zero mentions of: pay, prize, money, payout, entry fee
4. ✅ Reviewer can: sign up → create team → view rules → play
5. ✅ No gated features or "coming soon" placeholders

TestFlight Build Checklist:
1. ✅ Admin UI accessible to admins
2. ✅ Payment required before team creation
3. ✅ Payouts/Payment tabs visible
4. ✅ All existing functionality preserved

---

## Implementation Order

1. **Admin UI exclusion** (ProfileView.swift) - Highest risk for rejection
2. **Monetization language removal** (4 view files) - Required for approval
3. **Payment enforcement** (PlayerSelectionView.swift) - TestFlight functionality
4. **Verification tasks** (WR limits, defense availability) - Confirm, don't fix

---

## Files Modified

**iOS (4-5 files)**:
- `ios-app/PlayoffChallenge/Views/ProfileView.swift`
- `ios-app/PlayoffChallenge/Views/RulesView.swift`
- `ios-app/PlayoffChallenge/Views/HomeView.swift`
- `ios-app/PlayoffChallenge/Views/AdminView.swift` (optional)
- `ios-app/PlayoffChallenge/Views/PlayerSelectionView.swift` (payment check)

**Backend**: None (enforcement already exists)

**Database**: Verify `game_settings.wr_limit = 3` and defense availability

---

## Exit Criteria

**App Store Build**:
- Passes Apple review without questions
- No admin UI reachable
- No monetization language visible
- Fully playable without barriers

**TestFlight Build**:
- All existing features work
- Payment enforced correctly
- Admin tools accessible
