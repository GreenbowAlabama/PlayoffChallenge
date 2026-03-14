//
//  Contest.swift
//  core
//
//  Domain model for a single persisted contest.
//

import Foundation

/// Typed contest template type (e.g., NFL, PGA, pickem).
/// Maps from OpenAPI template_type string values.
public enum ContestTemplateType: String, Codable, Sendable {
    case playoffChallenge = "PLAYOFF_CHALLENGE"
    case pickem = "PICKEM"
    case pgaTournament = "PGA_TOURNAMENT"
    case pgaBase = "PGA_BASE"
    case pgaDaily = "PGA_DAILY"
    case golfMajor = "GOLF_MAJOR"
    case unknown = "UNKNOWN"
}

/// Contest domain model representing a single contest in a list or detail view.
/// Mapped from `ContestListItemDTO` or `ContestDetailResponseContract`.
/// Immutable, Codable, Hashable, Equatable, and Sendable.
public struct Contest: Identifiable, Hashable, Equatable, Sendable {
    public let id: UUID
    public let organizerId: String
    public let contestName: String
    public let organizerName: String?
    public let status: ContestStatus
    public let entryCount: Int
    public let maxEntries: Int?
    public let entryFeeCents: Int
    public let lockTime: Date?
    public let startTime: Date?
    public let endTime: Date?
    public let tournamentStartTime: Date?
    public let tournamentEndTime: Date?
    public let joinToken: String?
    public let createdAt: Date
    public let updatedAt: Date
    public let leaderboardState: LeaderboardComputationState?
    public let actions: ContestActions?
    public let payoutTable: [PayoutTier]?
    public let rosterConfig: RosterConfig?
    public let templateType: ContestTemplateType
    public let sport: Sport  // Sport type: GOLF, NFL, etc.
    public let isPlatformOwned: Bool?

    public init(
        id: UUID,
        organizerId: String,
        contestName: String,
        organizerName: String?,
        status: ContestStatus,
        entryCount: Int,
        maxEntries: Int?,
        entryFeeCents: Int,
        lockTime: Date?,
        startTime: Date?,
        endTime: Date?,
        tournamentStartTime: Date?,
        tournamentEndTime: Date?,
        joinToken: String?,
        createdAt: Date,
        updatedAt: Date,
        leaderboardState: LeaderboardComputationState?,
        actions: ContestActions?,
        payoutTable: [PayoutTier]?,
        rosterConfig: RosterConfig?,
        templateType: ContestTemplateType = .unknown,
        sport: Sport = .unknown,
        isPlatformOwned: Bool?
    ) {
        self.id = id
        self.organizerId = organizerId
        self.contestName = contestName
        self.organizerName = organizerName
        self.status = status
        self.entryCount = entryCount
        self.maxEntries = maxEntries
        self.entryFeeCents = entryFeeCents
        self.lockTime = lockTime
        self.startTime = startTime
        self.endTime = endTime
        self.tournamentStartTime = tournamentStartTime
        self.tournamentEndTime = tournamentEndTime
        self.joinToken = joinToken
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.leaderboardState = leaderboardState
        self.actions = actions
        self.payoutTable = payoutTable
        self.rosterConfig = rosterConfig
        self.templateType = templateType
        self.sport = sport
        self.isPlatformOwned = isPlatformOwned
    }

    // MARK: - Computed Properties
    /// Share URL for this contest (uses join token for deep linking).
    /// Note: Use the joinToken with the app's configured base URL in the view layer.
    public var shareURLToken: String? {
        joinToken
    }

    // MARK: - Mapping
    /// Initialize from a contract type (list item).
    public static func from(_ contract: ContestListItemDTO) -> Contest {
        let status = ContestStatus(rawValue: contract.status.uppercased()) ?? .scheduled
        let lbState = contract.leaderboardState.flatMap { s -> LeaderboardComputationState? in
            // Map string state to enum
            switch s.lowercased() {
            case "pending": return .pending
            case "computed": return .computed
            case "error": return .error
            default: return .unknown
            }
        }

        let templateType = contract.templateType.flatMap { ContestTemplateType(rawValue: $0) } ?? .unknown
        let sport = Sport(contract.sport)

        return Contest(
            id: UUID(uuidString: contract.id) ?? UUID(),
            organizerId: contract.organizerId,
            contestName: contract.contestName,
            organizerName: contract.organizerName,
            status: status,
            entryCount: contract.entryCount,
            maxEntries: contract.maxEntries,
            entryFeeCents: contract.entryFeeCents,
            lockTime: contract.lockTime,
            startTime: contract.startTime,
            endTime: contract.endTime,
            tournamentStartTime: nil,
            tournamentEndTime: nil,
            joinToken: contract.joinToken,
            createdAt: contract.createdAt,
            updatedAt: contract.updatedAt,
            leaderboardState: lbState,
            actions: contract.actions.map { ContestActions.from($0) },
            payoutTable: contract.payoutTable?.map { PayoutTier.from($0) },
            rosterConfig: contract.rosterConfig.map { RosterConfig.from($0) },
            templateType: templateType,
            sport: sport,
            isPlatformOwned: contract.isPlatformOwned
        )
    }

