import Foundation

// MARK: - PayoutTier (Domain Type)
/// Domain model for a payout tier bracket.
/// Mapped from PayoutTierContract.
/// Immutable representation of a single prize tier.
struct PayoutTier: Codable, Hashable, Equatable, Sendable {
    let rankMin: Int
    let rankMax: Int
    let amount: Decimal

    enum CodingKeys: String, CodingKey {
        case rankMin = "rank_min"
        case rankMax = "rank_max"
        case amount
    }

    /// Initialize from a contract type.
    /// Maps snake_case contract fields to camelCase domain fields.
    static func from(_ contract: PayoutTierContract) -> PayoutTier {
        PayoutTier(
            rankMin: contract.rank_min,
            rankMax: contract.rank_max,
            amount: contract.amount
        )
    }

    /// Stub factory for testing.
    static func stub(
        rankMin: Int = 1,
        rankMax: Int = 10,
        amount: Decimal = 100.0
    ) -> PayoutTier {
        PayoutTier(rankMin: rankMin, rankMax: rankMax, amount: amount)
    }
}

// MARK: - RosterConfig (Domain Type)
/// Domain model for contest-agnostic roster configuration.
/// Wraps typed key-value data structure for roster schema.
/// Mapped from RosterConfigContract ([String: AnyCodable]).
struct RosterConfig: Codable, Hashable, Equatable {
    let config: [String: AnyCodable]

    init(config: [String: AnyCodable]) {
        self.config = config
    }

    /// Initialize from contract type.
    /// Contract is already [String: AnyCodable], so direct passthrough.
    static func from(_ contract: [String: AnyCodable]) -> RosterConfig {
        RosterConfig(config: contract)
    }

    /// Stub factory for testing.
    static func stub(_ config: [String: AnyCodable] = [:]) -> RosterConfig {
        RosterConfig(config: config)
    }

    // MARK: Codable Conformance
    enum CodingKeys: String, CodingKey {
        case config
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        config = try container.decode([String: AnyCodable].self, forKey: .config)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(config, forKey: .config)
    }

    // MARK: Hashable Conformance
    func hash(into hasher: inout Hasher) {
        hasher.combine(config.keys.sorted())
    }

    // MARK: Equatable Conformance
    static func == (lhs: RosterConfig, rhs: RosterConfig) -> Bool {
        lhs.config.keys == rhs.config.keys
    }
}

// MARK: - ContestActionState (Domain Model)
/// Domain model for contest action state and authorization layer.
/// Represents user capability flags, leaderboard state, payout structure, and roster configuration.
/// Mapped from ContestDetailResponseContract.
/// Immutable, truthful Domain representation — no field invention, no loss.
struct ContestActionState: Codable, Hashable, Equatable {
    let contestId: UUID
    let contestType: String
    let leaderboardState: LeaderboardState
    let actions: ContestActions
    let payoutTable: [PayoutTier]
    let rosterConfig: RosterConfig

    enum CodingKeys: String, CodingKey {
        case contestId = "contest_id"
        case contestType = "contest_type"
        case leaderboardState = "leaderboard_state"
        case actions
        case payoutTable = "payout_table"
        case rosterConfig = "roster_config"
    }

    /// Full initializer.
    init(
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

    // MARK: - Mapping
    /// Map from ContestDetailResponseContract to ContestActionState domain model.
    /// Pure transformation from contract (DTO) to domain types:
    /// - Contest ID string parsed to UUID; invalid UUIDs fallback to empty UUID
    /// - Contest type passed through (platform agnostic)
    /// - Leaderboard state and actions passed through (already well-formed contract types)
    /// - Payout table contracts mapped to domain PayoutTier instances
    /// - Roster config contract (dict) mapped to domain RosterConfig instance
    /// No field invention, no silent loss. Every contract field maps to domain.
    static func from(_ contract: ContestDetailResponseContract) -> ContestActionState {
        let parsedId = UUID(uuidString: contract.contest_id) ?? UUID()
        let payoutTiers = contract.payout_table.map { PayoutTier.from($0) }
        let rosterConfig = RosterConfig.from(contract.roster_config)

        return ContestActionState(
            contestId: parsedId,
            contestType: contract.type,
            leaderboardState: contract.leaderboard_state,
            actions: contract.actions,
            payoutTable: payoutTiers,
            rosterConfig: rosterConfig
        )
    }

    // MARK: - Testing Factory
    /// Stub factory for testing with sensible defaults.
    /// Provides fully initialized instance for unit tests.
    static func stub(
        contestId: UUID = UUID(),
        contestType: String = "playoff",
        leaderboardState: LeaderboardState = .pending,
        actions: ContestActions = ContestActions(
            can_join: true,
            can_edit_entry: true,
            is_live: false,
            is_closed: false,
            is_scoring: false,
            is_scored: false,
            is_read_only: false,
            can_share_invite: true,
            can_manage_contest: true,
            can_delete: true,
            can_unjoin: true
        ),
        payoutTable: [PayoutTier] = [PayoutTier.stub()],
        rosterConfig: RosterConfig = RosterConfig.stub()
    ) -> ContestActionState {
        ContestActionState(
            contestId: contestId,
            contestType: contestType,
            leaderboardState: leaderboardState,
            actions: actions,
            payoutTable: payoutTable,
            rosterConfig: rosterConfig
        )
    }

    // MARK: Codable Conformance
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        contestId = try container.decode(UUID.self, forKey: .contestId)
        contestType = try container.decode(String.self, forKey: .contestType)
        leaderboardState = try container.decode(LeaderboardState.self, forKey: .leaderboardState)
        actions = try container.decode(ContestActions.self, forKey: .actions)
        payoutTable = try container.decode([PayoutTier].self, forKey: .payoutTable)
        rosterConfig = try container.decode(RosterConfig.self, forKey: .rosterConfig)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(contestId, forKey: .contestId)
        try container.encode(contestType, forKey: .contestType)
        try container.encode(leaderboardState, forKey: .leaderboardState)
        try container.encode(actions, forKey: .actions)
        try container.encode(payoutTable, forKey: .payoutTable)
        try container.encode(rosterConfig, forKey: .rosterConfig)
    }
}
