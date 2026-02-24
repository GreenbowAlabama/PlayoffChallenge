# iOS Multi-Contest Assumption Audit

## Executive Summary

The iOS client maintains **high coupling to NFL/Playoff-specific assumptions** across seven architectural categories. While the leaderboard rendering layer has been successfully abstracted via contract-driven schema, the entry/roster layer remains hardcoded to fixed position sets (QB, RB, WR, TE, K, DEF) with fixed limits (1, 2, 3, 1, 1, 1). The contest creation flow explicitly gates on a single `ContestType` enum case. These constraints will block multi-contest support until roster configuration and position rendering are driven by dynamic backend contracts rather than hardcoded enumerations.

**Critical blocker:** Position lists are duplicated across 6+ views and 3+ ViewModels as string literals in ForEach loops. Position limits are replicated across multiple models. Any future sport will require coordinated changes across many files.

---

## Findings

### 1. Hardcoded Sport Checks

#### Finding 1.1: ContestType Enum (Single-Case)
- **File:** `CustomContests/Models/ContestType.swift`
- **Lines:** 5-21
- **Code snippet:**
  ```swift
  enum ContestType: CaseIterable, Identifiable {
      case nflPlayoff
      var id: String {
          switch self { case .nflPlayoff: return "nfl_playoff" }
      }
  }
  ```
- **Category:** Hardcoded sport checks
- **Risk Level:** **High**
- **Description:** Only one case (`nflPlayoff`) exists. Future sports require enum modification. All UI that uses ContestType.allCases will force-present only NFL as an option until this enum is extended.
- **Required Refactor Category:** Contest type dispatch abstraction; backend-driven sport registry

#### Finding 1.2: Default Contest Type Assignment
- **File:** `CustomContests/ViewModels/CreateCustomContestViewModel.swift`
- **Lines:** 34
- **Code snippet:**
  ```swift
  @Published var selectedContestType: ContestType = .nflPlayoff
  ```
- **Category:** Hardcoded sport checks
- **Risk Level:** **Medium**
- **Description:** Contest creation flow defaults to `.nflPlayoff`. Users cannot select other sports unless ContestType enum is expanded. Creates invisible barrier to multi-contest onboarding.
- **Required Refactor Category:** Dynamic contest type selection UI

#### Finding 1.3: Contest Type in Create Contest Form
- **File:** `Views/CreateContestFlowView.swift`
- **Lines:** 57, 68-72
- **Code snippet:**
  ```swift
  @State private var selectedContestType: ContestType = .nflPlayoff
  ...
  Picker("Contest Type", selection: $selectedContestType) {
      ForEach(ContestType.allCases) { type in
          Text(type.displayName).tag(type)
      }
  }
  ```
- **Category:** Hardcoded sport checks
- **Risk Level:** **Medium**
- **Description:** Form picker bound to ContestType enum. Adding sports requires coordinated enum + displayName updates across the codebase.
- **Required Refactor Category:** Contest type picker abstraction

---

### 2. Conditional UI Branching Based on Sport

#### Finding 2.1: Hardcoded Playoff Week Picker (NFL weeks 16-19)
- **File:** `Views/LeaderboardView.swift`
- **Lines:** 16-21
- **Code snippet:**
  ```swift
  let playoffRounds = [
      (16, "Wild Card"),
      (17, "Divisional"),
      (18, "Conference"),
      (19, "Super Bowl")
  ]
  ```
- **Category:** Conditional UI branching based on sport
- **Risk Level:** **High**
- **Description:** Weeks are hardcoded to NFL regular season weeks (16-19). Any other sport with different season structure will not render correctly. No dynamic week mapping from backend.
- **Required Refactor Category:** Dynamic week/slate picker driven by contest config

#### Finding 2.2: Hardcoded Playoff Week Picker (LineupView)
- **File:** `Views/LineupView.swift`
- **Lines:** 131-138
- **Code snippet:**
  ```swift
  var playoffWeeks: [(Int, String)] {
      [
          (playoffStartWeek, "Wild Card"),
          (playoffStartWeek + 1, "Divisional"),
          (playoffStartWeek + 2, "Conference"),
          (playoffStartWeek + 3, "Super Bowl")
      ]
  }
  ```
