import Foundation

// MARK: - Custom Contest Settings

/// Settings for a custom contest.
struct CustomContestSettings: Codable, Equatable {
    let maxEntries: Int
    let entryFeeCents: Int
    let isPrivate: Bool

    enum CodingKeys: String, CodingKey {
        case maxEntries = "max_entries"
        case entryFeeCents = "entry_fee_cents"
        case isPrivate = "is_private"
    }

    init(
        maxEntries: Int,
        entryFeeCents: Int = 0,
        isPrivate: Bool = true
    ) {
        self.maxEntries = maxEntries
        self.entryFeeCents = entryFeeCents
        self.isPrivate = isPrivate
    }
}

// MARK: - Payout Structure

/// Payout structure for a contest.
struct PayoutStructure: Codable, Equatable, Hashable {
    let type: String
    let maxWinners: Int?

    enum CodingKeys: String, CodingKey {
        case type
        case maxWinners = "max_winners"
    }

    init(type: String, maxWinners: Int? = nil) {
        self.type = type
        self.maxWinners = maxWinners
    }
}

// MARK: - Create Request

/// Request model for creating a contest.
struct CreateContestRequest: Codable, Equatable {
    let name: String
    let maxEntries: Int
    let entryFeeCents: Int
    let isPrivate: Bool
    let lockTime: Date?
    let payoutStructure: PayoutStructure

    enum CodingKeys: String, CodingKey {
        case name
        case maxEntries = "max_entries"
        case entryFeeCents = "entry_fee_cents"
        case isPrivate = "is_private"
        case lockTime = "lock_time"
        case payoutStructure = "payout_structure"
    }

    init(
        name: String,
        settings: CustomContestSettings,
        payoutStructure: PayoutStructure,
        lockTime: Date? = nil
    ) {
        self.name = name
        self.maxEntries = settings.maxEntries
        self.entryFeeCents = settings.entryFeeCents
        self.isPrivate = settings.isPrivate
        self.lockTime = lockTime
        self.payoutStructure = payoutStructure
    }
}
