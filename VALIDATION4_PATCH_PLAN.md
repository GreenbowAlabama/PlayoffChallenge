# VALIDATION 4 iOS Architecture Patch Plan

**Date**: 2026-02-23
**Scope**: Fix all architecture violations in PlayoffChallenge iOS app
**Authority**: ARCHITECTURE.md, DOMAIN_TYPES.md, ARCHITECTURE_ENFORCEMENT.md

---

## Executive Summary

**Violations Identified**: 8 major categories
1. Domain types defined in iOS app instead of Core
2. Service protocols returning DTOs instead of Domain types
3. ViewModels publishing DTOs/Contracts instead of Domain types
4. Optional fields in Domain types
5. Concrete service injection instead of protocol injection
6. Fabricated/inferred Domain fields
7. Direct Contract access in Views
8. Duplicate Contracts/Domain types in iOS app vs Core

**Total Files to Create**: 18
**Total Files to Modify**: 12
**Total Files to Delete**: 20 (after migration)

**Outcome**: Full VALIDATION 4 compliance, all tests pass

---

## Phase 1: Create Core Domain Package

### 1.1 Create `core/Sources/core/Domain/` Directory

**Status**: Create directory structure
**Action**:
```bash
mkdir -p /Users/iancarter/Documents/workspace/playoff-challenge/core/Sources/core/Domain
```

---

### 1.2 File: `core/Sources/core/Domain/Contest.swift`

**Source**: Migrate from `ios-app/PlayoffChallenge/Domain/Contest.swift`
**Content**: Remove optional fields that aren't guaranteed from backend.
**Lines to create**: 1-80

```swift
import Foundation

/// Domain contest model - single persisted contest representation.
/// Mapped from ContestDetailResponseDTO or ContestListItemDTO.
/// Immutable, backend-authoritative.
public struct Contest: Identifiable, Hashable, Codable {
    public let id: UUID
    public let templateId: UUID
    public let type: String
    public let organizerId: UUID
    public let organizerName: String  // Required from backend
    public let entryFeeCents: Int
    public let contestName: String
    public let status: ContestStatus
    public let entryCount: Int
    public let maxEntries: Int?
    public let isLocked: Bool
    public let leaderboardState: LeaderboardState
    public let actions: ContestActions
    public let payoutTable: [PayoutTier]
    public let rosterConfig: RosterConfig

    // Timestamps: required from backend
    public let createdAt: Date
    public let updatedAt: Date
    public let startTime: Date?
    public let endTime: Date?
    public let lockTime: Date?

    // Join info
    public let joinToken: String?
    public let userHasEntered: Bool

    public init(
        id: UUID,
        templateId: UUID,
        type: String,
        organizerId: UUID,
        organizerName: String,
        entryFeeCents: Int,
        contestName: String,
        status: ContestStatus,
        entryCount: Int,
        maxEntries: Int?,
        isLocked: Bool,
        leaderboardState: LeaderboardState,
        actions: ContestActions,
        payoutTable: [PayoutTier],
        rosterConfig: RosterConfig,
        createdAt: Date,
        updatedAt: Date,
        startTime: Date?,
        endTime: Date?,
        lockTime: Date?,
        joinToken: String?,
        userHasEntered: Bool
    ) {
        self.id = id
        self.templateId = templateId
        self.type = type
        self.organizerId = organizerId
        self.organizerName = organizerName
        self.entryFeeCents = entryFeeCents
        self.contestName = contestName
        self.status = status
        self.entryCount = entryCount
        self.maxEntries = maxEntries
        self.isLocked = isLocked
        self.leaderboardState = leaderboardState
        self.actions = actions
        self.payoutTable = payoutTable
        self.rosterConfig = rosterConfig
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.startTime = startTime
        self.endTime = endTime
        self.lockTime = lockTime
        self.joinToken = joinToken
        self.userHasEntered = userHasEntered
    }
}

public enum ContestStatus: String, Codable, Hashable {
    case scheduled, active, closed, settled, cancelled, error
}

public struct RosterConfig: Hashable, Codable {
    public let entryFields: [String: AnyCodable]?
    public let validationRules: [String: AnyCodable]?

    public init(entryFields: [String: AnyCodable]? = nil, validationRules: [String: AnyCodable]? = nil) {
        self.entryFields = entryFields
        self.validationRules = validationRules
    }
}

public struct PayoutTier: Hashable, Codable {
    public let rankMin: Int
    public let rankMax: Int
    public let amount: Decimal?  // Null before settlement

    public init(rankMin: Int, rankMax: Int, amount: Decimal? = nil) {
        self.rankMin = rankMin
        self.rankMax = rankMax
        self.amount = amount
    }
}

// MARK: - Stubs for Testing

extension Contest {
    public static func stub(
        id: UUID = UUID(),
        templateId: UUID = UUID(),
        type: String = "nba",
        organizerId: UUID = UUID(),
        organizerName: String = "Test Organizer",
        entryFeeCents: Int = 500,
        contestName: String = "Test Contest",
        status: ContestStatus = .active,
        entryCount: Int = 5,
        maxEntries: Int? = 10,
        isLocked: Bool = false,
        leaderboardState: LeaderboardState = .open,
        actions: ContestActions = .stub(),
        payoutTable: [PayoutTier] = [],
        rosterConfig: RosterConfig = RosterConfig(),
        createdAt: Date = Date(),
        updatedAt: Date = Date(),
        startTime: Date? = nil,
        endTime: Date? = nil,
        lockTime: Date? = nil,
        joinToken: String? = "test-token",
        userHasEntered: Bool = false
    ) -> Self {
        Contest(
            id: id,
            templateId: templateId,
            type: type,
            organizerId: organizerId,
            organizerName: organizerName,
            entryFeeCents: entryFeeCents,
            contestName: contestName,
            status: status,
            entryCount: entryCount,
            maxEntries: maxEntries,
            isLocked: isLocked,
            leaderboardState: leaderboardState,
            actions: actions,
            payoutTable: payoutTable,
            rosterConfig: rosterConfig,
            createdAt: createdAt,
            updatedAt: updatedAt,
            startTime: startTime,
            endTime: endTime,
            lockTime: lockTime,
            joinToken: joinToken,
            userHasEntered: userHasEntered
        )
    }
}
```

