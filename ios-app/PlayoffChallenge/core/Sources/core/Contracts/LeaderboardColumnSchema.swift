//
//  LeaderboardColumnSchema.swift
//  core
//
//  Schema definition for dynamic leaderboard columns.
//  Contest-type-agnostic column rendering guidance.
//

import Foundation

/// LeaderboardColumnSchema: Column definition for dynamic leaderboard rendering.
/// key and label are required; type and format are optional hints.
public struct LeaderboardColumnSchema: Decodable, Sendable {
    public let key: String
    public let label: String
    public let type: String?
    public let format: String?

    enum CodingKeys: String, CodingKey {
        case key, label, type, format
    }

    public init(key: String, label: String, type: String? = nil, format: String? = nil) {
        self.key = key
        self.label = label
        self.type = type
        self.format = format
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        key = try c.decode(String.self, forKey: .key)
        label = try c.decode(String.self, forKey: .label)
        type = try c.decodeIfPresent(String.self, forKey: .type)
        format = try c.decodeIfPresent(String.self, forKey: .format)
    }
}
