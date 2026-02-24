//
//  CustomContestSettings.swift
//  core
//
//  Domain model for custom contest settings.
//

import Foundation

/// CustomContestSettings domain model representing settings when creating a custom contest.
/// Immutable, Codable, Hashable, Equatable, and Sendable.
public struct CustomContestSettings: Codable, Hashable, Equatable, Sendable {
    public let entryFeeCents: Int
    public let maxEntries: Int
    
    public init(
        entryFeeCents: Int,
        maxEntries: Int
    ) {
        self.entryFeeCents = entryFeeCents
        self.maxEntries = maxEntries
    }
    
    enum CodingKeys: String, CodingKey {
        case entryFeeCents = "entry_fee_cents"
        case maxEntries = "max_entries"
    }
    
    // MARK: - Testing Factory
    /// Stub factory for testing.
    public static func stub(
        entryFeeCents: Int = 1000,
        maxEntries: Int = 10
    ) -> CustomContestSettings {
        return CustomContestSettings(
            entryFeeCents: entryFeeCents,
            maxEntries: maxEntries
        )
    }
}
