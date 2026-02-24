//
//  JoinLinkError.swift
//  PlayoffChallenge
//
//  Join flow error types - explicit, user-displayable errors
//

import Foundation

/// Explicit, user-displayable errors for join flow
enum JoinLinkError: Error, Equatable, LocalizedError {
    // Resolution errors
    case networkError(underlying: String)
    case environmentMismatch(expected: String, actual: String)

    // Contest state errors (aligned with backend codes)
    case contestNotFound
    case contestUnavailable
    case contestCompleted
    case contestLocked
    case contestFull
    case contestCancelled

    // Join errors
    case alreadyJoined
    case notAuthenticated
    case serverError(message: String)

    var errorDescription: String? {
        switch self {
        case .networkError(let underlying):
            return "Network error: \(underlying)"
        case .environmentMismatch(let expected, let actual):
            return "This link is for \(expected), but you're using the \(actual) app."
        case .contestNotFound:
            return "This contest could not be found."
        case .contestUnavailable:
            return "This contest is not available."
        case .contestCompleted:
            return "This contest has already ended."
        case .contestLocked:
            return "This contest is no longer accepting entries."
        case .contestFull:
            return "This contest is full."
        case .contestCancelled:
            return "This contest has been cancelled."
        case .alreadyJoined:
            return "You have already joined this contest."
        case .notAuthenticated:
            return "Please sign in to join this contest."
        case .serverError(let message):
            return message
        }
    }

    /// User-friendly title for error display
    var title: String {
        switch self {
        case .networkError:
            return "Connection Error"
        case .environmentMismatch:
            return "Wrong App Version"
        case .contestNotFound:
            return "Contest Not Found"
        case .contestUnavailable:
            return "Contest Unavailable"
        case .contestCompleted:
            return "Contest Ended"
        case .contestLocked, .contestFull, .contestCancelled:
            return "Contest Unavailable"
        case .alreadyJoined:
            return "Already Joined"
        case .notAuthenticated:
            return "Sign In Required"
        case .serverError:
            return "Error"
        }
    }
}
