//
//  ContestTemplate.swift
//  core
//
//  Domain model for a contest template.
//

import Foundation

/// ContestTemplate domain model representing a template for creating contests.
/// Immutable, Codable, Hashable, Equatable, and Sendable.
public struct ContestTemplate: Identifiable, Codable, Hashable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let description: String?
    public let defaultEntryFeeCents: Int
    public let allowedEntryFeeMinCents: Int
    public let allowedEntryFeeMaxCents: Int
    public let defaultMaxEntries: Int
    public let allowedPayoutStructures: [PayoutStructure]
    
    public init(
        id: String,
        name: String,
        description: String?,
        defaultEntryFeeCents: Int,
        allowedEntryFeeMinCents: Int,
        allowedEntryFeeMaxCents: Int,
        defaultMaxEntries: Int,
        allowedPayoutStructures: [PayoutStructure]
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.defaultEntryFeeCents = defaultEntryFeeCents
        self.allowedEntryFeeMinCents = allowedEntryFeeMinCents
        self.allowedEntryFeeMaxCents = allowedEntryFeeMaxCents
        self.defaultMaxEntries = defaultMaxEntries
        self.allowedPayoutStructures = allowedPayoutStructures
    }
    
    enum CodingKeys: String, CodingKey {
        case id
        case name
        case description
        case defaultEntryFeeCents = "default_entry_fee_cents"
        case allowedEntryFeeMinCents = "allowed_entry_fee_min_cents"
        case allowedEntryFeeMaxCents = "allowed_entry_fee_max_cents"
        case defaultMaxEntries = "default_max_entries"
        case allowedPayoutStructures = "allowed_payout_structures"
    }
    
    // MARK: - Testing Factory
    /// Stub factory for testing.
    public static func stub(
        id: String = "template-1",
        name: String = "Playoff Challenge",
        description: String? = "Standard playoff contest",
        defaultEntryFeeCents: Int = 1000,
        allowedEntryFeeMinCents: Int = 0,
        allowedEntryFeeMaxCents: Int = 10000,
        defaultMaxEntries: Int = 100,
        allowedPayoutStructures: [PayoutStructure] = [PayoutStructure.stub()]
    ) -> ContestTemplate {
        return ContestTemplate(
            id: id,
            name: name,
            description: description,
            defaultEntryFeeCents: defaultEntryFeeCents,
            allowedEntryFeeMinCents: allowedEntryFeeMinCents,
            allowedEntryFeeMaxCents: allowedEntryFeeMaxCents,
            defaultMaxEntries: defaultMaxEntries,
            allowedPayoutStructures: allowedPayoutStructures
        )
    }
}