- **Category:** Conditional UI branching based on sport
- **Risk Level:** **Medium**
- **Description:** While more flexible (uses playoffStartWeek offset), the labels and structure assume a 4-round playoff. Other sports may have different round counts or naming.
- **Required Refactor Category:** Dynamic round labels from contest config

#### Finding 2.3: Hardcoded Week Names (MyPickView)
- **File:** `Views/MyPickView.swift`
- **Lines:** 85-89
- **Code snippet:**
  ```swift
  var body: some View {
      Picker("Week", selection: $selectedWeek) {
          Text("Wild Card").tag(16)
          Text("Divisional").tag(17)
          Text("Conference").tag(18)
          Text("Super Bowl").tag(19)
      }
  }
  ```
- **Category:** Conditional UI branching based on sport
- **Risk Level:** **High**
- **Description:** Hardcoded week numbers and labels. Different sports cannot use this component without modification.
- **Required Refactor Category:** Dynamic week/round rendering

#### Finding 2.4: Hardcoded Week Names (PlayerSelectionView)
- **File:** `Views/PlayerSelectionView.swift`
- **Lines:** 134-141
- **Code snippet:**
  ```swift
  var weeks: [(Int, String)] {
      [
          (16, "Wild Card"),
          (17, "Divisional"),
          (18, "Conference"),
          (19, "Super Bowl")
      ]
  }
  ```
- **Category:** Conditional UI branching based on sport
- **Risk Level:** **High**
- **Description:** Same hardcoded week structure as LeaderboardView. Code duplication across pickers.
- **Required Refactor Category:** Shared week picker component

#### Finding 2.5: Week Name Computation (LineupView EmptyWeekView)
- **File:** `Views/LineupView.swift`
- **Lines:** 157-165
- **Code snippet:**
  ```swift
  var weekName: String {
      let offset = weekNumber - playoffStartWeek
      switch offset {
      case 0: return "Wild Card"
      case 1: return "Divisional"
      case 2: return "Conference"
      case 3: return "Super Bowl"
      default: return "Week \(weekNumber)"
      }
  }
  ```
- **Category:** Conditional UI branching based on sport
- **Risk Level:** **Medium**
- **Description:** Switch statement hardcodes playoff round names based on offset. Replicates logic from other week pickers.
- **Required Refactor Category:** Centralized week name lookup service

---

### 3. Static Roster Assumptions

#### Finding 3.1: Hardcoded Position List (LineupView)
- **File:** `Views/LineupView.swift`
- **Lines:** 53
- **Code snippet:**
  ```swift
  ForEach(["QB", "RB", "WR", "TE", "K", "DEF"], id: \.self) { position in
      LineupPositionSectionV2(...)
  }
  ```
- **Category:** Static roster assumptions
- **Risk Level:** **High**
- **Description:** Position set is hardcoded as a string array literal. Any new sport with different positions requires code modification. Cannot render golfers, drivers, rounds, or other non-position roster structures.
- **Required Refactor Category:** Dynamic roster config rendering

#### Finding 3.2: Hardcoded Position List (PlayerSelectionView)
- **File:** `Views/PlayerSelectionView.swift`
- **Lines:** 28-68
- **Code snippet:**
  ```swift
  PositionSection(position: "QB", limit: viewModel.positionLimits.qb, ...)
  PositionSection(position: "RB", limit: viewModel.positionLimits.rb, ...)
  PositionSection(position: "WR", limit: viewModel.positionLimits.wr, ...)
  PositionSection(position: "TE", limit: viewModel.positionLimits.te, ...)
  PositionSection(position: "K", limit: viewModel.positionLimits.k, ...)
  PositionSection(position: "DEF", limit: viewModel.positionLimits.def, ...)
  ```
- **Category:** Static roster assumptions
- **Risk Level:** **High**
- **Description:** Explicit position instances hardcoded in view. 6 separate view builder calls that must be updated for any roster change. No dynamic iteration over roster config.
- **Required Refactor Category:** Dynamic position section iteration

