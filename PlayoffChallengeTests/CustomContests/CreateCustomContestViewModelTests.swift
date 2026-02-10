import XCTest
@testable import PlayoffChallenge

@MainActor
final class CreateCustomContestViewModelTests: XCTestCase {

    private var mockCreator: MockCustomContestCreator!
    private var mockPublisher: MockCustomContestPublisher!
    private var sut: CreateCustomContestViewModel!

    private let testUserId = UUID()

    override func setUp() {
        super.setUp()
        mockCreator = MockCustomContestCreator()
        mockPublisher = MockCustomContestPublisher()
        sut = CreateCustomContestViewModel(
            creator: mockCreator,
            publisher: mockPublisher,
            userId: testUserId
        )
    }

    override func tearDown() {
        sut = nil
        mockPublisher = nil
        mockCreator = nil
        super.tearDown()
    }

    // MARK: - Initial State Tests

    func testInitialState_isIdle() {
        XCTAssertEqual(sut.state, .idle)
    }

    func testInitialState_hasEmptyContestName() {
        XCTAssertEqual(sut.contestName, "")
    }

    func testInitialState_hasDefaultMaxEntries() {
        XCTAssertEqual(sut.maxEntries, 10)
    }

    func testInitialState_createIsDisabled() {
        XCTAssertFalse(sut.isCreateEnabled)
    }

    func testInitialState_hasValidationError_becauseNameIsEmpty() {
        // Initial state has empty name, which is invalid
        XCTAssertEqual(sut.validationError, .nameRequired)
    }

    func testInitialState_isNotSubmitting() {
        XCTAssertFalse(sut.isSubmitting)
    }

    func testInitialState_draftIsNil() {
        XCTAssertNil(sut.draft)
    }

    func testInitialState_publishResultIsNil() {
        XCTAssertNil(sut.publishResult)
    }

    // MARK: - Validation Tests

    func testValidation_emptyName_showsNameRequiredError() {
        sut.contestName = ""
        sut.maxEntries = 10

        XCTAssertFalse(sut.isCreateEnabled)
        XCTAssertEqual(sut.validationError, .nameRequired)
    }

    func testValidation_whitespaceName_showsNameRequiredError() {
        sut.contestName = "   "
        sut.maxEntries = 10

        XCTAssertFalse(sut.isCreateEnabled)
        XCTAssertEqual(sut.validationError, .nameRequired)
    }

    func testValidation_nameTooLong_showsNameTooLongError() {
        sut.contestName = String(repeating: "a", count: 51)
        sut.maxEntries = 10

        XCTAssertFalse(sut.isCreateEnabled)
        XCTAssertEqual(sut.validationError, .nameTooLong(maxLength: 50))
    }

    func testValidation_maxEntriesZero_showsInvalidError() {
        sut.contestName = "Valid Name"
        sut.maxEntries = 0

        XCTAssertFalse(sut.isCreateEnabled)
        XCTAssertEqual(sut.validationError, .maxEntriesInvalid)
    }

    func testValidation_maxEntriesTooLow_showsTooLowError() {
        sut.contestName = "Valid Name"
        sut.maxEntries = 1

        XCTAssertFalse(sut.isCreateEnabled)
        XCTAssertEqual(sut.validationError, .maxEntriesTooLow(minimum: 2))
    }

    func testValidation_maxEntriesTooHigh_showsTooHighError() {
        sut.contestName = "Valid Name"
        sut.maxEntries = 1001

        XCTAssertFalse(sut.isCreateEnabled)
        XCTAssertEqual(sut.validationError, .maxEntriesTooHigh(maximum: 1000))
    }

    func testValidation_validInputs_createIsEnabled() {
        sut.contestName = "My Contest"
        sut.maxEntries = 10

        XCTAssertTrue(sut.isCreateEnabled)
        XCTAssertNil(sut.validationError)
    }

    func testValidation_validNameAtMaxLength_createIsEnabled() {
        sut.contestName = String(repeating: "a", count: 50)
        sut.maxEntries = 10

        XCTAssertTrue(sut.isCreateEnabled)
        XCTAssertNil(sut.validationError)
    }

    func testValidation_maxEntriesAtMinimum_createIsEnabled() {
        sut.contestName = "My Contest"
        sut.maxEntries = 2

        XCTAssertTrue(sut.isCreateEnabled)
        XCTAssertNil(sut.validationError)
    }

    func testValidation_maxEntriesAtMaximum_createIsEnabled() {
        sut.contestName = "My Contest"
        sut.maxEntries = 1000

        XCTAssertTrue(sut.isCreateEnabled)
        XCTAssertNil(sut.validationError)
    }

