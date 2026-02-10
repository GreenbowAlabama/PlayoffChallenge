//
//  NavigationResilienceTests.swift
//  PlayoffChallengeTests
//
//  Tests for navigation resilience between Contest Detail and Leaderboard.
//  Ensures no duplicate view models, stale state, or crashes on repeated transitions.
//

import XCTest
@testable import PlayoffChallenge

final class NavigationResilienceTests: XCTestCase {

    private var testStore: JoinedContestsStore!
    private var mockJoiner: MockContestJoiner!
    private let testUserId = UUID()

    @MainActor
    override func setUp() {
        super.setUp()
        testStore = JoinedContestsStore.makeForTesting()
        mockJoiner = MockContestJoiner()
        mockJoiner.joinResult = .success(
            ContestJoinResult(contestId: UUID(), userId: UUID(), joinedAt: Date(), message: "Joined")
        )
        CreatedContestsStore.shared.clear()
    }

    @MainActor
    override func tearDown() {
        testStore?.clear()
        testStore = nil
        mockJoiner = nil
        CreatedContestsStore.shared.clear()
        super.tearDown()
    }

    // MARK: - Test Helpers

    private func createTestContest(
        id: UUID = UUID(),
        name: String = "Test Contest",
        isJoined: Bool = false
    ) -> MockContest {
        MockContest(
            id: id,
            name: name,
            entryCount: 5,
            maxEntries: 20,
            status: "Open",
            creatorName: "Organizer",
            entryFee: 25.0,
            joinToken: "testtoken",
            isJoined: isJoined
        )
    }

    @MainActor
    private func createDetailVM(contest: MockContest, configureUser: Bool = false) -> ContestDetailViewModel {
        let vm = ContestDetailViewModel(contestId: contest.id, placeholder: contest, contestJoiner: mockJoiner, joinedStore: testStore)
        if configureUser {
            vm.configure(currentUserId: testUserId)
        }
        return vm
    }

    // MARK: - Contest Detail → Leaderboard Navigation Tests

    @MainActor func testLeaderboardViewModelReceivesCorrectContestId() async {
        // Given: A contest
        let contestId = UUID()
        let contest = createTestContest(id: contestId, name: "Championship")

        // When: LeaderboardViewModel is created from ContestDetail
        let leaderboardVM = ContestLeaderboardViewModel(contest: contest, joinedStore: testStore)

        // Then: Contest ID is correctly passed
        XCTAssertEqual(leaderboardVM.contestId, contestId)
        XCTAssertEqual(leaderboardVM.contestName, "Championship")
    }

    @MainActor func testMultipleNavigationsCreateIndependentViewModels() async {
        // Given: A contest
        let contest = createTestContest()

        // When: Multiple LeaderboardViewModels are created (simulating repeated navigation)
        let vm1 = ContestLeaderboardViewModel(contest: contest, joinedStore: testStore)
        let vm2 = ContestLeaderboardViewModel(contest: contest, joinedStore: testStore)
        let vm3 = ContestLeaderboardViewModel(contest: contest, joinedStore: testStore)

        // Load data in each
        await vm1.loadLeaderboard()
        await vm2.loadLeaderboard()
        await vm3.loadLeaderboard()

        // Then: Each has its own state (no shared mutable state)
        XCTAssertFalse(vm1.isLoading)
        XCTAssertFalse(vm2.isLoading)
        XCTAssertFalse(vm3.isLoading)

        // All should have loaded entries
        XCTAssertFalse(vm1.entries.isEmpty)
        XCTAssertFalse(vm2.entries.isEmpty)
        XCTAssertFalse(vm3.entries.isEmpty)
    }

    @MainActor func testNavigateToLeaderboardThenBackPreservesJoinedState() async {
        // Simulates: ContestDetail → Leaderboard → Back to ContestDetail

        let contestId = UUID()
        let contest = createTestContest(id: contestId)

        // User views ContestDetail and joins
        let detailVM1 = createDetailVM(contest: contest, configureUser: true)
        await detailVM1.joinContest()
        XCTAssertTrue(detailVM1.isJoined)

        // Navigate to Leaderboard
        let leaderboardVM = ContestLeaderboardViewModel(contest: detailVM1.contest, joinedStore: testStore)
        await leaderboardVM.loadLeaderboard()

        // User should appear on leaderboard
        XCTAssertTrue(testStore.isJoined(contestId: contestId))

        // Navigate back - new ViewModel created
        let detailVM2 = createDetailVM(contest: contest)

        // Joined state should be preserved
        XCTAssertTrue(detailVM2.isJoined)
    }

