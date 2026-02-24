//
//  ContestActionState.swift
//  core
//
//  Domain model for contest action state and authorization layer.
//

import Foundation

/// Domain model for contest action state and authorization layer.
/// Represents user capability flags, leaderboard state, payout structure, and roster configuration.
/// Mapped from ContestDetailResponseContract.
/// Immutable, truthful Domain representation — no field invention, no loss.
public struct ContestActionState: Codable, Hashable, Equatable, Sendable {
    public let contestId: UUID
    public let contestType: String
    public let leaderboardState: LeaderboardComputationState
    public let actions: ContestActions
    public let payoutTable: [PayoutTier]
    public let rosterConfig: RosterConfig

    enum CodingKeys: String, CodingKey {
        case contestId = "contest_id"
        case contestType = "contest_type"
        case leaderboardState = "leaderboard_state"
        case actions
        case payoutTable = "payout_table"
        case rosterConfig = "roster_config"
    }

    /// Full initializer.
    public init(
        contestId: UUID,
        contestType: String,
        leaderboardState: LeaderboardComputationState,
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

    // MARK: - Mapping
    /// Map from ContestDetailResponseContract to ContestActionState domain model.
    public static func from(_ contract: ContestDetailResponseContract) -> ContestActionState {
        let parsedId = UUID(uuidString: contract.contest_id) ?? UUID()
        let payoutTiers = contract.payout_table.map { PayoutTier.from($0) }
        let rosterConfig = RosterConfig.from(contract.roster_config)
        let mappedActions = ContestActions.from(contract.actions)
        let mappedState = LeaderboardComputationState.from(contract.leaderboard_state)

        return ContestActionState(
            contestId: parsedId,
            contestType: contract.type,
            leaderboardState: mappedState,
            actions: mappedActions,
            payoutTable: payoutTiers,
            rosterConfig: rosterConfig
        )
    }

    // MARK: - Testing Factory
    /// Stub factory for testing with sensible defaults.
    public static func stub(
        contestId: UUID = UUID(),
        contestType: String = "playoff",
        leaderboardState: LeaderboardComputationState = .pending,
        actions: ContestActions = ContestActions.stub(),
        payoutTable: [PayoutTier] = [PayoutTier.stub()],
        rosterConfig: RosterConfig = RosterConfig.stub()
    ) -> ContestActionState {
        return ContestActionState(
            contestId: contestId,
            contestType: contestType,
            leaderboardState: leaderboardState,
            actions: actions,
            payoutTable: payoutTable,
            rosterConfig: rosterConfig
        )
    }

    // MARK: Codable Conformance
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        contestId = try container.decode(UUID.self, forKey: .contestId)
        contestType = try container.decode(String.self, forKey: .contestType)
        leaderboardState = try container.decode(LeaderboardComputationState.self, forKey: .leaderboardState)
        actions = try container.decode(ContestActions.self, forKey: .actions)
        payoutTable = try container.decode([PayoutTier].self, forKey: .payoutTable)
        rosterConfig = try container.decode(RosterConfig.self, forKey: .rosterConfig)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(contestId, forKey: .contestId)
        try container.encode(contestType, forKey: .contestType)
        try container.encode(leaderboardState, forKey: .leaderboardState)
        try container.encode(actions, forKey: .actions)
        try container.encode(payoutTable, forKey: .payoutTable)
        try container.encode(rosterConfig, forKey: .rosterConfig)
    }
}
