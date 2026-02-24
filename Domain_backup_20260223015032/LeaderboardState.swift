import Foundation

/// Domain leaderboard state enum.
/// Maps from string wire representation.
enum LeaderboardState: String, Equatable {
    case pending = "pending"
    case computed = "computed"
    case error = "error"
}
