//
//  PayoutRow.swift
//  core
//
//  Domain model for a user's payout row.
//

import Foundation

/// PayoutRow domain model representing a single user's payout in a leaderboard.
/// Mapped from `PayoutRowContract`.
/// Immutable, Codable, Hashable, Equatable, and safe for multi-contest use.
public struct PayoutRow: Identifiable, Codable, Hashable, Equatable, Sendable {
    public let id: UUID
    public let userId: UUID
    public let username: String
    public let rank: Int
    public let payoutCents: Int
    public let tier: Int?
    
    public init(id: UUID, userId: UUID, username: String, rank: Int, payoutCents: Int, tier: Int?) {
        self.id = id
        self.userId = userId
        self.username = username
        self.rank = rank
        self.payoutCents = max(0, payoutCents)
        self.tier = tier
    }
    
    // MARK: - Mapping
    /// Initialize from a contract type.
    /// Maps contract fields to domain fields, ensuring payoutCents >= 0.
    public static func from(_ contract: PayoutRowContract) -> PayoutRow {
        return PayoutRow(
            id: UUID(uuidString: contract.id) ?? UUID(),
            userId: UUID(uuidString: contract.userId) ?? UUID(),
            username: contract.username,
            rank: contract.rank,
            payoutCents: contract.payoutCents,
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
        payoutCents: Int = 1000,
        tier: Int? = 1
    ) -> PayoutRow {
        return PayoutRow(
            id: id,
            userId: userId,
            username: username,
            rank: rank,
            payoutCents: payoutCents,
            tier: tier
        )
    }
}