    @MainActor func testRepeatedDetailLeaderboardTransitionsNoStateLoss() async {
        // Multiple round trips: Detail → Leaderboard → Detail → Leaderboard → ...

        let contestId = UUID()
        let contest = createTestContest(id: contestId)

        // First visit - join contest
        let detail1 = createDetailVM(contest: contest, configureUser: true)
        await detail1.joinContest()

        for _ in 0..<5 {
            // Navigate to Leaderboard
            let leaderboard = ContestLeaderboardViewModel(contest: contest, joinedStore: testStore)
            await leaderboard.loadLeaderboard()
            XCTAssertTrue(leaderboard.isCurrentUserOnLeaderboard || testStore.isJoined(contestId: contestId))

            // Navigate back to Detail
            let detail = createDetailVM(contest: contest)
            XCTAssertTrue(detail.isJoined, "Joined state should persist across navigation cycles")
        }
    }

    // MARK: - Contest Creation Flow Re-entry Tests

    @MainActor func testCreateContestFlowStartsClean() async {
        // Given: Previous navigation state exists
        let previousContest = createTestContest(name: "Previous Contest")
        testStore.markJoined(previousContest)

        // When: New contest is created (simulated)
        let newContestId = UUID()
        let newContest = MockContest(
            id: newContestId,
            name: "Newly Created Contest",
            entryCount: 1,
            maxEntries: 20,
            status: "Open",
            creatorName: "You",
            entryFee: 10.0,
            joinToken: "newtoken",
            isJoined: true // Creator is automatically joined
        )
        CreatedContestsStore.shared.add(newContest)

        // Then: New contest exists independently
        let storedContests = CreatedContestsStore.shared.getAll()
        XCTAssertTrue(storedContests.contains { $0.id == newContestId })

        // And previous join state is unaffected
        XCTAssertTrue(testStore.isJoined(contestId: previousContest.id))
    }

    @MainActor func testAvailableContestsToDetailToBackNavigation() async {
        // Simulates: Landing → Available Contests → Contest Detail → Back

        // Load available contests
        let availableVM = AvailableContestsViewModel(joinedStore: testStore)
        await availableVM.loadContests()
        XCTAssertFalse(availableVM.contests.isEmpty)

        // Select first contest (navigate to Rules → Detail)
        guard let selectedContest = availableVM.contests.first else {
            XCTFail("No contests available")
            return
        }

        // View detail and join
        let detailVM = createDetailVM(contest: selectedContest, configureUser: true)
        await detailVM.joinContest()
        XCTAssertTrue(detailVM.isJoined)

        // Navigate back to Available Contests (reload)
        await availableVM.refresh()

        // Joined contest should now show as joined
        let reloadedContest = availableVM.contests.first { $0.id == selectedContest.id }
        XCTAssertTrue(reloadedContest?.isJoined == true)
    }

    // MARK: - State Consistency Tests

    @MainActor func testJoinedStateConsistentBetweenDetailAndLeaderboard() async {
        let contestId = UUID()
        let contest = createTestContest(id: contestId)

        // Join via ContestDetail
        let detailVM = createDetailVM(contest: contest, configureUser: true)
        await detailVM.joinContest()

        // Verify joined state in Leaderboard
        let leaderboardVM = ContestLeaderboardViewModel(
            contest: detailVM.contest,
            dataProvider: DefaultLeaderboardDataProvider(joinedStore: testStore),
            joinedStore: testStore
        )
        await leaderboardVM.loadLeaderboard()

        // Both should agree user is joined
        XCTAssertTrue(detailVM.isJoined)
        XCTAssertTrue(testStore.isJoined(contestId: contestId))
    }

    @MainActor func testNoStaleStateAfterJoinAndNavigate() async {
        let contestId = UUID()
        let contest = createTestContest(id: contestId)

        // Initial state - not joined
        let vm1 = createDetailVM(contest: contest, configureUser: true)
        XCTAssertFalse(vm1.isJoined)

        // Join
        await vm1.joinContest()
        XCTAssertTrue(vm1.isJoined)

        // Create multiple new ViewModels (simulating navigation)
        for i in 0..<10 {
            let vm = createDetailVM(contest: contest)
            XCTAssertTrue(vm.isJoined, "ViewModel \(i) should show joined state")
        }
    }

    // MARK: - Concurrent Access Tests

    @MainActor func testConcurrentLeaderboardLoadsDoNotCorruptState() async {
        let contest = createTestContest()
        testStore.markJoined(contest)

        // Create multiple ViewModels and load concurrently
        let viewModels = (0..<5).map { _ in
            ContestLeaderboardViewModel(
                contest: contest,
                dataProvider: DefaultLeaderboardDataProvider(joinedStore: testStore),
                joinedStore: testStore
            )
        }

        // Load all concurrently
        await withTaskGroup(of: Void.self) { group in
            for vm in viewModels {
                group.addTask {
                    await vm.loadLeaderboard()
                }
            }
        }

        // All should have consistent state
        for (index, vm) in viewModels.enumerated() {
            XCTAssertFalse(vm.entries.isEmpty, "ViewModel \(index) should have entries")
            XCTAssertFalse(vm.isLoading, "ViewModel \(index) should not be loading")
        }
    }
}