---

### 1.3 File: `core/Sources/core/Domain/ContestActionState.swift`

**Source**: Migrate from `ios-app/PlayoffChallenge/Domain/ContestActionState.swift`
**Content**: Keep mapping logic clean, no fabrication.

```swift
import Foundation

/// Domain model for contest action state.
/// Master state for contest detail: capabilities, leaderboard, payout, roster.
/// Mapped 1:1 from ContestDetailResponseContract (never fabricated or inferred).
public struct ContestActionState: Hashable, Codable {
    public let contestId: String
    public let contestType: String
    public let leaderboardState: LeaderboardState
    public let actions: ContestActions
    public let payoutTable: [PayoutTier]
    public let rosterConfig: RosterConfig

    public init(
        contestId: String,
        contestType: String,
        leaderboardState: LeaderboardState,
        actions: ContestActions,
        payoutTable: [PayoutTier],
        rosterConfig: RosterConfig
    ) {
        self.contestId = contestId
        self.contestType = contestType
        self.leaderboardState = leaderboardState
        self.actions = actions
        self.payoutTable = payoutTable
        self.rosterConfig = rosterConfig
    }
}

extension ContestActionState {
    public static func stub(
        contestId: String = "123",
        contestType: String = "nba",
        leaderboardState: LeaderboardState = .open,
        actions: ContestActions = .stub(),
        payoutTable: [PayoutTier] = [],
        rosterConfig: RosterConfig = RosterConfig()
    ) -> Self {
        ContestActionState(
            contestId: contestId,
            contestType: contestType,
            leaderboardState: leaderboardState,
            actions: actions,
            payoutTable: payoutTable,
            rosterConfig: rosterConfig
        )
    }
}
```

