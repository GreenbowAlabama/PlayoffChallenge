//
//  LeaderboardAPIResponse.swift
//  PlayoffChallenge
//
//  API wrapper DTO for leaderboard response.
//  Matches OpenAPI schema exactly (line 1745 in openapi.yaml).
//  Maps to Core domain via service layer.
//

import Foundation

/// LeaderboardAPIResponse: Wrapper DTO matching OpenAPI Leaderboard schema.
/// Decodes the backend response exactly as specified.
/// Transformed to Core.LeaderboardResponseContract by service layer.
struct LeaderboardAPIResponse: Decodable {
    let standings: [StandingAPIDTO]
    let metadata: [String: AnyCodable]?

    enum CodingKeys: String, CodingKey {
        case standings
        case metadata
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        standings = try c.decode([StandingAPIDTO].self, forKey: .standings)
        metadata = try c.decodeIfPresent([String: AnyCodable].self, forKey: .metadata)
    }
}

/// StandingAPIDTO: Individual standing from OpenAPI response.
/// Maps to Core.Standing via LeaderboardRowContract adapter.
struct StandingAPIDTO: Decodable {
    let user_id: String
    let user_display_name: String
    let total_score: Double
    let rank: Int

    enum CodingKeys: String, CodingKey {
        case user_id
        case user_display_name
        case total_score
        case rank
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        user_id = try c.decode(String.self, forKey: .user_id)
        user_display_name = try c.decode(String.self, forKey: .user_display_name)
        total_score = try c.decode(Double.self, forKey: .total_score)
        rank = try c.decode(Int.self, forKey: .rank)
    }
}
