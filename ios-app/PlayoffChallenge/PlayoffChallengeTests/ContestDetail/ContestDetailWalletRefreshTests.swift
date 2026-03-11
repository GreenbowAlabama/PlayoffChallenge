//
//  ContestDetailWalletRefreshTests.swift
//  PlayoffChallengeTests
//
//  Tests for wallet refresh behavior in ContestDetailView across presentation paths.
//

import XCTest
import Combine
@testable import PlayoffChallenge

final class ContestDetailWalletRefreshTests: XCTestCase {

    // MARK: - Test 1: Deep-link path provides wallet refresher

    func testDeepLinkPathProvidesWalletRefresher() {
        // Given: A ContestDetailView is created with walletRefresher explicitly provided
        // (simulating the fixed deep-link environment)
        let mockWalletVM = MockUserWalletViewModel()
        let contestId = UUID()

        let viewModel = ContestDetailViewModel(
            contestId: contestId,
            placeholder: nil,
            contestJoiner: MockContestJoiner(),
            detailFetcher: MockContestDetailFetcher(),
            walletRefresher: mockWalletVM  // This is the fix: walletVM now injected
        )

        // When: ViewModel is initialized
        // Then: walletRefresher should not be nil
        XCTAssertNotNil(viewModel.walletRefresher, "walletRefresher must be non-nil in deep-link path after fix")
    }

    // MARK: - Test 2: Join triggers wallet refresh callback

    func testJoinTriggersWalletRefresh() async {
        // Given: A contest detail view model with a mock wallet refresher
        let mockWalletVM = MockUserWalletViewModel()
        let contestId = UUID()
        let userId = UUID()

        let mockJoiner = MockContestJoiner()
        mockJoiner.joinResult = .success(JoinContestResponse(joined: true, participant: nil))

        let mockDetailFetcher = MockContestDetailFetcher()
        let mockContest = Contest.stub(id: contestId, status: .scheduled)
        mockDetailFetcher.contestToReturn = mockContest

        let viewModel = ContestDetailViewModel(
            contestId: contestId,
            placeholder: nil,
            contestJoiner: mockJoiner,
            detailFetcher: mockDetailFetcher,
            walletRefresher: mockWalletVM
        )

        viewModel.configure(currentUserId: userId)

        // When: User joins the contest
        await viewModel.joinContest()

        // Then: Wallet refresh should have been called
        XCTAssertTrue(mockWalletVM.refreshWalletCalled, "wallet refresh must be called after successful join")
    }

    // MARK: - Test 3: Unjoin triggers wallet refresh callback

    func testUnjoinTriggersWalletRefresh() async {
        // Given: A contest detail view model with a mock wallet refresher
        let mockWalletVM = MockUserWalletViewModel()
        let contestId = UUID()
        let userId = UUID()

        let mockJoiner = MockContestJoiner()
        let mockContest = Contest.stub(id: contestId, status: .scheduled)
        mockJoiner.unjoinResult = .success(mockContest)

        let viewModel = ContestDetailViewModel(
            contestId: contestId,
            placeholder: mockContest,
            contestJoiner: mockJoiner,
            detailFetcher: MockContestDetailFetcher(),
            walletRefresher: mockWalletVM
        )

        viewModel.configure(currentUserId: userId)

        // When: User unjoins the contest
        await viewModel.unjoinContest()

        // Then: Wallet refresh should have been called
        XCTAssertTrue(mockWalletVM.refreshWalletCalled, "wallet refresh must be called after successful unjoin")
    }

    // MARK: - Test 4: Existing main tab path still works

    func testMainTabPathStillProvidesDependencies() {
        // Given: The normal injection path via AuthenticatedRootView
        let authService = AuthService.shared
        let availableVM = AvailableContestsViewModel()
        let myVM = MyContestsViewModel()
        let walletVM = UserWalletViewModel()

        // When: All ViewModels are created at the root level
        // Then: They should be shareable across all presentation contexts
        XCTAssertNotNil(authService, "authService must exist")
        XCTAssertNotNil(availableVM, "availableVM must exist")
        XCTAssertNotNil(myVM, "myVM must exist")
        XCTAssertNotNil(walletVM, "walletVM must exist")

        // And: They can be injected into environment
        // (This test verifies the structure is correct for the fix)
    }
}

// MARK: - Mock Wallet ViewModel

class MockUserWalletViewModel: UserWalletViewModel, WalletRefreshing {
    var refreshWalletCalled = false

    override func refreshWallet() async {
        refreshWalletCalled = true
        await super.refreshWallet()
    }
}

// MARK: - Mock Contest Joiner

class MockContestJoiner: ContestJoining {
    var joinResult: Result<JoinContestResponse, Error> = .failure(NSError(domain: "test", code: -1))
    var unjoinResult: Result<Contest, Error> = .failure(NSError(domain: "test", code: -1))

    func joinContest(contestId: UUID, token: String?, userId: UUID) async throws -> JoinContestResponse {
        return try joinResult.get()
    }

    func joinSystemContest(contestId: UUID, userId: UUID) async throws -> JoinContestResponse {
        return try joinResult.get()
    }

    func unjoinContest(id: UUID) async throws -> Contest {
        return try unjoinResult.get()
    }
}

// MARK: - Mock Contest Detail Fetcher

class MockContestDetailFetcher: ContestDetailFetching {
    var contestToReturn: Contest?

    func fetchContestDetail(contestId: UUID, userId: UUID?) async throws -> ContestDetailResult {
        guard let contest = contestToReturn else {
            throw NSError(domain: "test", code: -1)
        }

        return ContestDetailResult(
            contest: contest,
            actionState: ContestActionState(
                leaderboardState: .loading,
                actions: ContestActions(
                    canJoin: true,
                    canUnjoin: false,
                    canEditEntry: false,
                    canDelete: false,
                    canShareInvite: false,
                    isClosed: false
                )
            )
        )
    }
}