---

### 1.4 File: `core/Sources/core/Domain/ContestActions.swift`

**Note**: May already exist in Contracts. Move to Domain and ensure no duplicates.

```swift
import Foundation

/// User capability flags for a contest.
/// All from backend—no client-side inference.
public struct ContestActions: Hashable, Codable {
    public let canJoin: Bool
    public let canEditEntry: Bool
    public let isLive: Bool
    public let isClosed: Bool
    public let isScoring: Bool
    public let isScored: Bool
    public let isReadOnly: Bool
    public let canShareInvite: Bool
    public let canManageContest: Bool
    public let canDelete: Bool
    public let canUnjoin: Bool

    public init(
        canJoin: Bool,
        canEditEntry: Bool,
        isLive: Bool,
        isClosed: Bool,
        isScoring: Bool,
        isScored: Bool,
        isReadOnly: Bool,
        canShareInvite: Bool,
        canManageContest: Bool,
        canDelete: Bool,
        canUnjoin: Bool
    ) {
        self.canJoin = canJoin
        self.canEditEntry = canEditEntry
        self.isLive = isLive
        self.isClosed = isClosed
        self.isScoring = isScoring
        self.isScored = isScored
        self.isReadOnly = isReadOnly
        self.canShareInvite = canShareInvite
        self.canManageContest = canManageContest
        self.canDelete = canDelete
        self.canUnjoin = canUnjoin
    }
}

extension ContestActions {
    public static func stub(
        canJoin: Bool = true,
        canEditEntry: Bool = false,
        isLive: Bool = true,
        isClosed: Bool = false,
        isScoring: Bool = false,
        isScored: Bool = false,
        isReadOnly: Bool = false,
        canShareInvite: Bool = true,
        canManageContest: Bool = false,
        canDelete: Bool = false,
        canUnjoin: Bool = true
    ) -> Self {
        ContestActions(
            canJoin: canJoin,
            canEditEntry: canEditEntry,
            isLive: isLive,
            isClosed: isClosed,
            isScoring: isScoring,
            isScored: isScored,
            isReadOnly: isReadOnly,
            canShareInvite: canShareInvite,
            canManageContest: canManageContest,
            canDelete: canDelete,
            canUnjoin: canUnjoin
        )
    }
}
```

---

### 1.5 File: `core/Sources/core/Domain/Leaderboard.swift`

**Source**: Migrate from `ios-app/PlayoffChallenge/Domain/Leaderboard.swift`

```swift
import Foundation

/// Leaderboard data with rankings and scores.
/// Contest-specific schema-driven rendering.
public struct Leaderboard: Hashable, Codable {
    public let contestId: String
    public let columns: [LeaderboardColumn]
    public let rows: [LeaderboardRow]
    public let state: LeaderboardState
    public let meta: LeaderboardMetadata?

    public init(
        contestId: String,
        columns: [LeaderboardColumn],
        rows: [LeaderboardRow],
        state: LeaderboardState,
        meta: LeaderboardMetadata? = nil
    ) {
        self.contestId = contestId
        self.columns = columns
        self.rows = rows
        self.state = state
        self.meta = meta
    }
}

public struct LeaderboardColumn: Hashable, Codable {
    public let name: String
    public let type: String  // "number", "string", etc.

    public init(name: String, type: String) {
        self.name = name
        self.type = type
    }
}

public struct LeaderboardRow: Hashable, Codable {
    public let userId: String
    public let username: String
    public let rank: Int
    public let values: [AnyCodable]
    public let tier: Int?

    public init(userId: String, username: String, rank: Int, values: [AnyCodable], tier: Int? = nil) {
        self.userId = userId
        self.username = username
        self.rank = rank
        self.values = values
        self.tier = tier
    }
}

public struct LeaderboardMetadata: Hashable, Codable {
    public let generatedAt: String?
    public let totalParticipants: Int?

    public init(generatedAt: String? = nil, totalParticipants: Int? = nil) {
        self.generatedAt = generatedAt
        self.totalParticipants = totalParticipants
    }
}

extension Leaderboard {
    public static func stub(
        contestId: String = "123",
        columns: [LeaderboardColumn] = [],
        rows: [LeaderboardRow] = [],
        state: LeaderboardState = .open,
        meta: LeaderboardMetadata? = nil
    ) -> Self {
        Leaderboard(
            contestId: contestId,
            columns: columns,
            rows: rows,
            state: state,
            meta: meta
        )
    }
}
```

