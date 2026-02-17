# Client Fluidity Program
## 02: Iteration 02 - iOS Contract Compliance

**Status:** PLANNED
**Iteration:** 02
**Duration:** 3-4 weeks
**Owner:** iOS Team
**Depends On:** Iteration 01 (Backend Contract Alignment)
**Blocks:** Iteration 03

---

## Purpose

Refactor iOS to become a pure presentation layer that renders contest data from the backend contract without implementing business logic. Remove all client-side scoring, payout calculation, and hardcoded assumptions about contest types.

---

## Scope

### In Scope

1. **Remove Client-Side Scoring Logic**
   - Delete all scoring calculation code
   - Remove player stat aggregation
   - Remove position/matchup scoring logic

2. **Remove Client-Side Payout Calculation**
   - Delete payout computation code
   - Remove prize pool distribution logic
   - Delete all winnings prediction

3. **Dynamic Leaderboard Rendering**
   - Parse `column_schema` from backend
   - Render columns dynamically based on type
   - Support ordinal, string, numeric, currency, percentage, date types
   - Apply sort hints from schema

4. **Dynamic Payout Table Rendering**
   - Render `payout_table` from contest detail
   - Display place, rank range, payout amount with currency
   - No calculation or aggregation

5. **Dynamic Roster Configuration Rendering**
   - Parse `roster_config` from contest detail
   - Render entry fields based on field type
   - Display validation rules to user during entry creation
   - Show constraint violations (salary cap, etc.) before submission

6. **Contest Type Awareness**
   - Use `type` field for branding and UX hints only
   - No type-specific logic in presentation
   - Support unknown types gracefully

7. **Action Flag Compliance**
   - Use `actions.can_join` to enable/disable join button
   - Use `actions.can_edit_entry` to enable/disable edit UI
   - Use `actions.is_read_only` to disable all mutations
   - Use `actions.is_live` to show live indicator
   - Use `actions.is_scored` to show leaderboard
   - Remove client-side state prediction

8. **Join URL Elimination**
   - Remove hardcoded join URLs for specific contest types
   - Use canonical `GET /api/custom-contests/join/:token` endpoint
   - Dynamic join handling based on contest type

### Out of Scope

- **Server Sync:** No CloudKit or local persistence changes
- **Real-Time Updates:** No WebSocket or SSE implementation
- **Offline Mode:** No offline contest rendering
- **UI Design Changes:** Structure unchanged; behavior driven by data
- **Animation Overhauls:** Existing animations preserved where possible
- **Performance Rewrite:** Defer until measured performance issue
- **Accessibility Audit:** Continue per existing standards

---

## Invariants

### No Business Logic
- Leaderboard displays backend data as-is; no calculations
- Payout table displays server amounts; no redistribution
- Validation happens server-side; client shows constraints only

### Multi-Contest Awareness
- iOS respects `contest_id` from all responses
- No global state for "current" contest
- Concurrent contests render independently

### Idempotency Respected
- Join actions are safe to retry
- Entry submission is safe to retry (deduplication server-side)
- No client-side state mutation on GET requests

### Type Agnostic
- New contest types work without code changes
- Unknown types render with default styling
- No type-specific conditional logic in rendering

---

## Codable Model Requirements

### 1. Contest Model

