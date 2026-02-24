//
//  ContestDetailViewModelTests.swift
//  PlayoffChallengeTests
//
//  Unit tests for ContestDetailViewModel.
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
    func test_initialState_reflectsContest() {
        let contest = MockContest.fixture(name: "Test Contest", isJoined: false)
        let (vm, _) = makeSUT(contest: contest)

        XCTAssertEqual(vm.contest.name, "Test Contest")
        XCTAssertFalse(vm.isLoading)
        XCTAssertFalse(vm.isJoining)
        XCTAssertNil(vm.errorMessage)
    }

    // MARK: - Join Capability Tests

    @MainActor
    func test_canJoinContest_whenCanJoinAction() async {
        let contest = MockContest.fixture(status: .scheduled, isJoined: false)
        let contract = ContestDetailResponseContract.fixture(
            actions: ContestActions.fixture(can_join: true)
        )
        let (vm, _) = makeSUT(contest: contest, contractResult: .success(contract))

        await vm.fetchContestDetail()

        XCTAssertTrue(vm.canJoinContest)
    }

    @MainActor
    func test_cannotJoinContest_whenCannotJoinAction() async {
        let contest = MockContest.fixture(isJoined: true)
        let contract = ContestDetailResponseContract.fixture(
            actions: ContestActions.fixture(can_join: false)
        )
        let (vm, _) = makeSUT(contest: contest, contractResult: .success(contract))

        await vm.fetchContestDetail()

        XCTAssertFalse(vm.canJoinContest)
    }

    @MainActor
    func test_cannotJoinContest_whenLocked() async {
        let contract = ContestDetailResponseContract.fixture(
            actions: ContestActions.fixture(can_join: false)
        )
        let (vm, _) = makeSUT(
            contest: MockContest.fixture(status: .locked),
            contractResult: .success(contract)
        )

        await vm.fetchContestDetail()

        XCTAssertFalse(vm.canJoinContest)
    }

    @MainActor
    func test_cannotJoinContest_whenFull() async {
        let contest = MockContest.fixture(
            entryCount: 20,
            maxEntries: 20,
            status: .scheduled,
            isJoined: false
        )
        let contract = ContestDetailResponseContract.fixture(
            actions: ContestActions.fixture(can_join: false)
        )
        let (vm, _) = makeSUT(contest: contest, contractResult: .success(contract))

        await vm.fetchContestDetail()

        XCTAssertFalse(vm.canJoinContest)
    }

    // MARK: - Action Availability Tests

    @MainActor
    func test_canSelectLineup_whenCanEditAction() async {
        let contest = MockContest.fixture(status: .scheduled, isJoined: true)
        let contract = ContestDetailResponseContract.fixture(
            actions: ContestActions.fixture(can_edit_entry: true)
        )
        let (vm, _) = makeSUT(contest: contest, contractResult: .success(contract))

        await vm.fetchContestDetail()

        XCTAssertTrue(vm.canSelectLineup)
    }

    @MainActor
    func test_cannotSelectLineup_whenCannotEditAction() async {
        let contest = MockContest.fixture(isJoined: false)
        let contract = ContestDetailResponseContract.fixture(
            actions: ContestActions.fixture(can_edit_entry: false)
        )
        let (vm, _) = makeSUT(contest: contest, contractResult: .success(contract))

        await vm.fetchContestDetail()

        XCTAssertFalse(vm.canSelectLineup)
    }

    @MainActor
    func test_cannotSelectLineup_whenNoContract() async {
        let contest = MockContest.fixture(status: .complete, isJoined: true)
        let (vm, _) = makeSUT(contest: contest)

        XCTAssertFalse(vm.canSelectLineup)
    }

    @MainActor
    func test_canAlwaysViewRules() {
        let notJoined = MockContest.fixture(isJoined: false)
        let joined = MockContest.fixture(isJoined: true)

        let (vm1, _) = makeSUT(contest: notJoined)
        let (vm2, _) = makeSUT(contest: joined)

        XCTAssertTrue(vm1.canViewRules)
        XCTAssertTrue(vm2.canViewRules)
    }

    @MainActor
    func test_canAlwaysViewLeaderboard() {
        let notJoined = MockContest.fixture(isJoined: false)
        let joined = MockContest.fixture(isJoined: true)

        let (vm1, _) = makeSUT(contest: notJoined)
        let (vm2, _) = makeSUT(contest: joined)

        XCTAssertTrue(vm1.canViewLeaderboard)
        XCTAssertTrue(vm2.canViewLeaderboard)
    }

    // MARK: - Join Button Title Tests

    @MainActor
    func test_joinButtonTitle_whenCanEditEntry() async {
        let contest = MockContest.fixture(isJoined: true)
        let contract = ContestDetailResponseContract.fixture(
            actions: ContestActions.fixture(can_join: false, can_edit_entry: true)
        )
        let (vm, _) = makeSUT(contest: contest, contractResult: .success(contract))

        await vm.fetchContestDetail()

        XCTAssertEqual(vm.joinButtonTitle, "Joined")
    }

    @MainActor
    func test_joinButtonTitle_whenCannotJoin() async {
        let contest = MockContest.fixture(isJoined: false)
        let contract = ContestDetailResponseContract.fixture(
            actions: ContestActions.fixture(can_join: false, can_edit_entry: false)
        )
        let (vm, _) = makeSUT(contest: contest, contractResult: .success(contract))

        await vm.fetchContestDetail()

        XCTAssertEqual(vm.joinButtonTitle, "Cannot Join")
    }

    @MainActor
    func test_joinButtonTitle_whenCanJoin() async {
        let contest = MockContest.fixture(status: .scheduled, isJoined: false)
        let contract = ContestDetailResponseContract.fixture(
            actions: ContestActions.fixture(can_join: true, can_edit_entry: false)
        )
        let (vm, _) = makeSUT(contest: contest, contractResult: .success(contract))

        await vm.fetchContestDetail()

        XCTAssertEqual(vm.joinButtonTitle, "Join Contest")
    }

    // MARK: - Status Message Tests

    @MainActor
    func test_statusMessage_whenCanJoin() async {
        let contest = MockContest.fixture(status: .scheduled, isJoined: false)
        let contract = ContestDetailResponseContract.fixture(
            actions: ContestActions.fixture(can_join: true, can_edit_entry: false)
        )
        let (vm, _) = makeSUT(contest: contest, contractResult: .success(contract))

        await vm.fetchContestDetail()

        XCTAssertEqual(vm.statusMessage, "Join this contest to select your lineup")
    }

    @MainActor
    func test_statusMessage_whenClosed() async {
        let contest = MockContest.fixture(isJoined: false)
        let contract = ContestDetailResponseContract.fixture(
            actions: ContestActions.fixture(can_join: false, is_closed: true)
        )
        let (vm, _) = makeSUT(contest: contest, contractResult: .success(contract))

        await vm.fetchContestDetail()

        XCTAssertEqual(vm.statusMessage, "This contest is closed")
    }

    @MainActor
    func test_statusMessage_nil_whenCanEditEntry() async {
        let contest = MockContest.fixture(isJoined: true)
        let contract = ContestDetailResponseContract.fixture(
            actions: ContestActions.fixture(can_edit_entry: true)
        )
        let (vm, _) = makeSUT(contest: contest, contractResult: .success(contract))

        await vm.fetchContestDetail()

        XCTAssertNil(vm.statusMessage)
    }

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

    // MARK: - Join Action Tests

    @MainActor
    func test_joinContest_failure_noUserId_setsError() async {
        let contest = MockContest.fixture(isJoined: false)
        let (vm, _) = makeSUT(contest: contest, configureUser: false)

        await vm.joinContest()

        XCTAssertEqual(vm.errorMessage, "Please sign in to join this contest.")
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

    // MARK: - Error Handling Tests

    @MainActor
    func test_clearError_resetsErrorMessage() {
        let (vm, _) = makeSUT()
        vm.clearError()
        XCTAssertNil(vm.errorMessage)
    }
}
}
