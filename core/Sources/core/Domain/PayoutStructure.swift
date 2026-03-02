//
//  PayoutStructure.swift
//  core
//
//  Domain model for payout structure.
//

import Foundation

/// PayoutStructure domain model representing a contest's payout rule.
/// Captures all fields from backend templates, including those required for specific types.
/// Immutable, Codable, Hashable, Equatable, and Sendable.
public struct PayoutStructure: Codable, Hashable, Equatable, Sendable {
    public let type: String
    public let maxWinners: Int?
    public let payoutPercentages: [Double]?
    public let minEntries: Int?

    public init(
        type: String,
        maxWinners: Int? = nil,
        payoutPercentages: [Double]? = nil,
        minEntries: Int? = nil
    ) {
        self.type = type
        self.maxWinners = maxWinners
        self.payoutPercentages = payoutPercentages
        self.minEntries = minEntries
    }

    enum CodingKeys: String, CodingKey {
        case type
        case maxWinners = "max_winners"
        case payoutPercentages = "payout_percentages"
        case minEntries = "min_entries"
    }
    
    // MARK: - Testing Factory
    /// Stub factory for testing.
    public static func stub(
        type: String = "TOP_3",
        maxWinners: Int? = 3,
        payoutPercentages: [Double]? = nil,
        minEntries: Int? = nil
    ) -> PayoutStructure {
        return PayoutStructure(
            type: type,
            maxWinners: maxWinners,
            payoutPercentages: payoutPercentages,
            minEntries: minEntries
        )
    }
}
