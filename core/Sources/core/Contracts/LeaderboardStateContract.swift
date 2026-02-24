//
//  LeaderboardState.swift
//  core
//
//  Leaderboard computation state (not UI state).
//  Drives all leaderboard visibility and readiness decisions.
//

import Foundation

/// LeaderboardState: Backend computation state for leaderboards.
/// Must be present in every leaderboard response.
/// Enum enforces valid states only; unknown values fail decode.
public enum LeaderboardStateContract: String, Codable, Sendable, Equatable {
    case pending
    case computed
    case error
    case unknown

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let rawValue = try container.decode(String.self)

        switch rawValue.lowercased() {
        case "pending": self = .pending
        case "computed": self = .computed
        case "error": self = .error
        default: self = .unknown
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .pending: try container.encode("pending")
        case .computed: try container.encode("computed")
        case .error: try container.encode("error")
        case .unknown: try container.encode("unknown")
        }
    }
}
