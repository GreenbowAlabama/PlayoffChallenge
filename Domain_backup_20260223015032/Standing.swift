import Foundation

/// Domain model for participant standing.
/// Mapped from StandingDTO.
struct Standing: Equatable {
    let userId: UUID
    let displayName: String
    let totalScore: Double
    let rank: Int
}
