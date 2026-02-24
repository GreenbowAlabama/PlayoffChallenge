//
//  NavigationResilienceTests.swift
//  PlayoffChallengeTests
//
//  Tests for navigation resilience between Contest Detail and Leaderboard.
//  Ensures view models load data correctly without state persistence concerns.
//

import XCTest
@testable import PlayoffChallenge

@MainActor
final class NavigationResilienceTests: XCTestCase {

    private let testUserId = UUID()

    // MARK: - Helpers

    @MainActor
    private func makeDetailVM(
        contest: MockContest? = nil,
        configureUser: Bool = false
    ) -> (detail: ContestDetailViewModel, fetcher: MockContestDetailFetcher) {
        let testContest = contest ?? .fixture()
        let fetcher = MockContestDetailFetcher()

        let detailVM = ContestDetailViewModel(
            contestId: testContest.id,
            placeholder: testContest,
            contestJoiner: MockContestJoiner.success(),
            detailFetcher: fetcher,
            getCurrentUserId: configureUser ? { self.testUserId } : { nil }
        )

        return (detailVM, fetcher)
    }

    // MARK: - Leaderboard Loading Tests

    @MainActor
    func test_leaderboardViewModel_receivesCorrectContestId() async {
        let contestId = UUID()
        let contest = MockContest.fixture(id: contestId, name: "Championship")
        let fetcher = MockContestDetailFetcher()

        let leaderboardVM = ContestLeaderboardViewModel(contestId: contestId, fetcher: fetcher)
        await leaderboardVM.loadLeaderboard()

        XCTAssertEqual(leaderboardVM.contestId, contestId)
        XCTAssertNotNil(leaderboardVM.leaderboardContract)
    }

    @MainActor
    func test_multipleNavigations_createIndependentViewModels() async {
        let contest = MockContest.fixture()
        let fetcher = MockContestDetailFetcher()

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
    func test_detailViewLoadsFetch() async {
        let contestId = UUID()
        let contest = MockContest.fixture(id: contestId)
        let (detailVM, _) = makeDetailVM(contest: contest)

        await detailVM.fetchContestDetail()

        XCTAssertEqual(detailVM.contest.id, contestId)
    }

    // MARK: - Concurrent Access Tests

    @MainActor
    func test_concurrentLeaderboardLoads_noDataLoss() async {
        let contest = MockContest.fixture()
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

    @MainActor
    func test_detailRefreshLoadsFreshData() async {
        let contest = MockContest.fixture(name: "Original Contest")
        let (detailVM, _) = makeDetailVM(contest: contest)

        await detailVM.fetchContestDetail()
        XCTAssertEqual(detailVM.contest.name, "Original Contest")

        await detailVM.refresh()
        XCTAssertNotNil(detailVM.contractContest)
    }

    @MainActor
    func test_multipleDetailViewModels_independentStates() async {
        let contestId = UUID()
        let contest = MockContest.fixture(id: contestId)
        let fetcher = MockContestDetailFetcher()

        let vm1 = ContestDetailViewModel(
            contestId: contestId,
            placeholder: contest,
            contestJoiner: MockContestJoiner.success(),
            detailFetcher: fetcher
        )

        let vm2 = ContestDetailViewModel(
            contestId: contestId,
            placeholder: contest,
            contestJoiner: MockContestJoiner.success(),
            detailFetcher: fetcher
        )

        await vm1.fetchContestDetail()
        await vm2.fetchContestDetail()

        XCTAssertEqual(vm1.contest.id, contestId)
        XCTAssertEqual(vm2.contest.id, contestId)
    }
}
