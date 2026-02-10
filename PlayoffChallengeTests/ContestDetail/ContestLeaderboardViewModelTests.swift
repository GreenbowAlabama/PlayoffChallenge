//
//  ContestLeaderboardViewModelTests.swift
//  PlayoffChallengeTests
//
//  Unit tests for ContestLeaderboardViewModel.
//  Proves that joined users appear on the leaderboard.
//

import XCTest
@testable import PlayoffChallenge

// MARK: - Mock Data Provider

@MainActor
final class MockLeaderboardDataProvider: LeaderboardDataProviding {
    var entriesToReturn: [MockLeaderboardEntry] = []
    var currentUserEntry: MockLeaderboardEntry?
    var getEntriesCalled = false
    var getEntriesContestId: UUID?

    func getEntries(for contestId: UUID) async -> [MockLeaderboardEntry] {
        getEntriesCalled = true
        getEntriesContestId = contestId
        return entriesToReturn
    }

    func getCurrentUserEntry(contestId: UUID, username: String) -> MockLeaderboardEntry? {
        return currentUserEntry
    }

    func reset() {
        entriesToReturn = []
        currentUserEntry = nil
        getEntriesCalled = false
        getEntriesContestId = nil
    }
}

final class ContestLeaderboardViewModelTests: XCTestCase {

    private var mockDataProvider: MockLeaderboardDataProvider!
    private var testStore: JoinedContestsStore!

    @MainActor
    override func setUp() {
        super.setUp()
        mockDataProvider = MockLeaderboardDataProvider()
        testStore = JoinedContestsStore.makeForTesting()
    }

    @MainActor
    override func tearDown() {
        mockDataProvider = nil
        testStore?.clear()
        testStore = nil
        super.tearDown()
    }

    // MARK: - Test Helpers