```swift
struct Contest: Codable, Identifiable {
    let id: String
    let contestId: String
    let type: String
    let name: String
    let description: String?
    let status: String  // "open", "live", "closed", "scored", "archived"
    let startsAt: Date
    let endsAt: Date
    let organizerId: String
    let entryFee: Decimal
    let currency: String  // "USD", "EUR", etc.
    let maxEntries: Int?
    let currentEntries: Int

    let actions: ContestActions
    let payoutTable: [PayoutRow]
    let rosterConfig: RosterConfig
}

struct ContestActions: Codable {
    let canJoin: Bool
    let canEditEntry: Bool
    let isReadOnly: Bool
    let isLive: Bool
    let isClosed: Bool
    let isScoring: Bool
    let isScored: Bool

    enum CodingKeys: String, CodingKey {
        case canJoin = "can_join"
        case canEditEntry = "can_edit_entry"
        case isReadOnly = "is_read_only"
        case isLive = "is_live"
        case isClosed = "is_closed"
        case isScoring = "is_scoring"
        case isScored = "is_scored"
    }
}

struct PayoutRow: Codable {
    let place: Int
    let minRank: Int
    let maxRank: Int
    let payoutAmount: Decimal
    let payoutPercent: Decimal?
    let currency: String

    enum CodingKeys: String, CodingKey {
        case place
        case minRank = "min_rank"
        case maxRank = "max_rank"
        case payoutAmount = "payout_amount"
        case payoutPercent = "payout_percent"
        case currency
    }
}
```

### 2. Leaderboard Model

```swift
struct Leaderboard: Codable {
    let contestId: String
    let contestType: String
    let leaderboardState: String  // "pending", "computing", "computed", "error"
    let generatedAt: Date

    let columnSchema: [LeaderboardColumn]
    let rows: [LeaderboardRow]
    let pagination: Pagination

    enum CodingKeys: String, CodingKey {
        case contestId = "contest_id"
        case contestType = "contest_type"
        case leaderboardState = "leaderboard_state"
        case generatedAt = "generated_at"
        case columnSchema = "column_schema"
        case rows
        case pagination
    }
}

struct LeaderboardColumn: Codable {
    let id: String
    let name: String
    let type: String  // "ordinal", "string", "numeric", "currency", "percentage", "date"
    let sortable: Bool
    let sortDirection: String?  // "ascending", "descending"
    let precision: Int?
    let currency: String?
    let hint: String?

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case type
        case sortable
        case sortDirection = "sort_direction"
        case precision
        case currency
        case hint
    }
}

struct LeaderboardRow: Codable {
    let rank: Int
    let userId: String
    let userName: String
    let score: Decimal?
    let payout: Decimal?
    let isCurrentUser: Bool
    let entryId: String
    // Additional columns rendered dynamically from columnSchema

    enum CodingKeys: String, CodingKey {
        case rank
        case userId = "user_id"
        case userName = "user_name"
        case score
        case payout
        case isCurrentUser = "is_current_user"
        case entryId = "entry_id"
    }
}

struct Pagination: Codable {
    let page: Int
    let perPage: Int
    let totalRows: Int
    let totalPages: Int

    enum CodingKeys: String, CodingKey {
        case page
        case perPage = "per_page"
        case totalRows = "total_rows"
        case totalPages = "total_pages"
    }
}
```

### 3. Roster Configuration Model

```swift
struct RosterConfig: Codable {
    let maxEntriesPerUser: Int
    let entryFields: [EntryField]
    let validationRules: [ValidationRule]

    enum CodingKeys: String, CodingKey {
        case maxEntriesPerUser = "max_entries_per_user"
        case entryFields = "entry_fields"
        case validationRules = "validation_rules"
    }
}

struct EntryField: Codable {
    let id: String
    let name: String
    let type: String  // "player_selection", "entry_text", "team_selection", etc.
    let required: Bool
    let constraints: FieldConstraints?
}

struct FieldConstraints: Codable {
    let minSelections: Int?
    let maxSelections: Int?
    let allowedPositions: [String]?
    let allowedTeams: [String]?
    let minSalaryTotal: Decimal?
    let maxSalaryTotal: Decimal?
    let uniqueTeams: Bool?
    let uniquePlayers: Bool?

    enum CodingKeys: String, CodingKey {
        case minSelections = "min_selections"
        case maxSelections = "max_selections"
        case allowedPositions = "allowed_positions"
        case allowedTeams = "allowed_teams"
        case minSalaryTotal = "min_salary_total"
        case maxSalaryTotal = "max_salary_total"
        case uniqueTeams = "unique_teams"
        case uniquePlayers = "unique_players"
    }
}

struct ValidationRule: Codable {
    let id: String
    let ruleType: String  // "max_total", "min_total", "unique", "range"
    let field: String
    let maxValue: Decimal?
    let minValue: Decimal?
    let errorMessage: String

    enum CodingKeys: String, CodingKey {
        case id
        case ruleType = "rule_type"
        case field
        case maxValue = "max_value"
        case minValue = "min_value"
        case errorMessage = "error_message"
    }
}
```

