//
//  ContestLeaderboardViewModelTests.swift
//  PlayoffChallengeTests
//
//  Unit tests for ContestLeaderboardViewModel.
//  Tests contract-based leaderboard rendering.
//

import XCTest
@testable import PlayoffChallenge

@MainActor
final class ContestLeaderboardViewModelTests: XCTestCase {

    private var mockFetcher: MockContestDetailFetcher!

    override func setUp() {
        super.setUp()
        mockFetcher = MockContestDetailFetcher()
    }

    override func tearDown() {
        mockFetcher?.reset()
        mockFetcher = nil
        super.tearDown()
    }

    // MARK: - Test Helpers

    private func createTestLeaderboardContract(
        state: LeaderboardState = .computed,
        rows: [LeaderboardRow] = []
    ) -> LeaderboardResponseContract {
        LeaderboardResponseContract(
            contest_id: UUID().uuidString,
            contest_type: "test",
            leaderboard_state: state,
            generated_at: nil,
            column_schema: [
                LeaderboardColumnSchema(key: "rank", label: "Rank", type: "number", format: nil),
                LeaderboardColumnSchema(key: "name", label: "Player", type: nil, format: nil),
                LeaderboardColumnSchema(key: "points", label: "Points", type: "number", format: nil)
            ],
            rows: rows
        )
    }

    // MARK: - Initial State Tests

    @MainActor func testInitialStateIsCorrect() {
        let contestId = UUID()
        let sut = ContestLeaderboardViewModel(contestId: contestId, fetcher: mockFetcher)

        XCTAssertNil(sut.leaderboardContract)
        XCTAssertFalse(sut.isLoading)
        XCTAssertNil(sut.errorMessage)
    }

    // MARK: - Load Leaderboard Tests

    @MainActor func testLoadLeaderboardFetchesContract() async {
        let contestId = UUID()
        let contract = createTestLeaderboardContract()
        mockFetcher.leaderboardResult = .success(contract)

        let sut = ContestLeaderboardViewModel(contestId: contestId, fetcher: mockFetcher)
        await sut.loadLeaderboard()

        XCTAssertGreaterThan(mockFetcher.fetchLeaderboardCallCount, 0)
        XCTAssertEqual(mockFetcher.lastLeaderboardContestId, contestId)
        XCTAssertNotNil(sut.leaderboardContract)
        XCTAssertEqual(sut.leaderboardContract?.contest_id, contract.contest_id)
    }

    @MainActor func testLoadLeaderboardHandlesError() async {
        let contestId = UUID()
        mockFetcher.leaderboardResult = .failure(TestError.boom)

        let sut = ContestLeaderboardViewModel(contestId: contestId, fetcher: mockFetcher)
        await sut.loadLeaderboard()

        XCTAssertNil(sut.leaderboardContract)
        XCTAssertNotNil(sut.errorMessage)
    }

    @MainActor func testLoadLeaderboardSetsLoadingFalseAfterCompletion() async {
        let contestId = UUID()
        mockFetcher.leaderboardResult = .success(createTestLeaderboardContract())

        let sut = ContestLeaderboardViewModel(contestId: contestId, fetcher: mockFetcher)
        await sut.loadLeaderboard()

        XCTAssertFalse(sut.isLoading)
    }

    // MARK: - State Tests

    @MainActor func testIsPendingWhenStateIsPending() {
        let contestId = UUID()
        let contract = createTestLeaderboardContract(state: .pending)
        mockFetcher.leaderboardResult = .success(contract)

        let sut = ContestLeaderboardViewModel(contestId: contestId, fetcher: mockFetcher)
        sut.leaderboardContract = contract

        XCTAssertTrue(sut.isPending)
        XCTAssertFalse(sut.isComputed)
        XCTAssertFalse(sut.hasError)
    }

    @MainActor func testIsComputedWhenStateIsComputed() {
        let contestId = UUID()
        let contract = createTestLeaderboardContract(state: .computed)
        mockFetcher.leaderboardResult = .success(contract)

        let sut = ContestLeaderboardViewModel(contestId: contestId, fetcher: mockFetcher)
        sut.leaderboardContract = contract

        XCTAssertFalse(sut.isPending)
        XCTAssertTrue(sut.isComputed)
        XCTAssertFalse(sut.hasError)
    }

    @MainActor func testHasErrorWhenStateIsError() {
        let contestId = UUID()
        let contract = createTestLeaderboardContract(state: .error)
        mockFetcher.leaderboardResult = .success(contract)

        let sut = ContestLeaderboardViewModel(contestId: contestId, fetcher: mockFetcher)
        sut.leaderboardContract = contract

        XCTAssertFalse(sut.isPending)
        XCTAssertFalse(sut.isComputed)
        XCTAssertTrue(sut.hasError)
    }

