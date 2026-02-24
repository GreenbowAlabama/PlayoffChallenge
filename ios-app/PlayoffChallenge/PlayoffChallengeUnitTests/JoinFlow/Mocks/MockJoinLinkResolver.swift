//
//  MockJoinLinkResolver.swift
//  PlayoffChallengeTests
//
//  Mock implementation of JoinLinkResolving for testing
//

import Foundation
@testable import PlayoffChallenge

final class MockJoinLinkResolver: JoinLinkResolving {
    var resolveResult: Result<ResolvedJoinLink, JoinLinkError>?
    var resolveCalled = false
    var resolveToken: String?

    func resolve(token: String) async throws -> ResolvedJoinLink {
        resolveCalled = true
        resolveToken = token

        guard let result = resolveResult else {
            fatalError("MockJoinLinkResolver.resolveResult not configured")
        }

        switch result {
        case .success(let link):
            return link
        case .failure(let error):
            throw error
        }
    }

    func reset() {
        resolveResult = nil
        resolveCalled = false
        resolveToken = nil
    }
}