    private func createTestContest(
        id: UUID = UUID(),
        name: String = "Test Contest"
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
            isJoined: false
        )
    }

    private func createTestEntry(
        username: String = "Player",
        points: Double = 100.0
    ) -> MockLeaderboardEntry {
        MockLeaderboardEntry(
            id: UUID(),
            username: username,
            teamName: nil,
            totalPoints: points
        )
    }

    // MARK: - Initial State Tests

    @MainActor func testInitialStateIsCorrect() {
        let contest = createTestContest()
        let sut = ContestLeaderboardViewModel(contest: contest, dataProvider: mockDataProvider, joinedStore: testStore)

        XCTAssertTrue(sut.entries.isEmpty)
        XCTAssertFalse(sut.isLoading)
        XCTAssertNil(sut.errorMessage)
        XCTAssertNil(sut.currentUserRank)
    }

    @MainActor func testContestNameIsExposed() {
        let contest = createTestContest(name: "Championship 2026")
        let sut = ContestLeaderboardViewModel(contest: contest, dataProvider: mockDataProvider, joinedStore: testStore)

        XCTAssertEqual(sut.contestName, "Championship 2026")
    }

    // MARK: - Load Leaderboard Tests

    @MainActor func testLoadLeaderboardFetchesEntries() async {
        let contest = createTestContest()
        mockDataProvider.entriesToReturn = [
            createTestEntry(username: "Player1", points: 150),
            createTestEntry(username: "Player2", points: 100)
        ]
        let sut = ContestLeaderboardViewModel(contest: contest, dataProvider: mockDataProvider, joinedStore: testStore)

        await sut.loadLeaderboard()

        XCTAssertTrue(mockDataProvider.getEntriesCalled)
        XCTAssertEqual(mockDataProvider.getEntriesContestId, contest.id)
        XCTAssertEqual(sut.entries.count, 2)
    }

    @MainActor func testLoadLeaderboardSortsByPointsDescending() async {
        let contest = createTestContest()
        mockDataProvider.entriesToReturn = [
            createTestEntry(username: "LowScorer", points: 50),
            createTestEntry(username: "HighScorer", points: 200),
            createTestEntry(username: "MidScorer", points: 100)
        ]
        let sut = ContestLeaderboardViewModel(contest: contest, dataProvider: mockDataProvider, joinedStore: testStore)

        await sut.loadLeaderboard()

        XCTAssertEqual(sut.entries[0].username, "HighScorer")
        XCTAssertEqual(sut.entries[1].username, "MidScorer")
        XCTAssertEqual(sut.entries[2].username, "LowScorer")
    }

    @MainActor func testLoadLeaderboardSetsLoadingFalseAfterCompletion() async {
        let contest = createTestContest()
        let sut = ContestLeaderboardViewModel(contest: contest, dataProvider: mockDataProvider, joinedStore: testStore)

        await sut.loadLeaderboard()

        XCTAssertFalse(sut.isLoading)
    }

    // MARK: - Join → Leaderboard Inclusion Tests (KEY TEST)

    @MainActor func testJoinedUserAppearsOnLeaderboard() async {
        // Given: A contest and user who has joined
        let contest = createTestContest()
        testStore.markJoined(contest)

        // When: Using the default data provider which checks JoinedContestsStore
        let sut = ContestLeaderboardViewModel(
            contest: contest,
            dataProvider: DefaultLeaderboardDataProvider(joinedStore: testStore),
            joinedStore: testStore
        )
        await sut.loadLeaderboard()

        // Then: User appears on leaderboard
        XCTAssertTrue(sut.isCurrentUserOnLeaderboard)
        XCTAssertTrue(sut.entries.contains { $0.username == "You" })
    }

    @MainActor func testNotJoinedUserDoesNotAppearOnLeaderboard() async {
        // Given: A contest the user has NOT joined
        let contest = createTestContest()
        // Explicitly do NOT mark as joined

        // Use mock data provider that returns only other players
        mockDataProvider.entriesToReturn = [
            createTestEntry(username: "OtherPlayer1", points: 100),
            createTestEntry(username: "OtherPlayer2", points: 80)
        ]

        let sut = ContestLeaderboardViewModel(
            contest: contest,
            dataProvider: mockDataProvider,
            joinedStore: testStore
        )
        await sut.loadLeaderboard()

        // Then: Current user is NOT on leaderboard
        XCTAssertFalse(sut.isCurrentUserOnLeaderboard)
        XCTAssertFalse(sut.entries.contains { $0.username == "You" })
    }

    @MainActor func testCurrentUserRankIsCalculated() async {
        // Given: A contest with the user at rank 3
        let contest = createTestContest()
        mockDataProvider.entriesToReturn = [
            createTestEntry(username: "Leader", points: 200),
            createTestEntry(username: "Second", points: 150),
            createTestEntry(username: "You", points: 100),
            createTestEntry(username: "Fourth", points: 50)
        ]

        let sut = ContestLeaderboardViewModel(contest: contest, dataProvider: mockDataProvider, joinedStore: testStore)
        await sut.loadLeaderboard()

        XCTAssertEqual(sut.currentUserRank, 3)
    }

    @MainActor func testCurrentUserRankIsNilWhenNotOnLeaderboard() async {
        let contest = createTestContest()
        mockDataProvider.entriesToReturn = [
            createTestEntry(username: "Player1", points: 100)
        ]

        let sut = ContestLeaderboardViewModel(contest: contest, dataProvider: mockDataProvider, joinedStore: testStore)
        await sut.loadLeaderboard()

        XCTAssertNil(sut.currentUserRank)
    }

    // MARK: - Add Current User Tests

    @MainActor func testAddCurrentUserIfJoinedAddsUserWhenJoined() {
        let contest = createTestContest()
        testStore.markJoined(contest)

        let sut = ContestLeaderboardViewModel(contest: contest, dataProvider: mockDataProvider, joinedStore: testStore)
        sut.addCurrentUserIfJoined()

        XCTAssertTrue(sut.isCurrentUserOnLeaderboard)
        XCTAssertEqual(sut.entries.count, 1)
    }

    @MainActor func testAddCurrentUserIfJoinedDoesNothingWhenNotJoined() {
        let contest = createTestContest()
        // Not joined

        let sut = ContestLeaderboardViewModel(contest: contest, dataProvider: mockDataProvider, joinedStore: testStore)
        sut.addCurrentUserIfJoined()

        XCTAssertFalse(sut.isCurrentUserOnLeaderboard)
        XCTAssertTrue(sut.entries.isEmpty)
    }

    @MainActor func testAddCurrentUserIfJoinedIsIdempotent() {
        let contest = createTestContest()
        testStore.markJoined(contest)

        let sut = ContestLeaderboardViewModel(contest: contest, dataProvider: mockDataProvider, joinedStore: testStore)
        sut.addCurrentUserIfJoined()
        sut.addCurrentUserIfJoined()
        sut.addCurrentUserIfJoined()

        // Should only have one "You" entry
        let youEntries = sut.entries.filter { $0.username == "You" }
        XCTAssertEqual(youEntries.count, 1)
    }

    // MARK: - Refresh Tests

    @MainActor func testRefreshReloadsLeaderboard() async {
        let contest = createTestContest()
        mockDataProvider.entriesToReturn = [createTestEntry(username: "Player", points: 100)]

        let sut = ContestLeaderboardViewModel(contest: contest, dataProvider: mockDataProvider, joinedStore: testStore)
        await sut.refresh()

        XCTAssertTrue(mockDataProvider.getEntriesCalled)
        XCTAssertEqual(sut.entries.count, 1)
    }
}