---

## Refactoring Checklist

### Phase 1: Mandatory Codebase Audit (Required for Closure Gate)

**Search and document all instances of:**
- [ ] "score" - Identify all scoring-related code
- [ ] "payout" - Identify all payout computation code
- [ ] "distribution" - Identify all prize distribution logic
- [ ] "calculate" - Identify all calculation functions
- [ ] "compute" - Identify all computation functions
- [ ] "aggregate" - Identify all aggregation logic

**Document for each match:**
- File path and line number
- Function/method name
- Purpose and what it computes
- Whether it's part of business logic (must be deleted) or formatting (keep)

**Verify:**
- [ ] All business logic identified
- [ ] All formatting logic separated and kept
- [ ] No scoring/payout logic remains outside of deleted files

**Also Identify:**
- [ ] All type-specific hardcoded paths ("daily-fantasy", "survivor", etc.)
- [ ] All type-conditional logic in views or controllers
- [ ] All join URL construction code with type parameters

### Phase 2: Remove Scoring Logic (Week 1-2)

**Files to Delete (Examples; adjust per codebase):**
- `ScoringEngine.swift`
- `PlayerStatAggregator.swift`
- `PositionScoringCalculator.swift`
- `MatchupScoreComputer.swift`
- Any file with "score" + "calculation" in name

**Before Deletion:**
- [ ] Export scoring logic as documentation (if useful for understanding)
- [ ] Verify no other code depends on these files (grep the codebase)
- [ ] Confirm backend now exposes all scores

**Tests to Delete:**
- [ ] All unit tests for scoring logic
- [ ] All integration tests that simulate scoring
- [ ] All fixtures that include score computation

### Phase 3: Remove Payout Logic (Week 1-2)

**Files to Delete (Examples; adjust per codebase):**
- `PayoutCalculator.swift`
- `PrizePoolDistributor.swift`
- `WinningsComputer.swift`
- Any file with "payout" + "calculation" in name

**Before Deletion:**
- [ ] Verify backend now exposes payout table
- [ ] Confirm no UI predictions remain
- [ ] Check for dependent code

**Tests to Delete:**
- [ ] All unit tests for payout calculation
- [ ] All integration tests for prize distribution
- [ ] All fixtures with payout amounts

### Phase 4: Dynamic Leaderboard Rendering (Week 2-3)

**Rendering Logic (New/Refactored):**
- [ ] Create `LeaderboardColumnRenderer` view (or similar)
  - Input: `LeaderboardColumn` schema + value
  - Output: Formatted cell (ordinal, currency, numeric, etc.)

- [ ] Create `LeaderboardRowView`
  - Input: `LeaderboardRow` + `[LeaderboardColumn]` schema
  - Output: Rendered row with dynamic columns

- [ ] Update `LeaderboardViewController` (or SwiftUI equivalent)
  - Remove hardcoded column names
  - Parse `columnSchema` from API response
  - Render rows dynamically

- [ ] Implement column type formatting:
  - `ordinal`: "1st", "2nd", "3rd", "4th", etc.
  - `string`: Plain text
  - `numeric`: Decimal with precision
  - `currency`: Symbol + amount (USD $100.00, EUR €75.50)
  - `percentage`: Value% with precision
  - `date`: ISO format or locale-specific

