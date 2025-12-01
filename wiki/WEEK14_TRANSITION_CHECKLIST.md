# Week 14 Transition - Quick Checklist

**Goal:** Advance all testers from Week 13 (Divisional) to Week 14 (Conference) with increased multipliers (2x→3x, 1x→2x).

**Time Required:** 10-15 minutes

**When to Run:** After all Week 13 games finish, before Week 14 starts

---

## Pre-Flight Checks

### ✅ 1. Verify Week 13 Games Are Done
Check [ESPN Scoreboard](https://www.espn.com/nfl/scoreboard) - all Week 13 games must show "Final"

### ✅ 2. Clean Week 14 Data
```bash
node scripts/clear-week14-scores.js
```

### ✅ 3. Validate Readiness
```bash
node scripts/validate-week14-readiness.js
```
All checks should pass ✅

---

## Execute Transition

### Option A: iOS Admin Panel (Recommended)
1. Open iOS app → Admin Panel
2. Tap **"Process Week Transition (Multipliers)"**
3. Wait for success message

### Option B: API (if app unavailable)
```bash
curl -X POST "https://playoffchallenge-production.up.railway.app/api/admin/process-week-transition" \
  -H "Content-Type: application/json" \
  -d '{"userId": "YOUR_ADMIN_APPLE_ID", "currentWeek": 2}'
```

---

## Post-Transition Validation

### ✅ 1. Check Week Number
```bash
curl "https://playoffchallenge-production.up.railway.app/api/game-config" | jq '{current_playoff_week, current_nfl_week}'
```
**Expected:** `current_playoff_week: 3`, `current_nfl_week: 14`

### ✅ 2. Verify Multipliers Increased
```bash
curl "https://playoffchallenge-production.up.railway.app/api/picks?week=3" | jq '[.[] | .multiplier] | group_by(.) | map({multiplier: .[0], count: length})'
```
**Expected:** Mix of `multiplier: 2` and `multiplier: 3` (no 1x yet)

### ✅ 3. Test in iOS App
- Open "My Picks" → Week 14 tab
- Verify picks show increased multipliers (3x badges for Wild Card picks, 2x for Divisional)
- Leaderboard should load without errors

---

## Quick Rollback (If Needed)

If something goes wrong:
```bash
# Revert to Week 13
curl -X POST "https://playoffchallenge-production.up.railway.app/api/admin/set-active-week" \
  -H "Content-Type: application/json" \
  -d '{"userId": "YOUR_ADMIN_APPLE_ID", "playoffWeek": 2, "nflWeek": 13}'

# Clear bad Week 14 data
node scripts/clear-week14-scores.js
```

---

## What's Happening Behind the Scenes

- All Week 13 picks copy to Week 14 automatically
- Multipliers increase: 2x→3x, 1x→2x
- No eliminations this week (Week 14 has no bye teams)
- Users can modify picks after transition

---

## Success Criteria

**You're done when:**
- ✅ Game config shows Week 14 (playoff week 3)
- ✅ All users have picks in Week 14
- ✅ Multipliers are 2x and 3x (not 1x)
- ✅ iOS app leaderboard loads correctly

**Questions?** See `/wiki/WEEK14_CONFERENCE_TRANSITION.md` for full details or ping Ian.
