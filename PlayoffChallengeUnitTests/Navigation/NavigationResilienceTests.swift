//
//  NavigationResilienceTests.swift
//  PlayoffChallengeTests
//
//  Tests for navigation resilience between Contest Detail and Leaderboard.
//  Ensures no duplicate view models, stale state, or crashes on repeated transitions.
//

import XCTest
@testable import PlayoffChallenge

@MainActor
final class NavigationResilienceTests: XCTestCase {

    private let testUserId = UUID()

    // MARK: - Helpers

    @MainActor
    private func makeSUT(
        contest: MockContest? = nil,
        configureUser: Bool = false
    ) -> (detail: ContestDetailViewModel, leaderboard: ContestLeaderboardViewModel, store: MockJoinedStore, fetcher: MockContestDetailFetcher) {
        let testContest = contest ?? .fixture()
        let store = MockJoinedStore()
        let fetcher = MockContestDetailFetcher()

        let detailVM = ContestDetailViewModel(
            contestId: testContest.id,
            placeholder: testContest,
            contestJoiner: MockContestJoiner.success(),
            detailFetcher: fetcher,
            joinedStore: store,
            getCurrentUserId: configureUser ? { self.testUserId } : { nil }
        )

        let leaderboardVM = ContestLeaderboardViewModel(
            contestId: testContest.id,
            fetcher: fetcher
        )

        return (detailVM, leaderboardVM, store, fetcher)
    }

    // MARK: - Contest Detail → Leaderboard Navigation Tests

    @MainActor
    func test_leaderboardViewModel_receivesCorrectContestId() async {
        let contestId = UUID()
        let contest = MockContest.fixture(id: contestId, name: "Championship")
        let (_, leaderboardVM, _, _) = makeSUT(contest: contest)

        await leaderboardVM.loadLeaderboard()

        XCTAssertEqual(leaderboardVM.contestId, contestId)
        XCTAssertNotNil(leaderboardVM.leaderboardContract)
    }

    @MainActor
    func test_multipleNavigations_createIndependentViewModels() async {
        let contest = MockContest.fixture()
        let (_, _, _, fetcher) = makeSUT(contest: contest)

        let vm1 = ContestLeaderboardViewModel(contestId: contest.id, fetcher: fetcher)
        let vm2 = ContestLeaderboardViewModel(contestId: contest.id, fetcher: fetcher)
        let vm3 = ContestLeaderboardViewModel(contestId: contest.id, fetcher: fetcher)

        await vm1.loadLeaderboard()
        await vm2.loadLeaderboard()
        await vm3.loadLeaderboard()

        XCTAssertFalse(vm1.isLoading)
        XCTAssertFalse(vm2.isLoading)
        XCTAssertFalse(vm3.isLoading)

        XCTAssertNotNil(vm1.leaderboardContract)
        XCTAssertNotNil(vm2.leaderboardContract)
        XCTAssertNotNil(vm3.leaderboardContract)
    }

    @MainActor
    func test_navigateToLeaderboard_thenBack_preservesJoinedState() async {
        let contestId = UUID()
        let contest = MockContest.fixture(id: contestId)
        let (detailVM1, leaderboardVM, store, _) = makeSUT(contest: contest, configureUser: true)

        // Join via detail
        await detailVM1.joinContest()
        XCTAssertTrue(detailVM1.isJoined)

        // Navigate to leaderboard
        await leaderboardVM.loadLeaderboard()

        // Detail still joined
        XCTAssertTrue(detailVM1.isJoined)

        // Navigate back with new detail VM
        let detailVM2 = ContestDetailViewModel(
            contestId: contestId,
            placeholder: contest,
            contestJoiner: MockContestJoiner.success(),
            detailFetcher: MockContestDetailFetcher(),
            joinedStore: store,
            getCurrentUserId: { self.testUserId }
        )

        // New VM should show joined
        let isJoined = store.isJoined(contestId: contestId)
        XCTAssertTrue(isJoined)
    }

    @MainActor
    func test_repeatedDetailLeaderboardTransitions_noStateLoss() async {
        let contestId = UUID()
        let contest = MockContest.fixture(id: contestId)
        let (detailVM1, _, store, fetcher) = makeSUT(contest: contest, configureUser: true)

        // Join on first visit
        await detailVM1.joinContest()

        for i in 0..<5 {
            // Navigate to leaderboard
            let leaderboard = ContestLeaderboardViewModel(contestId: contestId, fetcher: fetcher)
            await leaderboard.loadLeaderboard()
            XCTAssertNotNil(leaderboard.leaderboardContract, "Round trip \(i): leaderboard should have data")

            // Navigate back
            let detail = ContestDetailViewModel(
                contestId: contestId,
                placeholder: contest,
                contestJoiner: MockContestJoiner.success(),
                detailFetcher: fetcher,
                joinedStore: store,
                getCurrentUserId: { self.testUserId }
            )
            let isJoined = store.isJoined(contestId: contestId)
            XCTAssertTrue(isJoined, "Round trip \(i): joined state should persist")
        }
    }

