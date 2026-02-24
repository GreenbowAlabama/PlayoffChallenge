//
//  ContestDetailViewModelTests.swift
//  PlayoffChallengeTests
//
//  Tests for ContestDetailViewModel.
//  Validates that all UI state derives from backend contract only.
//  No local joined authority. No isJoined property. No persistence.
//

import XCTest
@testable import PlayoffChallenge

@MainActor
final class ContestDetailViewModelTests: XCTestCase {

    private let testUserId = UUID()

    // MARK: - Helpers

    @MainActor
    private func makeSUT(
        contest: MockContest? = nil,
        detailResult: Result<MockContest, Error>? = nil,
        contractResult: Result<ContestDetailResponseContract, Error>? = nil,
        configureUser: Bool = false
    ) -> (vm: ContestDetailViewModel, fetcher: MockContestDetailFetcher) {
        let testContest = contest ?? .fixture()
        let testDetailResult = detailResult ?? .success(.fixture())
        let testContractResult = contractResult ?? .success(.fixture())

        let fetcher = MockContestDetailFetcher(
            detailResult: testDetailResult,
            contractResult: testContractResult
        )
        let vm = ContestDetailViewModel(
            contestId: testContest.id,
            placeholder: testContest,
            contestJoiner: MockContestJoiner.success(),
            detailFetcher: fetcher,
            getCurrentUserId: configureUser ? { self.testUserId } : { nil }
        )
        return (vm, fetcher)
    }

    // MARK: - Initial State Tests

    @MainActor
    func test_initialState_reflectsPlaceholder() {
        let contest = MockContest.fixture(name: "Test Contest")
        let (vm, _) = makeSUT(contest: contest)

        XCTAssertEqual(vm.contest.name, "Test Contest")
        XCTAssertFalse(vm.isLoading)
        XCTAssertFalse(vm.isJoining)
        XCTAssertNil(vm.errorMessage)
    }

    // MARK: - Contract-Driven Join Capability Tests

    @MainActor
    func test_canJoinContest_whenCanJoinActionTrue() async {
        let contract = ContestDetailResponseContract.fixture(
            actions: ContestActions.fixture(can_join: true)
        )
        let (vm, _) = makeSUT(contractResult: .success(contract))

        await vm.fetchContestDetail()

        XCTAssertTrue(vm.canJoinContest)
    }

    @MainActor
    func test_canJoinContest_whenCanJoinActionFalse() async {
        let contract = ContestDetailResponseContract.fixture(
            actions: ContestActions.fixture(can_join: false)
        )
        let (vm, _) = makeSUT(contractResult: .success(contract))

        await vm.fetchContestDetail()

        XCTAssertFalse(vm.canJoinContest)
    }

    @MainActor
    func test_canJoinContest_whenNoContract() async {
        let (vm, _) = makeSUT(contractResult: .failure(NSError(domain: "test", code: -1)))

        XCTAssertFalse(vm.canJoinContest)
    }

    // MARK: - Contract-Driven Lineup Selection Tests

    @MainActor
    func test_canSelectLineup_whenCanEditEntryTrue() async {
        let contract = ContestDetailResponseContract.fixture(
            actions: ContestActions.fixture(can_edit_entry: true)
        )
        let (vm, _) = makeSUT(contractResult: .success(contract))

        await vm.fetchContestDetail()

        XCTAssertTrue(vm.canSelectLineup)
    }

    @MainActor
    func test_canSelectLineup_whenCanEditEntryFalse() async {
        let contract = ContestDetailResponseContract.fixture(
            actions: ContestActions.fixture(can_edit_entry: false)
        )
        let (vm, _) = makeSUT(contractResult: .success(contract))

        await vm.fetchContestDetail()

        XCTAssertFalse(vm.canSelectLineup)
    }

    @MainActor
    func test_canSelectLineup_whenNoContract() async {
        let (vm, _) = makeSUT(contractResult: .failure(NSError(domain: "test", code: -1)))

        XCTAssertFalse(vm.canSelectLineup)
    }

    // MARK: - Always-Available View Tests

    @MainActor
    func test_canAlwaysViewRules() {
        let (vm, _) = makeSUT()
        XCTAssertTrue(vm.canViewRules)
    }

    @MainActor
    func test_canAlwaysViewLeaderboard() {
        let (vm, _) = makeSUT()
        XCTAssertTrue(vm.canViewLeaderboard)
    }

    // MARK: - Join Button Title Tests (Contract-Driven)

    @MainActor
    func test_joinButtonTitle_whenCanJoinTrue() async {
        let contract = ContestDetailResponseContract.fixture(
            actions: ContestActions.fixture(can_join: true)
        )
        let (vm, _) = makeSUT(contractResult: .success(contract))

        await vm.fetchContestDetail()

        XCTAssertEqual(vm.joinButtonTitle, "Join Contest")
    }

    @MainActor
    func test_joinButtonTitle_whenCanJoinFalseAndCanEditTrue() async {
        let contract = ContestDetailResponseContract.fixture(
            actions: ContestActions.fixture(can_join: false, can_edit_entry: true)
        )
        let (vm, _) = makeSUT(contractResult: .success(contract))

        await vm.fetchContestDetail()

        XCTAssertEqual(vm.joinButtonTitle, "Joined")
    }

