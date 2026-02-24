# iOS Contract Compliance Audit — Iteration 02 Phase 1

**Date:** 2026-02-17
**Scope:** Inference patterns in iOS codebase that depend on client-side business logic instead of contract fields
**Status:** In Progress

---

## 1. Status Branching

Branches on `contest.status` that must be replaced with `actions` + `leaderboard_state`.

### IOS-02-AUD-001
- **File:** `ios-app/PlayoffChallenge/ViewModels/ContestDetailViewModel.swift`
- **Lines:** 85, 127, 131, 146, 153, 156
- **Pattern:** Direct branching on `contest.status` string literal values
- **Current behavior:**
  - Line 85: `guard !hasFetched || contest.status == "Loading" else { return }` — Guard clause using status to control fetch logic
  - Line 127: `return contest.status == "SCHEDULED"` — `canJoinContest` depends on status == "SCHEDULED"
  - Line 131: `isJoined && contest.status != "COMPLETE"` — `canSelectLineup` excludes "COMPLETE"
  - Line 146: `if contest.status == "LOCKED"` — `joinButtonTitle` changes label for "LOCKED"
  - Line 153-158: `statusMessage` derives copy from "SCHEDULED" vs "LOCKED" status strings
- **Category:** Must replace with contract field
- **Replace with:** `actions.can_join`, `actions.can_edit_entry`, `actions.is_read_only`, `leaderboard_state`
- **Contract fields:** `actions.can_join`, `actions.can_edit_entry`, `actions.is_read_only`, `actions.is_closed`
- **New behavior summary:** Joinability, edit capability, and read-only states must come exclusively from backend `actions.*` flags, not status inference.
- **Risk:** High — Core UI state gating depends on status string matching rather than authoritative action flags
- **Notes:**
  - "Loading" status is a placeholder antipattern; should use `isFetching` or similar loading flag
  - `canJoinContest` must derive from `actions.can_join` (post-contract)
  - `canSelectLineup` must derive from `actions.can_edit_entry`
  - `joinButtonTitle` and `statusMessage` must be data-driven from actions, not status strings
  - All status strings are subject to backend change; hardcoding them breaks on API evolution

---

## 2. Payout Computation

Formulas, percent splits, and prize pool math that must be removed entirely.

### IOS-02-AUD-002
- **File:** `ios-app/PlayoffChallenge/Views/RulesView.swift`
- **Lines:** 137, 331, 343-356
- **Pattern:** `payoutResponse`, `payoutItems`, hardcoded payout section handling
- **Current behavior:**
  - Line 137: Section title hardcoded as "Payouts"
  - Line 331: `@Published var payoutResponse: PayoutResponse?` — ViewModel property stores payout data
  - Line 343-356: Payout loading and display in RulesView — fetches and displays payout tiers
  - Likely contains client-side payout calculation or display logic (not shown in excerpt, but present in usage)
- **Category:** Must remove
- **Replace with:** `payout_table` from contest detail contract
- **Contract fields:** `payout_table: [{rank_min, rank_max, amount}, ...]`
- **New behavior summary:** Render `payout_table` from backend contract as-is; no client-side calculation or inference.
- **Risk:** Medium — Currently appears to be display-only, but any client-side math is forbidden per contract
- **Notes:**
  - Verify RulesView does not compute or split prize pools
  - Any tie-breaking logic for payout tiers must be removed
  - Payout display must be pure formatting of provided backend values

---

## 3. Rank Computation

Client-side rank assignment, tie resolution, and sorting that must be removed entirely.

### IOS-02-AUD-003
- **File:** `ios-app/PlayoffChallenge/ViewModels/ContestLeaderboardViewModel.swift`
- **Lines:** 109, 114-118
- **Pattern:** Client-side sorting and rank calculation
- **Current behavior:**
  - Line 109: `loadedEntries.sort { $0.totalPoints > $1.totalPoints }` — Sorts entries by total points descending
  - Lines 114-118: Computes `currentUserRank = userIndex + 1` after sorting — Derives rank from sorted position
  - Rank is entirely inferred from index in client-sorted array