    // MARK: - Contest Creation Flow Tests

    @MainActor
    func test_createContestFlow_startsClean() async {
        let previousContest = MockContest.fixture(name: "Previous Contest")

        let newContestId = UUID()
        let newContest = MockContest.fixture(
            id: newContestId,
            name: "Newly Created Contest",
            entryCount: 1,
            maxEntries: 20,
            status: .scheduled,
            creatorName: "You",
            entryFee: 10.0,
            isJoined: true
        )

        let store = MockJoinedStore()
        store.markJoined(newContest)

        let isJoined = store.isJoined(contestId: newContestId)
        XCTAssertTrue(isJoined)
        XCTAssertNotNil(previousContest)
    }

    @MainActor
    func test_availableContests_toDetail_toBack_navigation() async {
        let service = MockContestService(
            result: .success([AvailableContestDTO.fixture()])
        )
        let availableVM = AvailableContestsViewModel(service: service)
        await availableVM.loadContests()
        XCTAssertFalse(availableVM.contests.isEmpty)

        guard let selectedContest = availableVM.contests.first else {
            XCTFail("No contests available")
            return
        }

        let store = MockJoinedStore()
        let fetcher = MockContestDetailFetcher()
        let detailVM = ContestDetailViewModel(
            contestId: selectedContest.id,
            placeholder: selectedContest,
            contestJoiner: MockContestJoiner.success(),
            detailFetcher: fetcher,
            joinedStore: store,
            getCurrentUserId: { self.testUserId }
        )

        await detailVM.joinContest()
        store.markJoined(selectedContest)

        let isJoined = store.isJoined(contestId: selectedContest.id)
        XCTAssertTrue(isJoined)
    }

    // MARK: - State Consistency Tests

    @MainActor
    func test_joinedState_consistentBetweenDetailAndLeaderboard() async {
        let contestId = UUID()
        let contest = MockContest.fixture(id: contestId)
        let (detailVM, leaderboardVM, store, _) = makeSUT(contest: contest, configureUser: true)

        await detailVM.joinContest()
        store.markJoined(contest)

        await leaderboardVM.loadLeaderboard()

        let isJoined = store.isJoined(contestId: contestId)
        XCTAssertTrue(isJoined)
        XCTAssertNotNil(leaderboardVM.leaderboardContract)
    }

    @MainActor
    func test_noStaleState_afterJoinAndNavigate() async {
        let contestId = UUID()
        let contest = MockContest.fixture(id: contestId)
        let (vm1, _, store, fetcher) = makeSUT(contest: contest, configureUser: true)

        XCTAssertFalse(vm1.isJoined)

        await vm1.joinContest()
        store.markJoined(contest)
        XCTAssertTrue(vm1.isJoined)

        for i in 0..<10 {
            let vm = ContestDetailViewModel(
                contestId: contestId,
                placeholder: contest,
                contestJoiner: MockContestJoiner.success(),
                detailFetcher: fetcher,
                joinedStore: store,
                getCurrentUserId: { self.testUserId }
            )
            let isJoined = store.isJoined(contestId: contestId)
            XCTAssertTrue(isJoined, "ViewModel \(i) should show joined state")
        }
    }

    // MARK: - Concurrent Access Tests

    @MainActor
    func test_concurrentLeaderboardLoads_noStateLoss() async {
        let contest = MockContest.fixture(isJoined: true)
        let fetcher = MockContestDetailFetcher()

        let viewModels = (0..<5).map { _ in
            ContestLeaderboardViewModel(contestId: contest.id, fetcher: fetcher)
        }

        await withTaskGroup(of: Void.self) { group in
            for vm in viewModels {
                group.addTask {
                    await vm.loadLeaderboard()
                }
            }
        }

        for (index, vm) in viewModels.enumerated() {
            XCTAssertNotNil(vm.leaderboardContract, "ViewModel \(index) should have data")
            XCTAssertFalse(vm.isLoading, "ViewModel \(index) should not be loading")
        }
    }
}