    @MainActor
    func test_joinButtonTitle_whenCanJoinFalseAndCanEditFalse() async {
        let contract = ContestDetailResponseContract.fixture(
            actions: ContestActions.fixture(can_join: false, can_edit_entry: false)
        )
        let (vm, _) = makeSUT(contractResult: .success(contract))

        await vm.fetchContestDetail()

        XCTAssertEqual(vm.joinButtonTitle, "Cannot Join")
    }

    @MainActor
    func test_joinButtonTitle_default_whenNoContract() {
        let (vm, _) = makeSUT()
        XCTAssertEqual(vm.joinButtonTitle, "Join Contest")
    }

    // MARK: - Status Message Tests (Contract-Driven)

    @MainActor
    func test_statusMessage_whenCanJoinTrue() async {
        let contract = ContestDetailResponseContract.fixture(
            actions: ContestActions.fixture(can_join: true, can_edit_entry: false)
        )
        let (vm, _) = makeSUT(contractResult: .success(contract))

        await vm.fetchContestDetail()

        XCTAssertEqual(vm.statusMessage, "Join this contest to select your lineup")
    }

    @MainActor
    func test_statusMessage_whenCanEditTrue() async {
        let contract = ContestDetailResponseContract.fixture(
            actions: ContestActions.fixture(can_edit_entry: true)
        )
        let (vm, _) = makeSUT(contractResult: .success(contract))

        await vm.fetchContestDetail()

        XCTAssertNil(vm.statusMessage)
    }

    @MainActor
    func test_statusMessage_whenClosedAndCannotJoin() async {
        let contract = ContestDetailResponseContract.fixture(
            actions: ContestActions.fixture(can_join: false, is_closed: true)
        )
        let (vm, _) = makeSUT(contractResult: .success(contract))

        await vm.fetchContestDetail()

        XCTAssertEqual(vm.statusMessage, "This contest is closed")
    }

    @MainActor
    func test_statusMessage_nil_whenNoContract() {
        let (vm, _) = makeSUT()
        XCTAssertNil(vm.statusMessage)
    }

    // MARK: - Display Status Tests

    @MainActor
    func test_displayStatusMessage_reflectsContestStatus() {
        let scheduled = MockContest.fixture(status: .scheduled)
        let locked = MockContest.fixture(status: .locked)
        let complete = MockContest.fixture(status: .complete)

        let (vm1, _) = makeSUT(contest: scheduled)
        let (vm2, _) = makeSUT(contest: locked)
        let (vm3, _) = makeSUT(contest: complete)

        XCTAssertEqual(vm1.displayStatusMessage, "Scheduled")
        XCTAssertEqual(vm2.displayStatusMessage, "Locked")
        XCTAssertEqual(vm3.displayStatusMessage, "Complete")
    }

    // MARK: - Error Handling Tests

    @MainActor
    func test_joinContest_failure_noUserId_setsError() async {
        let (vm, _) = makeSUT(configureUser: false)

        await vm.joinContest()

        XCTAssertEqual(vm.errorMessage, "Please sign in to join this contest.")
    }

    @MainActor
    func test_clearError_resetsErrorMessage() {
        let (vm, _) = makeSUT()
        vm.clearError()
        XCTAssertNil(vm.errorMessage)
    }

    // MARK: - Fetch and Refresh Tests

    @MainActor
    func test_fetchContestDetail_updatesContestFromBackend() async {
        let fetched = MockContest.fixture(name: "Fetched Contest")
        let (vm, _) = makeSUT(detailResult: .success(fetched))

        await vm.fetchContestDetail()

        XCTAssertEqual(vm.contest.name, "Fetched Contest")
    }

    @MainActor
    func test_fetchContestDetail_updatesContractFromBackend() async {
        let contract = ContestDetailResponseContract.fixture(
            actions: ContestActions.fixture(can_join: true)
        )
        let (vm, _) = makeSUT(contractResult: .success(contract))

        await vm.fetchContestDetail()

        XCTAssertNotNil(vm.contractContest)
        XCTAssertTrue(vm.contractContest?.actions.can_join ?? false)
    }

    @MainActor
    func test_refresh_updatesDataFromBackend() async {
        let fetched = MockContest.fixture(name: "Refreshed Contest")
        let (vm, _) = makeSUT(detailResult: .success(fetched))

        await vm.refresh()

        XCTAssertEqual(vm.contest.name, "Refreshed Contest")
    }

    // MARK: - Entry Fee Tests

    @MainActor
    func test_formattedEntryFee_paidContest() {
        let contest = MockContest.fixture(entryFee: 50.0)
        XCTAssertEqual(contest.formattedEntryFee, "$50.00")
    }

    @MainActor
    func test_formattedEntryFee_freeContest() {
        let contest = MockContest.fixture(entryFee: 0.0)
        XCTAssertEqual(contest.formattedEntryFee, "Free")
    }

    // MARK: - Formatted Lock Time Tests

    @MainActor
    func test_formattedLockTime_producesValidString() {
        let (vm, _) = makeSUT()
        let date = Date()
        let formatted = vm.formattedLockTime(date)
        XCTAssertFalse(formatted.isEmpty)
    }
}
