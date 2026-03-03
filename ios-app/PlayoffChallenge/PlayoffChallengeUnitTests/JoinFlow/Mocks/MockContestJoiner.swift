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
    var joinSystemResult: Result<ContestJoinResult, JoinLinkError>?
    var unjoinResult: Result<Void, APIError> = .success(())

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
            throw JoinLinkError.invalidToken
        }

        switch result {
        case .success(let joinResult):
            return joinResult
        case .failure(let error):
            throw error
        }
    }

    func joinSystemContest(contestId: UUID, userId: UUID) async throws -> ContestJoinResult {
        // Fall back to joinResult if joinSystemResult not configured
        let result = joinSystemResult ?? joinResult
        guard let result = result else {
            throw JoinLinkError.invalidToken
        }

        switch result {
        case .success(let joinResult):
            return joinResult
        case .failure(let error):
            throw error
        }
    }

    func unjoinContest(id: UUID) async throws {
        switch unjoinResult {
        case .success:
            return
        case .failure(let error):
            throw error
        }
    }

    func reset() {
        joinResult = nil
        joinSystemResult = nil
        unjoinResult = .success(())
        joinCalled = false
        joinContestId = nil
        joinToken = nil
        joinUserId = nil
    }
}