- **Category:** Must remove
- **Replace with:** Display rows exactly as backend delivers; rank shown only if included in `column_schema`
- **Contract fields:** `leaderboard_state`, `column_schema[]`, `rows[]` (must include rank field if needed)
- **New behavior summary:** Stop sorting, stop computing rank from index. Display backend-delivered rows in backend order.
- **Risk:** High — Client-side sorting changes display order and violates contract. Rank computation is forbidden.
- **Notes:**
  - Remove `.sort { ... }` completely — no client-side ranking logic
  - If rank display is needed, backend must provide it as a `column_schema` column
  - Backend order is canonical; preserve it exactly
  - Tie handling (if needed) must be defined in backend contract, not client heuristics

### IOS-02-AUD-004
- **File:** `ios-app/PlayoffChallenge/Views/LeaderboardView.swift`
- **Lines:** 62-64
- **Pattern:** Client-side rank assignment using `enumerated()` and `index + 1`
- **Current behavior:**
  - Line 62: `ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in`
  - Line 64: `rank: index + 1` passed to row component — Rank computed from iteration index
- **Category:** Must remove
- **Replace with:** Render rows exactly as returned; show rank only if backend includes it in row data
- **Contract fields:** `rows[]` with rank field if applicable, or `column_schema` that references rank
- **New behavior summary:** Remove index-based rank calculation. If rank is needed, consume it from backend-provided row data.
- **Risk:** High — Same as IOS-02-AUD-003; violates contract sorting and tie-breaking rules
- **Notes:**
  - Change to `ForEach(entries, id: \.id)` without enumeration
  - Pass rank from entry data only if backend provides it
  - Do not reconstruct rank from iteration position

### IOS-02-AUD-005
- **File:** `ios-app/PlayoffChallenge/Views/ContestLeaderboardView.swift`
- **Lines:** 55-57
- **Pattern:** Client-side rank assignment using `enumerated()` and `index + 1`
- **Current behavior:**
  - Line 55: `ForEach(Array(viewModel.entries.enumerated()), id: \.element.id) { index, entry in`
  - Line 57: `rank: index + 1` passed to LeaderboardRowView — Rank inferred from sorted position
- **Category:** Must remove
- **Replace with:** Render rows exactly as returned; rank shown only if backend provides it
- **Contract fields:** `rows[]` with rank field if applicable
- **New behavior summary:** Remove enumeration-based rank calculation. Use backend-provided rank or omit if not in contract.
- **Risk:** High — Breaks tie-breaking and contest-agnostic leaderboard rendering
- **Notes:**
  - Same fix as IOS-02-AUD-004
  - Coordinate with ContestLeaderboardViewModel to stop sorting (IOS-02-AUD-003)

---

## 4. Scoring State Inference

Client-side inference of readiness (`pending`, `computed`, `error`) based on data presence instead of explicit contract field.

### IOS-02-AUD-006
- **File:** `ios-app/PlayoffChallenge/Views/ContestLeaderboardView.swift`
- **Lines:** 24-26
- **Pattern:** Empty state logic based on `viewModel.entries.isEmpty` instead of explicit state field
- **Current behavior:**
  - Line 24-26: `if viewModel.isLoading { ... } else if viewModel.entries.isEmpty { show "No entries yet" }`
  - Assumes "empty array = not computed yet" — Uses data presence as readiness proxy
- **Category:** Must replace with contract field
- **Replace with:** Explicit `leaderboard_state` enum field from backend contract
- **Contract fields:** `leaderboard_state: "pending" | "computed" | "error"`
- **New behavior summary:** Show loading/computed/error states based on `leaderboard_state`, not data presence.
- **Risk:** Medium — Can show incorrect UI (e.g., "No entries" when in "pending" state but stale data present)
- **Notes:**
  - Add `leaderboard_state` field to backend contract response
  - Even if `entries.isEmpty`, show "pending" UI if `leaderboard_state == "pending"`
  - "No entries" UI only shown if `leaderboard_state == "computed"` AND `entries.isEmpty`

