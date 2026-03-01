import Foundation

/// DTO for contest list item.
/// Maps to OpenAPI ContestListItem.
/// Used by:
/// - GET /api/custom-contests (200)
/// - GET /api/custom-contests/available (200)
struct ContestListItemDTO: Decodable {
    // Required fields
    let id: UUID
    let organizerId: UUID
    let organizerName: String
    let entryFeeCents: Int
    let payoutStructure: JSONValue?  // Required field but nullable
    let contestName: String
    let maxEntries: Int?
    let status: String
    let isLocked: Bool
    let isLive: Bool
    let isSettled: Bool
    let entryCount: Int
    let userHasEntered: Bool
    let timeUntilLock: Int?
    let lockTime: Date?
    let templateName: String
    let templateSport: String
    let templateType: String
    let leaderboardState: String
    let actions: ActionsDTO
    let payoutTable: [PayoutRowDTO]
    let rosterConfig: RosterConfigDTO
    let createdAt: Date
    let updatedAt: Date

    // Optional/nullable fields
    let startTime: Date?
    let endTime: Date?
    let joinToken: String?
    let isPlatformOwned: Bool?

    enum CodingKeys: String, CodingKey {
        case id
        case organizerId = "organizer_id"
        case organizerName = "organizer_name"
        case entryFeeCents = "entry_fee_cents"
        case payoutStructure = "payout_structure"
        case contestName = "contest_name"
        case startTime = "start_time"
        case endTime = "end_time"
        case lockTime = "lock_time"
        case maxEntries = "max_entries"
        case joinToken = "join_token"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case isPlatformOwned = "is_platform_owned"
        case templateName = "template_name"
        case templateSport = "template_sport"
        case templateType = "template_type"
        case status
        case isLocked = "is_locked"
        case isLive = "is_live"
        case isSettled = "is_settled"
        case entryCount = "entry_count"
        case userHasEntered = "user_has_entered"
        case timeUntilLock = "time_until_lock"
        case leaderboardState = "leaderboard_state"
        case actions
        case payoutTable = "payout_table"
        case rosterConfig = "roster_config"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)

        // Required fields
        id = try c.decode(UUID.self, forKey: .id)
        organizerId = try c.decode(UUID.self, forKey: .organizerId)
        organizerName = try c.decode(String.self, forKey: .organizerName)
        entryFeeCents = try c.decode(Int.self, forKey: .entryFeeCents)
        payoutStructure = try c.decodeIfPresent(JSONValue.self, forKey: .payoutStructure)
        contestName = try c.decode(String.self, forKey: .contestName)
        maxEntries = try c.decodeIfPresent(Int.self, forKey: .maxEntries)
        status = try c.decode(String.self, forKey: .status)
        isLocked = try c.decode(Bool.self, forKey: .isLocked)
        isLive = try c.decode(Bool.self, forKey: .isLive)
        isSettled = try c.decode(Bool.self, forKey: .isSettled)
        entryCount = try c.decode(Int.self, forKey: .entryCount)
        userHasEntered = try c.decode(Bool.self, forKey: .userHasEntered)
        timeUntilLock = try c.decodeIfPresent(Int.self, forKey: .timeUntilLock)
        lockTime = try c.decodeIfPresent(Date.self, forKey: .lockTime)
        templateName = try c.decode(String.self, forKey: .templateName)
        templateSport = try c.decode(String.self, forKey: .templateSport)
        templateType = try c.decode(String.self, forKey: .templateType)
        leaderboardState = try c.decode(String.self, forKey: .leaderboardState)
        actions = try c.decode(ActionsDTO.self, forKey: .actions)
        payoutTable = try c.decode([PayoutRowDTO].self, forKey: .payoutTable)
        rosterConfig = try c.decode(RosterConfigDTO.self, forKey: .rosterConfig)
        createdAt = try c.decode(Date.self, forKey: .createdAt)
        updatedAt = try c.decode(Date.self, forKey: .updatedAt)

        // Optional/nullable fields
        startTime = try c.decodeIfPresent(Date.self, forKey: .startTime)
        endTime = try c.decodeIfPresent(Date.self, forKey: .endTime)
        joinToken = try c.decodeIfPresent(String.self, forKey: .joinToken)
        isPlatformOwned = try c.decodeIfPresent(Bool.self, forKey: .isPlatformOwned)
    }
}
