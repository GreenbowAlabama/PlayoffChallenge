import Foundation

/// DTO for individual participant standing.
/// Maps to OpenAPI Standing schema.
struct StandingDTO: Decodable {
    let user_id: UUID
    let user_display_name: String
    let total_score: Double
    let rank: Int
}