---

### 1.6 File: `core/Sources/core/Domain/PublishResult.swift`

**Source**: Migrate from `ios-app/PlayoffChallenge/Domain/PublishResult.swift`

```swift
import Foundation

/// Result of publishing a contest draft.
public struct PublishResult: Hashable, Codable {
    public let contestId: UUID
    public let joinToken: String
    public let joinURL: URL?

    public init(contestId: UUID, joinToken: String, joinURL: URL? = nil) {
        self.contestId = contestId
        self.joinToken = joinToken
        self.joinURL = joinURL
    }
}

extension PublishResult {
    public static func stub(
        contestId: UUID = UUID(),
        joinToken: String = "test-token",
        joinURL: URL? = URL(string: "http://example.com/join/test-token")
    ) -> Self {
        PublishResult(
            contestId: contestId,
            joinToken: joinToken,
            joinURL: joinURL
        )
    }
}
```

---

### 1.7 File: `core/Sources/core/Domain/ContestTemplate.swift`

**Source**: Migrate from `ios-app/PlayoffChallenge/CustomContests/Models/ContestTemplate.swift`

```swift
import Foundation

/// Ops-owned blueprint for contest instances.
/// Provides entry fee and payout structure constraints.
public struct ContestTemplate: Codable, Identifiable, Equatable, Hashable {
    public let id: UUID
    public let name: String
    public let defaultEntryFeeCents: Int
    public let allowedEntryFeeMinCents: Int
    public let allowedEntryFeeMaxCents: Int
    public let allowedPayoutStructures: [PayoutStructure]

    public init(
        id: UUID,
        name: String,
        defaultEntryFeeCents: Int,
        allowedEntryFeeMinCents: Int,
        allowedEntryFeeMaxCents: Int,
        allowedPayoutStructures: [PayoutStructure]
    ) {
        self.id = id
        self.name = name
        self.defaultEntryFeeCents = defaultEntryFeeCents
        self.allowedEntryFeeMinCents = allowedEntryFeeMinCents
        self.allowedEntryFeeMaxCents = allowedEntryFeeMaxCents
        self.allowedPayoutStructures = allowedPayoutStructures
    }

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case defaultEntryFeeCents = "default_entry_fee_cents"
        case allowedEntryFeeMinCents = "allowed_entry_fee_min_cents"
        case allowedEntryFeeMaxCents = "allowed_entry_fee_max_cents"
        case allowedPayoutStructures = "allowed_payout_structures"
    }

    static func == (lhs: ContestTemplate, rhs: ContestTemplate) -> Bool {
        lhs.id == rhs.id
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
}

extension ContestTemplate {
    public static func stub(
        id: UUID = UUID(),
        name: String = "Test Template",
        defaultEntryFeeCents: Int = 500,
        allowedEntryFeeMinCents: Int = 100,
        allowedEntryFeeMaxCents: Int = 5000,
        allowedPayoutStructures: [PayoutStructure] = []
    ) -> Self {
        ContestTemplate(
            id: id,
            name: name,
            defaultEntryFeeCents: defaultEntryFeeCents,
            allowedEntryFeeMinCents: allowedEntryFeeMinCents,
            allowedEntryFeeMaxCents: allowedEntryFeeMaxCents,
            allowedPayoutStructures: allowedPayoutStructures
        )
    }
}
```

---

### 1.8 File: `core/Sources/core/Domain/PayoutStructure.swift`

**New file for Payout structure definition**

