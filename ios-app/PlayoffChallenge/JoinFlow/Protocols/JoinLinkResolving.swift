//
//  JoinLinkResolving.swift
//  PlayoffChallenge
//
//  Protocol for resolving join tokens to contest details
//

import Foundation

/// Resolves a join token to contest details without requiring authentication.
/// Used for the initial deep link resolution before showing preview UI.
protocol JoinLinkResolving {
    /// Resolves a join token to contest details.
    /// - Parameter token: The join token from the universal link
    /// - Returns: Resolved join link details including contest info
    /// - Throws: JoinLinkError if resolution fails
    func resolve(token: String) async throws -> ResolvedJoinLink
}