### IOS-02-AUD-007
- **File:** `ios-app/PlayoffChallenge/Views/LeaderboardView.swift`
- **Lines:** 46-59
- **Pattern:** Empty state conditional based on entries data presence
- **Current behavior:**
  - Line 46: `if isLoading { ... }`
  - Line 48: `else if entries.isEmpty { show "No scores yet" }`
  - Line 59: `else { show entries }` — Assumes data presence = scored, empty = pending
- **Category:** Must replace with contract field
- **Replace with:** Explicit `leaderboard_state` from backend response
- **Contract fields:** `leaderboard_state: "pending" | "computed" | "error"`
- **New behavior summary:** Use `leaderboard_state` to control UI states, not entry count.
- **Risk:** Medium — Same risk as IOS-02-AUD-006
- **Notes:**
  - Backend must include `leaderboard_state` in leaderboard endpoint response
  - If `leaderboard_state == "pending"`, show pending UI even if entries are present
  - If `leaderboard_state == "error"`, show error UI and do not attempt retry logic client-side

---

## 5. Leaderboard Schema Assumptions

Hardcoded column definitions and fixed-schema assumptions instead of dynamic rendering from `column_schema`.

### IOS-02-AUD-008
- **File:** `ios-app/PlayoffChallenge/Views/LeaderboardView.swift`
- **Lines:** 180-269 (ExpandableLeaderboardRow structure)
- **Pattern:** Hardcoded row layout with fixed fields: rank (index), username, teamName, totalPoints
- **Current behavior:**
  - Line 198: Rank displayed from parameter (derived from `index + 1`)
  - Line 206: Username displayed from `entry.username`
  - Line 210-213: Optional teamName displayed as secondary text
  - Line 221: Points displayed from `entry.totalPoints`
  - Lines 244-254: Picks section with hardcoded structure
  - Entire row structure is rigid; cannot accommodate schema changes
- **Category:** Must replace with contract field
- **Replace with:** Render using `column_schema` as source of truth; rows as `[String: JSONValue]`
- **Contract fields:** `column_schema: [{key, label, type, format}, ...]`, `rows: [[String: JSONValue]]`
- **New behavior summary:** Render columns dynamically based on `column_schema`; read values from rows dictionary.
- **Risk:** High — Any schema change requires code modification; inflexible for contest types
- **Notes:**
  - Refactor row model from struct with fixed fields to dynamic dictionary
  - Render headers and cells using `column_schema` metadata
  - Handle optional/missing fields gracefully (show placeholder if key not in row)
  - Type/format metadata in schema (e.g., "currency", "number") should drive formatting

### IOS-02-AUD-009
- **File:** `ios-app/PlayoffChallenge/Views/ContestLeaderboardView.swift`
- **Lines:** 101-156 (LeaderboardRowView structure)
- **Pattern:** Hardcoded columns: rank (index), username, teamName, totalPoints
- **Current behavior:**
  - Line 109: Rank displayed from `rank: Int` parameter (derived from index)
  - Line 117: Username from `entry.username`
  - Line 121-125: Optional teamName as secondary text
  - Line 132: Points from `entry.totalPoints`
  - Entire view assumes fixed structure
- **Category:** Must replace with contract field
- **Replace with:** Render dynamically from `column_schema` and row dictionary
- **Contract fields:** `column_schema[]`, `rows[]` as dictionaries keyed by column identifiers
- **New behavior summary:** Render columns from schema definition; cells read from row dictionaries.
- **Risk:** High — Same as IOS-02-AUD-008; prevents schema flexibility
- **Notes:**
  - Identical issue to LeaderboardView row component
  - Coordinate refactor across both views and ViewModels

