import Foundation

/// DTO for contest action capability flags.
/// Maps to OpenAPI Actions schema.
/// All fields required, all non-nullable.
struct ActionsDTO: Decodable {
    let can_join: Bool
    let can_edit_entry: Bool
    let is_live: Bool
    let is_closed: Bool
    let is_scoring: Bool
    let is_scored: Bool
    let is_read_only: Bool
    let can_share_invite: Bool
    let can_manage_contest: Bool
    let can_delete: Bool
    let can_unjoin: Bool
}
