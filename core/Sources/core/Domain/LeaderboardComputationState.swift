//
//  LeaderboardComputationState.swift
//  core
//
//  Domain model representing the computation state of a leaderboard.
//

import Foundation

/// Domain model representing the backend computation state for leaderboards.
/// Mapped from `LeaderboardStateContract`.
public enum LeaderboardComputationState: String, Codable, Hashable, Equatable, Sendable, CaseIterable {
    case pending
    case computed
    case error
    case unknown

    // MARK: - Mapping
    /// Initialize from a contract type.
    public static func from(_ contract: LeaderboardStateContract) -> LeaderboardComputationState {
        switch contract {
        case .pending: return .pending
        case .computed: return .computed
        case .error: return .error
        case .unknown: return .unknown
        }
    }
}
