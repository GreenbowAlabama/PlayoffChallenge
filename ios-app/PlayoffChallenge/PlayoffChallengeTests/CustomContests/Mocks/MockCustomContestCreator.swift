import Foundation
@testable import PlayoffChallenge

/// Mock implementation of CustomContestCreating for tests.
final class MockCustomContestCreator: CustomContestCreating {
    // Configurable responses
    var loadTemplatesResult: Result<[ContestTemplate], Error> = .success([])
    var createDraftResult: Result<CustomContestDraft, Error> = .failure(CustomContestError.networkError(underlying: "Not configured"))

    // Captured inputs for verification
    private(set) var loadTemplatesCallCount = 0
    private(set) var createDraftCallCount = 0
    private(set) var lastCreateDraftTemplateId: UUID?
    private(set) var lastCreateDraftName: String?
    private(set) var lastCreateDraftSettings: CustomContestSettings?
    private(set) var lastCreateDraftPayoutStructure: PayoutStructure?
    private(set) var lastCreateDraftUserId: UUID?
    private(set) var lastCreateDraftLockTime: Date?

    func loadTemplates() async throws -> [ContestTemplate] {
        loadTemplatesCallCount += 1
        return try loadTemplatesResult.get()
    }

    func createDraft(
        templateId: UUID,
        name: String,
        settings: CustomContestSettings,
        payoutStructure: PayoutStructure,
        userId: UUID,
        lockTime: Date?
    ) async throws -> CustomContestDraft {
        createDraftCallCount += 1
        lastCreateDraftTemplateId = templateId
        lastCreateDraftName = name
        lastCreateDraftSettings = settings
        lastCreateDraftPayoutStructure = payoutStructure
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
        loadTemplatesCallCount = 0
        createDraftCallCount = 0
        lastCreateDraftTemplateId = nil
        lastCreateDraftName = nil
        lastCreateDraftSettings = nil
        lastCreateDraftPayoutStructure = nil
        lastCreateDraftUserId = nil
        lastCreateDraftLockTime = nil
        loadTemplatesResult = .success([])
        createDraftResult = .failure(CustomContestError.networkError(underlying: "Not configured"))
    }
}
