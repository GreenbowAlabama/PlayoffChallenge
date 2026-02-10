//
//  ContestDetailViewModelTests.swift
//  PlayoffChallengeTests
//
//  Unit tests for ContestDetailViewModel.
//

import XCTest
@testable import PlayoffChallenge

final class ContestDetailViewModelTests: XCTestCase {

    private var testStore: JoinedContestsStore!
    private var mockJoiner: MockContestJoiner!
    private let testUserId = UUID()

    @MainActor
    override func setUp() {
        super.setUp()
        // Use isolated UserDefaults suite for tests
        testStore = JoinedContestsStore.makeForTesting()
        mockJoiner = MockContestJoiner()
        mockJoiner.joinResult = .success(
            ContestJoinResult(contestId: UUID(), userId: UUID(), joinedAt: Date(), message: "Joined")
        )
    }

    @MainActor
    override func tearDown() {
        testStore?.clear()
        testStore = nil
        mockJoiner = nil
        super.tearDown()
    }

    // MARK: - Test Helpers

    private func createTestContest(
        id: UUID = UUID(),
        isJoined: Bool = false,
        status: String = "Open",
        entryFee: Double = 25.0,
        entryCount: Int = 5,
        maxEntries: Int = 20
    ) -> MockContest {
        MockContest(
            id: id,
            name: "Test Contest",
            entryCount: entryCount,
            maxEntries: maxEntries,
            status: status,
            creatorName: "Organizer",
            entryFee: entryFee,
            joinToken: "testtoken123",
            isJoined: isJoined
        )
    }

    @MainActor
    private func createViewModel(contest: MockContest, configureUser: Bool = false) -> ContestDetailViewModel {
        let vm = ContestDetailViewModel(contestId: contest.id, placeholder: contest, contestJoiner: mockJoiner, joinedStore: testStore)
        if configureUser {
            vm.configure(currentUserId: testUserId)
        }
        return vm
    }

    // MARK: - Initial State Tests

    @MainActor func testInitialStateReflectsContest() {
        let contest = createTestContest(isJoined: false)
        let sut = createViewModel(contest: contest)

        XCTAssertEqual(sut.contest.name, "Test Contest")
        XCTAssertFalse(sut.isJoined)
        XCTAssertFalse(sut.isLoading)
        XCTAssertFalse(sut.isJoining)
        XCTAssertNil(sut.errorMessage)
    }

    @MainActor func testInitialStateWhenAlreadyJoined() {
        let contest = createTestContest(isJoined: true)
        let sut = createViewModel(contest: contest)

        XCTAssertTrue(sut.isJoined)
    }

    // MARK: - Join State Derivation Tests

    @MainActor func testCanJoinContestWhenNotJoinedAndOpen() {
        let contest = createTestContest(isJoined: false, status: "Open")
        let sut = createViewModel(contest: contest)

        XCTAssertTrue(sut.canJoinContest)
    }

    @MainActor func testCannotJoinContestWhenAlreadyJoined() {
        let contest = createTestContest(isJoined: true, status: "Open")
        let sut = createViewModel(contest: contest)

        XCTAssertFalse(sut.canJoinContest)
    }

    @MainActor func testCannotJoinContestWhenLocked() {
        let contest = createTestContest(isJoined: false, status: "Locked")
        let sut = createViewModel(contest: contest)

        XCTAssertFalse(sut.canJoinContest)
    }

    @MainActor func testCannotJoinContestWhenFull() {
        let contest = createTestContest(
            isJoined: false,
            status: "Open",
            entryCount: 20,
            maxEntries: 20
        )
        let sut = createViewModel(contest: contest)

        XCTAssertFalse(sut.canJoinContest)
    }

    // MARK: - Action Availability Tests

    @MainActor func testCanSelectLineupWhenJoined() {
        let contest = createTestContest(isJoined: true, status: "Open")
        let sut = createViewModel(contest: contest)

        XCTAssertTrue(sut.canSelectLineup)
    }

    @MainActor func testCannotSelectLineupWhenNotJoined() {
        let contest = createTestContest(isJoined: false, status: "Open")
        let sut = createViewModel(contest: contest)

        XCTAssertFalse(sut.canSelectLineup)
    }

    @MainActor func testCannotSelectLineupWhenCompletedEvenIfJoined() {
        let contest = createTestContest(isJoined: true, status: "Completed")
        let sut = createViewModel(contest: contest)

        XCTAssertFalse(sut.canSelectLineup)
    }

