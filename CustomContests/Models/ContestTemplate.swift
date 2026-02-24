import Foundation

// MARK: - Contest Template

/// Ops-owned blueprint for contest instances.
/// Provides entry fee and payout structure constraints for UI-driven contest creation.
/// Backend is authoritative on allowed values.
struct ContestTemplate: Codable, Identifiable, Equatable, Hashable {
    let id: UUID
    let name: String
    let defaultEntryFeeCents: Int
    let allowedEntryFeeMinCents: Int
    let allowedEntryFeeMaxCents: Int
    let allowedPayoutStructures: [PayoutStructure]

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case defaultEntryFeeCents = "default_entry_fee_cents"
        case allowedEntryFeeMinCents = "allowed_entry_fee_min_cents"
        case allowedEntryFeeMaxCents = "allowed_entry_fee_max_cents"
        case allowedPayoutStructures = "allowed_payout_structures"
    }

    // MARK: - Equatable
    // Identity based solely on id (UUID), matching backend entity semantics.
    // Other properties are attributes, not identity discriminators.
    static func == (lhs: ContestTemplate, rhs: ContestTemplate) -> Bool {
        lhs.id == rhs.id
    }

    // MARK: - Hashable
    // Hash based solely on id to maintain SwiftUI selection binding semantics.
    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
}

// MARK: - Template Constraints

/// Constraints that limit what settings a contest instance can have.
/// Ops define these; users must stay within them.
struct TemplateConstraints: Codable, Equatable {
    let minEntries: Int
    let maxEntries: Int
    let allowedEntryFees: [Decimal]

    enum CodingKeys: String, CodingKey {
        case minEntries = "min_entries"
        case maxEntries = "max_entries"
        case allowedEntryFees = "allowed_entry_fees"
    }

    init(
        minEntries: Int = 2,
        maxEntries: Int = 1000,
        allowedEntryFees: [Decimal] = [0]
    ) {
        self.minEntries = minEntries
        self.maxEntries = maxEntries
        self.allowedEntryFees = allowedEntryFees
    }

    /// Checks if an entry fee is allowed by this template.
    func isEntryFeeAllowed(_ fee: Decimal) -> Bool {
        allowedEntryFees.contains(fee)
    }

    /// Checks if max entries value is within the template's allowed range.
    func isMaxEntriesValid(_ entries: Int) -> Bool {
        entries >= minEntries && entries <= maxEntries
    }
}
