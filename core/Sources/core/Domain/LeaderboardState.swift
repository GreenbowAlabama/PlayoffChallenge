//
//  LeaderboardState.swift
//  core
//
//  Domain model for leaderboard states.
//

import Foundation

/// Domain model representing the state of a leaderboard.
/// This defines the business logic state for leaderboard/contest progression.
/// Must be fully Codable (encode/decode), Hashable, and Equatable.
public enum LeaderboardState: String, Codable, Hashable, Equatable, Sendable, CaseIterable {
    // Contest progression states (domain logic)
    /// Leaderboard is open, contest is still accepting entries or yet to start.
    case open

    /// Contest has started, entries are locked, waiting for scoring to begin.
    case locked

    /// Active scoring is happening as events occur.
    case scoring

    /// Events are finished, initial scoring is complete, pending final review.
    case scored

    /// Scores are under dispute or review, payouts are paused.
    case disputed

    /// Contest is fully resolved, payouts executed, no further changes expected.
    case settled

    // Leaderboard computation states (backend presentation layer)
    /// Leaderboard computation is pending (settlement not yet recorded).
    case pending

    /// Leaderboard computation is complete and available.
    case computed

    /// Leaderboard computation encountered an error.
    case error
    
    // MARK: - Codable Conformance
    
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let rawValue = try container.decode(String.self)
        
        guard let state = LeaderboardState(rawValue: rawValue.lowercased()) else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Invalid leaderboard state: \(rawValue)"
            )
        }
        self = state
    }
    
    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(self.rawValue)
    }
}
