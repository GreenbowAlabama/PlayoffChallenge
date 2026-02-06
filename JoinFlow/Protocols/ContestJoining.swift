//
//  ContestJoining.swift
//  PlayoffChallenge
//
//  Protocol for authenticated contest joining operations
//

import Foundation

/// Handles authenticated contest joining operations.
/// Requires user to be authenticated before calling.
protocol ContestJoining {
    /// Joins a contest using a previously resolved join token.
    /// - Parameters:
    ///   - token: The join token
    ///   - userId: The authenticated user's ID
    /// - Returns: Success confirmation with contest details
    /// - Throws: JoinLinkError if join fails
    func joinContest(token: String, userId: UUID) async throws -> ContestJoinResult
}
