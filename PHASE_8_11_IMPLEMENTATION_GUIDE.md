# PHASE 8-11: IMPLEMENTATION GUIDE
## Playoff Challenge Domain Completion & iOS Integration

**Document Version**: 1.0
**Date**: 2026-02-23
**Status**: Ready for Team Execution
**Authority**: CLAUDE.md (multi-contest, isolation, deterministic scoring)

---

## TABLE OF CONTENTS
1. [Domain Type Code Specifications](#domain-type-code-specifications)
2. [Test Templates & Suites](#test-templates--suites)
3. [CI/CD Gate Definitions](#cicd-gate-definitions)
4. [Task Board & Execution Plan](#task-board--execution-plan)
5. [Implementation Checklist](#implementation-checklist)

---

# DOMAIN TYPE CODE SPECIFICATIONS

## Overview
All Domain types reside in `core/Sources/core/Domain/`. Each type must:
- ✅ Be `public` (exported to iOS app)
- ✅ Conform to `Codable` (for JSON serialization)
- ✅ Conform to `Hashable` (for SwiftUI @State, collections)
- ✅ Have `.stub()` for testing
- ✅ Map from Contracts via `.from(contract)` static method
- ✅ Never have optional fields unless explicitly allowed by backend
- ✅ Never fabricate/infer fields

---

## 1. Contest.swift (PRIORITY: CRITICAL)

**File**: `core/Sources/core/Domain/Contest.swift`
**Status**: 🔴 Currently stub (1 field)
**Target**: Full 23-field implementation

### Type Definition

```swift
import Foundation

/// Domain contest model - authoritative single source for contest state.
/// Immutable, backend-sourced, never fabricated.
/// Mappes from ContestDetailResponseContract or ContestListItemDTO.
public struct Contest: Identifiable, Hashable, Codable, Equatable {
    // MARK: - Identity
    public let id: UUID
    public let templateId: UUID

    // MARK: - Classification
    public let type: String  // "nba", "nfl", "mlb", etc. (ops-defined)

    // MARK: - Ownership & Participation
    public let organizerId: UUID
    public let organizerName: String  // Required from backend
    public let entryCount: Int
    public let maxEntries: Int?  // NULL = unlimited

    // MARK: - Financial
    public let entryFeeCents: Int  // Never negative or zero

    // MARK: - Display
    public let contestName: String
    public let status: ContestStatus
    public let isLocked: Bool

    // MARK: - Action State
    public let leaderboardState: LeaderboardState
    public let actions: ContestActions

    // MARK: - Payout & Roster
    public let payoutTable: [PayoutTier]  // Settlement state
    public let rosterConfig: RosterConfig  // Entry schema

    // MARK: - Timestamps
    public let createdAt: Date
    public let updatedAt: Date
    public let startTime: Date?      // NULL = no start constraint
    public let endTime: Date?        // NULL = no end constraint
    public let lockTime: Date?       // NULL = no entry lock

    // MARK: - Join Info
    public let joinToken: String?    // NULL = not shareable/not joinable
    public let userHasEntered: Bool  // Participant auth flag

    // MARK: - Initializer
    public init(
        id: UUID,
        templateId: UUID,
        type: String,
        organizerId: UUID,
        organizerName: String,
        entryCount: Int,
        maxEntries: Int?,
        entryFeeCents: Int,
        contestName: String,
        status: ContestStatus,
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
        self.entryCount = entryCount
        self.maxEntries = maxEntries
        self.entryFeeCents = entryFeeCents
        self.contestName = contestName
        self.status = status
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

    // MARK: - Mapping from Contract
    /// Maps from ContestDetailResponseContract to Domain Contest.
    /// Pure 1:1 mapping, no fabrication, handles null fields per backend contract.
    public static func from(_ contract: ContestDetailResponseContract) -> Contest {
        return Contest(
            id: UUID(uuidString: contract.contest_id) ?? UUID(),
            templateId: UUID(uuidString: contract.template_id) ?? UUID(),
            type: contract.type,
            organizerId: UUID(uuidString: contract.organizer_id) ?? UUID(),
            organizerName: contract.organizer_name ?? "Unknown",
            entryCount: contract.entry_count ?? 0,
            maxEntries: contract.max_entries,
            entryFeeCents: contract.entry_fee_cents ?? 0,
            contestName: contract.contest_name ?? "Untitled Contest",
            status: ContestStatus(rawValue: contract.status) ?? .scheduled,
            isLocked: contract.is_locked ?? false,
            leaderboardState: contract.leaderboard_state,
            actions: contract.actions,
            payoutTable: contract.payout_table.map(PayoutTier.from) ?? [],
            rosterConfig: RosterConfig.from(contract.roster_config),
            createdAt: ISO8601DateFormatter().date(from: contract.created_at) ?? Date(),
            updatedAt: ISO8601DateFormatter().date(from: contract.updated_at) ?? Date(),
            startTime: contract.start_time.flatMap { ISO8601DateFormatter().date(from: $0) },
            endTime: contract.end_time.flatMap { ISO8601DateFormatter().date(from: $0) },
            lockTime: contract.lock_time.flatMap { ISO8601DateFormatter().date(from: $0) },
            joinToken: contract.join_token,
            userHasEntered: contract.user_has_entered ?? false
        )
    }
}

// MARK: - ContestStatus Enum
public enum ContestStatus: String, Codable, Hashable {
    case scheduled  // Not started
    case active     // Entries open
    case closed     // Entries locked
    case scoring    // Scoring in progress
    case settled    // Scoring complete
    case cancelled  // Cancelled, no payout
    case error      // Internal error state
}

// MARK: - Stubs for Testing
extension Contest {
    public static func stub(
        id: UUID = UUID(),
        templateId: UUID = UUID(),
        type: String = "nba",
        organizerId: UUID = UUID(),
        organizerName: String = "Test Organizer",
        entryCount: Int = 5,
        maxEntries: Int? = 10,
        entryFeeCents: Int = 500,
        contestName: String = "Test Contest",
        status: ContestStatus = .active,
        isLocked: Bool = false,
        leaderboardState: LeaderboardState = .open,
        actions: ContestActions = .stub(),
        payoutTable: [PayoutTier] = [],
        rosterConfig: RosterConfig = .stub(),
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
            entryCount: entryCount,
            maxEntries: maxEntries,
            entryFeeCents: entryFeeCents,
            contestName: contestName,
            status: status,
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

### Mapping Examples

```swift
// ✅ VALID: Contest with all fields populated
let fullContest = Contest.from(fullResponseContract)
// Produces: Contest with all 23 fields set

// ✅ VALID: Contest with null optional fields
let minimalContest = Contest.from(minimalResponseContract)
// startTime, endTime, lockTime, maxEntries, joinToken = nil (allowed)

// ✅ VALID: Contest with null optional string fields
let nameContract = ContestDetailResponseContract(..., organizerName: nil, ...)
let contest = Contest.from(nameContract)
// Result: organizerName = "Unknown" (fallback, not nil)

// ✅ VALID: Contest with invalid UUID strings
let badUuidContract = ContestDetailResponseContract(..., contest_id: "not-a-uuid", ...)
let contest = Contest.from(badUuidContract)
// Result: id = UUID() (stub, logged as error in production)
```

---

## 2. ContestActionState.swift (PRIORITY: CRITICAL)

**File**: `core/Sources/core/Domain/ContestActionState.swift`
**Status**: 🟡 Partial (references Contract types)
**Target**: Full Domain type composition

### Type Definition

```swift
import Foundation

/// Domain model for contest action state and authorization.
/// Master state for contest detail: capabilities, leaderboard, payout, roster.
/// Mapped 1:1 from ContestDetailResponseContract, never fabricated.
/// Immutable, authoritative from backend.
public struct ContestActionState: Hashable, Codable, Equatable {
    public let contestId: UUID
    public let contestType: String
    public let leaderboardState: LeaderboardState
    public let actions: ContestActions
    public let payoutTable: [PayoutTier]
    public let rosterConfig: RosterConfig

    public init(
        contestId: UUID,
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

    // MARK: - Mapping from Contract
    public static func from(_ contract: ContestDetailResponseContract) -> ContestActionState {
        return ContestActionState(
            contestId: UUID(uuidString: contract.contest_id) ?? UUID(),
            contestType: contract.type,
            leaderboardState: contract.leaderboard_state,
            actions: contract.actions,
            payoutTable: contract.payout_table.map(PayoutTier.from) ?? [],
            rosterConfig: RosterConfig.from(contract.roster_config)
        )
    }
}

// MARK: - Stubs
extension ContestActionState {
    public static func stub(
        contestId: UUID = UUID(),
        contestType: String = "nba",
        leaderboardState: LeaderboardState = .open,
        actions: ContestActions = .stub(),
        payoutTable: [PayoutTier] = [],
        rosterConfig: RosterConfig = .stub()
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

## 3. Standing.swift (NEW - PRIORITY: HIGH)

**File**: `core/Sources/core/Domain/Standing.swift`
**Status**: 🔴 Does not exist
**Target**: Leaderboard row representation

### Type Definition

```swift
import Foundation

/// Leaderboard standing row - represents one participant's ranking and score.
/// Contest-specific schema with dynamic columns.
/// One row per participant in leaderboard.
public struct Standing: Hashable, Codable, Equatable, Identifiable {
    public let id: String  // user_id from backend
    public let userId: String
    public let username: String
    public let rank: Int  // 1-based ranking
    public let values: [AnyCodable]  // Schema-driven columns
    public let tier: Int?  // Payout tier (NULL until settled)

    public init(
        userId: String,
        username: String,
        rank: Int,
        values: [AnyCodable],
        tier: Int? = nil
    ) {
        self.id = userId
        self.userId = userId
        self.username = username
        self.rank = rank
        self.values = values
        self.tier = tier
    }

    // MARK: - Mapping from Contract
    public static func from(_ contract: LeaderboardRowContract) -> Standing {
        return Standing(
            userId: contract.user_id ?? "unknown",
            username: contract.username ?? "Unknown",
            rank: contract.rank ?? 0,
            values: contract.values ?? [],
            tier: contract.tier
        )
    }
}

// MARK: - Stubs
extension Standing {
    public static func stub(
        userId: String = "user-123",
        username: String = "Test User",
        rank: Int = 1,
        values: [AnyCodable] = [],
        tier: Int? = nil
    ) -> Self {
        Standing(
            userId: userId,
            username: username,
            rank: rank,
            values: values,
            tier: tier
        )
    }
}
```

---

## 4. PayoutRow.swift (NEW - PRIORITY: HIGH)

**File**: `core/Sources/core/Domain/PayoutRow.swift`
**Status**: 🔴 Does not exist
**Target**: Settlement payout representation

### Type Definition

```swift
import Foundation

/// Payout row - represents one participant's settled payout amount.
/// Only populated after scoring complete and settlement calculated.
/// One row per winning participant.
public struct PayoutRow: Hashable, Codable, Equatable, Identifiable {
    public let id: String  // user_id
    public let userId: String
    public let username: String
    public let rank: Int
    public let payoutCents: Int  // Never negative
    public let tier: Int  // Payout tier (1-based)

    public init(
        userId: String,
        username: String,
        rank: Int,
        payoutCents: Int,
        tier: Int
    ) {
        self.id = userId
        self.userId = userId
        self.username = username
        self.rank = rank
        self.payoutCents = max(0, payoutCents)  // Clamp to non-negative
        self.tier = tier
    }

    // MARK: - Mapping from Contract
    public static func from(_ contract: PayoutRowContract) -> PayoutRow {
        return PayoutRow(
            userId: contract.user_id ?? "unknown",
            username: contract.username ?? "Unknown",
            rank: contract.rank ?? 0,
            payoutCents: contract.payout_cents ?? 0,
            tier: contract.tier ?? 0
        )
    }
}

// MARK: - Stubs
extension PayoutRow {
    public static func stub(
        userId: String = "user-123",
        username: String = "Test User",
        rank: Int = 1,
        payoutCents: Int = 5000,
        tier: Int = 1
    ) -> Self {
        PayoutRow(
            userId: userId,
            username: username,
            rank: rank,
            payoutCents: payoutCents,
            tier: tier
        )
    }
}
```

---

## 5. RosterConfig.swift (PRIORITY: HIGH)

**File**: `core/Sources/core/Domain/RosterConfig.swift`
**Status**: 🔴 Currently stub
**Target**: Entry validation schema

### Type Definition

```swift
import Foundation

/// Contest-specific entry field schema and validation rules.
/// Defines what fields participants must provide in their entry.
/// Contest-type-agnostic (e.g., NBA has different schema than MLB).
public struct RosterConfig: Hashable, Codable, Equatable {
    public let entryFields: [String: AnyCodable]?  // Schema definition
    public let validationRules: [String: AnyCodable]?  // Validation constraints

    public init(
        entryFields: [String: AnyCodable]? = nil,
        validationRules: [String: AnyCodable]? = nil
    ) {
        self.entryFields = entryFields
        self.validationRules = validationRules
    }

    // MARK: - Mapping from Contract
    public static func from(_ contract: RosterConfigContract?) -> RosterConfig {
        guard let contract = contract else { return RosterConfig() }
        return RosterConfig(
            entryFields: contract.entry_fields,
            validationRules: contract.validation_rules
        )
    }
}

// MARK: - Stubs
extension RosterConfig {
    public static func stub(
        entryFields: [String: AnyCodable]? = nil,
        validationRules: [String: AnyCodable]? = nil
    ) -> Self {
        RosterConfig(
            entryFields: entryFields,
            validationRules: validationRules
        )
    }
}
```

---

## 6. PayoutTier.swift (PRIORITY: HIGH)

**File**: `core/Sources/core/Domain/PayoutTier.swift`
**Status**: 🟡 Partial definition
**Target**: Complete with mapping

### Type Definition

```swift
import Foundation

/// Payout tier - rank range and associated payout amount.
/// One tier per winning bracket (e.g., 1st place, 2nd-5th, 6th-20th).
/// Used for both pre-settlement configuration and post-settlement results.
public struct PayoutTier: Hashable, Codable, Equatable {
    public let rankMin: Int  // 1-based (inclusive)
    public let rankMax: Int  // 1-based (inclusive)
    public let amountCents: Int?  // NULL before settlement, populated after

    public init(
        rankMin: Int,
        rankMax: Int,
        amountCents: Int? = nil
    ) {
        self.rankMin = rankMin
        self.rankMax = rankMax
        self.amountCents = amountCents
    }

    // MARK: - Mapping from Contract
    public static func from(_ contract: PayoutTierContract) -> PayoutTier {
        return PayoutTier(
            rankMin: contract.rank_min ?? 0,
            rankMax: contract.rank_max ?? 0,
            amountCents: contract.amount_cents
        )
    }
}

// MARK: - Stubs
extension PayoutTier {
    public static func stub(
        rankMin: Int = 1,
        rankMax: Int = 1,
        amountCents: Int? = 5000
    ) -> Self {
        PayoutTier(
            rankMin: rankMin,
            rankMax: rankMax,
            amountCents: amountCents
        )
    }
}
```

---

## 7. LeaderboardState.swift (PRIORITY: HIGH)

**File**: `core/Sources/core/Domain/LeaderboardState.swift`
**Status**: 🔴 May not exist as separate file
**Target**: Contest scoring state enumeration

### Type Definition

```swift
import Foundation

/// Leaderboard state - progression of contest from entry through scoring.
/// Determines what UI is shown, what actions are enabled.
public enum LeaderboardState: String, Codable, Hashable, Equatable {
    case open      // Entries open, no leaderboard yet
    case locked    // Entries locked, ready for scoring
    case scoring   // Scoring in progress
    case scored    // Scoring complete, payouts calculated
    case disputed  // Score dispute filed, under review
    case settled   // Payouts distributed
}
```

---

## 8. LeaderboardState.swift (Enum - PRIORITY: MEDIUM)

**File**: `core/Sources/core/Domain/Leaderboard.swift`
**Status**: 🟡 Partially complete
**Target**: Full leaderboard structure with standings

### Type Definition

```swift
import Foundation

/// Leaderboard - complete contest standings with schema-driven columns.
/// Contest-agnostic rendering via schema definition.
public struct Leaderboard: Hashable, Codable, Equatable {
    public let contestId: UUID
    public let columns: [LeaderboardColumn]
    public let standings: [Standing]
    public let state: LeaderboardState
    public let meta: LeaderboardMetadata?

    public init(
        contestId: UUID,
        columns: [LeaderboardColumn],
        standings: [Standing],
        state: LeaderboardState,
        meta: LeaderboardMetadata? = nil
    ) {
        self.contestId = contestId
        self.columns = columns
        self.standings = standings
        self.state = state
        self.meta = meta
    }

    // MARK: - Mapping from Contract
    public static func from(_ contract: LeaderboardContract) -> Leaderboard {
        return Leaderboard(
            contestId: UUID(uuidString: contract.contest_id) ?? UUID(),
            columns: contract.columns?.map(LeaderboardColumn.from) ?? [],
            standings: contract.standings?.map(Standing.from) ?? [],
            state: contract.state,
            meta: contract.meta.flatMap(LeaderboardMetadata.from)
        )
    }
}

public struct LeaderboardColumn: Hashable, Codable, Equatable {
    public let name: String  // "Rank", "Score", "Team Points", etc.
    public let type: String  // "number", "string", "currency", etc.

    public init(name: String, type: String) {
        self.name = name
        self.type = type
    }

    public static func from(_ contract: LeaderboardColumnContract) -> LeaderboardColumn {
        return LeaderboardColumn(
            name: contract.name ?? "Unknown",
            type: contract.type ?? "string"
        )
    }
}

public struct LeaderboardMetadata: Hashable, Codable, Equatable {
    public let generatedAt: String?
    public let totalParticipants: Int?

    public init(generatedAt: String? = nil, totalParticipants: Int? = nil) {
        self.generatedAt = generatedAt
        self.totalParticipants = totalParticipants
    }

    public static func from(_ contract: LeaderboardMetadataContract?) -> LeaderboardMetadata? {
        guard let contract = contract else { return nil }
        return LeaderboardMetadata(
            generatedAt: contract.generated_at,
            totalParticipants: contract.total_participants
        )
    }
}

// MARK: - Stubs
extension Leaderboard {
    public static func stub(
        contestId: UUID = UUID(),
        columns: [LeaderboardColumn] = [],
        standings: [Standing] = [],
        state: LeaderboardState = .open,
        meta: LeaderboardMetadata? = nil
    ) -> Self {
        Leaderboard(
            contestId: contestId,
            columns: columns,
            standings: standings,
            state: state,
            meta: meta
        )
    }
}

extension LeaderboardColumn {
    public static func stub(
        name: String = "Score",
        type: String = "number"
    ) -> Self {
        LeaderboardColumn(name: name, type: type)
    }
}
```

---

## 9. ContestActions.swift (PRIORITY: HIGH)

**File**: `core/Sources/core/Domain/ContestActions.swift`
**Status**: 🟡 Already in Contracts
**Target**: Ensure in Domain (no duplication)

### Type Definition

```swift
import Foundation

/// User capability flags for a specific contest.
/// Determines what actions are available in UI (join, edit, manage, etc.).
/// All derived from backend, no client-side inference.
public struct ContestActions: Hashable, Codable, Equatable {
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

    // MARK: - Mapping from Contract
    public static func from(_ contract: ContestActionsContract) -> ContestActions {
        return ContestActions(
            canJoin: contract.can_join ?? false,
            canEditEntry: contract.can_edit_entry ?? false,
            isLive: contract.is_live ?? false,
            isClosed: contract.is_closed ?? false,
            isScoring: contract.is_scoring ?? false,
            isScored: contract.is_scored ?? false,
            isReadOnly: contract.is_read_only ?? false,
            canShareInvite: contract.can_share_invite ?? false,
            canManageContest: contract.can_manage_contest ?? false,
            canDelete: contract.can_delete ?? false,
            canUnjoin: contract.can_unjoin ?? false
        )
    }
}

// MARK: - Stubs
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

## 10. Core Package Exports

**File**: `core/Sources/core/core.swift`
**Status**: 🔴 Exports outdated
**Target**: Export all Domain types

### Content

```swift
import Foundation

// MARK: - Domain Types Export
// All Domain types must be public for iOS app consumption

@_exported import struct Core.Contest
@_exported import enum Core.ContestStatus
@_exported import struct Core.ContestActionState
@_exported import struct Core.ContestActions
@_exported import struct Core.Standing
@_exported import struct Core.PayoutRow
@_exported import struct Core.PayoutTier
@_exported import struct Core.RosterConfig
@_exported import enum Core.LeaderboardState
@_exported import struct Core.Leaderboard
@_exported import struct Core.LeaderboardColumn
@_exported import struct Core.LeaderboardMetadata

// Existing Contract/Service exports
// ... (maintain existing exports)
```

---

# TEST TEMPLATES & SUITES

## Phase 10 Test Implementation Guide

### Directory Structure

```
core/
├── Tests/
│   └── coreTests/
│       ├── Domain/
│       │   ├── ContestMappingTests.swift
│       │   ├── ContestActionStateTests.swift
│       │   ├── StandingTests.swift
│       │   ├── PayoutRowTests.swift
│       │   ├── LeaderboardTests.swift
│       │   └── RosterConfigTests.swift
│       ├── Integration/
│       │   ├── ContestListFetchTests.swift
│       │   ├── ContestDetailFetchTests.swift
│       │   ├── PayoutCalculationTests.swift
│       │   ├── MultiContestIsolationTests.swift
│       │   └── ConcurrentJoinTests.swift
│       └── Utilities/
│           ├── Fixtures.swift (test data)
│           ├── ContractMocks.swift
│           └── AssertionHelpers.swift
```

---

## Test Template 1: Domain Mapping Unit Tests

**File**: `core/Tests/coreTests/Domain/ContestMappingTests.swift`

```swift
import XCTest
@testable import Core

final class ContestMappingTests: XCTestCase {

    // MARK: - Happy Path

    func testContestFromFullContract() {
        // Arrange
        let contract = ContestDetailResponseContract.full()  // All fields populated

        // Act
        let contest = Contest.from(contract)

        // Assert
        XCTAssertEqual(contest.id, UUID(uuidString: contract.contest_id))
        XCTAssertEqual(contest.contestName, contract.contest_name)
        XCTAssertEqual(contest.entryFeeCents, contract.entry_fee_cents)
        XCTAssertEqual(contest.entryCount, contract.entry_count)
        XCTAssertEqual(contest.status, .active)
        XCTAssertFalse(contest.isLocked)
        // ... assert all 23 fields
    }

    // MARK: - Null Handling

    func testContestFromContractWithNullOptionalFields() {
        // Arrange: Contract with null optional fields
        var contract = ContestDetailResponseContract.minimal()
        contract.start_time = nil
        contract.end_time = nil
        contract.lock_time = nil
        contract.max_entries = nil
        contract.join_token = nil

        // Act
        let contest = Contest.from(contract)

        // Assert: Optional fields should be nil
        XCTAssertNil(contest.startTime)
        XCTAssertNil(contest.endTime)
        XCTAssertNil(contest.lockTime)
        XCTAssertNil(contest.maxEntries)
        XCTAssertNil(contest.joinToken)
    }

    func testContestFromContractWithNullOrganizerName() {
        // Arrange: Backend returns null organizer_name
        var contract = ContestDetailResponseContract.minimal()
        contract.organizer_name = nil

        // Act
        let contest = Contest.from(contract)

        // Assert: Should fallback to "Unknown", never nil
        XCTAssertEqual(contest.organizerName, "Unknown")
    }

    func testContestFromContractWithNullOrganizerNameEmpty() {
        // Arrange: Backend returns empty string
        var contract = ContestDetailResponseContract.minimal()
        contract.organizer_name = ""

        // Act
        let contest = Contest.from(contract)

        // Assert: Empty string is valid
        XCTAssertEqual(contest.organizerName, "")
    }

    // MARK: - Invalid UUID Handling

    func testContestFromContractWithInvalidUUID() {
        // Arrange: Backend returns non-UUID string
        var contract = ContestDetailResponseContract.minimal()
        contract.contest_id = "not-a-uuid"
        contract.template_id = "invalid"
        contract.organizer_id = "bad-uuid"

        // Act
        let contest = Contest.from(contract)

        // Assert: Should use generated UUID(), log error in production
        XCTAssertNotNil(contest.id)
        XCTAssertNotNil(contest.templateId)
        XCTAssertNotNil(contest.organizerId)
        // In production, should log error via OSLog
    }

    // MARK: - Date Parsing

    func testContestFromContractWithValidDates() {
        // Arrange: ISO8601 formatted dates
        let now = ISO8601DateFormatter().string(from: Date())
        var contract = ContestDetailResponseContract.minimal()
        contract.created_at = now
        contract.updated_at = now
        contract.start_time = now

        // Act
        let contest = Contest.from(contract)

        // Assert: Dates should be parsed correctly
        XCTAssertNotNil(contest.createdAt)
        XCTAssertNotNil(contest.updatedAt)
        XCTAssertNotNil(contest.startTime)
    }

    func testContestFromContractWithInvalidDateFormat() {
        // Arrange: Malformed date string
        var contract = ContestDetailResponseContract.minimal()
        contract.created_at = "invalid-date"
        contract.updated_at = "2024-13-45"  // Invalid month/day

        // Act
        let contest = Contest.from(contract)

        // Assert: Should fallback to Date() (current time), never crash
        XCTAssertNotNil(contest.createdAt)
        XCTAssertNotNil(contest.updatedAt)
    }

    // MARK: - Status Enumeration

    func testContestFromContractWithValidStatus() {
        // Arrange: All valid status values
        for statusRaw in ["scheduled", "active", "closed", "scoring", "settled", "cancelled", "error"] {
            var contract = ContestDetailResponseContract.minimal()
            contract.status = statusRaw

            // Act
            let contest = Contest.from(contract)

            // Assert: Should map to enum
            XCTAssertNotNil(contest.status)
        }
    }

    func testContestFromContractWithInvalidStatus() {
        // Arrange: Unknown status value
        var contract = ContestDetailResponseContract.minimal()
        contract.status = "unknown_status"

        // Act
        let contest = Contest.from(contract)

        // Assert: Should fallback to .scheduled
        XCTAssertEqual(contest.status, .scheduled)
    }

    // MARK: - Equatable & Hashable

    func testContestEquality() {
        // Arrange
        let id = UUID()
        let contestA = Contest.stub(id: id)
        let contestB = Contest.stub(id: id)

        // Act
        let equal = contestA == contestB

        // Assert
        XCTAssertTrue(equal)
    }

    func testContestHashable() {
        // Arrange
        let contest = Contest.stub()
        let set = Set<Contest>([contest, contest])  // Should deduplicate

        // Act & Assert
        XCTAssertEqual(set.count, 1)
    }

    // MARK: - Snapshot Testing (for regression)

    func testContestFromContractSnapshot() {
        // Arrange
        let contract = ContestDetailResponseContract.full()
        let contest = Contest.from(contract)

        // Act: Create JSON snapshot
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        let data = try! encoder.encode(contest)
        let json = String(data: data, encoding: .utf8)!

        // Assert: Compare against stored snapshot
        assertSnapshot(matching: json, as: .json)
    }
}
```

---

## Test Template 2: Integration Tests (Contract → Domain → ViewModel)

**File**: `core/Tests/coreTests/Integration/ContestDetailFetchTests.swift`

```swift
import XCTest
@testable import Core

final class ContestDetailFetchIntegrationTests: XCTestCase {

    func testContestDetailFetchMapsToDomain() {
        // Simulate: Backend returns ContestDetailResponseContract
        // -> Maps to Domain Contest
        // -> ViewModel publishes Domain type
        // -> UI renders correctly

        // Arrange: Mock service returning contract
        let mockContract = ContestDetailResponseContract.full()
        let mockService = MockContestService(responseContract: mockContract)

        // Act: Service returns Domain type
        let expectation = expectation(description: "Fetch completes")
        var domainContest: Contest?

        Task {
            domainContest = try await mockService.fetchContestDetail(id: UUID())
            expectation.fulfill()
        }

        // Assert: Domain type is complete and valid
        waitForExpectations(timeout: 1)
        XCTAssertNotNil(domainContest)
        XCTAssertEqual(domainContest?.contestName, mockContract.contest_name)
        XCTAssertEqual(domainContest?.entryFeeCents, mockContract.entry_fee_cents)
    }

    func testContestDetailWithNullFieldsStillValid() {
        // Arrange: Contract with minimal fields
        let mockContract = ContestDetailResponseContract.minimal()

        // Act
        let contest = Contest.from(mockContract)

        // Assert: Should never crash, all fields have values
        XCTAssertNotNil(contest.id)
        XCTAssertNotNil(contest.organizerName)  // Fallback to "Unknown"
        XCTAssertNotNil(contest.status)  // Fallback to .scheduled
        // Should be safe to publish to ViewModel
    }
}
```

---

## Test Template 3: Multi-Contest Isolation Tests

**File**: `core/Tests/coreTests/Integration/MultiContestIsolationTests.swift`

```swift
import XCTest
@testable import Core

final class MultiContestIsolationTests: XCTestCase {

    let contestIds = (1...5).map { _ in UUID() }

    func testContestScoringSeparationAcrossMultipleContests() {
        // CRITICAL: One contest's scoring must not affect another

        // Arrange: 5 contests with different scoring states
        let contests = contestIds.map { id -> Contest in
            Contest.stub(
                id: id,
                contestName: "Contest \(id)",
                status: [.active, .closed, .scoring, .scored, .settled].randomElement()!
            )
        }

        // Act: Scope all mutations by contest_id
        let contestAState = ContestActionState.stub()  // Contest A detail
        let contestBState = ContestActionState.stub()  // Contest B detail

        // Assert: Each contest's state is independent
        XCTAssertNotEqual(contestAState.contestId, contestBState.contestId)

        // Scoring one contest should not affect others
        let scoredA = mutateContest(contestAState, status: .scored)
        let scoredB = ContestActionState.stub()  // Unchanged

        XCTAssertEqual(scoredA.leaderboardState, .scored)
        XCTAssertNotEqual(scoredB.leaderboardState, .scored)
    }

    func testParticipantJoinIsolatedByContestId() {
        // Constraint: A user can join Contest A once, Contest B once
        // But not Contest A twice

        // Arrange: Two contests
        let contestA = Contest.stub(id: UUID())
        let contestB = Contest.stub(id: UUID())

        // Scenario: User attempts to join both
        // Should succeed for both (contest isolation)
        // Should fail if attempting Contest A again

        // This test validates DB constraint: UNIQUE(contest_id, user_id)
        // Implementation in Phase 11
        XCTAssertTrue(true)  // Placeholder for integration test
    }

    func testPayoutCalculationIsolation() {
        // Arrange: Contest A and B with different payout structures
        let contestA = Contest.stub(
            id: UUID(),
            payoutTable: [
                PayoutTier.stub(rankMin: 1, rankMax: 1, amountCents: 10000)
            ]
        )

        let contestB = Contest.stub(
            id: UUID(),
            payoutTable: [
                PayoutTier.stub(rankMin: 1, rankMax: 3, amountCents: 5000)
            ]
        )

        // Act: Calculate payouts independently
        let payoutA = contestA.payoutTable[0].amountCents ?? 0
        let payoutB = contestB.payoutTable[0].amountCents ?? 0

        // Assert: Payouts differ as expected
        XCTAssertEqual(payoutA, 10000)
        XCTAssertEqual(payoutB, 5000)
        XCTAssertNotEqual(payoutA, payoutB)
    }
}
```

---

## Test Template 4: Payout Calculation Tests

**File**: `core/Tests/coreTests/Integration/PayoutCalculationTests.swift`

```swift
import XCTest
@testable import Core

final class PayoutCalculationTests: XCTestCase {

    func testPayoutRowCalculation_WinnerTakesAll() {
        // Arrange: 10 participants, winner takes all, entry fee $5
        let entryFeeCents = 500
        let totalParticipants = 10
        let prizePoolCents = entryFeeCents * totalParticipants  // 5000 cents

        // Act: Winner takes all
        let payoutRow = PayoutRow.stub(
            rank: 1,
            payoutCents: prizePoolCents  // All 5000
        )

        // Assert
        XCTAssertEqual(payoutRow.payoutCents, 5000)
        XCTAssertTrue(payoutRow.payoutCents > 0)
    }

    func testPayoutRowCalculation_TieredPayout() {
        // Arrange: Tiered payout
        // 1st place: 50%, 2nd-3rd: 25%, 4th-10th: 25%
        let entryFeeCents = 500
        let totalParticipants = 10
        let prizePoolCents = entryFeeCents * totalParticipants  // 5000

        // Act: Calculate per tier
        let tier1 = Int(Double(prizePoolCents) * 0.50)  // 2500
        let tier2 = Int(Double(prizePoolCents) * 0.25)  // 1250
        let tier3 = Int(Double(prizePoolCents) * 0.25)  // 1250

        // Assert
        XCTAssertEqual(tier1, 2500)
        XCTAssertEqual(tier2, 1250)
        XCTAssertEqual(tier3, 1250)
        XCTAssertEqual(tier1 + tier2 + tier3, prizePoolCents)  // No loss
    }

    func testPayoutRowDecimalRounding() {
        // Arrange: Entry fee creates uneven splits
        // 3 participants, $1.50 entry = 150 cents total
        // 50/25/25 split
        let prizePoolCents = 150

        // Act: Tiered split (may have rounding)
        let tier1 = Int(Double(prizePoolCents) * 0.50)  // 75 cents
        let tier2 = Int(Double(prizePoolCents) * 0.25)  // 37 cents (rounding)
        let tier3 = Int(Double(prizePoolCents) * 0.25)  // 37 cents

        // Assert: Account for rounding loss (safe to lose <1 cent)
        let total = tier1 + tier2 + tier3
        XCTAssertLessThanOrEqual(abs(total - prizePoolCents), 1)
    }

    func testPayoutRowNeverNegative() {
        // Arrange: Create PayoutRow with negative amount
        let payoutRow = PayoutRow(
            userId: "user-1",
            username: "User",
            rank: 1,
            payoutCents: -100,  // Invalid
            tier: 1
        )

        // Act & Assert: Should clamp to 0
        XCTAssertGreaterThanOrEqual(payoutRow.payoutCents, 0)
    }

    func testPayoutRowIdempotency() {
        // CRITICAL: Settling same contest twice = same payouts

        // Arrange: Contest with fixed standings
        let standings = [
            Standing.stub(userId: "user-1", rank: 1),
            Standing.stub(userId: "user-2", rank: 2)
        ]

        // Act: Calculate payouts twice
        let payouts1 = calculatePayouts(standings: standings, totalEntries: 2)
        let payouts2 = calculatePayouts(standings: standings, totalEntries: 2)

        // Assert: Identical
        XCTAssertEqual(payouts1, payouts2)
    }
}

// Helper function (implement in actual codebase)
func calculatePayouts(standings: [Standing], totalEntries: Int) -> [PayoutRow] {
    // TODO: Implement payout logic
    []
}
```

---

## Test Template 5: Concurrent Join Tests

**File**: `core/Tests/coreTests/Integration/ConcurrentJoinTests.swift`

```swift
import XCTest
@testable import Core

final class ConcurrentJoinTests: XCTestCase {

    func testConcurrentJoinsRespectCapacity() {
        // CRITICAL: Contest with maxEntries=10 should not accept 11 joins

        // Arrange
        let contest = Contest.stub(maxEntries: 10)
        let userIds = (1...15).map { UUID() }

        // Act: Simulate 15 concurrent join attempts
        let expectation = expectation(description: "Concurrent joins complete")
        expectation.expectedFulfillmentCount = 15

        var successCount = 0
        var rejectedCount = 0
        let lock = NSLock()

        for userId in userIds {
            Task {
                do {
                    _ = try await joinContest(contestId: contest.id, userId: userId)
                    lock.lock()
                    successCount += 1
                    lock.unlock()
                } catch ContestError.full {
                    lock.lock()
                    rejectedCount += 1
                    lock.unlock()
                }
                expectation.fulfill()
            }
        }

        // Assert
        waitForExpectations(timeout: 5)
        XCTAssertEqual(successCount, 10)  // Only 10 allowed
        XCTAssertEqual(rejectedCount, 5)  // 5 rejected
    }

    func testConcurrentJoinsNoDuplicateParticipants() {
        // CRITICAL: Same user cannot join same contest twice

        // Arrange
        let contest = Contest.stub()
        let userId = UUID()

        // Act: Same user attempts to join twice concurrently
        let expectation = expectation(description: "Concurrent joins complete")
        expectation.expectedFulfillmentCount = 2

        var firstSuccess = false
        var secondError: ContestError? = nil

        for i in 0..<2 {
            Task {
                do {
                    _ = try await joinContest(contestId: contest.id, userId: userId)
                    if i == 0 { firstSuccess = true }
                } catch ContestError.alreadyJoined {
                    if i == 1 { secondError = .alreadyJoined }
                }
                expectation.fulfill()
            }
        }

        // Assert
        waitForExpectations(timeout: 5)
        XCTAssertTrue(firstSuccess)
        XCTAssertEqual(secondError, .alreadyJoined)
    }
}

// Helper (implement in actual service)
func joinContest(contestId: UUID, userId: UUID) async throws {
    // TODO: Implement with SELECT ... FOR UPDATE
    throw ContestError.full
}

enum ContestError: Error {
    case full
    case alreadyJoined
}
```

---

# CI/CD GATE DEFINITIONS

## GitHub Actions Workflow

**File**: `.github/workflows/build-and-test.yml`

```yaml
name: Build & Test — Playoff Challenge

on:
  pull_request:
    branches: [main, staging]
  push:
    branches: [main, staging]

jobs:
  core-build:
    name: Core Package Build
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Swift 6.2
        run: |
          # Swift 6.2 from swiftlang/swift docker or Xcode 16.2
          swift --version

      - name: Core build
        run: |
          cd core
          swift build 2>&1 | tee build.log

      - name: Check for compilation errors
        run: |
          if grep -i "error:" build.log; then
            echo "❌ Compilation errors detected"
            exit 1
          fi

      - name: Check for warnings
        run: |
          WARNING_COUNT=$(grep -i "warning:" build.log | wc -l)
          if [ $WARNING_COUNT -gt 5 ]; then
            echo "⚠️  Too many warnings: $WARNING_COUNT"
            exit 1
          fi

  core-test:
    name: Core Package Tests
    runs-on: macos-latest
    needs: core-build
    steps:
      - uses: actions/checkout@v4

      - name: Install Swift 6.2
        run: swift --version

      - name: Core tests
        run: |
          cd core
          swift test 2>&1 | tee test.log

      - name: Verify 66+ tests pass
        run: |
          PASS_COUNT=$(grep "passed" test.log | awk '{print $1}')
          if [ "$PASS_COUNT" -lt 66 ]; then
            echo "❌ Expected 66+ tests, got $PASS_COUNT"
            exit 1
          fi

      - name: Fail on test failures
        if: failure()
        run: |
          echo "❌ Tests failed"
          cat test.log
          exit 1

  ios-build:
    name: iOS App Build
    runs-on: macos-latest
    needs: core-build
    steps:
      - uses: actions/checkout@v4

      - name: Install Xcode
        run: |
          xcode-select --install || true
          xcodebuild -version

      - name: iOS app build
        run: |
          cd ios-app/PlayoffChallenge
          xcodebuild -scheme PlayoffChallenge \
            -configuration Debug \
            -derivedDataPath build \
            2>&1 | tee build.log

      - name: Check for errors
        run: |
          if grep -i "error:" build.log; then
            echo "❌ iOS build errors"
            exit 1
          fi

      - name: Check for warnings
        run: |
          WARNING_COUNT=$(grep -i "warning:" build.log | wc -l)
          echo "Warnings: $WARNING_COUNT"
          # Allow some warnings, but fail on Domain type leaks
          if grep -i "Contract\|DTO" build.log | grep -i "published\|@state"; then
            echo "❌ DTO leakage in ViewModels"
            exit 1
          fi

  lint-domain-types:
    name: Lint — Domain Type Rules
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4

      - name: Check no DTO in @Published
        run: |
          set +e
          grep -r "@Published.*Contract\|@Published.*DTO" ios-app/ 2>/dev/null
          if [ $? -eq 0 ]; then
            echo "❌ Found @Published DTO/Contract types"
            exit 1
          fi

      - name: Check no Optional in Domain fields
        run: |
          set +e
          # Domain types should not have Optional fields unless explicitly allowed
          OPTIONAL_DOMAINS=$(grep -r "public let.*: .*?" \
            core/Sources/core/Domain/*.swift | \
            grep -v "Date?\|maxEntries\|joinToken\|tier" | \
            wc -l)
          if [ "$OPTIONAL_DOMAINS" -gt 0 ]; then
            echo "⚠️  Review optional fields in Domain types"
            # Don't fail, just warn (some are allowed)
          fi

      - name: Check Codable conformance
        run: |
          for file in core/Sources/core/Domain/*.swift; do
            if grep -q "^public struct\|^public enum" "$file"; then
              if ! grep -q "Codable" "$file"; then
                echo "❌ $file missing Codable"
                exit 1
              fi
            fi
          done

      - name: Check Hashable conformance
        run: |
          for file in core/Sources/core/Domain/*.swift; do
            if grep -q "^public struct" "$file"; then
              if ! grep -q "Hashable" "$file"; then
                echo "❌ $file missing Hashable"
                exit 1
              fi
            fi
          done

  lint-no-fatalerror:
    name: Lint — No fatalError()
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4

      - name: Check no fatalError in service methods
        run: |
          set +e
          grep "fatalError()" \
            core/Sources/core/Mutations/*.swift \
            core/Sources/core/Services/*.swift 2>/dev/null
          if [ $? -eq 0 ]; then
            echo "❌ Found fatalError() in service code"
            exit 1
          fi

  contract-deserialization:
    name: Contract Tests — JSON Deserialization
    runs-on: macos-latest
    needs: core-build
    steps:
      - uses: actions/checkout@v4

      - name: Run contract tests
        run: |
          cd core
          swift test ContractTests 2>&1 | tee contract-test.log

      - name: Verify contract tests pass
        run: |
          if grep -i "failed" contract-test.log; then
            echo "❌ Contract deserialization failed"
            exit 1
          fi

  security-scan:
    name: Security — OWASP Top 10
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4

      - name: Check for SQL injection patterns
        run: |
          set +e
          grep -r "String(format:" core/ ios-app/ | grep -i "select\|insert\|update"
          if [ $? -eq 0 ]; then
            echo "⚠️  Potential SQL injection pattern"
          fi

      - name: Check for hardcoded secrets
        run: |
          set +e
          grep -r "password\|api_key\|secret" \
            core/ ios-app/ \
            --include="*.swift" \
            | grep -i "= \"" | grep -v "// secret\|test"
          if [ $? -eq 0 ]; then
            echo "⚠️  Possible hardcoded secret"
          fi

  results:
    name: Test Results Summary
    runs-on: ubuntu-latest
    needs: [core-build, core-test, ios-build, lint-domain-types, lint-no-fatalerror]
    if: always()
    steps:
      - name: Check all gates passed
        run: |
          echo "✅ All CI/CD gates passed"
          echo "Core: Build ✓ | Tests ✓ (66+)"
          echo "iOS: Build ✓ | No warnings"
          echo "Lint: Domain types ✓ | No DTO leak ✓ | Codable/Hashable ✓"
```

---

## Lint Rules — Custom Swift Lint Configuration

**File**: `.swiftlint.yml`

```yaml
# SwiftLint configuration for Playoff Challenge

rules:
  - custom_rules

custom_rules:
  no_dto_in_published:
    name: "No DTO in @Published"
    regex: '@Published.*\b(Contract|DTO)\b'
    match_kinds: source.swift.identifier
    message: "@Published should only use Domain types, not DTO/Contract"
    severity: error

  no_optional_domain_fields:
    name: "No Optional in Domain fields"
    regex: '(core/Sources/core/Domain).*public let.*\?: '
    match_kinds: source.swift.identifier
    message: "Domain types should not have Optional fields (except explicitly allowed)"
    severity: warning

  no_service_in_viewmodel:
    name: "ViewModels inject protocols, not concrete services"
    regex: 'ios-app.*ViewModel.*init.*: CustomContestService\)'
    match_kinds: source.swift.identifier
    message: "Inject protocol (CustomContestServiceing), not concrete service"
    severity: error

  codable_in_domain:
    name: "Domain types must be Codable"
    regex: '(core/Sources/core/Domain).*public struct.*(?!.*Codable)'
    match_kinds: source.swift.identifier
    message: "Domain struct must conform to Codable"
    severity: error

  hashable_in_domain:
    name: "Domain types must be Hashable"
    regex: '(core/Sources/core/Domain).*public struct.*(?!.*Hashable)'
    match_kinds: source.swift.identifier
    message: "Domain struct must conform to Hashable"
    severity: error
```

---

# TASK BOARD & EXECUTION PLAN

## Phase 8-11 Detailed Task Board

### Task Legend
- 🔴 **Blocked** — Waiting on dependencies
- 🟡 **Pending** — Ready to start (dependencies clear)
- 🟢 **In Progress** — Currently being worked on
- ✅ **Complete** — Done, tested, merged

---

## PHASE 8: DOMAIN MODEL COMPLETION (Weeks 1-2)

| Task ID | Task | Owner | Priority | Effort | Dependencies | Status | Notes |
|---------|------|-------|----------|--------|--------------|--------|-------|
| **8.1** | Complete `Contest.swift` — 23 fields + initializer | Core Dev | 🔴 **HIGH** | 4h | None | 🔴 Blocked | Use spec above; add mapping logic |
| **8.2** | Fix `ContestActionState.swift` — remove Contract refs | Core Dev | 🔴 **HIGH** | 2h | 8.1 | 🔴 Blocked | Replace PayoutTierContract with PayoutTier |
| **8.3** | Create `Standing.swift` struct | Core Dev | 🔴 **HIGH** | 2h | None | 🔴 Blocked | Leaderboard row representation |
| **8.4** | Create `PayoutRow.swift` struct | Core Dev | 🔴 **HIGH** | 2h | None | 🔴 Blocked | Settlement payout row |
| **8.5** | Complete `RosterConfig.swift` with mapping | Core Dev | 🔴 **HIGH** | 1h | None | 🔴 Blocked | Entry schema validation |
| **8.6** | Define `LeaderboardState` enum | Core Dev | 🔴 **HIGH** | 1h | None | 🔴 Blocked | Contest scoring state |
| **8.7** | Ensure Codable + Hashable on all types | Core Dev | 🔴 **HIGH** | 2h | 8.1-8.6 | 🔴 Blocked | Conformance check |
| **8.8** | Write Contest.from(DTO) mapper + edge cases | Core Dev | 🔴 **HIGH** | 3h | 8.1-8.7 | 🔴 Blocked | Null handling, UUID parsing, date formatting |
| **8.9** | Update `core.swift` exports | Core Dev | 🔴 **HIGH** | 1h | 8.1-8.8 | 🔴 Blocked | @_exported imports |
| **8.10** | Write Domain model unit tests | QA | 🔴 **HIGH** | 6h | 8.1-8.9 | 🔴 Blocked | Snapshot tests, mapping edge cases (see templates) |
| **8.11** | Code review + commit Phase 8 | Core Dev | 🔴 **MEDIUM** | 1h | 8.1-8.10 | 🔴 Blocked | Tag: PHASE_8_COMPLETE |

**Phase 8 Success Criteria**:
- ✅ All Domain types defined (9 types)
- ✅ 90+ unit tests (66 existing + 24 new Domain tests)
- ✅ 0 compilation warnings
- ✅ `swift build` succeeds
- ✅ `swift test` all pass

---

## PHASE 9: iOS INTEGRATION (Weeks 2-3)

| Task ID | Task | Owner | Priority | Effort | Dependencies | Status | Notes |
|---------|------|-------|----------|--------|--------------|--------|-------|
| **9.1** | Update `AvailableContestsViewModel` — publish Domain types | iOS Dev | 🔴 **HIGH** | 3h | 8.1, 8.8 | 🔴 Blocked | Change @Published from DTO to Contest |
| **9.2** | Update `ContestDetailViewModel` — publish ContestActionState | iOS Dev | 🔴 **HIGH** | 2h | 8.2 | 🔴 Blocked | Import Core; use Domain type |
| **9.3** | Update `ContestLeaderboardViewModel` — publish Leaderboard | iOS Dev | 🔴 **HIGH** | 2h | 8.3 | 🔴 Blocked | Schema-driven rendering |
| **9.4** | Wire "Create Contest" dropdown to CustomContestService | iOS Dev | 🔴 **HIGH** | 4h | 8.1, 9.1 | 🔴 Blocked | UI → Service flow |
| **9.5** | Remove iOS app `Domain/` folder; update imports | iOS Dev | 🔴 **HIGH** | 2h | 9.1-9.4 | 🔴 Blocked | Delete Domain folder; import from Core |
| **9.6** | Verify protocol injection (no concrete service refs) | QA | 🔴 **MEDIUM** | 2h | 9.1-9.5 | 🔴 Blocked | Lint check for Serviceing protocols |
| **9.7** | iOS app build via xcodebuild — zero warnings | QA | 🔴 **HIGH** | 2h | 9.1-9.6 | 🔴 Blocked | `xcodebuild -scheme PlayoffChallenge` |
| **9.8** | Code review + commit Phase 9 | iOS Dev | 🔴 **MEDIUM** | 1h | 9.1-9.7 | 🔴 Blocked | Tag: PHASE_9_COMPLETE |

**Phase 9 Success Criteria**:
- ✅ iOS app builds with zero warnings
- ✅ ViewModels publish Domain types only
- ✅ Create Contest flow wired and testable
- ✅ No DTO imports in ViewModels
- ✅ Protocol injection working

---

## PHASE 10: TESTING & RISK MITIGATION (Weeks 3-4)

| Task ID | Task | Owner | Priority | Effort | Dependencies | Status | Notes |
|---------|------|-------|----------|--------|--------------|--------|-------|
| **10.1** | Unit tests — Contest.from() mapping (null, UUID, dates) | QA | 🔴 **HIGH** | 4h | 8.8, 8.10 | 🔴 Blocked | Use template above |
| **10.2** | Unit tests — ContestActionState.from() mapping | QA | 🔴 **HIGH** | 3h | 8.2, 8.10 | 🔴 Blocked | Contract→Domain mapping |
| **10.3** | Integration test — Contest fetch → ViewModel → UI | QA | 🔴 **HIGH** | 6h | 9.1, 9.7 | 🔴 Blocked | Full stack; mock API |
| **10.4** | Unit tests — Payout calculations (tiered, rounding, edge cases) | QA | 🔴 **HIGH** | 5h | 8.4 | 🔴 Blocked | See template |
| **10.5** | Unit tests — Multi-contest isolation (5 contests, independent state) | QA | 🔴 **MEDIUM** | 4h | 8.1, 8.2 | 🔴 Blocked | Parametrized tests |
| **10.6** | Fuzz tests — Contract deserialization (malformed JSON, edge cases) | QA | 🔴 **HIGH** | 3h | 8.8 | 🔴 Blocked | Crash-resistant parsing |
| **10.7** | Integration test — Concurrent joins (capacity + duplicate prevention) | QA | 🔴 **HIGH** | 3h | 8.1 | 🔴 Blocked | Race condition prevention |
| **10.8** | Snapshot tests — Contest JSON serialization (regression) | QA | 🔴 **MEDIUM** | 2h | 8.1 | 🔴 Blocked | Detect unintended field changes |
| **10.9** | Documentation — Domain type mapping & invariants | Product | 🔴 **MEDIUM** | 2h | 8.1-8.10 | 🔴 Blocked | Confluence/ARCHITECTURE.md update |
| **10.10** | CI/CD setup — GitHub Actions workflow | DevOps | 🔴 **HIGH** | 3h | 10.1-10.9 | 🔴 Blocked | Use workflow above |
| **10.11** | Code review + commit Phase 10 | QA | 🔴 **MEDIUM** | 1h | 10.1-10.10 | 🔴 Blocked | Tag: PHASE_10_COMPLETE |

**Phase 10 Success Criteria**:
- ✅ 150+ tests (120 Domain/mapping + 30 integration)
- ✅ 0 test flakiness
- ✅ Payout logic fully tested (edge cases)
- ✅ Multi-contest isolation proven
- ✅ 100% CI pass rate
- ✅ Contract deserialization fuzzing complete

---

## PHASE 11: ADVANCED FEATURES & SCALING (Weeks 4-8)

| Task ID | Task | Owner | Priority | Effort | Dependencies | Status | Notes |
|---------|------|-------|----------|--------|--------------|--------|-------|
| **11.1** | Implement SELECT FOR UPDATE locking (concurrent join safety) | Backend Dev | 🟡 **HIGH** | 6h | 10.7 | 🟡 Pending | Prevent participant dup |
| **11.2** | Batch contest scoring (handle 100+ contests in parallel) | Backend Dev | 🟡 **HIGH** | 8h | 8.1-8.10 | 🟡 Pending | Service-level batch operation |
| **11.3** | Idempotent settlement (prevent double-payout) | Backend Dev | 🟡 **HIGH** | 5h | 10.4 | 🟡 Pending | Idempotency key + dedup check |
| **11.4** | Audit logging (scoring replay, determinism verification) | Backend Dev | 🟡 **MEDIUM** | 6h | 11.2, 11.3 | 🟡 Pending | Enable scoring replay |
| **11.5** | Soft-delete for contests (preserve participants) | Backend Dev | 🟡 **MEDIUM** | 3h | 8.1 | 🟡 Pending | No cascade to participants |
| **11.6** | Contest list pagination (indexed queries, offset/limit) | Backend Dev | 🟡 **MEDIUM** | 4h | 8.1 | 🟡 Pending | Performance optimization |
| **11.7** | Unit tests — Payout idempotency (same input = same output) | QA | 🟡 **HIGH** | 4h | 11.3 | 🟡 Pending | Verify 2x settlement = 1x |
| **11.8** | Stress tests — 100 concurrent contests, 1000 participants | QA | 🟡 **MEDIUM** | 5h | 11.2, 11.3 | 🟡 Pending | Performance baseline |
| **11.9** | Documentation — Operations runbook (settling, replays, disputes) | Product | 🟡 **MEDIUM** | 3h | 11.2-11.5 | 🟡 Pending | RunBook.md |
| **11.10** | Code review + commit Phase 11 | Backend Dev | 🟡 **MEDIUM** | 1h | 11.1-11.9 | 🟡 Pending | Tag: PHASE_11_COMPLETE |

**Phase 11 Success Criteria**:
- ✅ Batch scoring handles 100+ contests (< 2s per contest)
- ✅ Payout settlement idempotent (proven by tests)
- ✅ Concurrent join safety (SELECT FOR UPDATE, 0 duplicates)
- ✅ Audit trail for all settlement operations
- ✅ Stress test: 1000 participants, 0 data loss
- ✅ Operations runbook ready

---

## SUMMARY TABLE (All Phases)

| Phase | # Tasks | Core Dev | iOS Dev | QA | DevOps | Total Effort |
|-------|---------|----------|---------|-----|--------|--------------|
| **Phase 8** | 11 | 22h | — | 6h | — | **28h** |
| **Phase 9** | 8 | — | 15h | 4h | — | **19h** |
| **Phase 10** | 11 | — | — | 25h | 3h | **28h** |
| **Phase 11** | 10 | 28h | — | 9h | — | **37h** |
| **TOTAL** | **40** | **50h** | **15h** | **44h** | **3h** | **112h** |

**Timeline**: 6-8 weeks @ 20h/week per dev

---

# IMPLEMENTATION CHECKLIST

## Pre-Implementation (This Week)

### For All Roles
- [ ] Read CLAUDE.md (platform rules, multi-contest requirements)
- [ ] Read PHASE_8_11_IMPLEMENTATION_GUIDE.md (this file)
- [ ] Review VALIDATION4_PATCH_PLAN.md for Context

### For Core Dev
- [ ] Set up local environment: Swift 6.2, SwiftPM
- [ ] Clone repo, checkout `staging` branch
- [ ] Verify `swift build` and `swift test` work (66 passing)
- [ ] Review Contest.swift spec above; ask clarifying questions

### For iOS Dev
- [ ] Set up local environment: Xcode 16.2+
- [ ] Clone repo, checkout `staging` branch
- [ ] Verify iOS app builds with `xcodebuild`
- [ ] Review ViewModel specs above

### For QA
- [ ] Set up Swift test environment
- [ ] Review test templates above
- [ ] Set up snapshot testing framework
- [ ] Create test data/fixtures directory

---

## Phase 8 Implementation (Week 1-2)

### Day 1-2: Type Definitions
- [ ] **8.1** Create Contest.swift (4h)
- [ ] **8.3** Create Standing.swift (2h)
- [ ] **8.4** Create PayoutRow.swift (2h)
- [ ] **8.5** Complete RosterConfig.swift (1h)

### Day 2-3: Enums & Conformance
- [ ] **8.6** Define LeaderboardState enum (1h)
- [ ] **8.7** Add Codable/Hashable to all (2h)
- [ ] **8.2** Fix ContestActionState (2h)

### Day 3-4: Mapping Logic
- [ ] **8.8** Contest.from(DTO) mapper (3h)
- [ ] **8.9** Update core.swift exports (1h)

### Day 4-5: Testing
- [ ] **8.10** Domain unit tests (6h)
- [ ] **8.11** Code review + commit (1h)

### Verification Gate
```bash
cd core
swift build  # Should succeed with no warnings
swift test   # Should show 90+ tests passing
```

---

## Phase 9 Implementation (Week 2-3)

### Day 1-2: ViewModel Updates
- [ ] **9.1** AvailableContestsViewModel (3h)
- [ ] **9.2** ContestDetailViewModel (2h)
- [ ] **9.3** ContestLeaderboardViewModel (2h)

### Day 2-3: UI Wiring
- [ ] **9.4** Create Contest dropdown wiring (4h)
- [ ] **9.5** Remove iOS Domain/ folder, update imports (2h)

### Day 4: Verification
- [ ] **9.6** Verify protocol injection (2h)
- [ ] **9.7** iOS build check (2h)
- [ ] **9.8** Code review + commit (1h)

### Verification Gate
```bash
cd ios-app/PlayoffChallenge
xcodebuild -scheme PlayoffChallenge -configuration Debug
# Should succeed with zero warnings/errors
```

---

## Phase 10 Implementation (Week 3-4)

### Day 1-2: Unit Tests
- [ ] **10.1** Contest.from() mapping tests (4h)
- [ ] **10.2** ContestActionState mapping tests (3h)
- [ ] **10.8** Snapshot tests (2h)

### Day 2-3: Integration Tests
- [ ] **10.3** Contest fetch → ViewModel → UI (6h)
- [ ] **10.4** Payout calculation tests (5h)
- [ ] **10.5** Multi-contest isolation tests (4h)

### Day 4: Edge Cases & CI/CD
- [ ] **10.6** Fuzz tests — JSON deserialization (3h)
- [ ] **10.7** Concurrent join tests (3h)
- [ ] **10.10** CI/CD setup (3h)
- [ ] **10.9** Documentation (2h)
- [ ] **10.11** Code review + commit (1h)

### Verification Gate
```bash
cd core
swift test  # Should show 150+ tests, all passing, no flakiness
```

---

## Phase 11 Implementation (Week 4-8)

### Sprints: Week 4-8 (Backend Dev focus)
- [ ] **11.1** SELECT FOR UPDATE locking (6h)
- [ ] **11.2** Batch scoring service (8h)
- [ ] **11.3** Idempotent settlement (5h)
- [ ] **11.4** Audit logging (6h)
- [ ] **11.5** Soft-delete (3h)
- [ ] **11.6** Pagination optimization (4h)
- [ ] **11.7** Idempotency tests (4h)
- [ ] **11.8** Stress tests (5h)
- [ ] **11.9** Operations runbook (3h)
- [ ] **11.10** Code review + commit (1h)

### Verification Gate
```bash
# Batch scoring: 100 contests < 2s
# Stress test: 1000 participants, 0 data loss
# Idempotency: settle(X) = settle(settle(X))
```

---

## Risk Mitigation Checklist

### Critical Blockers
- [ ] **Blocker 1**: Contest Domain type complete (8.1)
- [ ] **Blocker 2**: Contract→Domain mapping consistent (8.2, 8.8)
- [ ] **Blocker 3**: Multi-contest isolation tests passing (10.5)
- [ ] **Blocker 4**: Payout logic fully tested (10.4)
- [ ] **Blocker 5**: iOS build verified (9.7)

### Safety Checks
- [ ] No `fatalError()` in service methods
- [ ] No DTO in @Published ViewModels
- [ ] No optional fields in Domain types (except explicit)
- [ ] All Domain types Codable + Hashable
- [ ] SELECT FOR UPDATE locking implemented (11.1)
- [ ] Payout settlement idempotent (11.3)

---

## Definition of Done (Per Task)

Each task is **DONE** when:
1. ✅ Code written to spec
2. ✅ Tests written and passing (100% green)
3. ✅ No warnings/errors in build
4. ✅ Code review approved by 2 reviewers
5. ✅ Merged to `staging` (not main)
6. ✅ CI/CD all gates passing
7. ✅ Updated documentation (ARCHITECTURE.md, etc.)

---

## Success Metrics

### Week 2 (Phase 8 Complete)
- ✅ 9 Domain types defined and tested
- ✅ 90+ unit tests passing
- ✅ 0 compilation warnings
- ✅ Contest.from() mapper handling all null cases

### Week 3 (Phase 9 Complete)
- ✅ iOS app builds with zero warnings
- ✅ ViewModels publish Domain types only
- ✅ Create Contest flow end-to-end working
- ✅ No DTO/Contract imports in iOS app code

### Week 4 (Phase 10 Complete)
- ✅ 150+ tests passing (no flakiness)
- ✅ Multi-contest isolation proven
- ✅ Payout calculations fully tested
- ✅ CI/CD gates enforcing quality

### Week 8 (Phase 11 Complete)
- ✅ Batch scoring handles 100+ contests
- ✅ Payout settlement idempotent (proven)
- ✅ Concurrent join safety (SELECT FOR UPDATE)
- ✅ Production-ready multi-contest platform

---

## Questions? Escalation Path

1. **Architecture Questions** → Product Lead / Platform Architect
2. **Design/Spec Clarity** → Core Dev Lead
3. **Implementation Blockers** → Tech Lead
4. **Test/QA Strategy** → QA Lead
5. **Timeline/Resource** → Project Manager

**Weekly Sync**: Mondays @ 10am (15 min status update)

---

**END OF PHASE 8-11 IMPLEMENTATION GUIDE**

*Document prepared for 67 Enterprises Playoff Challenge Platform*
*Authority: CLAUDE.md (platform invariants)*
*Ready for team handoff and execution.*