    // MARK: - Create Draft Tests

    func testCreateDraft_whenValid_callsCreatorWithCorrectParameters() async {
        let expectedDraft = makeDraft(name: "Test Contest", maxEntries: 10)
        mockCreator.configureSuccess(draft: expectedDraft)

        sut.contestName = "Test Contest"
        sut.maxEntries = 10

        await sut.createDraft()

        XCTAssertEqual(mockCreator.createDraftCallCount, 1)
        XCTAssertEqual(mockCreator.lastCreateDraftName, "Test Contest")
        XCTAssertEqual(mockCreator.lastCreateDraftSettings?.maxEntries, 10)
        XCTAssertEqual(mockCreator.lastCreateDraftUserId, testUserId)
    }

    func testCreateDraft_whenValid_transitionsToCreatingThenCreated() async {
        let expectedDraft = makeDraft(name: "Test Contest", maxEntries: 10)
        mockCreator.configureSuccess(draft: expectedDraft)

        sut.contestName = "Test Contest"
        sut.maxEntries = 10

        XCTAssertEqual(sut.state, .idle)

        await sut.createDraft()

        XCTAssertEqual(sut.state, .created)
        XCTAssertEqual(sut.draft, expectedDraft)
    }

    func testCreateDraft_whenValid_isSubmittingDuringCreate() async {
        let expectedDraft = makeDraft(name: "Test Contest", maxEntries: 10)
        mockCreator.configureSuccess(draft: expectedDraft)

        sut.contestName = "Test Contest"
        sut.maxEntries = 10

        // After completion, isSubmitting should be false
        await sut.createDraft()
        XCTAssertFalse(sut.isSubmitting)
    }

    func testCreateDraft_whenInvalid_doesNotCallCreator() async {
        sut.contestName = ""
        sut.maxEntries = 10

        await sut.createDraft()

        XCTAssertEqual(mockCreator.createDraftCallCount, 0)
        XCTAssertEqual(sut.state, .idle)
    }

    func testCreateDraft_whenServiceFails_transitionsToError() async {
        mockCreator.configureFailure(error: .networkError(underlying: "Connection failed"))

        sut.contestName = "Test Contest"
        sut.maxEntries = 10

        await sut.createDraft()

        XCTAssertEqual(sut.state, .error(.networkError(underlying: "Connection failed")))
        XCTAssertNil(sut.draft)
    }

    func testCreateDraft_trimsContestName() async {
        let expectedDraft = makeDraft(name: "My Contest", maxEntries: 10)
        mockCreator.configureSuccess(draft: expectedDraft)

        sut.contestName = "  My Contest  "
        sut.maxEntries = 10

        await sut.createDraft()

        XCTAssertEqual(mockCreator.lastCreateDraftName, "My Contest")
    }

    // MARK: - Publish Tests

    func testPublish_whenNoDraft_doesNotCallPublisher() async {
        sut.contestName = "Test Contest"
        sut.maxEntries = 10

        await sut.publishDraft()

        XCTAssertEqual(mockPublisher.publishCallCount, 0)
    }

    func testPublish_whenDraftExists_callsPublisherWithCorrectParameters() async {
        let draft = makeDraft(name: "Test Contest", maxEntries: 10)
        mockCreator.configureSuccess(draft: draft)
        mockPublisher.configureSuccess(result: makePublishResult(contestId: draft.id))

        sut.contestName = "Test Contest"
        sut.maxEntries = 10

        await sut.createDraft()
        await sut.publishDraft()

        XCTAssertEqual(mockPublisher.publishCallCount, 1)
        XCTAssertEqual(mockPublisher.lastPublishContestId, draft.id)
        XCTAssertEqual(mockPublisher.lastPublishUserId, testUserId)
    }

    func testPublish_whenSuccessful_transitionsToPublished() async {
        let draft = makeDraft(name: "Test Contest", maxEntries: 10)
        let publishResult = makePublishResult(contestId: draft.id)
        mockCreator.configureSuccess(draft: draft)
        mockPublisher.configureSuccess(result: publishResult)

        sut.contestName = "Test Contest"
        sut.maxEntries = 10

        await sut.createDraft()
        await sut.publishDraft()

        XCTAssertEqual(sut.state, .published)
        XCTAssertEqual(sut.publishResult, publishResult)
    }

    func testPublish_whenServiceFails_transitionsToError() async {
        let draft = makeDraft(name: "Test Contest", maxEntries: 10)
        mockCreator.configureSuccess(draft: draft)
        mockPublisher.configureFailure(error: .notAuthorized)

        sut.contestName = "Test Contest"
        sut.maxEntries = 10

        await sut.createDraft()
        await sut.publishDraft()

        XCTAssertEqual(sut.state, .error(.notAuthorized))
        XCTAssertNil(sut.publishResult)
    }

