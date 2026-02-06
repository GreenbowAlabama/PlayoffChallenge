import Foundation

/// Error types for custom contest creation and publishing.
enum CustomContestError: Error, Equatable, LocalizedError {
    // Validation errors
    case nameRequired
    case nameTooLong(maxLength: Int)
    case maxEntriesInvalid
    case maxEntriesTooLow(minimum: Int)
    case maxEntriesTooHigh(maximum: Int)
    case lockTimeInPast

    // State errors
    case notInDraftState
    case contestNotFound
    case notAuthorized

    // Network errors
    case networkError(underlying: String)
    case serverError(message: String)

    var errorDescription: String? {
        switch self {
        case .nameRequired:
            return "Contest name is required."
        case .nameTooLong(let maxLength):
            return "Contest name must be \(maxLength) characters or less."
        case .maxEntriesInvalid:
            return "Maximum entries must be a positive number."
        case .maxEntriesTooLow(let minimum):
            return "Maximum entries must be at least \(minimum)."
        case .maxEntriesTooHigh(let maximum):
            return "Maximum entries cannot exceed \(maximum)."
        case .lockTimeInPast:
            return "Lock time must be in the future."
        case .notInDraftState:
            return "Only draft contests can be published."
        case .contestNotFound:
            return "Contest not found."
        case .notAuthorized:
            return "You are not authorized to modify this contest."
        case .networkError(let underlying):
            return "Network error: \(underlying)"
        case .serverError(let message):
            return "Server error: \(message)"
        }
    }

    var title: String {
        switch self {
        case .nameRequired, .nameTooLong:
            return "Invalid Name"
        case .maxEntriesInvalid, .maxEntriesTooLow, .maxEntriesTooHigh:
            return "Invalid Entry Limit"
        case .lockTimeInPast:
            return "Invalid Lock Time"
        case .notInDraftState:
            return "Cannot Publish"
        case .contestNotFound:
            return "Not Found"
        case .notAuthorized:
            return "Not Authorized"
        case .networkError:
            return "Network Error"
        case .serverError:
            return "Server Error"
        }
    }
}
