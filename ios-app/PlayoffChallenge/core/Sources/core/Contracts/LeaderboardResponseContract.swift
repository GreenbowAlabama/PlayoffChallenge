//
//  LeaderboardResponseContract.swift
//  core
//
//  Backend leaderboard contract response.
//  Source of truth for leaderboard rendering and state.
//

import Foundation

/// LeaderboardRow: Dynamic leaderboard row (contest-type-agnostic).
public typealias LeaderboardRow = [String: AnyCodable]

/// LeaderboardResponseContract: Backend leaderboard response contract.
/// All fields are required; leaderboard_state drives all rendering decisions.
public struct LeaderboardResponseContract: Decodable {
    public let contest_id: String
    public let contest_type: String
    public let leaderboard_state: LeaderboardState
    public let generated_at: String?
    public let column_schema: [LeaderboardColumnSchema]
    public let rows: [LeaderboardRow]

    enum CodingKeys: String, CodingKey {
        case contest_id
        case contest_type
        case leaderboard_state
        case generated_at
        case column_schema
        case rows
    }

    public init(
        contest_id: String,
        contest_type: String,
        leaderboard_state: LeaderboardState,
        generated_at: String? = nil,
        column_schema: [LeaderboardColumnSchema],
        rows: [LeaderboardRow]
    ) {
        self.contest_id = contest_id
        self.contest_type = contest_type
        self.leaderboard_state = leaderboard_state
        self.generated_at = generated_at
        self.column_schema = column_schema
        self.rows = rows
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        contest_id = try c.decode(String.self, forKey: .contest_id)
        contest_type = try c.decode(String.self, forKey: .contest_type)
        leaderboard_state = try c.decode(LeaderboardState.self, forKey: .leaderboard_state)
        generated_at = try c.decodeIfPresent(String.self, forKey: .generated_at)
        column_schema = try c.decode([LeaderboardColumnSchema].self, forKey: .column_schema)
        rows = try c.decode([LeaderboardRow].self, forKey: .rows)
    }
}