    @MainActor func testIsEmptyWhenComputedWithNoRows() {
        let contestId = UUID()
        let contract = createTestLeaderboardContract(state: .computed, rows: [])

        let sut = ContestLeaderboardViewModel(contestId: contestId, fetcher: mockFetcher)
        sut.leaderboardContract = contract

        XCTAssertTrue(sut.isEmpty)
    }

    @MainActor func testIsNotEmptyWhenComputedWithRows() {
        let contestId = UUID()
        let rows: [LeaderboardRow] = [
            ["rank": AnyCodable(1), "name": AnyCodable("Player1"), "points": AnyCodable(100)]
        ]
        let contract = createTestLeaderboardContract(state: .computed, rows: rows)

        let sut = ContestLeaderboardViewModel(contestId: contestId, fetcher: mockFetcher)
        sut.leaderboardContract = contract

        XCTAssertFalse(sut.isEmpty)
    }

    // MARK: - Refresh Tests

    @MainActor func testRefreshReloadsLeaderboard() async {
        let contestId = UUID()
        mockFetcher.leaderboardResult = .success(createTestLeaderboardContract())

        let sut = ContestLeaderboardViewModel(contestId: contestId, fetcher: mockFetcher)
        await sut.refresh()

        XCTAssertGreaterThan(mockFetcher.fetchLeaderboardCallCount, 0)
        XCTAssertNotNil(sut.leaderboardContract)
    }

    // MARK: - Contract Enforcement Tests

    @MainActor func testEmptyIsNotInferredFromRowsAlone() {
        // Empty rows should NOT imply pending or error
        let contestId = UUID()
        let contract = createTestLeaderboardContract(state: .computed, rows: [])

        let sut = ContestLeaderboardViewModel(contestId: contestId, fetcher: mockFetcher)
        sut.leaderboardContract = contract

        XCTAssertTrue(sut.isEmpty, "isEmpty should be true for computed state with empty rows")
        XCTAssertFalse(sut.isPending, "Empty rows should not imply pending")
        XCTAssertFalse(sut.hasError, "Empty rows should not imply error")
    }

    @MainActor func testPendingStateWithRowsDoesNotShowTable() {
        // Rows present but pending state should not show table
        let contestId = UUID()
        let rows: [LeaderboardRow] = [
            ["rank": AnyCodable(1), "name": AnyCodable("Player1"), "points": AnyCodable(100)]
        ]
        let contract = createTestLeaderboardContract(state: .pending, rows: rows)

        let sut = ContestLeaderboardViewModel(contestId: contestId, fetcher: mockFetcher)
        sut.leaderboardContract = contract

        XCTAssertTrue(sut.isPending, "State drives UI, not row count")
        XCTAssertFalse(sut.isEmpty, "Pending is not empty")
        XCTAssertFalse(sut.isComputed, "Pending is not computed")
    }

    @MainActor func testLeaderboardStateIsSourceOfTruth() {
        // Verify state enum controls behavior, not data presence
        let contestId = UUID()

        // Scenario 1: Error state
        let errorContract = createTestLeaderboardContract(state: .error, rows: [])
        let sut1 = ContestLeaderboardViewModel(contestId: contestId, fetcher: mockFetcher)
        sut1.leaderboardContract = errorContract
        XCTAssertTrue(sut1.hasError)

        // Scenario 2: Pending state (even with rows)
        let rows: [LeaderboardRow] = [
            ["rank": AnyCodable(1), "name": AnyCodable("P"), "points": AnyCodable(50)]
        ]
        let pendingContract = createTestLeaderboardContract(state: .pending, rows: rows)
        let sut2 = ContestLeaderboardViewModel(contestId: contestId, fetcher: mockFetcher)
        sut2.leaderboardContract = pendingContract
        XCTAssertTrue(sut2.isPending)
        XCTAssertEqual(sut2.rows.count, 1, "Rows are accessible but state drives display")

        // Scenario 3: Computed state with rows
        let computedContract = createTestLeaderboardContract(state: .computed, rows: rows)
        let sut3 = ContestLeaderboardViewModel(contestId: contestId, fetcher: mockFetcher)
        sut3.leaderboardContract = computedContract
        XCTAssertTrue(sut3.isComputed)
        XCTAssertFalse(sut3.isEmpty, "Computed with rows is not empty")
    }
}
