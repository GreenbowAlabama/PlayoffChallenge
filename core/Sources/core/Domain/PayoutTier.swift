//
//  PayoutTier.swift
//  core
//
//  Domain model for a payout tier bracket.
//

import Foundation

/// Domain model for a payout tier bracket.
/// Mapped from PayoutTierContract.
/// Immutable representation of a single prize tier.
public struct PayoutTier: Codable, Hashable, Equatable, Sendable {
    public let rankMin: Int
    public let rankMax: Int
    public let amount: Decimal

    enum CodingKeys: String, CodingKey {
        case rankMin = "rank_min"
        case rankMax = "rank_max"
        case amount
    }

    // MARK: - Mapping
    /// Initialize from a contract type.
    /// Maps snake_case contract fields to camelCase domain fields.
    public static func from(_ contract: PayoutTierContract) -> PayoutTier {
        return PayoutTier(
            rankMin: contract.rank_min,
            rankMax: contract.rank_max,
            amount: contract.amount
        )
    }

    // MARK: - Testing Factory
    /// Stub factory for testing.
    public static func stub(
        rankMin: Int = 1,
        rankMax: Int = 10,
        amount: Decimal = 100.0
    ) -> PayoutTier {
        return PayoutTier(rankMin: rankMin, rankMax: rankMax, amount: amount)
    }
}
