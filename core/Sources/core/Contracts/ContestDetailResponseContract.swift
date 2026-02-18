//
//  ContestDetailResponseContract.swift
//  core
//
//  Contest detail contract response (source of truth for contest state).
//  Backend-driven—no client-side inference allowed.
//  All required fields must decode strictly.
//

import Foundation

/// RosterConfigContract: Contest-type-agnostic roster configuration.
public typealias RosterConfigContract = [String: AnyCodable]

/// ContestDetailResponseContract: Master source of truth for contest state.
/// Backend authoritative response—client must not infer state, capability, or eligibility.
/// Every required field is mandatory; missing any field = decode failure.
public struct ContestDetailResponseContract: Decodable {
    public let contest_id: String
    public let type: String
    public let leaderboard_state: LeaderboardState
    public let actions: ContestActions
    public let payout_table: [PayoutTierContract]
    public let roster_config: RosterConfigContract

    enum CodingKeys: String, CodingKey {
        case contest_id
        case type
        case leaderboard_state
        case actions
        case payout_table
        case roster_config
    }

    public init(
        contest_id: String,
        type: String,
        leaderboard_state: LeaderboardState,
        actions: ContestActions,
        payout_table: [PayoutTierContract],
        roster_config: RosterConfigContract
    ) {
        self.contest_id = contest_id
        self.type = type
        self.leaderboard_state = leaderboard_state
        self.actions = actions
        self.payout_table = payout_table
        self.roster_config = roster_config
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        contest_id = try c.decode(String.self, forKey: .contest_id)
        type = try c.decode(String.self, forKey: .type)
        leaderboard_state = try c.decode(LeaderboardState.self, forKey: .leaderboard_state)
        actions = try c.decode(ContestActions.self, forKey: .actions)
        // Required fields — no fallback
        payout_table = try c.decode([PayoutTierContract].self, forKey: .payout_table)
        roster_config = try c.decode(RosterConfigContract.self, forKey: .roster_config)
    }
}
