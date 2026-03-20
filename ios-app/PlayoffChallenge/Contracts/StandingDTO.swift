import Foundation

/// DTO for individual participant standing.
/// Maps to backend flat standings response shape.
struct StandingDTO: Decodable {
    let user_id: String
    let user_display_name: String
    let total_score: Double?
    let rank: Int
}