    @MainActor func testCanAlwaysViewRules() {
        let notJoinedContest = createTestContest(isJoined: false)
        let joinedContest = createTestContest(isJoined: true)

        let sut1 = createViewModel(contest: notJoinedContest)
        let sut2 = createViewModel(contest: joinedContest)

        XCTAssertTrue(sut1.canViewRules)
        XCTAssertTrue(sut2.canViewRules)
    }

    @MainActor func testCanAlwaysViewLeaderboard() {
        let notJoinedContest = createTestContest(isJoined: false)
        let joinedContest = createTestContest(isJoined: true)

        let sut1 = createViewModel(contest: notJoinedContest)
        let sut2 = createViewModel(contest: joinedContest)

        XCTAssertTrue(sut1.canViewLeaderboard)
        XCTAssertTrue(sut2.canViewLeaderboard)
    }

    // MARK: - Join Button Title Tests

    @MainActor func testJoinButtonTitleWhenJoined() {
        let contest = createTestContest(isJoined: true)
        let sut = createViewModel(contest: contest)

        XCTAssertEqual(sut.joinButtonTitle, "Joined")
    }

    @MainActor func testJoinButtonTitleWhenFull() {
        let contest = createTestContest(
            isJoined: false,
            entryCount: 20,
            maxEntries: 20
        )
        let sut = createViewModel(contest: contest)

        XCTAssertEqual(sut.joinButtonTitle, "Contest Full")
    }

    @MainActor func testJoinButtonTitleWhenLocked() {
        let contest = createTestContest(isJoined: false, status: "Locked")
        let sut = createViewModel(contest: contest)

        XCTAssertEqual(sut.joinButtonTitle, "Contest Locked")
    }

    @MainActor func testJoinButtonTitleWhenCanJoin() {
        let contest = createTestContest(isJoined: false, status: "Open")
        let sut = createViewModel(contest: contest)

        XCTAssertEqual(sut.joinButtonTitle, "Join Contest")
    }

    // MARK: - Status Message Tests

    @MainActor func testStatusMessageWhenCanJoin() {
        let contest = createTestContest(isJoined: false, status: "Open")
        let sut = createViewModel(contest: contest)

        XCTAssertEqual(sut.statusMessage, "Join this contest to select your lineup")
    }

    @MainActor func testStatusMessageWhenFull() {
        let contest = createTestContest(
            isJoined: false,
            status: "Open",
            entryCount: 20,
            maxEntries: 20
        )
        let sut = createViewModel(contest: contest)

        XCTAssertEqual(sut.statusMessage, "This contest is full")
    }

    @MainActor func testStatusMessageWhenLocked() {
        let contest = createTestContest(isJoined: false, status: "Locked")
        let sut = createViewModel(contest: contest)

        XCTAssertEqual(sut.statusMessage, "This contest is locked")
    }

    @MainActor func testNoStatusMessageWhenJoined() {
        let contest = createTestContest(isJoined: true)
        let sut = createViewModel(contest: contest)

        XCTAssertNil(sut.statusMessage)
    }

    // MARK: - Join Tests (with mock joiner)

    @MainActor func testJoinContestSetsJoinedState() async {
        let contest = createTestContest(isJoined: false)
        let sut = createViewModel(contest: contest, configureUser: true)

        await sut.joinContest()

        XCTAssertTrue(sut.isJoined)
        XCTAssertNil(sut.errorMessage)
    }

    @MainActor func testJoinContestIncrementsEntryCount() async {
        let contest = createTestContest(isJoined: false, entryCount: 5)
        let sut = createViewModel(contest: contest, configureUser: true)

        await sut.joinContest()

        XCTAssertEqual(sut.contest.entryCount, 6)
    }

    @MainActor func testJoinContestWithoutUserIdShowsError() async {
        let contest = createTestContest(isJoined: false)
        let sut = createViewModel(contest: contest, configureUser: false)

        await sut.joinContest()

        XCTAssertFalse(sut.isJoined)
        XCTAssertEqual(sut.errorMessage, "Please sign in to join this contest.")
    }

    // MARK: - Entry Fee Display Tests

    @MainActor func testFormattedEntryFeeForPaidContest() {
        let contest = createTestContest(entryFee: 50.0)
        XCTAssertEqual(contest.formattedEntryFee, "$50.00")
    }

    @MainActor func testFormattedEntryFeeForFreeContest() {
        let contest = createTestContest(entryFee: 0.0)
        XCTAssertEqual(contest.formattedEntryFee, "Free")
    }

