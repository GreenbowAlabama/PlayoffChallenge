# Domain Types Reference

**Authority**: All Domain types must be defined in `core/Sources/core/Domain/` or imported from Core.
**Never invent Domain types in iOS app.**

---

## Canonical Domain Types

### ContestActionState

**Location**: `core/Sources/core/Domain/ContestActionState.swift`

**Purpose**: Master state for contest detail view. Backend-authoritative. Immutable.

**Definition**:

```swift
public struct ContestActionState: Hashable, Codable {
    // Identifiers
    public let contestId: String

    // States
    public let leaderboardState: LeaderboardState
    public let actions: ContestActions

    // Data
    public let payout: [PayoutTier]
    public let roster: RosterConfigContract

    // Optional: UI enhancement (backend does not provide)
    public let metadata: ContestMetadata?
}
```

**Usage**:

```swift
// ViewModel
@Published var actionState: ContestActionState?

// Service returns it
protocol ContestDetailFetching {
    func fetchContestActionState(contestId: UUID) async throws -> ContestActionState
}

// View consumes it
if let state = vm.actionState {
    if state.actions.canJoin { ... }
}
```

---

### ContestActions

**Location**: `core/Sources/core/Domain/ContestActions.swift`

**Purpose**: User capability flags for a contest. Authoritative from backend.

**Definition**:

```swift
public struct ContestActions: Hashable, Codable {
    public let canJoin: Bool          // User can join
    public let canDelete: Bool        // Organizer can delete
    public let canUnjoin: Bool        // User can leave
    public let canEditEntry: Bool     // User can modify roster
    public let isClosed: Bool         // Contest in closed state

    // No inference—all from backend
}
```

**Mapping from Contract**:

```swift
// Service implementation
let actions = ContestActions(
    canJoin: contract.actions.can_join,
    canDelete: contract.actions.can_delete,
    canUnjoin: contract.actions.can_unjoin,
    canEditEntry: contract.actions.can_edit_entry,
    isClosed: contract.actions.is_closed
)
```

**Usage**:

```swift
// ViewModel
var canJoinContest: Bool {
    actionState?.actions.canJoin ?? false  // Trust backend, no inference
}

// View
if vm.canJoinContest {
    Button("Join") { ... }
}
```

---

### PayoutTier

**Location**: `core/Sources/core/Domain/PayoutTier.swift`

**Purpose**: Single row in payout table. Immutable prize breakdown.

**Definition**:

```swift
public struct PayoutTier: Hashable, Codable {
    public let place: Int            // 1st, 2nd, 3rd, etc.
    public let payout: Decimal       // Prize amount

    // Optional metadata
    public let percentage: Decimal?  // Of total prize pool
    public let participants: Int?    // # of entrants at this place
}
```

**Mapping from Contract**:

```swift
let tiers = contract.payout_table.map { tier in
    PayoutTier(
        place: tier.place,
        payout: tier.payout,
        percentage: tier.percentage,
        participants: tier.participants
    )
}
```

**Usage**:

```swift
// ViewModel
@Published var payout: [PayoutTier]?

// View: Display payout table
ForEach(vm.payout ?? [], id: \.place) { tier in
    HStack {
        Text("Place \(tier.place)")
        Spacer()
        Text("$\(tier.payout)")
    }
}
```

---

### Leaderboard

**Location**: `core/Sources/core/Domain/Leaderboard.swift`

**Purpose**: Leaderboard data with rankings and scores. Immutable, endpoint-specific.

**Definition**:

```swift
public struct Leaderboard: Hashable, Codable {
    public let contestId: String
    public let columns: [LeaderboardColumn]      // Score columns (contest-specific)
    public let rows: [LeaderboardRow]            // User entries + scores
    public let state: LeaderboardState           // open, locked, settled
    public let meta: LeaderboardMetadata?        // Timestamps, counts
}

public struct LeaderboardColumn: Hashable, Codable {
    public let name: String                      // "Points", "Record", etc.
    public let type: String                      // "number", "string", etc.
}

public struct LeaderboardRow: Hashable, Codable {
    public let userId: String
    public let username: String
    public let rank: Int
    public let values: [AnyCodable]              // Column values (contest-agnostic)
    public let tier: Int?                        // Payout tier (if settled)
}
```