**Tests:**
- [ ] Unit test for each column type formatter
- [ ] Integration test: render leaderboard with mock schema
- [ ] Test: unknown column type renders safely (as string)
- [ ] Test: sorting respects schema hints

### Phase 5: Dynamic Payout Table Rendering (Week 2)

**Rendering Logic (New/Refactored):**
- [ ] Create `PayoutTableView`
  - Input: `[PayoutRow]` from contest detail
  - Output: Formatted table (place, rank range, amount)

- [ ] Formatting rules:
  - Place: "1st", "2nd", "3rd", "4th-10th" (if min≠max)
  - Rank Range: "4 - 10" or just number if place = 1
  - Amount: Currency formatted

**Tests:**
- [ ] Unit test: format place ordinal
- [ ] Unit test: format rank range (single vs. range)
- [ ] Unit test: currency formatting by locale
- [ ] Integration test: render full payout table

### Phase 6: Dynamic Roster Configuration (Week 2-3)

**Rendering Logic (New/Refactored):**
- [ ] Create `RosterConfigRenderer`
  - Input: `RosterConfig` from contest detail
  - Output: Entry creation UI (fields + validation rules displayed)

- [ ] Entry field rendering:
  - `player_selection`: Use existing player picker; apply constraints
  - `entry_text`: Text input with hint
  - `team_selection`: Team picker
  - Other types: Render as string input (fail safe)

- [ ] Validation display:
  - Show constraints inline (salary cap, player limits)
  - Display validation rules as user enters data
  - Show constraint violations before submit

**Validation (Client-Side Presentation Only):**
- [ ] Show salary cap remaining as user adds players
- [ ] Disable "Add Player" button if max reached
- [ ] Display validation rules from `validationRules` array
- [ ] Show error message if constraint violated

**Critical Invariant:**
- Validation rules are **informational only** (displayed to user)
- **Actual validation happens server-side on POST**
- Client does NOT enforce rules; does NOT prevent submission based on local checks
- Server is authority; client trusts server response for final validation
- User CAN submit even if client shows constraint violations

**Tests:**
- [ ] Unit test: render player_selection field
- [ ] Unit test: render validation rule messages
- [ ] Unit test: salary display updates correctly
- [ ] Integration test: full entry UI renders from contract
- [ ] Unit test: unknown field type renders safely

### Phase 7: Action Flag Integration (Week 2-3)

**Update All Contest Views:**
- [ ] Contest detail: Use `actions` to set join button state
  - `can_join` → enable button
  - `is_closed` → disable + show "Closed"
  - `is_read_only` → hide all mutation buttons

- [ ] Leaderboard view:
  - Show only if `is_scored = true`
  - Show "Scoring in progress" if `is_scoring = true`
  - Show "Not yet scored" if neither

- [ ] Entry edit view:
  - Enable edit only if `can_edit_entry = true`
  - Disable if `is_read_only = true`

- [ ] Join button:
  - Disable if not `can_join`
  - Disable if `is_closed`

**Remove State Prediction:**
- [ ] Delete any code that predicts contest state
- [ ] Delete any code that computes next state
- [ ] Trust `actions` flags as ground truth

**Tests:**
- [ ] Unit test: contest with `can_join=true` enables join button
- [ ] Unit test: `is_scoring=true` shows loading state
- [ ] Unit test: `is_read_only=true` disables all mutations
- [ ] Integration test: action flags transition correctly

### Phase 8: Type Agnostic Rendering (Required for Unknown Contest Types)

**Architectural Requirement:**
**Unknown contest types must render using default presentation behavior without code modification.**

**Contest Type Usage Rules:**
- [ ] Fetch contest `type` field for branding/theming only
- [ ] Remove ALL type-specific logic from views, controllers, services
- [ ] Unknown types render with default styling/colors automatically