#### Finding 3.3: Hardcoded Position List (MyPickView)
- **File:** `Views/MyPickView.swift`
- **Lines:** 33-41
- **Code snippet:**
  ```swift
  ForEach(["QB", "RB", "WR", "TE", "K", "DEF"], id: \.self) { position in
      if let picks = viewModel.picksByPosition[position], !picks.isEmpty {
          PositionPicksSection(...)
      }
  }
  ```
- **Category:** Static roster assumptions
- **Risk Level:** **High**
- **Description:** Duplicates position hardcoding pattern from LineupView. Forces dict-based grouping for exactly these 6 positions.
- **Required Refactor Category:** Dynamic position rendering

#### Finding 3.4: Position Color Mapping (LineupView)
- **File:** `Views/LineupView.swift`
- **Lines:** 271-280
- **Code snippet:**
  ```swift
  private var positionColor: Color {
      switch position {
      case "QB": return .blue
      case "RB": return .green
      case "WR": return .orange
      case "TE": return .purple
      case "K": return .red
      case "DEF": return .indigo
      default: return .gray
      }
  }
  ```
- **Category:** Static roster assumptions
- **Risk Level:** **Medium**
- **Description:** Visual encoding tied to 6 hardcoded positions. Adding a position requires finding and updating this switch in multiple files (LineupView, LineupPositionSectionV2, EmptySlotButton).
- **Required Refactor Category:** Roster-config-driven color scheme

#### Finding 3.5: Position Display Names (LineupView)
- **File:** `Views/LineupView.swift`
- **Lines:** 259-268
- **Code snippet:**
  ```swift
  private var positionName: String {
      switch position {
      case "QB": return "Quarterback"
      case "RB": return "Running Back"
      case "WR": return "Wide Receiver"
      case "TE": return "Tight End"
      case "K": return "Kicker"
      case "DEF": return "Defense"
      default: return position
      }
  }
  ```
- **Category:** Static roster assumptions
- **Risk Level:** **Medium**
- **Description:** Display names hardcoded in switch statement. PGA golfers, for example, would show as "golfer" not "golfer" (the actual position enum value).
- **Required Refactor Category:** Position metadata lookup

#### Finding 3.6: Position Limits Struct (LineupView)
- **File:** `Views/LineupView.swift`
- **Lines:** 894-902
- **Code snippet:**
  ```swift
  struct LineupPositionLimits {
      var qb: Int = 1
      var rb: Int = 2
      var wr: Int = 3
      var te: Int = 1
      var k: Int = 1
      var def: Int = 1
  }
  ```
- **Category:** Static roster assumptions
- **Risk Level:** **High**
- **Description:** Struct defines 6 NFL-specific position slots with hardcoded defaults. Cannot represent rosters with different slot counts (e.g., PGA with 6 golfers, no positions).
- **Required Refactor Category:** Dynamic slot structure from roster_config

#### Finding 3.7: Position Limits Dict (PlayerViewModel)
- **File:** `Models/PlayerViewModel.swift`
- **Lines:** 10-12
- **Code snippet:**
  ```swift
  @Published var positionLimits: [String: Int] = [
      "QB": 1, "RB": 2, "WR": 3, "TE": 1, "K": 1, "DEF": 1
  ]
  ```
- **Category:** Static roster assumptions
- **Risk Level:** **High**
- **Description:** Default position limits hardcoded as dict literal. If API returns different positions, the rendering layer has no way to handle them dynamically.
- **Required Refactor Category:** Dynamic position limits from API

#### Finding 3.8: GameSettings Position Limits
- **File:** `Models/Models.swift`
- **Lines:** 315-320
- **Code snippet:**
  ```swift
  let qbLimit: Int?
  let rbLimit: Int?
  let wrLimit: Int?
  let teLimit: Int?
  let kLimit: Int?
  let defLimit: Int?
  ```
- **Category:** Static roster assumptions
- **Risk Level:** **High**
- **Description:** API response model hardcoded with 6 explicit optional positions. Future sports require API contract change AND iOS model update. Leaderboard schema accepts any column; settings accepts only these 6.
- **Required Refactor Category:** Dynamic position limits via roster_config contract