```swift
import Foundation

/// Payout structure configuration for contest.
public struct PayoutStructure: Codable, Hashable, Equatable {
    public let type: String  // "winner_takes_all", "tiered", etc.
    public let tiers: [PayoutTierDef]?

    public init(type: String, tiers: [PayoutTierDef]? = nil) {
        self.type = type
        self.tiers = tiers
    }
}

public struct PayoutTierDef: Codable, Hashable, Equatable {
    public let place: Int
    public let payoutPercent: Decimal

    enum CodingKeys: String, CodingKey {
        case place
        case payoutPercent = "payout_percent"
    }

    public init(place: Int, payoutPercent: Decimal) {
        self.place = place
        self.payoutPercent = payoutPercent
    }
}

extension PayoutStructure {
    public static func stub(type: String = "winner_takes_all") -> Self {
        PayoutStructure(type: type, tiers: nil)
    }
}
```

---

### 1.9 File: `core/Sources/core/Domain/CustomContestDraft.swift`

**New file**

```swift
import Foundation

/// Settings for custom contest creation and drafting.
public struct CustomContestSettings: Codable, Hashable, Equatable {
    public let maxEntries: Int?
    public let entryFeeCents: Int

    public init(maxEntries: Int? = nil, entryFeeCents: Int) {
        self.maxEntries = maxEntries
        self.entryFeeCents = entryFeeCents
    }
}

/// Draft contest before publishing.
public struct CustomContestDraft: Codable, Hashable {
    public let templateId: UUID
    public let name: String
    public let settings: CustomContestSettings
    public let payoutStructure: PayoutStructure
    public let lockTime: Date?

    public init(
        templateId: UUID,
        name: String,
        settings: CustomContestSettings,
        payoutStructure: PayoutStructure,
        lockTime: Date? = nil
    ) {
        self.templateId = templateId
        self.name = name
        self.settings = settings
        self.payoutStructure = payoutStructure
        self.lockTime = lockTime
    }
}

extension CustomContestDraft {
    public static func stub(
        templateId: UUID = UUID(),
        name: String = "Draft Contest",
        settings: CustomContestSettings = CustomContestSettings(maxEntries: 100, entryFeeCents: 500),
        payoutStructure: PayoutStructure = .stub(),
        lockTime: Date? = nil
    ) -> Self {
        CustomContestDraft(
            templateId: templateId,
            name: name,
            settings: settings,
            payoutStructure: payoutStructure,
            lockTime: lockTime
        )
    }
}
```

---

### 1.10 Update `core/Sources/core/core.swift`

**Modify**: Add exports for all new Domain types

```swift
// Existing imports
import Foundation

// MARK: - Export Domain Types

@_exported import struct Core.Contest
@_exported import struct Core.ContestStatus
@_exported import struct Core.ContestActionState
@_exported import struct Core.ContestActions
@_exported import struct Core.Leaderboard
@_exported import struct Core.LeaderboardColumn
@_exported import struct Core.LeaderboardRow
@_exported import struct Core.LeaderboardState
@_exported import struct Core.PayoutTier
@_exported import struct Core.RosterConfig
@_exported import struct Core.PublishResult
@_exported import struct Core.ContestTemplate
@_exported import struct Core.PayoutStructure
@_exported import struct Core.CustomContestSettings
@_exported import struct Core.CustomContestDraft

// Existing contract exports...
```

---

## Phase 2: Update Service Protocols

### 2.1 File: `ios-app/PlayoffChallenge/CustomContests/Protocols/CustomContestPublishing.swift`

**Modify**: Change return type from PublishContestResult to PublishResult (Domain)

**Lines to change**: 15
```swift
// BEFORE
func publish(contestId: UUID, userId: UUID) async throws -> PublishContestResult

// AFTER
func publish(contestId: UUID, userId: UUID) async throws -> PublishResult
```

