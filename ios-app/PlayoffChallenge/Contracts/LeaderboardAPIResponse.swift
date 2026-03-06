//
//  LeaderboardAPIResponse.swift
//  PlayoffChallenge
//
//  API wrapper DTO for leaderboard response.
//  Matches OpenAPI schema exactly (lines 1866-1956 in openapi.yaml).
//  Maps to Core.LeaderboardResponseContract via service layer.
//

import Foundation

/// LeaderboardAPIResponse: Complete wrapper DTO matching OpenAPI Leaderboard schema.
/// Decodes the backend response exactly as specified, including contest metadata.
/// Transformed to Core.LeaderboardResponseContract by service layer for domain mapping.
struct LeaderboardAPIResponse: Decodable {
    let contest_id: String
    let contest_type: String
    let leaderboard_state: String  // pending, computed, error, unknown
    let generated_at: String?
    let column_schema: [LeaderboardColumnAPIDTO]
    let rows: [LeaderboardRowAPIDTO]

    enum CodingKeys: String, CodingKey {
        case contest_id
        case contest_type
        case leaderboard_state
        case generated_at
        case column_schema
        case rows
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        contest_id = try c.decode(String.self, forKey: .contest_id)
        contest_type = try c.decode(String.self, forKey: .contest_type)
        leaderboard_state = try c.decode(String.self, forKey: .leaderboard_state)
        generated_at = try c.decodeIfPresent(String.self, forKey: .generated_at)
        column_schema = try c.decode([LeaderboardColumnAPIDTO].self, forKey: .column_schema)
        rows = try c.decode([LeaderboardRowAPIDTO].self, forKey: .rows)
    }
}

/// LeaderboardColumnAPIDTO: Column schema from OpenAPI response.
/// Maps to Core.LeaderboardColumnSchema for domain layer.
struct LeaderboardColumnAPIDTO: Decodable {
    let key: String
    let label: String
    let type: String?
    let format: String?

    enum CodingKeys: String, CodingKey {
        case key, label, type, format
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        key = try c.decode(String.self, forKey: .key)
        label = try c.decode(String.self, forKey: .label)
        type = try c.decodeIfPresent(String.self, forKey: .type)
        format = try c.decodeIfPresent(String.self, forKey: .format)
    }
}

/// LeaderboardRowAPIDTO: Individual standing from OpenAPI response.
/// Captures backend field names exactly (user_display_name instead of username).
/// Maps to Core.LeaderboardRowContract with field name normalization.
struct LeaderboardRowAPIDTO: Decodable {
    let id: String
    let user_id: String
    let user_display_name: String  // Backend sends this, not "username"
    let rank: Int
    let values: [String: JSONValue]
    let tier: Int?

    enum CodingKeys: String, CodingKey {
        case id
        case user_id
        case user_display_name
        case rank
        case values
        case tier
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        user_id = try c.decode(String.self, forKey: .user_id)
        user_display_name = try c.decode(String.self, forKey: .user_display_name)
        rank = try c.decode(Int.self, forKey: .rank)
        values = try c.decode([String: JSONValue].self, forKey: .values)
        tier = try c.decodeIfPresent(Int.self, forKey: .tier)
    }
}