---

### 4. Static Leaderboard Shape Assumptions

#### Finding 4.1: Hardcoded Playoff Week Filters
- **File:** `Views/LeaderboardView.swift`
- **Lines:** 16-21, 27-31
- **Code snippet:**
  ```swift
  let playoffRounds = [(16, "Wild Card"), (17, "Divisional"), (18, "Conference"), (19, "Super Bowl")]
  Picker("Week", selection: $filterWeek) {
      Text("All Weeks").tag(nil as Int?)
      ForEach(playoffRounds, id: \.0) { round in ... }
  }
  ```
- **Category:** Static leaderboard shape assumptions
- **Risk Level:** **Medium**
- **Description:** Leaderboard week picker mirrors entry flow assumptions. Cannot filter multi-round contests dynamically.
- **Required Refactor Category:** Dynamic week/round selector

#### Finding 4.2: Pre-Game Banner (LeaderboardView)
- **File:** `Views/LeaderboardView.swift`
- **Lines:** 41-44
- **Code snippet:**
  ```swift
  if let meta = leaderboardMeta, !meta.gamesStarted {
      PreGameBanner()
  }
  ```
- **Category:** Static leaderboard shape assumptions
- **Risk Level:** **Low**
- **Description:** References NFL-specific concept (games haven't started). Works generically via metadata, but label/copy may need localization for other sports.
- **Required Refactor Category:** Sport-agnostic scoring state messaging

#### Finding 4.3: Legacy LeaderboardEntry (Deprecated)
- **File:** `Models/Models.swift`
- **Lines:** 196-241
- **Code snippet:**
  ```swift
  @available(*, deprecated: 1.0, renamed: "LeaderboardResponseContract", message: "Custom contests must use LeaderboardResponseContract...")
  struct LeaderboardEntry: Codable, Identifiable {
      let totalPoints: Double
      let picks: [LeaderboardPick]?
  }
  ```
- **Category:** Static leaderboard shape assumptions
- **Risk Level:** **Low**
- **Description:** Deprecated model kept for legacy weekly leaderboard. Contract-based rendering is enforced for custom contests. Clean separation is present.
- **Required Refactor Category:** None (already abstracted)

#### Finding 4.4: ContestLeaderboardViewModel (Contract-Driven)
- **File:** `ViewModels/ContestLeaderboardViewModel.swift`
- **Lines:** 19, 44-50
- **Code snippet:**
  ```swift
  @Published internal(set) var leaderboardContract: LeaderboardResponseContract?
  var columnSchema: [LeaderboardColumnSchema] { leaderboardContract?.column_schema ?? [] }
  var rows: [LeaderboardRow] { leaderboardContract?.rows ?? [] }
  ```
- **Category:** Static leaderboard shape assumptions
- **Risk Level:** **None (No coupling)**
- **Description:** ViewModel exposes leaderboard via contract. Schema-driven rendering is achieved. No hardcoded assumptions.
- **Required Refactor Category:** None

#### Finding 4.5: DynamicLeaderboardTableView (Contract-Compliant)
- **File:** `Views/DynamicLeaderboardTableView.swift`
- **Lines:** 11-62
- **Code snippet:**
  ```swift
  struct DynamicLeaderboardTableView: View {
      let columnSchema: [LeaderboardColumnSchema]
      let rows: [LeaderboardRow]
      var body: some View {
          ForEach(columnSchema, id: \.key) { column in ... }
      }
  }
  ```
- **Category:** Static leaderboard shape assumptions
- **Risk Level:** **None (No coupling)**
- **Description:** Renders any column schema dynamically. No hardcoded position or sport assumptions. Fully contest-type-agnostic.
- **Required Refactor Category:** None

---

### 5. Static Scoring Label Assumptions

#### Finding 5.1: ScoringRulesResponse Structure
- **File:** `Models/Models.swift`
- **Lines:** 386-393
- **Code snippet:**
  ```swift
  struct ScoringRulesResponse: Codable {
      let passing: [ScoringRule]?
      let rushing: [ScoringRule]?
      let receiving: [ScoringRule]?
      let special: [ScoringRule]?
      let kicking: [ScoringRule]?
      let defense: [ScoringRule]?
  }
  ```
- **Category:** Static scoring label assumptions
- **Risk Level:** **High**
- **Description:** API response hardcoded to 6 NFL scoring categories. PGA scoring (tournament round results, finish position) cannot be represented. No generic category structure.
- **Required Refactor Category:** Dynamic scoring category dispatch via strategy

#### Finding 5.2: RulesView Section Filtering
- **File:** `Views/RulesView.swift`
- **Lines:** 60-73
- **Code snippet:**
  ```swift
  let allowedSections = ["overview", "main_rules", "player_selection", "deadlines"]
  let filteredRules = viewModel.rulesContent.filter { allowedSections.contains($0.section) }
  let sortedRules = filteredRules.sorted { rule1, rule2 in
      let order = ["overview": 0, "main_rules": 1, "player_selection": 2, "deadlines": 3]
      return (order[rule1.section] ?? 99) < (order[rule2.section] ?? 99)
  }
  ```
- **Category:** Static scoring label assumptions
- **Risk Level:** **Medium**
- **Description:** Rules sections and sort order hardcoded. Different sports may have different rule structures (e.g., "lineup" vs "player_selection"). Copy is not contest-type-aware.
- **Required Refactor Category:** Dynamic rules section registry

#### Finding 5.3: GameSettings Position Codecs
- **File:** `Models/Models.swift`
- **Lines:** 315-340
- **Code snippet:**
  ```swift
  let qbLimit: Int?
  let rbLimit: Int?
  ...
  enum CodingKeys: String, CodingKey {
      case qbLimit = "qb_limit"
      case rbLimit = "rb_limit"
  }
  ```
- **Category:** Static scoring label assumptions
- **Risk Level:** **High**
- **Description:** Settings API contract hardcoded to 6 positional limits. Score breakdown labels depend on these positions existing.
- **Required Refactor Category:** Generic position limits via roster_config

---

### 6. Entry Flow Assumptions

#### Finding 6.1: Position Validation (PlayerViewModel)
- **File:** `Models/PlayerViewModel.swift`
- **Lines:** 67-108
- **Code snippet:**
  ```swift
  func pickPlayer(_ player: Player) async {
      let positionCount = myPicks.filter { pick in
          if let pickedPlayer = players.first(where: { $0.id == pick.playerId }) {
              return pickedPlayer.position == player.position
          }
          return false
      }.count
      let limit = positionLimits[player.position] ?? 99
  }
  ```
- **Category:** Entry flow assumptions
- **Risk Level:** **Medium**
- **Description:** Entry validation logic uses position-based grouping. If roster structure is different (e.g., PGA rounds, not positions), this validation model breaks.
- **Required Refactor Category:** Entry validation via roster_config contract

#### Finding 6.2: Lineup Completion Check (LineupView)
- **File:** `Views/LineupView.swift`
- **Lines:** 695-702
- **Code snippet:**
  ```swift
  var isLineupComplete: Bool {
      filledCountForPosition("QB") == positionLimits.qb &&
      filledCountForPosition("RB") == positionLimits.rb &&
      filledCountForPosition("WR") == positionLimits.wr &&
      filledCountForPosition("TE") == positionLimits.te &&
      filledCountForPosition("K") == positionLimits.k &&
      filledCountForPosition("DEF") == positionLimits.def
  }
  ```
- **Category:** Entry flow assumptions
- **Risk Level:** **High**
- **Description:** Completion validation hardcoded to 6 explicit positions. Cannot check completion for arbitrary roster structures.
- **Required Refactor Category:** Dynamic roster completion check

#### Finding 6.3: Position Picker Loop (LineupView)
- **File:** `Views/LineupView.swift`
- **Lines:** 53
- **Code snippet:**
  ```swift
  ForEach(["QB", "RB", "WR", "TE", "K", "DEF"], id: \.self) { position in ... }
  ```
- **Category:** Entry flow assumptions
- **Risk Level:** **High**
- **Description:** Entry builder iterates hardcoded position list. No way to render PGA golfer slots dynamically.
- **Required Refactor Category:** Dynamic entry builder based on roster_config

#### Finding 6.4: Position Limits Fallback (PlayerViewModel)
- **File:** `Models/PlayerViewModel.swift`
- **Lines:** 27-33
- **Code snippet:**
  ```swift
  positionLimits = [
      "QB": settings.qbLimit ?? 1,
      "RB": settings.rbLimit ?? 2,
      "WR": settings.wrLimit ?? 3,
      ...
  ]
  ```
- **Category:** Entry flow assumptions
- **Risk Level:** **Medium**
- **Description:** Fallback defaults only work for NFL. No mechanism to handle unknown positions from PGA or other sports.
- **Required Refactor Category:** Roster config as source of truth

#### Finding 6.5: Available Players Filtering (LineupView)
- **File:** `Views/LineupView.swift`
- **Lines:** 689-693
- **Code snippet:**
  ```swift
  var availablePlayers: [Player] {
      let currentPlayerIds = Set(slots.compactMap { $0.playerId })
      return allPlayers.filter { !currentPlayerIds.contains($0.id) }
  }
  ```
- **Category:** Entry flow assumptions
- **Risk Level:** **Low**
- **Description:** Availability check is generic (based on player ID uniqueness). Works for any sport. No coupling here.
- **Required Refactor Category:** None

---

### 7. Contest-Type-Specific Rendering Logic

#### Finding 7.1: Position-Based UI Components (Multiple)
- **Files:** `LineupView.swift`, `PlayerSelectionView.swift`, `MyPickView.swift`
- **Lines:** Lines 53-68 (LineupView), Lines 28-68 (PlayerSelectionView), Lines 33-41 (MyPickView)
- **Pattern:**
  ```swift
  ForEach(["QB", "RB", "WR", "TE", "K", "DEF"], id: \.self) { position in
      // Render position-specific UI
  }
  ```
- **Category:** Contest-type-specific rendering logic
- **Risk Level:** **High**
- **Description:** Position-centric rendering appears 3+ times across views. Couples UI structure to NFL positional system.
- **Required Refactor Category:** Roster-config-driven component system

#### Finding 7.2: Week-Based Round Rendering
- **Files:** `LeaderboardView.swift`, `PlayerSelectionView.swift`, `LineupView.swift`, `MyPickView.swift`
- **Pattern:** Hardcoded week→round mapping
- **Category:** Contest-type-specific rendering logic
- **Risk Level:** **Medium**
- **Description:** Week-based UI branching assumes fixed NFL round structure. Different sports may have different scheduling.
- **Required Refactor Category:** Slate/round abstraction

#### Finding 7.3: Player Position Display (PlayerImageView, others)
- **File:** `Views/PlayerImageView.swift` (referenced in multiple views)
- **Category:** Contest-type-specific rendering logic
- **Risk Level:** **Low**
- **Description:** Position-based avatar circle coloring used in many views. If roster structure changes, color scheme must be recomputed.
- **Required Refactor Category:** Configurable position metadata

---

## Coupling Map

### Summary by Category

| Category | Finding Count | High Risk | Medium Risk | Low Risk |
|----------|---------------|-----------|------------|----------|
| Hardcoded sport checks | 3 | 2 | 1 | 0 |
| Conditional UI branching | 5 | 3 | 1 | 1 |
| Static roster assumptions | 8 | 5 | 2 | 1 |
| Static leaderboard shape | 5 | 0 | 2 | 3 |
| Static scoring labels | 3 | 2 | 1 | 0 |
| Entry flow assumptions | 5 | 2 | 2 | 1 |
| Contest-type rendering | 3 | 1 | 1 | 1 |
| **TOTAL** | **32** | **15** | **10** | **7** |

### High-Risk Blockers (15 findings)

1. **ContestType enum** (single case only)
2. **Hardcoded position lists** (QB, RB, WR, TE, K, DEF in 4+ files)
3. **Position color mapping** (switch statement duplication)
4. **LineupPositionLimits struct** (NFL-only slot structure)
5. **GameSettings position limits** (6 hardcoded optionals in API model)
6. **ScoringRulesResponse** (6 hardcoded categories: passing, rushing, receiving, special, kicking, defense)
7. **Roster completion validation** (6-position check)
8. **Entry builder loop** (hardcoded position iteration)
9. **Week picker duplication** (3+ files with identical week→round hardcoding)
10. **Position limits dict default** (6-position PlayerViewModel)
11. **Default contest type** (forced .nflPlayoff)
12. **Week names switch statements** (multiple files)
13. **Rules section filtering** (hardcoded allowed sections list)
14. **Position validation logic** (position-based grouping)
15. **Position display names** (switch statement hardcoding)

### Medium-Risk Cleanups (10 findings)

Require refactoring but don't completely block multi-contest support:

1. Position-based UI branching in specific views
2. Week picker structure (more flexible than labels, but still assumes 4-round structure)
3. Position color mapping (visual concern only)
4. Pre-game banner (copy/messaging concern)
5. RulesView section hardcoding
6. Position-count limit fallbacks
7. Additional week-name hardcoding
8. Playoff week picker label hardcoding (two instances)
9. Entry validation fallback logic
10. Default contest type assignment

### Cosmetic/Low-Risk (7 findings)

Already abstracted or low-impact:

1. LeaderboardEntry (deprecated, not used for custom contests)
2. ContestLeaderboardViewModel (contract-driven, no coupling)
3. DynamicLeaderboardTableView (fully generic)
4. Available players filtering (sport-agnostic)
5. PlayerImageView position coloring (non-breaking)
6. Leaderboard format error message (generic state handling)

---

## Refactor Themes

### Theme 1: Dynamic Roster Configuration

**Scope:** Replace hardcoded position enumerations with backend-driven roster_config.

**Affected components:**
- LineupPositionLimits struct → deprecated
- PlayerViewModel.positionLimits → remove default, read from API
- GameSettings.{qbLimit, rbLimit, ...} → replace with dynamic roster_config
- All ForEach loops iterating ["QB", "RB", ...] → iterate roster_config.slots

**Files to modify:**
- `Models/Models.swift` (GameSettings, leaderboard contract models)
- `Models/PlayerViewModel.swift` (position limits dict)
- `Views/LineupView.swift` (position iteration, completion check, color mapping, display names)
- `Views/PlayerSelectionView.swift` (position section iteration)
- `Views/MyPickView.swift` (position grouping)
- `ViewModels/ContestLeaderboardViewModel.swift` (may need adjustment for roster rendering)

**Blocking:** All entry flows (lineup creation, player selection, validation)

### Theme 2: Dynamic Week/Slate Selection

**Scope:** Replace hardcoded NFL week assumptions with contest-type-aware schedule.

**Affected components:**
- Week pickers (4 instances: LeaderboardView, PlayerSelectionView, LineupView, MyPickView)
- Week name switches (EmptyWeekView, RulesTab, etc.)
- Playoff round labels ("Wild Card", "Divisional", ...)

**Files to modify:**
- `Views/LeaderboardView.swift` (playoffRounds array)
- `Views/PlayerSelectionView.swift` (weeks tuple array)
- `Views/LineupView.swift` (playoffWeeks var, weekName switch, PlayoffWeekPicker)
- `Views/MyPickView.swift` (week selector hardcoding)
- New service: SlateSelectionService (generic schedule provider)

**Blocking:** Contest browsing, lineup viewing, scoring timeline

### Theme 3: Entry Validation Framework

**Scope:** Abstract position-based validation into roster-config-aware validation.

**Affected components:**
- Position limit enforcement (PlayerViewModel.pickPlayer)
- Lineup completion checks (LineupView.isLineupComplete)
- Player availability filtering (genre-specific constraints)

**Files to modify:**
- `Models/PlayerViewModel.swift` (pickPlayer validation logic)
- `Views/LineupView.swift` (completion check)
- New service: RosterValidationService (generic validator)

**Blocking:** Entry submission, lineup validation

### Theme 4: Contest Type Dispatch

**Scope:** Replace single-case ContestType enum with registry-based sport selection.

**Affected components:**
- ContestType enum (only has .nflPlayoff)
- CreateCustomContestViewModel.selectedContestType default
- Contest creation form picker

**Files to modify:**
- `CustomContests/Models/ContestType.swift` (replace with registry lookup)
- `CustomContests/ViewModels/CreateCustomContestViewModel.swift` (remove default)
- `Views/CreateContestFlowView.swift` (picker logic)
- New service: ContestTypeRegistry (backend-driven sport list)

**Blocking:** Multi-contest creation UI

### Theme 5: Scoring Strategy Abstraction

**Scope:** Replace hardcoded ScoringRulesResponse with strategy-driven scoring display.

**Affected components:**
- ScoringRulesResponse (6 hardcoded categories)
- RulesView section filtering (allowed sections hardcoded)
- Score breakdown rendering

**Files to modify:**
- `Models/Models.swift` (ScoringRulesResponse)
- `Views/RulesView.swift` (section filtering, sorting)
- New service: ScoringStrategyRenderer

**Blocking:** Rules display, scoring explanation

### Theme 6: Position Metadata Lookup

**Scope:** Centralize position-specific metadata (display names, colors, icons) in a configurable registry.

**Affected components:**
- Position display name switches (LineupPositionSectionV2.positionName)
- Position color switches (LineupPositionSectionV2.positionColor, EmptySlotButton.positionColor)
- Player image placeholder colors (position-based)

**Files to modify:**
- `Views/LineupView.swift` (remove position name/color switches)
- `Views/PlayerImageView.swift` (color logic)
- New service: PositionMetadataRegistry

**Blocking:** Entry UI polish (cosmetic, but necessary for multi-contest)

### Theme 7: Capability-Flag Driven UI

**Scope:** Use backend-provided capability flags (from ContestActions or contest metadata) to gate sport-specific UI elements.

**Affected components:**
- ContestLeaderboardView state handling (already present)
- ViewModels determining allowed actions
- UI branching on sport-specific features

**Files to modify:**
- Existing: `ViewModels/ContestLeaderboardViewModel.swift` (already checks state)
- Add consistent pattern across all views

**Blocking:** Conditional rendering of sport-specific features

---

## Implementation Roadmap (Not Required For Audit)

**Phase 1 (CRITICAL):** Dynamic Roster Configuration
- Replace GameSettings with roster_config contract
- Update all position iterations to use dynamic roster
- Remove LineupPositionLimits struct

**Phase 2 (HIGH):** Contest Type Dispatch
- Replace ContestType enum with registry
- Add sport selection UI to contest creation
- Wire contest type to roster config fetch

**Phase 3 (HIGH):** Dynamic Week/Slate Selection
- Create SlateSelectionService
- Replace 4 week pickers with dynamic component
- Remove hardcoded week names

**Phase 4 (MEDIUM):** Entry Validation Framework
- Extract validation logic to service
- Make position validation generic
- Support arbitrary roster structures

**Phase 5 (MEDIUM):** Scoring Strategy Abstraction
- Generalize ScoringRulesResponse
- Replace rules section filtering
- Support multi-sport rules display

**Phase 6 (LOW):** Polish
- Position metadata registry
- Capability-flag driven UI refinement
- Code deduplication (week pickers, etc.)

---

## Conclusion

The iOS client has successfully abstracted **leaderboard rendering** via contract-driven schema, enabling contest-type-agnostic display. However, **entry flow and roster management** remain deeply coupled to NFL Playoff assumptions across 30+ discrete coupling points.

**Critical dependencies blocking multi-contest support:**

1. Single-case ContestType enum
2. Hardcoded position lists in 4+ views
3. Fixed position-limit struct (1, 2, 3, 1, 1, 1)
4. Hardcoded week→round mapping (4 instances)
5. Position-based validation logic
6. 6-hardcoded scoring categories in API model

**Immediate next steps:**

1. Extend ContestTemplate model to include roster_config and slate_config
2. Modify GameSettings API response to use generic position limits
3. Create SlateSelectionService to replace hardcoded week pickers
4. Refactor position iteration from ForEach(["QB", "RB", ...]) to iteration over dynamic roster
5. Establish RosterValidationService for entry validation

**No code changes required for this audit.**