**Full file**:
```swift
import Foundation
import Core

/// Protocol for publishing custom contest drafts.
protocol CustomContestPublishing {
    /// Publishes a draft contest, making it open for entries.
    /// - Parameters:
    ///   - contestId: The ID of the draft contest to publish.
    ///   - userId: The ID of the user (must be contest owner).
    /// - Returns: The publish result containing the contest ID, join token, and join URL.
    /// - Throws: `CustomContestError` if not in draft state or on failure.
    func publish(
        contestId: UUID,
        userId: UUID
    ) async throws -> PublishResult  // Changed from PublishContestResult
}
```

---

### 2.2 File: Check/Create `CustomContestCreating` protocol

**Create if missing**: Should define `createDraft()` returning Domain type

```swift
import Foundation
import Core

protocol CustomContestCreating {
    /// Creates a contest draft (not yet published).
    func createDraft(
        templateId: UUID,
        name: String,
        settings: CustomContestSettings,
        payoutStructure: PayoutStructure,
        userId: UUID,
        lockTime: Date?
    ) async throws -> Contest  // Domain type, not DTO
}
```

---

### 2.3 File: Check/Create `ContestServiceing` protocol

**Ensure**: Returns Domain `[Contest]`, not DTOs

```swift
import Foundation
import Core

protocol ContestServiceing {
    func fetchAvailableContests() async throws -> [Contest]  // Domain type
    func fetchCreatedContests() async throws -> [Contest]    // Domain type
}
```

---

## Phase 3: Update Service Implementations

### 3.1 File: `ios-app/PlayoffChallenge/CustomContests/Services/CustomContestService.swift`

**Changes**:
1. Add `import Core` at top
2. Update service methods to return Domain types
3. Ensure all mapping from DTO → Domain happens before return
4. Fix return types

**Lines to modify**:
- Line 39: `fetchAvailableContests()` already returns `[Contest]` ✓
- Line 81-82: Ensure `Contest.from(dto)` mapping is correct
- Line 159: `fetchCreatedContests()` already returns `[Contest]` ✓
- Line 234: `createAndPublish()` returns `PublishResult` ✓
- Line 442: `publish()` returns `PublishResult` ✓
- Line 357: `createDraft()` should return `Contest` (Domain) ✓

**Key addition**:
```swift
import Foundation
import Core  // Add this import

// ... existing code ...

// Ensure Contest.from(dto) mapping exists in Contest extension
// Example in CustomContestService:
let contests = dtos.map { Contest.from($0) }  // Maps DTO → Domain
```

---

## Phase 4: Refactor ViewModels

### 4.1 File: `ios-app/PlayoffChallenge/ViewModels/AvailableContestsViewModel.swift`

**Changes**:
1. Add `import Core`
2. Verify @Published uses Domain type or MockContest (check if MockContest is proper)
3. Verify protocol injection (not concrete service)
4. Remove duplicate DTO mapping

**Current state** (lines 29-30):
```swift
init(service: ContestServiceing = CustomContestService()) {
    self.service = service
}
```
✓ Already uses protocol injection!

**Verify** (lines 19-20):
```swift
@Published private(set) var contests: [MockContest] = []
```

**Question**: Is `MockContest` a proper Domain type? Check if it's in Core or needs to be.

---

### 4.2 File: `ios-app/PlayoffChallenge/ViewModels/ContestDetailViewModel.swift`

**Add**: Import Core and ensure @Published uses Domain types

**Expected changes**:
```swift
import Core

@Published var actionState: ContestActionState?  // Domain type from Core
```

---

### 4.3 File: `ios-app/PlayoffChallenge/ViewModels/ContestLeaderboardViewModel.swift`

**Expected changes**:
```swift
import Core

@Published var leaderboard: Leaderboard?  // Domain type from Core
```

---

## Phase 5: Clean Up iOS App

### 5.1 Update Imports in ios-app/PlayoffChallenge/Models/Models.swift

**Add at top**:
```swift
import Core

// Re-export Domain types from Core
@_exported import struct Core.Contest
@_exported import struct Core.ContestActionState
@_exported import struct Core.ContestActions
@_exported import struct Core.Leaderboard
@_exported import struct Core.LeaderboardColumn
@_exported import struct Core.LeaderboardRow
@_exported import struct Core.LeaderboardState
@_exported import struct Core.PayoutTier
@_exported import struct Core.PublishResult
// ... etc
```

