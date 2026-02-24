//
//  PendingJoinStoring.swift
//  PlayoffChallenge
//
//  Protocol for storing pending join intent for resume after authentication
//

import Foundation

/// Stores and retrieves pending join intent for resume after authentication
protocol PendingJoinStoring {
    /// Stores a pending join token to resume after authentication
    func store(token: String)

    /// Retrieves and clears any pending join token
    /// - Returns: The pending token if one exists, nil otherwise
    func retrieve() -> String?

    /// Clears any pending join intent without returning it
    func clear()

    /// Whether there is a pending join intent
    var hasPendingJoin: Bool { get }
}
