# CLIENT LOCK V1 — Manual iOS Contract Validation

## Objective
Verify that the iOS app renders strictly from the backend contract:
- No local inference of contest status, leaderboard_state, or capabilities
- UI gating driven solely by `contract.actions.*`
- Missing fields fail silently in UI (should not happen in production)
- Schema-driven rendering only

---

## Manual Test Scenarios

### 1. Contest Detail UI
1. Open any contest in the app.
2. Verify the following actions are correctly enabled/disabled based on backend response:
   - Join button → `actions.can_join`
   - Edit entry / lineup → `actions.can_edit_entry`
   - Share invite → `actions.can_share_invite`
   - Manage contest → `actions.can_manage_contest`
3. Confirm no buttons or options are visible/active based on:
   - `contest.status`
   - `leaderboard_state`
   - `entry_count` / `max_entries`
4. Record which buttons were active and match with expected backend values.

### 2. Leaderboard UI
1. Navigate to a contest leaderboard.
2. Verify that `leaderboard_state` drives display logic:
   - `.pending` → loading or placeholder state
   - `.computed` → show actual leaderboard rows
   - `.error` → show error state
3. Confirm no derived state or local inference (e.g., counting rows to determine pending/computed).

### 3. Negative / Missing Field Testing
1. If testing with a dev build, use fixtures that simulate missing fields:
   - Missing `can_share_invite`
   - Missing `can_manage_contest`
2. Confirm the app does not silently enable UI for missing actions.
3. Verify that errors are logged in the debug console if applicable.

### 4. Payout Table Rendering
1. Open a contest with a populated payout table.
2. Confirm:
   - All ranks/amounts appear exactly as provided by backend contract
   - Malformed or missing `amount` values trigger visible fallback or error message
3. Confirm no local calculation or rounding is applied in the client.

### 5. Roster Config Validation
1. Verify `roster_config.max_entries` limits UI interactions:
   - Cannot join beyond `max_entries`
   - Cannot submit more entries than allowed
2. Confirm no local defaults are applied if the backend sends unexpected values.

---

## Reporting Template
| Test Area | Contract Field | Expected Behavior | Observed Behavior | PASS/FAIL | Notes |
|-----------|----------------|-----------------|-----------------|-----------|-------|
| Contest Detail | can_join | Button enabled if true | | | |
| Contest Detail | can_edit_entry | Button enabled if true | | | |
| Contest Detail | can_share_invite | Share enabled if true | | | |
| Contest Detail | can_manage_contest | Manage enabled if true | | | |
| Leaderboard | leaderboard_state | State drives UI | | | |
| Payout Table | payout_table | Ranks and amounts match backend | | | |
| Roster Config | max_entries | Limits enforced | | | |

---

**Instructions**
- Use the table to track results for each contest.
- Compare with backend contract payloads.
- Note any UI drift or client-side inference.
- Submit completed sheet for verification.
