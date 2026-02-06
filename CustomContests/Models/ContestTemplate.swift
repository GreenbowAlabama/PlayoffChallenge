import Foundation

// MARK: - Contest Template

/// Ops-owned blueprint for contest instances.
/// Templates define the rules, scoring, and settlement strategies.
/// Only ops can create/modify templates; users reference them via templateId.
struct ContestTemplate: Codable, Equatable, Identifiable {
    let id: UUID
    let name: String
    let sportKey: String
    let scoringStrategyKey: String
    let settlementStrategyKey: String
    let constraints: TemplateConstraints
    let isActive: Bool
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case sportKey = "sport_key"
        case scoringStrategyKey = "scoring_strategy_key"
        case settlementStrategyKey = "settlement_strategy_key"
        case constraints
        case isActive = "is_active"
        case createdAt = "created_at"
    }

    init(
        id: UUID = UUID(),
        name: String,
        sportKey: String,
        scoringStrategyKey: String,
        settlementStrategyKey: String,
        constraints: TemplateConstraints = TemplateConstraints(),
        isActive: Bool = true,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.name = name
        self.sportKey = sportKey
        self.scoringStrategyKey = scoringStrategyKey
        self.settlementStrategyKey = settlementStrategyKey
        self.constraints = constraints
        self.isActive = isActive
        self.createdAt = createdAt
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
