import Foundation
@testable import PlayoffChallenge

/// Mock implementation of CustomContestPublishing for tests.
final class MockCustomContestPublisher: CustomContestPublishing {
    // Configurable responses
    var publishResult: Result<PublishContestResult, Error> = .failure(CustomContestError.networkError(underlying: "Not configured"))

    // Captured inputs for verification
    private(set) var publishCallCount = 0
    private(set) var lastPublishContestId: UUID?
    private(set) var lastPublishUserId: UUID?

    func publish(
        contestId: UUID,
        userId: UUID
    ) async throws -> PublishContestResult {
        publishCallCount += 1
        lastPublishContestId = contestId
        lastPublishUserId = userId

        switch publishResult {
        case .success(let result):
            return result
        case .failure(let error):
            throw error
        }
    }

    // Helper to configure a successful response
    func configureSuccess(result: PublishContestResult) {
        publishResult = .success(result)
    }

    // Helper to configure a failure response
    func configureFailure(error: CustomContestError) {
        publishResult = .failure(error)
    }

    func reset() {
        publishCallCount = 0
        lastPublishContestId = nil
        lastPublishUserId = nil
        publishResult = .failure(CustomContestError.networkError(underlying: "Not configured"))
    }
}