**Remove or comment**: Any duplicate type definitions

---

### 5.2 Delete iOS App Domain Folder (after migration)

```bash
rm -rf /Users/iancarter/Documents/workspace/playoff-challenge/ios-app/PlayoffChallenge/Domain/
```

**Files being deleted**:
- Contest.swift
- ContestActionState.swift
- ContestActions.swift
- Leaderboard.swift
- ActionRosterConfig.swift
- PublishResult.swift

---

### 5.3 Update ios-app/PlayoffChallenge/Contracts/ (Deduplication)

**Action**: Ensure no duplicate Contracts
**Keep**: Only in `core/Sources/core/Contracts/`
**Delete from iOS app**: If exists

---

## Phase 6: Verification & Testing

### 6.1 Core Package Tests

```bash
cd /Users/iancarter/Documents/workspace/playoff-challenge/core
swift build
swift test
```

**Expected**: All tests pass, no compilation errors

---

### 6.2 iOS App Build

```bash
cd /Users/iancarter/Documents/workspace/playoff-challenge/ios-app/PlayoffChallenge
swift build
```

**Expected**: No errors, no warnings

---

### 6.3 Lint Checks

**Run checks**:
1. No DTO/Contract in @Published properties
2. No concrete service imports in ViewModels
3. No optional fields in Domain types (unless explicitly from backend)
4. All services return Domain types

---

## Summary Table

| File | Action | Type | Lines | Status |
|------|--------|------|-------|--------|
| `core/Sources/core/Domain/Contest.swift` | CREATE | Domain | 1-80 | 📋 |
| `core/Sources/core/Domain/ContestActionState.swift` | CREATE | Domain | 1-50 | 📋 |
| `core/Sources/core/Domain/ContestActions.swift` | CREATE | Domain | 1-60 | 📋 |
| `core/Sources/core/Domain/Leaderboard.swift` | CREATE | Domain | 1-70 | 📋 |
| `core/Sources/core/Domain/PublishResult.swift` | CREATE | Domain | 1-30 | 📋 |
| `core/Sources/core/Domain/ContestTemplate.swift` | CREATE | Domain | 1-50 | 📋 |
| `core/Sources/core/Domain/PayoutStructure.swift` | CREATE | Domain | 1-40 | 📋 |
| `core/Sources/core/Domain/CustomContestDraft.swift` | CREATE | Domain | 1-50 | 📋 |
| `core/Sources/core/core.swift` | MODIFY | Exports | +30 | 📋 |
| `ios-app/.../CustomContestPublishing.swift` | MODIFY | Protocol | 15 | 📋 |
| `ios-app/.../CustomContestService.swift` | VERIFY | Service | All | ✓ |
| `ios-app/.../AvailableContestsViewModel.swift` | VERIFY | ViewModel | All | ⚠️ |
| `ios-app/.../ContestDetailViewModel.swift` | MODIFY | ViewModel | +1 | 📋 |
| `ios-app/.../ContestLeaderboardViewModel.swift` | MODIFY | ViewModel | +1 | 📋 |
| `ios-app/.../Models/Models.swift` | MODIFY | Imports | +20 | 📋 |
| `ios-app/PlayoffChallenge/Domain/*` | DELETE | Folder | - | 📋 |

---

## Compliance Checklist

### After Patch Application

- [ ] All Domain types defined in Core, not iOS app
- [ ] All service protocols return Domain types (never DTO/Contract)
- [ ] All ViewModels @Published only Domain types
- [ ] All ViewModels inject Service **Protocols** (not concrete types)
- [ ] No optional fields in Domain types (unless backend explicitly allows)
- [ ] No fabricated/inferred fields in Domain types
- [ ] No DTO/Contract imports in ViewModels
- [ ] Core `swift build` passes
- [ ] Core `swift test` passes
- [ ] iOS app `swift build` passes
- [ ] No compilation warnings

---

**Ready for implementation**.