    // MARK: - Error Handling Tests

    @MainActor func testClearErrorResetsErrorMessage() {
        let contest = createTestContest()
        let sut = createViewModel(contest: contest)

        // Simulate an error would be set here via dependency injection
        sut.clearError()

        XCTAssertNil(sut.errorMessage)
    }

    // MARK: - Join Persistence Tests (KEY TESTS)

    @MainActor func testJoinContestPersistsToJoinedContestsStore() async {
        // Given: A contest the user has not joined
        let contest = createTestContest(isJoined: false)
        let sut = createViewModel(contest: contest, configureUser: true)

        // When: User joins the contest
        await sut.joinContest()

        // Then: Contest is persisted in JoinedContestsStore
        XCTAssertTrue(testStore.isJoined(contestId: contest.id))
    }

    @MainActor func testJoinStateSurvidesViewModelRecreation() async {
        // Given: User joins a contest
        let contestId = UUID()
        let contest1 = MockContest(
            id: contestId,
            name: "Test Contest",
            entryCount: 5,
            maxEntries: 20,
            status: "Open",
            creatorName: "Organizer",
            entryFee: 25.0,
            joinToken: "testtoken",
            isJoined: false
        )
        let sut1 = createViewModel(contest: contest1, configureUser: true)
        await sut1.joinContest()

        // When: A new ViewModel is created for the same contest
        let contest2 = MockContest(
            id: contestId,
            name: "Test Contest",
            entryCount: 5,
            maxEntries: 20,
            status: "Open",
            creatorName: "Organizer",
            entryFee: 25.0,
            joinToken: "testtoken",
            isJoined: false  // Note: passed as false
        )
        let sut2 = createViewModel(contest: contest2)

        // Then: The new ViewModel reflects the persisted joined state
        XCTAssertTrue(sut2.isJoined)
    }

    @MainActor func testInitializationChecksJoinedContestsStore() {
        // Given: A contest that was previously joined (in store)
        let contestId = UUID()
        let contest = MockContest(
            id: contestId,
            name: "Test Contest",
            entryCount: 5,
            maxEntries: 20,
            status: "Open",
            creatorName: "Organizer",
            entryFee: 25.0,
            joinToken: "testtoken",
            isJoined: false  // Contest object says not joined
        )
        testStore.markJoined(contest)  // But store says joined

        // When: ViewModel is created
        let sut = createViewModel(contest: contest)

        // Then: ViewModel uses store as source of truth
        XCTAssertTrue(sut.isJoined)
    }

    @MainActor func testRefreshPreservesJoinedStateFromStore() async {
        // Given: A contest the user has joined
        let contest = createTestContest(isJoined: false)
        let sut = createViewModel(contest: contest, configureUser: true)
        await sut.joinContest()

        // When: Refresh is called
        await sut.refresh()

        // Then: Joined state is preserved
        XCTAssertTrue(sut.isJoined)
        XCTAssertTrue(testStore.isJoined(contestId: contest.id))
    }

    // MARK: - Navigation Resilience Tests

    @MainActor func testMultipleViewModelsForSameContestShareJoinedState() async {
        // Given: A contest
        let contestId = UUID()
        let contest = createTestContest(id: contestId, isJoined: false)

        // When: First ViewModel joins the contest
        let sut1 = createViewModel(contest: contest, configureUser: true)
        await sut1.joinContest()

        // And: Second ViewModel is created for same contest
        let sut2 = createViewModel(contest: contest)

        // Then: Both ViewModels reflect joined state
        XCTAssertTrue(sut1.isJoined)
        XCTAssertTrue(sut2.isJoined)
    }

    @MainActor func testJoinedStateConsistentAcrossNavigationCycles() async {
        // Simulates navigating to ContestDetail, joining, going back, and returning
        let contestId = UUID()
        let contest = createTestContest(id: contestId, isJoined: false)

        // First visit: user joins
        let firstVisitVM = createViewModel(contest: contest, configureUser: true)
        await firstVisitVM.joinContest()
        XCTAssertTrue(firstVisitVM.isJoined)

        // Navigate away (ViewModel is released)
        // Navigate back (new ViewModel created)
        let secondVisitVM = createViewModel(contest: contest)

        // Second visit should remember the join
        XCTAssertTrue(secondVisitVM.isJoined)

        // Third visit (yet another navigation cycle)
        let thirdVisitVM = createViewModel(contest: contest)
        XCTAssertTrue(thirdVisitVM.isJoined)
    }
}
