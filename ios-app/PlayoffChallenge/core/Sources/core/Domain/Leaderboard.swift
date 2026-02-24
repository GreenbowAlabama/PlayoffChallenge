import Foundation

/// Domain model for contest leaderboard.
/// Mapped from LeaderboardResponseContract.
/// Immutable, contest-type-agnostic representation.
struct Leaderboard {
    let contestId: UUID
    let contestType: String
    let state: LeaderboardState
    let generatedAt: Date?
    let columns: [LeaderboardColumn]
    let rows: [[String: AnyCodable]]
}

/// Domain model for leaderboard column metadata.
struct LeaderboardColumn {
    let key: String
    let label: String
    let type: String
    let format: String?
}
