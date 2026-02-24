//
//  Standing.swift
//  core
//
//  Domain model for a user's standing in a leaderboard.
//

import Foundation

/// Standing domain model representing a single user's rank and score in a leaderboard.
/// Mapped from `LeaderboardRowContract`.
/// Immutable, Codable, Hashable, Equatable, and safe for multi-contest use.
public struct Standing: Identifiable, Codable, Hashable, Equatable, Sendable {
    public let id: UUID
    public let userId: UUID
    public let username: String
    public let rank: Int
    public let values: [String: AnyCodable]
    public let tier: Int?
    
    public init(id: UUID, userId: UUID, username: String, rank: Int, values: [String: AnyCodable], tier: Int?) {
        self.id = id
        self.userId = userId
        self.username = username
        self.rank = rank
        self.values = values
        self.tier = tier
    }
    
    // MARK: - Mapping
    /// Initialize from a contract type.
    /// Maps contract fields to domain fields.
    public static func from(_ contract: LeaderboardRowContract) -> Standing {
        return Standing(
            id: UUID(uuidString: contract.id) ?? UUID(),
            userId: UUID(uuidString: contract.userId) ?? UUID(),
            username: contract.username,
            rank: contract.rank,
            values: contract.values,
            tier: contract.tier
        )
    }
    
    // MARK: - Testing Factory
    /// Stub factory for testing with sensible defaults.
    public static func stub(
        id: UUID = UUID(),
        userId: UUID = UUID(),
        username: String = "Test User",
        rank: Int = 1,
        values: [String: AnyCodable] = [:],
        tier: Int? = 1
    ) -> Standing {
        return Standing(
            id: id,
            userId: userId,
            username: username,
            rank: rank,
            values: values,
            tier: tier
        )
    }
    
    // MARK: - Hashable Conformance
    public func hash(into hasher: inout Hasher) {
        hasher.combine(id)
        hasher.combine(userId)
        hasher.combine(username)
        hasher.combine(rank)
        hasher.combine(tier)
        // Sort keys for stable hashing of values dictionary
        hasher.combine(values.keys.sorted())
    }
    
    // MARK: - Equatable Conformance
    public static func == (lhs: Standing, rhs: Standing) -> Bool {
        return lhs.id == rhs.id &&
               lhs.userId == rhs.userId &&
               lhs.username == rhs.username &&
               lhs.rank == rhs.rank &&
               lhs.tier == rhs.tier &&
               lhs.values == rhs.values
    }
}