**Allowed Type Usage (Presentation Only):**
- Different logo/color for known types ("daily-fantasy", "survivor")
- Type-specific default text in empty states ("Join a Daily Fantasy Contest")
- Type-specific analytics events or logging
- Localization based on type (strings, images)

**NOT Allowed (Forbidden):**
- `if type == "daily-fantasy" { renderPlayerPicker() }`
- `if type == "survivor" { calculateScore() }`
- Type-conditional logic that affects rendering or behavior
- Type-specific join URLs (use canonical endpoint only)
- Type-specific data parsing or transformation

**Tests:**
- [ ] Unit test: unknown type renders with default styling
- [ ] Unit test: no conditional logic based on type value
- [ ] Integration test: brand new contest type renders without code change
- [ ] Regression test: all existing types still render correctly

### Phase 9: Join URL Elimination (Week 3)

**Current Paths (to Deprecate):**
- Hardcoded URLs for specific contest types
- Deep links with contest type prefix
- Environment-specific URLs

**New Path (Canonical):**
- Use `/api/custom-contests/join/:token` endpoint
- Token received from marketing/email campaigns
- Works for any contest type

**Implementation:**
- [ ] Update deep link handler to recognize join tokens
- [ ] Route to canonical join flow (no type branching)
- [ ] Delete old type-specific join logic

**Tests:**
- [ ] Integration test: join token resolves to contest detail
- [ ] Integration test: join endpoint works after resolution
- [ ] Regression test: existing deep links still work (map to token)

### Phase 10: Cleanup (Week 4)

**Code Deletion:**
- [ ] Delete all scoring/payout/type-specific files
- [ ] Delete test files for deleted code
- [ ] Delete fixtures with hardcoded scores

**Imports & References:**
- [ ] Remove imports from deleted modules
- [ ] Fix any dangling references
- [ ] Remove commented-out scoring code

**Documentation:**
- [ ] Update README: "iOS is a presentation layer"
- [ ] Document new rendering views
- [ ] Update architecture docs

---

## Unit Test Requirements

### Minimum Test Coverage

**Codable Models:**
- [ ] `Contest` decodes correctly from API response
- [ ] `Leaderboard` decodes correctly from API response
- [ ] `RosterConfig` decodes with all field types
- [ ] Invalid JSON gracefully fails with clear error

**Column Rendering:**
- [ ] Ordinal type: 1→"1st", 2→"2nd", 3→"3rd", 21→"21st", 23→"23rd"
- [ ] Currency type: 1000.0→"$1,000.00", 75.5→"€75.50"
- [ ] Numeric type: respects precision (0, 1, 2 decimal places)
- [ ] String type: renders as-is
- [ ] Percentage type: 0.85→"85%"
- [ ] Date type: ISO to locale-specific format

**Leaderboard Rendering:**
- [ ] Rows render with correct number of columns
- [ ] Missing columns in schema render safely
- [ ] Unknown column types default to string
- [ ] Current user highlighted correctly

**Roster Config Rendering:**
- [ ] Entry fields render from schema
- [ ] Constraints displayed to user
- [ ] Salary display updates on selection
- [ ] Validation rules shown as static text

**Action Flag Integration:**
- [ ] `can_join=true` enables join button, `can_join=false` disables
- [ ] `is_read_only=true` disables all mutations
- [ ] `is_scoring=true` shows "Scoring in progress"
- [ ] `is_scored=true` shows leaderboard

**Type Agnostic:**
- [ ] Known type renders with theme
- [ ] Unknown type renders with default theme
- [ ] No conditional logic based on type

### Test Framework & Coverage

- [ ] Use existing test framework (XCTest, XCTestDynamics, Mockery)
- [ ] All tests must pass (zero failures = 100% pass rate)
- [ ] Tests in `/ios-app/PlayoffChallengeTests/`
- [ ] Mock API responses in `/ios-app/PlayoffChallengeTests/Fixtures/`
- [ ] Separate files for each view/model tested
- [ ] No percentage-based pass criteria; all tests must pass

