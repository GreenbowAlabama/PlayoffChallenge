FINAL PLAYOFF WEEK PROMOTION RUNBOOK

Wild Card → Divisional Round (Week 19 → Week 20)

⸻

OPERATIONAL DECISIONS (FINAL)
┌──────────────────────────────┬───────────────────────────────────────────────────────────────────────────────┐
│           Decision           │                                      Status                                   │
├──────────────────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ Week transition via web-admin│ CONFIRMED - Button fixed, curl no longer required for transition             │
├──────────────────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ Pre-game pick visibility     │ ACCEPTED GAP - Fix deferred unless confirmed user-visible leak               │
├──────────────────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ Week locking                 │ MANUAL - No automation required                                               │
├──────────────────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ Multiplier storage           │ picks.multiplier - No schema changes                                          │
├──────────────────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ PLAYOFF_TEAMS list           │ NO CHANGES - Update after tonight’s games                                     │
└──────────────────────────────┴───────────────────────────────────────────────────────────────────────────────┘

⸻

ACCEPTED RISKS FOR TONIGHT
	1.	Pre-Game Pick Visibility: Backend does not gate includePicks by individual player’s game_time. Privacy relies on iOS client behavior. Accepted - no confirmed user-visible leak in production iOS app.
	2.	PLAYOFF_TEAMS Hardcoded: List may include eliminated teams until manually updated. Swap validation will still work because ESPN scoreboard determines active teams dynamically. Accepted - update after final game.
	3.	Web-Admin Button Hotfix: Frontend-only contract fix. No backend logic or schema changes. Transition only occurs when button is clicked and confirmed.

⸻

PRE-FLIGHT CHECKLIST (DO NOW)
	1.	Verify Current State

– Run against production (read-only)
SELECT playoff_start_week, current_playoff_week, is_week_active FROM game_settings;
Expected: playoff_start_week=19, current_playoff_week=1, is_week_active=false
	2.	Confirm Scores Finalized

SELECT COUNT(*) as scored_picks FROM scores WHERE week_number = 19 AND final_points > 0;
Expected: Positive count matching number of players who played
	3.	Confirm No Week 20 Picks Exist

SELECT COUNT(*) FROM picks WHERE week_number = 20;
Expected: 0
	4.	Confirm Admin Access

curl -X GET “<BASE_URL>/api/admin/cache-status” 
-H “Authorization: Bearer <ADMIN_BEARER_TOKEN>”
Expected: 200 OK with JSON response
	5.	Record Admin User ID (Optional)

SELECT id, username FROM users WHERE is_admin = true;
Expected: iancarter present (id: c1c74d6c-1d2c-4436-a29d-2f6891f3e813)

Note: Web-admin now sources userId automatically from the admin JWT (localStorage.admin_token sub). No manual userId required for the button.

⸻

LIVE EXECUTION CHECKLIST

STEP 1: Confirm Week 19 Locked

Skip if already locked (is_week_active = false)

curl -X POST “<BASE_URL>/api/admin/update-week-status” 
-H “Authorization: Bearer <ADMIN_BEARER_TOKEN>” 
-H “Content-Type: application/json” 
-d ‘{“is_week_active”: false}’
Expected: {“success”: true, “message”: “Week locked”}

⸻

STEP 2: Execute Week Transition (WEB-ADMIN)

Web-admin:
	1.	Open Dashboard
	2.	Confirm the button shows: NFL Week 19 → Week 20
	3.	Click “Advance to Next Week”
	4.	In confirmation modal, type: ADVANCE WEEK
	5.	Confirm

Backend call (for reference only, no curl needed):
POST /api/admin/process-week-transition
Body: {“userId”:””,“fromWeek”:19,“toWeek”:20}

Expected:
	•	Success response returned in Network tab
	•	Button label updates to next week numbers after gameConfig refresh (polls every 30s)
	•	No errors in console