    /// Initialize from a detail contract.
    /// Maps only the fields present in ContestDetailResponseContract.
    /// Fields like organizerId, contestName, status come from the list endpoint (ContestListItemDTO).
    public static func from(_ contract: ContestDetailResponseContract) -> Contest {
        let templateType = ContestTemplateType(rawValue: contract.type) ?? .unknown
        let sport = Sport(contract.sport)

        return Contest(
            id: UUID(uuidString: contract.contest_id) ?? UUID(),
            organizerId: "", // Not present in detail contract; use ContestListItemDTO for populated contests
            contestName: "", // Not present in detail contract; use ContestListItemDTO for populated contests
            organizerName: nil, // Not present in detail contract
            status: .scheduled, // Not present in detail contract; use ContestListItemDTO for populated contests
            entryCount: 0,   // Not present in detail contract; use ContestListItemDTO for populated contests
            maxEntries: nil, // Not present in detail contract; use ContestListItemDTO for populated contests
            entryFeeCents: 0,
            lockTime: nil,
            startTime: contract.start_time, // Now mapped from contract (OpenAPI schema line 1116)
            endTime: contract.end_time,     // Now mapped from contract (OpenAPI schema line 1123)
            tournamentStartTime: contract.tournament_start_time,
            tournamentEndTime: contract.tournament_end_time,
            joinToken: contract.join_token, // Now mapped from contract (OpenAPI schema line 1143)
            createdAt: Date(),
            updatedAt: Date(),
            leaderboardState: LeaderboardComputationState.from(contract.leaderboard_state),
            actions: ContestActions.from(contract.actions),
            payoutTable: contract.payout_table.map { PayoutTier.from($0) },
            rosterConfig: RosterConfig.from(contract.roster_config),
            templateType: templateType,
            sport: sport,
            isPlatformOwned: nil // Not present in detail contract
        )
    }
    
    // MARK: - Testing Factory
    /// Stub factory for testing.
    public static func stub(
        id: UUID = UUID(),
        organizerId: String = "org-1",
        contestName: String = "Test Contest",
        organizerName: String? = "Organizer",
        status: ContestStatus = .scheduled,
        entryCount: Int = 0,
        maxEntries: Int? = 10,
        entryFeeCents: Int = 1000,
        lockTime: Date? = nil,
        startTime: Date? = nil,
        endTime: Date? = nil,
        tournamentStartTime: Date? = nil,
        tournamentEndTime: Date? = nil,
        joinToken: String? = "test-token",
        createdAt: Date = Date(),
        updatedAt: Date = Date(),
        leaderboardState: LeaderboardComputationState? = .pending,
        actions: ContestActions? = ContestActions.stub(),
        payoutTable: [PayoutTier]? = [PayoutTier.stub()],
        rosterConfig: RosterConfig? = RosterConfig.stub(),
        templateType: ContestTemplateType = .playoffChallenge,
        sport: Sport = .unknown,
        isPlatformOwned: Bool? = nil
    ) -> Contest {
        return Contest(
            id: id,
            organizerId: organizerId,
            contestName: contestName,
            organizerName: organizerName,
            status: status,
            entryCount: entryCount,
            maxEntries: maxEntries,
            entryFeeCents: entryFeeCents,
            lockTime: lockTime,
            startTime: startTime,
            endTime: endTime,
            tournamentStartTime: tournamentStartTime,
            tournamentEndTime: tournamentEndTime,
            joinToken: joinToken,
            createdAt: createdAt,
            updatedAt: updatedAt,
            leaderboardState: leaderboardState,
            actions: actions,
            payoutTable: payoutTable,
            rosterConfig: rosterConfig,
            templateType: templateType,
            sport: sport,
            isPlatformOwned: isPlatformOwned
        )
    }
}
