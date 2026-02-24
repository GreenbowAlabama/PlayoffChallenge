//
//  RosterConfig.swift
//  core
//
//  Domain model for contest-agnostic roster configuration.
//

import Foundation

/// Domain model for contest-agnostic roster configuration.
/// Wraps typed key-value data structure for roster schema.
/// Mapped from RosterConfigContract ([String: AnyCodable]).
/// Immutable, Codable, Hashable, Equatable, and safe for multi-contest use.
public struct RosterConfig: Codable, Hashable, Equatable, Sendable {
    public let config: [String: AnyCodable]

    public init(config: [String: AnyCodable]) {
        self.config = config
    }

    // MARK: - Mapping
    /// Initialize from contract type.
    /// Contract is already [String: AnyCodable], so direct passthrough.
    public static func from(_ contract: [String: AnyCodable]) -> RosterConfig {
        return RosterConfig(config: contract)
    }

    // MARK: - Testing Factory
    /// Stub factory for testing with sensible defaults.
    public static func stub(_ config: [String: AnyCodable] = [:]) -> RosterConfig {
        return RosterConfig(config: config)
    }

    // MARK: - Codable Conformance
    enum CodingKeys: String, CodingKey {
        case config
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        config = try container.decode([String: AnyCodable].self, forKey: .config)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(config, forKey: .config)
    }

    // MARK: - Hashable Conformance
    public func hash(into hasher: inout Hasher) {
        // Sort keys to ensure stable hash
        hasher.combine(config.keys.sorted())
    }

    // MARK: - Equatable Conformance
    public static func == (lhs: RosterConfig, rhs: RosterConfig) -> Bool {
        return lhs.config == rhs.config
    }
}
