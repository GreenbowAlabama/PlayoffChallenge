import Foundation

/// Domain contest status enum.
/// Maps from string wire representation.
enum ContestStatus: String, Equatable {
    case scheduled = "SCHEDULED"
    case locked = "LOCKED"
    case live = "LIVE"
    case complete = "COMPLETE"
    case cancelled = "CANCELLED"
    case error = "ERROR"
}
