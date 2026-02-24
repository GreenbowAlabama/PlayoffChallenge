//
//  MockContestJoiner.swift
//  PlayoffChallengeTests
//
//  Mock implementation of ContestJoining for testing
//

import Foundation
@testable import PlayoffChallenge

final class MockContestJoiner: ContestJoining {
    var joinResult: Result<ContestJoinResult, JoinLinkError>?
    var joinCalled = false
    var joinContestId: UUID?
    var joinToken: String?
    var joinUserId: UUID?

    func joinContest(contestId: UUID, token: String, userId: UUID) async throws -> ContestJoinResult {
        joinCalled = true
        joinContestId = contestId
        joinToken = token
        joinUserId = userId

        guard let result = joinResult else {
            fatalError("MockContestJoiner.joinResult not configured")
        }

        switch result {
        case .success(let joinResult):
            return joinResult
        case .failure(let error):
            throw error
        }
    }

    func reset() {
        joinResult = nil
        joinCalled = false
        joinContestId = nil
        joinToken = nil
        joinUserId = nil
    }
}
