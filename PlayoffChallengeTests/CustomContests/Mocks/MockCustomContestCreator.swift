import Foundation
@testable import PlayoffChallenge

/// Mock implementation of CustomContestCreating for tests.
final class MockCustomContestCreator: CustomContestCreating {
    // Configurable responses
    var createDraftResult: Result<CustomContestDraft, Error> = .failure(CustomContestError.networkError(underlying: "Not configured"))

    // Captured inputs for verification
    private(set) var createDraftCallCount = 0
    private(set) var lastCreateDraftName: String?
    private(set) var lastCreateDraftSettings: CustomContestSettings?
    private(set) var lastCreateDraftUserId: UUID?
    private(set) var lastCreateDraftLockTime: Date?

    func createDraft(
        name: String,
        settings: CustomContestSettings,
        userId: UUID,
        lockTime: Date?
    ) async throws -> CustomContestDraft {
        createDraftCallCount += 1
        lastCreateDraftName = name
        lastCreateDraftSettings = settings
        lastCreateDraftUserId = userId
        lastCreateDraftLockTime = lockTime

        switch createDraftResult {
        case .success(let draft):
            return draft
        case .failure(let error):
            throw error
        }
    }

    // Helper to configure a successful response
    func configureSuccess(draft: CustomContestDraft) {
        createDraftResult = .success(draft)
    }

    // Helper to configure a failure response
    func configureFailure(error: CustomContestError) {
        createDraftResult = .failure(error)
    }

    func reset() {
        createDraftCallCount = 0
        lastCreateDraftName = nil
        lastCreateDraftSettings = nil
        lastCreateDraftUserId = nil
        lastCreateDraftLockTime = nil
        createDraftResult = .failure(CustomContestError.networkError(underlying: "Not configured"))
    }
}