---

## Explicit "Do Not Implement" List

**These are Out of Scope:**

1. **Client-Side Scoring** - Any calculation of contest scores
2. **Client-Side Payouts** - Any calculation of winnings or prize distribution
3. **State Prediction** - Client guessing next state (use action flags)
4. **Type-Specific Logic** - Conditional UI based on contest type
5. **Dynamic Layout** - CSS-like rendering hints or component directives
6. **Version Negotiation** - Client capability advertisement
7. **Real-Time Updates** - WebSocket or SSE for live leaderboards
8. **Offline Rendering** - Cached contest data for offline display
9. **Performance Rewrite** - Major refactoring for speed (measure first)
10. **Schema Validation** - Strict schema enforcement on decode (lenient parsing)

---

## Files to Delete or Archive

**Delete These (Move to Archive if Needed Later):**
- All scoring calculation files (identified in audit)
- All payout computation files (identified in audit)
- All type-specific join/routing files
- Fixtures with hardcoded scores/payouts
- Tests for deleted business logic

**Archive These (Keep for Reference):**
- Documentation of old scoring rules (if useful)
- Old payout distribution formulas
- Migration guides (if re-onboarding)

**Keep These (Existing):**
- Player data models
- Contest models (refactored)
- API networking layer
- Existing UI tests (may need updates)
- Accessibility features

---

## Closure Gate: Binary Definition of Done for Iteration 02

**Iteration 02 MUST close when ALL of the following are verified:**

### Code Deletion & Audit
- [ ] Codebase audit completed (Phase 1 checklist)
- [ ] All scoring logic deleted (files removed, not commented out)
- [ ] All payout logic deleted (files removed, not commented out)
- [ ] Zero references to deleted scoring/payout code remain (grep verification)
- [ ] Binary size reduced compared to pre-iteration baseline

### Dynamic Rendering Implementation
- [ ] Leaderboard renders dynamically from `column_schema` (no hardcoded columns)
- [ ] Payout table renders from `payout_table` array (no hardcoded logic)
- [ ] Roster config renders from `roster_config` schema (no hardcoded fields)
- [ ] All column types render correctly: ordinal, string, numeric, currency, percentage, date
- [ ] Unknown column types render safely (default to string)

### Action Flags & State Management
- [ ] Action flags integrated in all contest views
- [ ] `can_join` controls join button state
- [ ] `is_read_only` disables all mutations
- [ ] `is_scoring` shows loading state
- [ ] `is_scored` shows leaderboard
- [ ] No client-side state prediction code remains

### Type Agnostic Rendering
- [ ] Contest type used for branding/theming only
- [ ] Zero type-conditional logic in code
- [ ] Unknown contest types render with default styling
- [ ] Type-specific join URLs removed (canonical endpoint only)

### Testing (ALL tests must pass, zero failures)
- [ ] All unit tests pass (zero failures)
- [ ] All integration tests pass (zero failures)
- [ ] Codable models decode all API responses correctly
- [ ] All column type formatters tested and passing
- [ ] Action flag behavior tested and passing
- [ ] Existing contest types still work (regression tests pass)
- [ ] Deep linking works
- [ ] Navigation between contests works

### Code Quality & Review
- [ ] Code review confirms: zero business logic in presentation layer
- [ ] Code review confirms: all rendering is data-driven
- [ ] No compiler warnings or errors
- [ ] No deprecated API usage

### Sign-Off
- [ ] iOS Lead approval
- [ ] Code review approval (business logic removal verified)
- [ ] Platform Architecture approval
- [ ] Iteration 03 can proceed (gate opened)

---

## Sign-Off

- [ ] iOS Lead Approval
- [ ] Code Review: All business logic removed
- [ ] Code Review: All rendering tests pass
- [ ] Platform Architecture Approval
- [ ] Ready for Iteration 03
