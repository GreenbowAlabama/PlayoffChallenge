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
    case invalidToken
    case tokenExpired
    case networkError(underlying: String)
    case environmentMismatch(expected: String, actual: String)

    // Contest state errors
    case contestNotFound
    case contestLocked
    case contestFull
    case contestCancelled

    // Join errors
    case alreadyJoined
    case notAuthenticated
    case serverError(message: String)

    var errorDescription: String? {
        switch self {
        case .invalidToken:
            return "This invite link is invalid or malformed."
        case .tokenExpired:
            return "This invite link has expired."
        case .networkError(let underlying):
            return "Network error: \(underlying)"
        case .environmentMismatch(let expected, let actual):
            return "This link is for \(expected), but you're using the \(actual) app."
        case .contestNotFound:
            return "This contest could not be found."
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
        case .invalidToken, .tokenExpired:
            return "Invalid Link"
        case .networkError:
            return "Connection Error"
        case .environmentMismatch:
            return "Wrong App Version"
        case .contestNotFound:
            return "Contest Not Found"
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
