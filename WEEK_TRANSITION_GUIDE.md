# Week Transition Guide

## Pre-Transition Checklist (Before advancing to next week)

### 1. Validate Current Week Data
Run validation script for the upcoming week:
```bash
DATABASE_URL="your-railway-url" node scripts/validate-week14-readiness.js
```

### 2. Check for Data Quality Issues

**Check for null positions:**
```sql
SELECT COUNT(*) FROM picks WHERE week_number = <NEXT_WEEK> AND position IS NULL;
```
If count > 0, delete them:
```bash
node scripts/delete-null-position-picks.sh
```

**Check for players missing ESPN IDs:**
```sql
SELECT DISTINCT p.full_name, p.team, p.position
FROM players p
JOIN picks pk ON p.id = pk.player_id
WHERE pk.week_number = <CURRENT_WEEK>
  AND p.espn_id IS NULL;
```

### 3. Clear Future Week Scores (if they exist)
```bash
# Replace 14 with the next week number
DATABASE_URL="your-railway-url" node scripts/clear-week14-scores.js
```

Or via SQL:
```sql
DELETE FROM scores WHERE week_number = <NEXT_WEEK>;
```

## Week Transition Process

### Option A: Lock & Advance (Recommended)
1. Open iOS app → Admin Panel → Set Week tab
2. Click **"Lock & Advance to Next Week"**
   - This locks the current week
   - Advances to the next week
   - Copies picks with increased multipliers

### Option B: Manual Multiplier Transition
1. Ensure current week is set correctly
2. Click **"Process Week Transition (Multipliers)"**
   - Copies current week picks to next week
   - Increases multipliers (1x → 2x, 2x → 3x, etc.)
   - Excludes eliminated players

## Post-Transition Validation

### 1. Verify Picks Copied Correctly
```bash
DATABASE_URL="your-railway-url" node scripts/validate-week14-readiness.js
```

### 2. Check Sample User
Via API:
```bash
curl "https://playoffchallenge-production.up.railway.app/api/picks/user/<USER_ID>" | grep week_number
```

Verify:
- ✓ Old week picks are locked
- ✓ New week picks exist
- ✓ Multipliers increased correctly
- ✓ All positions have values (no NULLs)

### 3. Initialize Scores
Trigger first stats update:
```bash
curl -X POST "https://playoffchallenge-production.up.railway.app/api/admin/update-live-stats" \
  -H "Content-Type: application/json" \
  -d '{"weekNumber": <NEXT_WEEK>}'
```

### 4. Verify Leaderboard
```bash
curl "https://playoffchallenge-production.up.railway.app/api/leaderboard?weekNumber=<NEXT_WEEK>&includePicks=true" | head -100
```

Check:
- ✓ Scores are 0 or low (only current games)
- ✓ No stale scores from previous week
- ✓ Multipliers display correctly
- ✓ No null positions causing decode errors

## Handling Eliminated Players

### Automatic Behavior
- When a team loses in the playoffs, their players become unavailable
- The week transition automatically excludes eliminated players
- Users will have incomplete rosters (< 8 picks)

### Options for Handling

**Option 1: Let Users Fill Manually**
- Users see their incomplete roster
- They can add replacement picks (will have 1x multiplier)

**Option 2: Auto-Fill Replacements**
Run the replacement script:
```bash
node scripts/add-replacement-picks-week14.js
```
- Finds users with incomplete rosters
- Adds random available players
- Sets multiplier to 1x (new picks)

## Common Issues & Fixes

### Issue: Null positions in picks
**Symptom:** iOS app shows decoding error when loading leaderboard
**Fix:**
```bash
bash scripts/delete-null-position-picks.sh
```

### Issue: Stale scores from previous week
**Symptom:** Week 14 shows Week 13 scores for players who haven't played
**Fix:**
```bash
DATABASE_URL="your-railway-url" node scripts/clear-week14-scores.js
curl -X POST ".../api/admin/update-live-stats" -d '{"weekNumber": 14}'
```

### Issue: Players missing ESPN IDs
**Symptom:** Players show 0 points even though they played
**Fix:**
1. Find player in ESPN roster
2. Update database:
```sql
UPDATE players SET espn_id = '<ESPN_ID>' WHERE id = '<PLAYER_ID>';
```

### Issue: Duplicate picks
**Symptom:** Users have more than required picks per position
**Fix:**
```bash
DATABASE_URL="your-railway-url" node scripts/cleanup-duplicate-bot-picks.js
```

## Week 14 Specific Notes

### NFL Week Mapping
- Playoff Week 1 = NFL Week 19 (Wild Card)
- Playoff Week 2 = NFL Week 20 (Divisional)
- Playoff Week 3 = NFL Week 21 (Conference Championships)
- Playoff Week 4 = NFL Week 22 (Super Bowl)

**Current Status:**
- We're using NFL Weeks 12-13 for testing
- Week 14 would be the next test week

### Expected Multipliers for Week 14
If using the multiplier system:
- Picks from Week 12 (if still active): 3x
- Picks from Week 13 (if still active): 2x
- New replacement picks: 1x

## Deployment Checklist

Before releasing to testers:
- [ ] Run validation script
- [ ] Clear any stale scores
- [ ] Delete null position picks
- [ ] Verify multipliers are correct
- [ ] Test leaderboard loads in iOS without errors
- [ ] Verify at least one player has live stats showing
- [ ] Check that 1x, 2x, 3x badges display correctly

## Scripts Reference

All scripts located in `/scripts/`:
- `validate-week14-readiness.js` - Pre-deployment validation
- `clear-week14-scores.js` - Clear stale scores
- `delete-null-position-picks.sh` - Remove invalid picks
- `add-replacement-picks-week14.js` - Fill incomplete rosters
- `cleanup-duplicate-bot-picks.js` - Remove duplicates

Run with:
```bash
DATABASE_URL="<railway-connection-string>" node scripts/<script-name>.js
```
