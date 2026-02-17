import Foundation

// MARK: - Custom Contest Draft

/// Immutable model representing a custom contest in draft state.
/// A draft can be saved locally or created on the backend.
struct CustomContestDraft: Codable, Equatable, Identifiable {
    let id: UUID
    let name: String
    let settings: CustomContestSettings
    let status: ContestStatus
    let createdAt: Date
    let joinToken: String?
    let settleTime: Date?

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case settings
        case status
        case createdAt = "created_at"
        case joinToken = "join_token"
        case settleTime = "settle_time"
    }

    init(
        id: UUID = UUID(),
        name: String,
        settings: CustomContestSettings,
        status: ContestStatus = .scheduled,
        createdAt: Date = Date(),
        joinToken: String? = nil,
        settleTime: Date? = nil
    ) {
        self.id = id
        self.name = name
        self.settings = settings
        self.status = status
        self.createdAt = createdAt
        self.joinToken = joinToken
        self.settleTime = settleTime
    }
}

// MARK: - Custom Contest Settings

/// Immutable settings for a custom contest.
struct CustomContestSettings: Codable, Equatable {
    let maxEntries: Int
    let entryFee: Decimal
    let isPrivate: Bool

    enum CodingKeys: String, CodingKey {
        case maxEntries = "max_entries"
        case entryFee = "entry_fee"
        case isPrivate = "is_private"
    }

    init(
        maxEntries: Int,
        entryFee: Decimal = 0,
        isPrivate: Bool = true
    ) {
        self.maxEntries = maxEntries
        self.entryFee = entryFee
        self.isPrivate = isPrivate
    }
}

// MARK: - Create Request

/// Request model for creating a draft contest via API.
struct CreateContestRequest: Codable, Equatable {
    let name: String
    let maxEntries: Int
    let entryFee: Decimal
    let isPrivate: Bool
    let lockTime: Date?

    enum CodingKeys: String, CodingKey {
        case name
        case maxEntries = "max_entries"
        case entryFee = "entry_fee"
        case isPrivate = "is_private"
        case lockTime = "lock_time"
    }

    init(name: String, settings: CustomContestSettings, lockTime: Date? = nil) {
        self.name = name
        self.maxEntries = settings.maxEntries
        self.entryFee = settings.entryFee
        self.isPrivate = settings.isPrivate
        self.lockTime = lockTime
    }
}

// MARK: - Publish Result

/// Result of publishing a draft contest.
struct PublishContestResult: Codable, Equatable {
    let contestId: UUID
    let joinToken: String
    let joinURL: URL

    enum CodingKeys: String, CodingKey {
        // Backend returns camelCase
        case contestId
        case joinToken
        case joinURL
    }

    /// Convenience computed property for the join link string.
    var joinLink: String {
        joinURL.absoluteString
    }
}