### IOS-02-AUD-010
- **File:** `ios-app/PlayoffChallenge/Models/Models.swift`
- **Lines:** 195-236
- **Pattern:** Hardcoded Codable struct fields for leaderboard rows
- **Current behavior:**
  - LeaderboardEntry struct with fixed required fields: `id`, `username`, `name`, `email`, `teamName`, `totalPoints`, `hasPaid`, `picks`
  - Enforces rigid schema that prevents dynamic columns and contest-agnostic rendering
  - Any schema change requires code modification to the struct
- **Category:** Must replace with contract field
- **Replace with:** Dynamic row representation using dictionaries or AnyDecodable
- **Contract fields:** `rows: [[String: AnyCodable]]` or similar dynamic type
- **New behavior summary:** Rows decoded as dictionaries keyed by column identifiers; columns defined by `column_schema` not struct fields.
- **Risk:** High — Rigid models prevent contest-agnostic design and dynamic column support
- **Notes:**
  - Current struct incompatible with schema-driven rendering from IOS-02-AUD-008/009
  - Consider creating new `LeaderboardRow` type alias for dynamic type: `typealias LeaderboardRow = [String: AnyCodable]`
  - Keep LeaderboardEntry struct available for backward compatibility during transition, but new endpoints should use dynamic rows
  - May need AnyCodable helper type for flexible JSON decoding across different contest types

### IOS-02-AUD-011
- **File:** `ios-app/PlayoffChallenge/Views/ContestDetailView.swift`
- **Lines:** 54, 63
- **Pattern:** Direct status display and placeholder redaction logic based on status value
- **Current behavior:**
  - Line 54: `StatView(value: viewModel.contest.status, label: "Status")` — Displays raw status string
  - Line 63: `.redacted(reason: viewModel.contest.status == "Loading" ? .placeholder : [])` — Loading placeholder conditional uses status string
  - Later in file (not shown): `InfoRowView(label: "Status", value: viewModel.contest.status)` — Additional status display
  - Also uses status for `.redacted(reason: ...)` — Placeholder visibility tied to status
- **Category:** Cosmetic only (safe) for display, but loading placeholder logic should use dedicated flag
- **Replace with:** Use `isFetching` flag for placeholder redaction instead of status check
- **Contract fields:** `isFetching` (local ViewModel state), status for display label only (if still needed)
- **New behavior summary:** Separate concerns: use dedicated loading flag for UI redaction, display status as provided by contract (or omit if not in contract).
- **Risk:** Low-Medium — Display is safe, but redaction logic brittle if status string changes
- **Notes:**
  - Status display for user info is acceptable, but should not drive behavior
  - The `.redacted(reason: status == "Loading")` pattern is fragile; use `isFetching` instead
  - If status is part of contract and should be displayed, keep display; otherwise remove

### IOS-02-AUD-012
- **File:** `ios-app/PlayoffChallenge/Views/ContestManagementView.swift`
- **Lines:** 108-133
- **Pattern:** StatusBadge component with hardcoded status-to-color mapping via switch statement
- **Current behavior:**
  - StatusBadge takes a status string and maps it to a Color via switch:
    - "SCHEDULED" → green
    - "LOCKED" → orange
    - "COMPLETE" → blue
    - "LIVE" → red
    - "CANCELLED" → gray
    - "ERROR" → red
    - default → secondary
  - Used in ManagedContestRowView (line 93)
  - Couples UI styling to status values, prevents evolution
- **Category:** Cosmetic only (safe) for styling, but coupling is problematic
- **Replace with:** Status label from contract; styling metadata in contract if needed
- **Contract fields:** `status` (for label), optional `statusColor` or `statusStyle` field from backend
- **New behavior summary:** Display status label as provided; if styling metadata needed, consume from contract not hardcoded map.
- **Risk:** Low-Medium — Cosmetic, but color mapping will break if backend status values change
- **Notes:**
  - This is display-only, so not high priority
  - Consider removing hardcoded color map if colors will be provided by backend
  - If colors remain static, consider moving to a contract-provided enum or static mapping outside the View