Record:
	•	advancedCount: ____
	•	eliminatedCount: ____
	•	activeTeams: ____________________

Optional validation (DevTools):
	•	Network tab request body contains userId/fromWeek/toWeek

⸻

STEP 3: Verify Week 20 Picks Created

SELECT COUNT(*) as week20_picks FROM picks WHERE week_number = 20;
Expected: Greater than 0, aligns with advancedCount from Step 2

SELECT multiplier, COUNT(*) FROM picks WHERE week_number = 20 GROUP BY multiplier;
Expected: Majority at 2.0 (advancing players)

⸻

STEP 4: Advance Current Playoff Week + Unlock

curl -X POST “<BASE_URL>/api/admin/update-current-week” 
-H “Authorization: Bearer <ADMIN_BEARER_TOKEN>” 
-H “Content-Type: application/json” 
-d ‘{
“current_playoff_week”: 2,
“is_week_active”: true
}’
Expected: {“success”: true, “message”: “Current week set to 2”}

⸻

STEP 5: Verify Final State

SELECT playoff_start_week, current_playoff_week, is_week_active FROM game_settings;
Expected: playoff_start_week=19, current_playoff_week=2, is_week_active=true

⸻

STEP 6: Verify Leaderboard Access

curl -X GET “<BASE_URL>/api/leaderboard?weekNumber=20” 
-H “Content-Type: application/json”
Expected: JSON array of users with total_points: 0 (no games played yet)

⸻

STEP 7: Verify Swap Eligibility (Spot Check)

curl -X GET “<BASE_URL>/api/picks/eliminated/<TEST_USER_ID>/20” 
-H “Authorization: Bearer <ADMIN_BEARER_TOKEN>”
Expected: Lists eliminated players from teams not in activeTeams

⸻

POST-EXECUTION VERIFICATION QUERIES

Run after users begin making swaps (before Saturday games):

– Swaps recorded
SELECT COUNT(*) FROM player_swaps WHERE week_number = 20;

– No duplicate picks
SELECT user_id, player_id, week_number, COUNT()
FROM picks WHERE week_number = 20
GROUP BY user_id, player_id, week_number
HAVING COUNT() > 1;
Expected: 0 rows

– Swapped players have multiplier = 1
SELECT u.username, p.full_name, pk.multiplier
FROM picks pk
JOIN users u ON pk.user_id = u.id
JOIN players p ON pk.player_id = p.id
WHERE pk.week_number = 20 AND pk.multiplier = 1.0;

⸻

LOCK WEEK 20 (BEFORE SATURDAY KICKOFF)

Execute manually before first Divisional game:

curl -X POST “<BASE_URL>/api/admin/update-week-status” 
-H “Authorization: Bearer <ADMIN_BEARER_TOKEN>” 
-H “Content-Type: application/json” 
-d ‘{“is_week_active”: false}’

⸻

PLACEHOLDER VALUES
┌──────────────────────┬──────────────────────────────────────┐
│     Placeholder      │                Value                 │
├──────────────────────┼──────────────────────────────────────┤
│ <BASE_URL>           │ ___________________                  │
├──────────────────────┼──────────────────────────────────────┤
│ <ADMIN_BEARER_TOKEN> │ ___________________                  │
├──────────────────────┼──────────────────────────────────────┤
│ <TEST_USER_ID>       │ ___________________                  │
└──────────────────────┴──────────────────────────────────────┘

⸻

ROLLBACK (IF NEEDED)

If transition created bad data:

– Delete week 20 picks (DESTRUCTIVE - use only if needed)
DELETE FROM picks WHERE week_number = 20;

– Reset game settings
UPDATE game_settings SET current_playoff_week = 1, is_week_active = false;

⸻

DEFERRED ITEMS (POST-PROMOTION)
	1.	Evaluate pre-game pick visibility gating (backend-side hardening)
	2.	Update PLAYOFF_TEAMS list after tonight’s games finalize
	3.	Consider automation for week locking at game_time