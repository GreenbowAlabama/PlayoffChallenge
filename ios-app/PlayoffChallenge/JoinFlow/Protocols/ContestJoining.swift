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
    /// For private contests with explicit share tokens.
    /// - Parameters:
    ///   - contestId: The contest instance ID
    ///   - token: The join token (required)
    ///   - userId: The authenticated user's ID
    /// - Returns: Success confirmation with contest details
    /// - Throws: JoinLinkError if join fails
    func joinContest(contestId: UUID, token: String, userId: UUID) async throws -> ContestJoinResult

    /// Joins a system contest by ID (no token required).
    /// For contests where join_token is nil and server controls access via actions.can_join.
    /// - Parameters:
    ///   - contestId: The contest instance ID
    ///   - userId: The authenticated user's ID
    /// - Returns: Success confirmation with contest details
    /// - Throws: JoinLinkError if join fails
    func joinSystemContest(contestId: UUID, userId: UUID) async throws -> ContestJoinResult
}
