import Foundation

/// DTO for contest list item.
/// Maps to OpenAPI ContestListItem.
/// Used by:
/// - GET /api/custom-contests (200)
/// - GET /api/custom-contests/available (200)
struct ContestListItemDTO: Decodable {
    // Required fields
    let id: UUID
    let organizer_id: UUID
    let organizer_name: String
    let entry_fee_cents: Int
    let payout_structure: JSONValue?  // Required field but nullable
    let contest_name: String
    let max_entries: Int?
    let status: String
    let is_locked: Bool
    let is_live: Bool
    let is_settled: Bool
    let entry_count: Int
    let user_has_entered: Bool
    let time_until_lock: Int?
    let lock_time: Date?
    let template_name: String
    let template_sport: String
    let template_type: String
    let leaderboard_state: String
    let actions: ActionsDTO
    let payout_table: [PayoutRowDTO]
    let roster_config: RosterConfigDTO
    let created_at: Date
    let updated_at: Date

    // Optional/nullable fields
    let start_time: Date?
    let end_time: Date?
    let join_token: String?
    let is_platform_owned: Bool?

    enum CodingKeys: String, CodingKey {
        case id, organizer_id, organizer_name, entry_fee_cents
        case payout_structure, contest_name, start_time, end_time
        case lock_time, max_entries, join_token, created_at, updated_at
        case is_platform_owned, template_name, template_sport, template_type
        case status, is_locked, is_live, is_settled, entry_count
        case user_has_entered, time_until_lock, leaderboard_state, actions
        case payout_table, roster_config
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)

        // Required fields
        id = try c.decode(UUID.self, forKey: .id)
        organizer_id = try c.decode(UUID.self, forKey: .organizer_id)
        organizer_name = try c.decode(String.self, forKey: .organizer_name)
        entry_fee_cents = try c.decode(Int.self, forKey: .entry_fee_cents)
        payout_structure = try c.decodeIfPresent(JSONValue.self, forKey: .payout_structure)
        contest_name = try c.decode(String.self, forKey: .contest_name)
        max_entries = try c.decodeIfPresent(Int.self, forKey: .max_entries)
        status = try c.decode(String.self, forKey: .status)
        is_locked = try c.decode(Bool.self, forKey: .is_locked)
        is_live = try c.decode(Bool.self, forKey: .is_live)
        is_settled = try c.decode(Bool.self, forKey: .is_settled)
        entry_count = try c.decode(Int.self, forKey: .entry_count)
        user_has_entered = try c.decode(Bool.self, forKey: .user_has_entered)
        time_until_lock = try c.decodeIfPresent(Int.self, forKey: .time_until_lock)
        lock_time = try c.decodeIfPresent(Date.self, forKey: .lock_time)
        template_name = try c.decode(String.self, forKey: .template_name)
        template_sport = try c.decode(String.self, forKey: .template_sport)
        template_type = try c.decode(String.self, forKey: .template_type)
        leaderboard_state = try c.decode(String.self, forKey: .leaderboard_state)
        actions = try c.decode(ActionsDTO.self, forKey: .actions)
        payout_table = try c.decode([PayoutRowDTO].self, forKey: .payout_table)
        roster_config = try c.decode(RosterConfigDTO.self, forKey: .roster_config)
        created_at = try c.decode(Date.self, forKey: .created_at)
        updated_at = try c.decode(Date.self, forKey: .updated_at)

        // Optional/nullable fields
        start_time = try c.decodeIfPresent(Date.self, forKey: .start_time)
        end_time = try c.decodeIfPresent(Date.self, forKey: .end_time)
        join_token = try c.decodeIfPresent(String.self, forKey: .join_token)
        is_platform_owned = try c.decodeIfPresent(Bool.self, forKey: .is_platform_owned)
    }
}