**Usage**:

```swift
// ViewModel
@Published var leaderboard: Leaderboard?

// View: Display rankings
ForEach(vm.leaderboard?.rows ?? [], id: \.userId) { row in
    HStack {
        Text("\(row.rank)")
        Text(row.username)
        ForEach(row.values, id: \.self) { value in
            Text("\(value)")
        }
    }
}
```

---

### LeaderboardState

**Location**: `core/Sources/core/Contracts/LeaderboardState.swift` (shared with Contract)

**Purpose**: Contest visibility state enum.

**Definition**:

```swift
public enum LeaderboardState: String, Codable, Hashable {
    case `open`          // Visible during contest
    case locked          // Visible after close, before settlement
    case settled         // Final, with payouts
    case hidden          // Not visible to non-organizers
}
```

**Usage**:

```swift
// ViewModel
var canViewLeaderboard: Bool {
    actionState?.leaderboardState != .hidden
}

// View: Conditional display
if vm.canViewLeaderboard {
    LeaderboardView(data: vm.leaderboard)
}
```

---

### ContestListItem

**Location**: `core/Sources/core/Domain/ContestListItem.swift`

**Purpose**: Summary card for contest in list. Immutable.

**Definition**:

```swift
public struct ContestListItem: Hashable, Codable, Identifiable {
    public let id: String
    public let name: String
    public let type: String                      // "nba", "nfl", etc.
    public let status: ContestStatus             // enum
    public let entryCount: Int
    public let maxEntries: Int?                  // Null = unlimited
    public let creatorName: String
    public let joinedByUser: Bool                // User is participant

    // Optional: URLs, images
    public let imageUrl: String?
    public let sportImage: String?
}

public enum ContestStatus: String, Codable, Hashable {
    case scheduled       // Not started
    case active          // In progress
    case closed          // Closed to new entries, not settled
    case settled         // Final
    case cancelled       // Cancelled
}
```

**Mapping from Contract**:

```swift
let item = ContestListItem(
    id: contract.contest_id,
    name: contract.name,
    type: contract.type,
    status: ContestStatus(rawValue: contract.status) ?? .scheduled,
    entryCount: contract.entry_count,
    maxEntries: contract.max_entries,
    creatorName: contract.creator_name,
    joinedByUser: contract.joined_by_user,
    imageUrl: contract.image_url,
    sportImage: contract.sport_image
)
```

**Usage**:

```swift
// ViewModel
@Published var contests: [ContestListItem] = []

// View: Display list
ForEach(vm.contests) { item in
    ContestRow(item: item)
        .onTapGesture { vm.navigateToContest(item.id) }
}
```

---

### MockContest

**Location**: `ios-app/PlayoffChallenge/Models/MockContest.swift`

**Purpose**: UI-only placeholder for contest detail before backend fetch.

**Definition**:

```swift
public struct MockContest: Identifiable {
    public let id: UUID
    public let name: String
    public let entryCount: Int
    public let maxEntries: Int
    public let status: ContestStatus
    public let creatorName: String
    public let joinToken: String?

    var displayStatus: String {
        switch status {
        case .scheduled: return "Not Started"
        case .active: return "In Progress"
        case .closed: return "Closed"
        case .settled: return "Settled"
        case .cancelled: return "Cancelled"
        }
    }
}
```

**Usage**:

```swift
// ViewModel: Placeholder until fetch
@Published var contest: MockContest = MockContest(
    id: contestId,
    name: "Loading…",
    entryCount: 0,
    maxEntries: 0,
    status: .scheduled,
    creatorName: "—",
    joinToken: nil
)

// Never exposed to View as Contract, always as MockContest
```

---

## Type Hierarchy