### IOS-02-AUD-013
- **File:** `ios-app/PlayoffChallenge/Views/AvailableContestsView.swift`
- **Lines:** (exact line number from search — uses `contest.status` for display)
- **Pattern:** Direct status display in contest list
- **Current behavior:**
  - Displays `contest.status` as plain text in AvailableContestsView
  - Similar to IOS-02-AUD-011 (status for user info)
- **Category:** Cosmetic only (safe)
- **Replace with:** Display status if provided by contract; can be omitted if not needed
- **Contract fields:** `status` (optional, for display only)
- **New behavior summary:** Status display is acceptable for user info; no behavior gating.
- **Risk:** Low — Display-only
- **Notes:**
  - Same pattern as IOS-02-AUD-011: safe to display, unsafe to gate behavior
  - No action needed unless status display is being removed from UI

---

## Summary by Category

| Category | Count | Impact |
|----------|-------|--------|
| Must Remove | 0 | — |
| Must Replace | 10 | High (Core UI state gating, leaderboard rendering, schema rigidity) |
| Cosmetic Only | 3 | Low-Medium (Display/styling, not behavior-gating) |

**Key metrics:**
- **Total findings:** 13
- **High risk:** 7 (IOS-02-AUD-001, 003-005, 008-010)
- **Medium risk:** 4 (IOS-02-AUD-002, 006-007, 012)
- **Low risk:** 2 (IOS-02-AUD-011, 013)

---

## Refactor Priority

1. **Phase 1 (High risk, blocking):**
   - IOS-02-AUD-001: Status branching → actions + leaderboard_state
   - IOS-02-AUD-003, IOS-02-AUD-004, IOS-02-AUD-005: Rank computation removal

2. **Phase 2 (Medium risk, structural):**
   - IOS-02-AUD-008, IOS-02-AUD-009, IOS-02-AUD-010: Schema-driven rendering

3. **Phase 3 (Medium risk, readiness):**
   - IOS-02-AUD-006, IOS-02-AUD-007: Explicit scoring state fields

---

## Next Steps

### Audit Verification (Phase 1)
- [ ] Examine RulesView more closely for payout formula or calculation logic (IOS-02-AUD-002)
- [ ] Check AvailableContestsView for any status-based gating (IOS-02-AUD-013)
- [ ] Search for "isLive", "isClosed", "isScored" patterns in ViewModel/View files
- [ ] Verify no ranking/tie-breaking logic in other leaderboard variations or services

### Contract Alignment (Pre-Phase 2)
- [ ] Confirm backend contract includes all required fields:
  - [ ] `actions: {can_join, can_edit_entry, is_read_only, is_closed, is_scoring, is_scored}`
  - [ ] `leaderboard_state: "pending" | "computed" | "error"`
  - [ ] `payout_table: [{rank_min, rank_max, amount}]`
  - [ ] `column_schema: [{key, label, type, format}]`
  - [ ] `rows: [[String: AnyCodable]]` (instead of rigid struct)
  - [ ] `generated_at` (for display, not readiness inference)
- [ ] Create contract fixture JSON files for testing:
  - [ ] `contest_detail_pending.json`
  - [ ] `contest_detail_live_readonly.json`
  - [ ] `leaderboard_pending.json`
  - [ ] `leaderboard_computed.json`
  - [ ] `leaderboard_error.json`

### Phase 2 ViewModel Refactor (Ordered)
1. ContestDetailViewModel: Replace status branching with actions + leaderboard_state (IOS-02-AUD-001)
2. ContestLeaderboardViewModel: Stop sorting, remove rank computation (IOS-02-AUD-003)
3. LeaderboardView/ContestLeaderboardView: Remove enumeration-based ranking (IOS-02-AUD-004, IOS-02-AUD-005)
4. Scoring state inference: Replace with explicit leaderboard_state (IOS-02-AUD-006, IOS-02-AUD-007)
5. Schema-driven rendering: Refactor rows to dynamic type, render from column_schema (IOS-02-AUD-008, IOS-02-AUD-009, IOS-02-AUD-010)