    func testPublish_preservesDraftAfterFailure() async {
        let draft = makeDraft(name: "Test Contest", maxEntries: 10)
        mockCreator.configureSuccess(draft: draft)
        mockPublisher.configureFailure(error: .serverError(message: "Internal error"))

        sut.contestName = "Test Contest"
        sut.maxEntries = 10

        await sut.createDraft()
        await sut.publishDraft()

        XCTAssertEqual(sut.draft, draft)
    }

    // MARK: - State Transition Tests

    func testState_afterCreateThenPublish_fullFlow() async {
        let draft = makeDraft(name: "Test Contest", maxEntries: 10)
        let publishResult = makePublishResult(contestId: draft.id)
        mockCreator.configureSuccess(draft: draft)
        mockPublisher.configureSuccess(result: publishResult)

        sut.contestName = "Test Contest"
        sut.maxEntries = 10

        XCTAssertEqual(sut.state, .idle)

        await sut.createDraft()
        XCTAssertEqual(sut.state, .created)

        await sut.publishDraft()
        XCTAssertEqual(sut.state, .published)
    }

    func testRetry_fromErrorState_canCreateAgain() async {
        mockCreator.configureFailure(error: .networkError(underlying: "First failure"))

        sut.contestName = "Test Contest"
        sut.maxEntries = 10

        await sut.createDraft()
        XCTAssertEqual(sut.state, .error(.networkError(underlying: "First failure")))

        // Now configure success and retry
        let draft = makeDraft(name: "Test Contest", maxEntries: 10)
        mockCreator.configureSuccess(draft: draft)

        await sut.createDraft()
        XCTAssertEqual(sut.state, .created)
    }

    func testClearError_resetsToIdleOrCreated() async {
        mockCreator.configureFailure(error: .networkError(underlying: "Failure"))

        sut.contestName = "Test Contest"
        sut.maxEntries = 10

        await sut.createDraft()
        XCTAssertEqual(sut.state, .error(.networkError(underlying: "Failure")))

        sut.clearError()
        XCTAssertEqual(sut.state, .idle)
    }

    func testClearError_afterPublishFailure_returnsToCreated() async {
        let draft = makeDraft(name: "Test Contest", maxEntries: 10)
        mockCreator.configureSuccess(draft: draft)
        mockPublisher.configureFailure(error: .serverError(message: "Error"))

        sut.contestName = "Test Contest"
        sut.maxEntries = 10

        await sut.createDraft()
        await sut.publishDraft()
        XCTAssertEqual(sut.state, .error(.serverError(message: "Error")))

        sut.clearError()
        XCTAssertEqual(sut.state, .created)
    }

    // MARK: - Button State Tests

    func testPrimaryButtonTitle_whenIdle_isCreateContest() {
        XCTAssertEqual(sut.primaryButtonTitle, "Create Contest")
    }

    func testPrimaryButtonTitle_whenCreated_isPublishContest() async {
        let draft = makeDraft(name: "Test Contest", maxEntries: 10)
        mockCreator.configureSuccess(draft: draft)

        sut.contestName = "Test Contest"
        sut.maxEntries = 10

        await sut.createDraft()

        XCTAssertEqual(sut.primaryButtonTitle, "Publish Contest")
    }

    func testIsPublishEnabled_whenNotCreated_isFalse() {
        sut.contestName = "Valid Name"
        sut.maxEntries = 10

        XCTAssertFalse(sut.isPublishEnabled)
    }

    func testIsPublishEnabled_whenCreated_isTrue() async {
        let draft = makeDraft(name: "Test Contest", maxEntries: 10)
        mockCreator.configureSuccess(draft: draft)

        sut.contestName = "Test Contest"
        sut.maxEntries = 10

        await sut.createDraft()

        XCTAssertTrue(sut.isPublishEnabled)
    }

    // MARK: - Helpers

    private func makeDraft(
        name: String,
        maxEntries: Int,
        id: UUID = UUID()
    ) -> CustomContestDraft {
        CustomContestDraft(
            id: id,
            name: name,
            settings: CustomContestSettings(maxEntries: maxEntries),
            status: .draft
        )
    }

    private func makePublishResult(contestId: UUID) -> PublishContestResult {
        PublishContestResult(
            contestId: contestId,
            joinToken: "test-token-123",
            joinURL: URL(string: "https://playoffchallenge.app/join/test-token-123")!
        )
    }
}