```
Core Package
├── Contracts/ (DTOs, network shape)
│   ├── ContestDetailResponseContract
│   ├── ContestListItemDTO
│   ├── LeaderboardResponseContract
│   ├── LeaderboardState (shared)
│   └── PayoutTierContract
│
└── Domain/ (Application model, authoritative)
    ├── ContestActionState (master state)
    ├── ContestActions
    ├── PayoutTier
    ├── Leaderboard
    ├── LeaderboardState (shared with Contracts)
    └── ContestListItem

iOS App
├── Models/
│   ├── MockContest (placeholder, not persisted)
│   └── (No other Domain types invented here)
│
├── ViewModels/
│   └── @Published properties use Domain types
│
└── Views/
    └── Read-only access to ViewModel.@Published
```

---

## Stub/Mock Patterns

**For testing**: Always use `.stub()` for Domain types.

```swift
// ContestActionState stub
extension ContestActionState {
    static func stub(
        contestId: String = "123",
        leaderboardState: LeaderboardState = .open,
        actions: ContestActions = .stub(),
        payout: [PayoutTier] = [],
        roster: RosterConfigContract = [:]
    ) -> Self {
        ContestActionState(
            contestId: contestId,
            leaderboardState: leaderboardState,
            actions: actions,
            payout: payout,
            roster: roster
        )
    }
}

// ContestActions stub
extension ContestActions {
    static func stub(
        canJoin: Bool = true,
        canDelete: Bool = false,
        canUnjoin: Bool = false,
        canEditEntry: Bool = false,
        isClosed: Bool = false
    ) -> Self {
        ContestActions(
            canJoin: canJoin,
            canDelete: canDelete,
            canUnjoin: canUnjoin,
            canEditEntry: canEditEntry,
            isClosed: isClosed
        )
    }
}
```

**Usage in tests**:

```swift
let mock = MockContestDetailFetching {
    return .stub(
        contestId: "123",
        actions: .stub(canJoin: true)
    )
}
```

---

## Migration Path

**If a Contract field is added**:

1. Update Contract in `core/Sources/core/Contracts/`
2. Add corresponding field to Domain type
3. Update Service mapping (Contract → Domain)
4. Update stubs in test fixtures
5. Update ViewModel if behavior changes
6. No View change needed (ViewModel handles it)

**If a Domain type is needed**:

1. Define in `core/Sources/core/Domain/`
2. Write tests for Contract → Domain mapping
3. Implement Service protocol to return it
4. Inject protocol into ViewModel
5. Publish via `@Published` in ViewModel
6. Consume in View

---

## Import Patterns

**ViewModel imports**:

```swift
import Foundation
import core                        // Import Domain types
import Combine

// ✅ These are OK
@Published var state: ContestActionState?
@Published var leaderboard: Leaderboard?

// ❌ These are forbidden
@Published var contract: ContestDetailResponseContract?
@Published var dto: ContestListItemDTO?
```

**Service implementation imports**:

```swift
import Foundation
import core                        // Contract AND Domain types

// ✅ OK: Receive Contract, return Domain
let contract: ContestDetailResponseContract = try JSONDecoder().decode(...)
let domain: ContestActionState = map(contract)
return domain

// ❌ NOT OK: Expose Contract via protocol
func fetch() -> ContestDetailResponseContract { ... }
```

**View imports**:

```swift
import SwiftUI

// ✅ OK: Receive Domain from ViewModel
@EnvironmentObject var vm: ContestDetailViewModel
if let state = vm.actionState { ... }

// ❌ NOT OK: Import services, contracts, DTOs
import core
@State var contract: ContestDetailResponseContract?
```

---

## Decision Tree: "What type should I use?"

```
Does the data come from the network?
├─ Yes → Core defines Contract (DTO) in Contracts/
│        Service maps to Domain
│        ViewModel publishes Domain
│        View reads Domain
│
└─ No → Is it UI-only state (loading, error, navigation)?
    ├─ Yes → Use ViewModel @Published properties
    │        (toggle, string, enum—primitives OK)
    │
    └─ No → Is it persisted or passed between Views?
        ├─ Yes → Define Domain in core/Sources/core/Domain/
        │        Service returns it
        │        ViewModel publishes it
        │        View reads it
        │
        └─ No → Use local @State in View (View-only)
```

---

**Document Version**: VALIDATION 4 Domain Types
**Last Updated**: 2026-02-23
**Authority**: Architecture Lead
