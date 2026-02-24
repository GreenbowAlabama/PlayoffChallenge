//
//  PayoutStructure.swift
//  core
//
//  Domain model for payout structure.
//

import Foundation

/// PayoutStructure domain model representing a contest's payout rule.
/// Immutable, Codable, Hashable, Equatable, and Sendable.
public struct PayoutStructure: Codable, Hashable, Equatable, Sendable {
    public let type: String
    public let maxWinners: Int?
    
    public init(type: String, maxWinners: Int? = nil) {
        self.type = type
        self.maxWinners = maxWinners
    }
    
    enum CodingKeys: String, CodingKey {
        case type
        case maxWinners = "max_winners"
    }
    
    // MARK: - Testing Factory
    /// Stub factory for testing.
    public static func stub(
        type: String = "TOP_3",
        maxWinners: Int? = 3
    ) -> PayoutStructure {
        return PayoutStructure(type: type, maxWinners: maxWinners)
    }
}
