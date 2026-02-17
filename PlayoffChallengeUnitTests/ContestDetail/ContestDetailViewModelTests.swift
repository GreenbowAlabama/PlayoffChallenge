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
    ) -> (vm: ContestDetailViewModel, fetcher: MockContestDetailFetcher, store: MockJoinedStore) {
        let testContest = contest ?? .fixture()
        let testDetailResult = detailResult ?? .success(.fixture())
        let testContractResult = contractResult ?? .success(.fixture())

        let store = MockJoinedStore()
        let fetcher = MockContestDetailFetcher(
            detailResult: testDetailResult,
            contractResult: testContractResult
        )
        let vm = ContestDetailViewModel(
            contestId: testContest.id,
            placeholder: testContest,
            contestJoiner: MockContestJoiner.success(),
            detailFetcher: fetcher,
            joinedStore: store,
            getCurrentUserId: configureUser ? { self.testUserId } : { nil }
        )
        return (vm, fetcher, store)
    }

    // MARK: - Initial State Tests

    @MainActor
    func test_initialState_reflectsContest() {
        let contest = MockContest.fixture(name: "Test Contest", isJoined: false)
        let (vm, _, _) = makeSUT(contest: contest)

        XCTAssertEqual(vm.contest.name, "Test Contest")
        XCTAssertFalse(vm.isJoined)
        XCTAssertFalse(vm.isLoading)
        XCTAssertFalse(vm.isJoining)
        XCTAssertNil(vm.errorMessage)
    }

    @MainActor
    func test_initialState_marksJoinedWhenAlreadyJoined() {
        let contest = MockContest.fixture(isJoined: true)
        let (vm, _, _) = makeSUT(contest: contest)

        XCTAssertTrue(vm.isJoined)
    }

    // MARK: - Join Capability Tests

    @MainActor
    func test_canJoinContest_whenNotJoinedAndOpen() async {
        let contest = MockContest.fixture(status: .scheduled, isJoined: false)
        let (vm, _, _) = makeSUT(contest: contest)

        await vm.fetchContestDetail()

        XCTAssertTrue(vm.canJoinContest)
    }

    @MainActor
    func test_cannotJoinContest_whenAlreadyJoined() async {
        let contest = MockContest.fixture(isJoined: true)
        let (vm, _, _) = makeSUT(contest: contest)
        vm.updateIsJoinedState(true)

        await vm.fetchContestDetail()

        XCTAssertFalse(vm.canJoinContest)
    }

    @MainActor
    func test_cannotJoinContest_whenLocked() async {
        let contract = ContestDetailResponseContract.fixture(
            actions: ContestActions.fixture(can_join: false)
        )
        let (vm, _, _) = makeSUT(
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
        let (vm, _, _) = makeSUT(contest: contest, contractResult: .success(contract))

        await vm.fetchContestDetail()

        XCTAssertFalse(vm.canJoinContest)
    }

    // MARK: - Action Availability Tests

    @MainActor
    func test_canSelectLineup_whenJoined() async {
        let contest = MockContest.fixture(status: .scheduled, isJoined: true)
        let (vm, _, _) = makeSUT(contest: contest)
        vm.updateIsJoinedState(true)

        await vm.fetchContestDetail()

        XCTAssertTrue(vm.canSelectLineup)
    }

    @MainActor
    func test_cannotSelectLineup_whenNotJoined() async {
        let contest = MockContest.fixture(isJoined: false)
        let (vm, _, _) = makeSUT(contest: contest)

        await vm.fetchContestDetail()

        XCTAssertFalse(vm.canSelectLineup)
    }

    @MainActor
    func test_cannotSelectLineup_whenCompletedEvenIfJoined() async {
        let contest = MockContest.fixture(status: .complete, isJoined: true)
        let contract = ContestDetailResponseContract.fixture(
            leaderboard_state: .computed,
            actions: ContestActions.fixture(can_edit_entry: false)
        )
        let (vm, _, _) = makeSUT(contest: contest, contractResult: .success(contract))
        vm.updateIsJoinedState(true)

        await vm.fetchContestDetail()

        XCTAssertFalse(vm.canSelectLineup)
    }

    @MainActor
    func test_canAlwaysViewRules() {
        let notJoined = MockContest.fixture(isJoined: false)
        let joined = MockContest.fixture(isJoined: true)

        let (vm1, _, _) = makeSUT(contest: notJoined)
        let (vm2, _, _) = makeSUT(contest: joined)

        XCTAssertTrue(vm1.canViewRules)
        XCTAssertTrue(vm2.canViewRules)
    }

    @MainActor
    func test_canAlwaysViewLeaderboard() {
        let notJoined = MockContest.fixture(isJoined: false)
        let joined = MockContest.fixture(isJoined: true)

        let (vm1, _, _) = makeSUT(contest: notJoined)
        let (vm2, _, _) = makeSUT(contest: joined)

        XCTAssertTrue(vm1.canViewLeaderboard)
        XCTAssertTrue(vm2.canViewLeaderboard)
    }

    // MARK: - Join Button Title Tests

    @MainActor
    func test_joinButtonTitle_whenJoined() async {
        let contest = MockContest.fixture(isJoined: true)
        let (vm, _, _) = makeSUT(contest: contest)
        vm.updateIsJoinedState(true)

        await vm.fetchContestDetail()

        XCTAssertEqual(vm.joinButtonTitle, "Joined")
    }

    @MainActor
    func test_joinButtonTitle_whenCannotJoin() async {
        let contest = MockContest.fixture(isJoined: false)
        let contract = ContestDetailResponseContract.fixture(
            actions: ContestActions.fixture(can_join: false)
        )
        let (vm, _, _) = makeSUT(contest: contest, contractResult: .success(contract))

        await vm.fetchContestDetail()

        XCTAssertEqual(vm.joinButtonTitle, "Cannot Join")
    }

    @MainActor
    func test_joinButtonTitle_whenCanJoin() async {
        let contest = MockContest.fixture(status: .scheduled, isJoined: false)
        let contract = ContestDetailResponseContract.fixture(
            actions: ContestActions.fixture(can_join: true)
        )
        let (vm, _, _) = makeSUT(contest: contest, contractResult: .success(contract))

        await vm.fetchContestDetail()

        XCTAssertEqual(vm.joinButtonTitle, "Join Contest")
    }

    // MARK: - Status Message Tests

    @MainActor
    func test_statusMessage_whenCanJoin() async {
        let contest = MockContest.fixture(status: .scheduled, isJoined: false)
        let contract = ContestDetailResponseContract.fixture(
            actions: ContestActions.fixture(can_join: true)
        )
        let (vm, _, _) = makeSUT(contest: contest, contractResult: .success(contract))

        await vm.fetchContestDetail()

        XCTAssertEqual(vm.statusMessage, "Join this contest to select your lineup")
    }

    @MainActor
    func test_statusMessage_whenClosed() async {
        let contest = MockContest.fixture(isJoined: false)
        let contract = ContestDetailResponseContract.fixture(
            actions: ContestActions.fixture(can_join: false, is_closed: true)
        )
        let (vm, _, _) = makeSUT(contest: contest, contractResult: .success(contract))

        await vm.fetchContestDetail()

        XCTAssertEqual(vm.statusMessage, "This contest is closed")
    }

    @MainActor
    func test_statusMessage_nil_whenJoined() async {
        let contest = MockContest.fixture(isJoined: true)
        let (vm, _, _) = makeSUT(contest: contest)
        vm.updateIsJoinedState(true)

        await vm.fetchContestDetail()

        XCTAssertNil(vm.statusMessage)
    }

    @MainActor
    func test_displayStatusMessage_reflectsContestStatus() {
        let scheduled = MockContest.fixture(status: .scheduled)
        let locked = MockContest.fixture(status: .locked)
        let complete = MockContest.fixture(status: .complete)

        let (vm1, _, _) = makeSUT(contest: scheduled)
        let (vm2, _, _) = makeSUT(contest: locked)
        let (vm3, _, _) = makeSUT(contest: complete)

        XCTAssertEqual(vm1.displayStatusMessage, "Scheduled")
        XCTAssertEqual(vm2.displayStatusMessage, "Locked")
        XCTAssertEqual(vm3.displayStatusMessage, "Complete")
    }

    // MARK: - Join Action Tests

    @MainActor
    func test_joinContest_success_setsJoinedState() async {
        let contest = MockContest.fixture(isJoined: false)
        let (vm, _, store) = makeSUT(contest: contest, configureUser: true)

        await vm.joinContest()

        XCTAssertTrue(vm.isJoined)
        XCTAssertNil(vm.errorMessage)
    }

    @MainActor
    func test_joinContest_failure_noUserId_setsError() async {
        let contest = MockContest.fixture(isJoined: false)
        let (vm, _, _) = makeSUT(contest: contest, configureUser: false)

        await vm.joinContest()

        XCTAssertFalse(vm.isJoined)
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
        let (vm, _, _) = makeSUT()
        vm.clearError()
        XCTAssertNil(vm.errorMessage)
    }

    // MARK: - Join Persistence Tests (KEY TESTS)

    @MainActor
    func test_joinContest_updatesIsJoinedState() async {
        let contestId = UUID()
        let contest = MockContest.fixture(id: contestId, isJoined: false)
        let (vm, _, _) = makeSUT(contest: contest, configureUser: true)

        await vm.joinContest()

        XCTAssertTrue(vm.isJoined)
    }

    @MainActor
    func test_joinState_persistsAcrossViewModelRecreation() async {
        let contestId = UUID()
        let contest1 = MockContest.fixture(id: contestId, isJoined: false)

        // First VM joins
        let (vm1, fetcher1, store1) = makeSUT(contest: contest1, configureUser: true)
        await vm1.joinContest()
        XCTAssertTrue(vm1.isJoined)

        // Second VM for same contest
        let contest2 = MockContest.fixture(id: contestId, isJoined: false)
        let vm2 = ContestDetailViewModel(
            contestId: contestId,
            placeholder: contest2,
            contestJoiner: MockContestJoiner.success(),
            detailFetcher: fetcher1,
            joinedStore: store1,
            getCurrentUserId: { self.testUserId }
        )

        // Check if joined via store
        let isJoinedInStore = store1.isJoined(contestId: contestId)
        XCTAssertTrue(isJoinedInStore)
    }

    @MainActor
    func test_initialization_withJoinedContest() {
        let contest = MockContest.fixture(isJoined: true)
        let (vm, _, _) = makeSUT(contest: contest)

        XCTAssertTrue(vm.isJoined)
    }

    @MainActor
    func test_refresh_preservesJoinedState() async {
        let contest = MockContest.fixture(isJoined: false)
        let (vm, _, _) = makeSUT(contest: contest, configureUser: true)

        await vm.joinContest()
        XCTAssertTrue(vm.isJoined)

        await vm.refresh()

        XCTAssertTrue(vm.isJoined)
    }

    @MainActor
    func test_multipleViewModels_shareJoinedState() async {
        let contestId = UUID()
        let contest = MockContest.fixture(id: contestId, isJoined: false)
        let (vm1, fetcher, store) = makeSUT(contest: contest, configureUser: true)

        await vm1.joinContest()
        XCTAssertTrue(vm1.isJoined)

        let vm2 = ContestDetailViewModel(
            contestId: contestId,
            placeholder: contest,
            contestJoiner: MockContestJoiner.success(),
            detailFetcher: fetcher,
            joinedStore: store,
            getCurrentUserId: { self.testUserId }
        )

        let isJoined = store.isJoined(contestId: contestId)
        XCTAssertTrue(isJoined)
    }

    @MainActor
    func test_joinedState_consistentAcrossNavigationCycles() async {
        let contestId = UUID()
        let contest = MockContest.fixture(id: contestId, isJoined: false)
        let (vm1, fetcher, store) = makeSUT(contest: contest, configureUser: true)

        await vm1.joinContest()
        XCTAssertTrue(vm1.isJoined)

        let vm2 = ContestDetailViewModel(
            contestId: contestId,
            placeholder: contest,
            contestJoiner: MockContestJoiner.success(),
            detailFetcher: fetcher,
            joinedStore: store,
            getCurrentUserId: { self.testUserId }
        )

        let vm3 = ContestDetailViewModel(
            contestId: contestId,
            placeholder: contest,
            contestJoiner: MockContestJoiner.success(),
            detailFetcher: fetcher,
            joinedStore: store,
            getCurrentUserId: { self.testUserId }
        )

        let vm2Joined = store.isJoined(contestId: contestId)
        let vm3Joined = store.isJoined(contestId: contestId)

        XCTAssertTrue(vm2Joined)
        XCTAssertTrue(vm3Joined)
    }
}
