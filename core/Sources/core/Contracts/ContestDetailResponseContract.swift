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
    public let template_sport: String?
    public let leaderboard_state: LeaderboardStateContract
    public let actions: ContestActionsContract
    public let payout_table: [PayoutTierContract]
    public let roster_config: RosterConfigContract

    // Optional timing and identifiers (per OpenAPI schema lines 1116-1146)
    public let start_time: Date?
    public let end_time: Date?
    public let tournament_start_time: Date?
    public let tournament_end_time: Date?
    public let join_token: String?

    enum CodingKeys: String, CodingKey {
        case contest_id
        case type
        case template_sport
        case leaderboard_state
        case actions
        case payout_table
        case roster_config
        case start_time
        case end_time
        case tournament_start_time
        case tournament_end_time
        case join_token
    }

    public init(
        contest_id: String,
        type: String,
        template_sport: String? = nil,
        leaderboard_state: LeaderboardStateContract,
        actions: ContestActionsContract,
        payout_table: [PayoutTierContract],
        roster_config: RosterConfigContract,
        start_time: Date? = nil,
        end_time: Date? = nil,
        tournament_start_time: Date? = nil,
        tournament_end_time: Date? = nil,
        join_token: String? = nil
    ) {
        self.contest_id = contest_id
        self.type = type
        self.template_sport = template_sport
        self.leaderboard_state = leaderboard_state
        self.actions = actions
        self.payout_table = payout_table
        self.roster_config = roster_config
        self.start_time = start_time
        self.end_time = end_time
        self.tournament_start_time = tournament_start_time
        self.tournament_end_time = tournament_end_time
        self.join_token = join_token
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        contest_id = try c.decode(String.self, forKey: .contest_id)
        type = try c.decode(String.self, forKey: .type)
        template_sport = try c.decodeIfPresent(String.self, forKey: .template_sport)
        leaderboard_state = try c.decode(LeaderboardStateContract.self, forKey: .leaderboard_state)
        actions = try c.decode(ContestActionsContract.self, forKey: .actions)
        // Required fields — no fallback
        payout_table = try c.decode([PayoutTierContract].self, forKey: .payout_table)
        roster_config = try c.decode(RosterConfigContract.self, forKey: .roster_config)
        // Optional fields (OpenAPI schema allows nullable)
        start_time = try c.decodeIfPresent(Date.self, forKey: .start_time)
        end_time = try c.decodeIfPresent(Date.self, forKey: .end_time)
        tournament_start_time = try c.decodeIfPresent(Date.self, forKey: .tournament_start_time)
        tournament_end_time = try c.decodeIfPresent(Date.self, forKey: .tournament_end_time)
        join_token = try c.decodeIfPresent(String.self, forKey: .join_token)
    }
}
