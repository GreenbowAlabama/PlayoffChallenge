//
//  JoinedContestsStoreTests.swift
//  PlayoffChallengeTests
//
//  Unit tests for JoinedContestsStore.
//

import XCTest
@testable import PlayoffChallenge

final class JoinedContestsStoreTests: XCTestCase {

    private var sut: JoinedContestsStore!

    @MainActor
    override func setUp() {
        super.setUp()
        // Use isolated UserDefaults suite for tests
        sut = JoinedContestsStore.makeForTesting()
    }

    @MainActor
    override func tearDown() {
        sut?.clear()
        sut = nil
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

    // MARK: - Initial State Tests

    @MainActor func testInitialStateIsEmpty() {
        XCTAssertTrue(sut.getJoinedIds().isEmpty)
        XCTAssertTrue(sut.getJoinedContests().isEmpty)
    }

    // MARK: - Mark Joined Tests

    @MainActor func testMarkJoinedAddsContestToStore() {
        let contest = createTestContest()

        sut.markJoined(contest)

        XCTAssertTrue(sut.isJoined(contestId: contest.id))
        XCTAssertEqual(sut.getJoinedIds().count, 1)
    }

    @MainActor func testMarkJoinedSetsIsJoinedTrue() {
        let contest = createTestContest(isJoined: false)

        sut.markJoined(contest)

        let storedContest = sut.getContest(by: contest.id)
        XCTAssertNotNil(storedContest)
        XCTAssertTrue(storedContest!.isJoined)
    }

    @MainActor func testMarkJoinedIsIdempotent() {
        let contest = createTestContest()

        sut.markJoined(contest)
        sut.markJoined(contest)
        sut.markJoined(contest)

        XCTAssertEqual(sut.getJoinedIds().count, 1)
        XCTAssertEqual(sut.getJoinedContests().count, 1)
    }

    @MainActor func testMarkJoinedMultipleContests() {
        let contest1 = createTestContest(name: "Contest 1")
        let contest2 = createTestContest(name: "Contest 2")
        let contest3 = createTestContest(name: "Contest 3")

        sut.markJoined(contest1)
        sut.markJoined(contest2)
        sut.markJoined(contest3)

        XCTAssertEqual(sut.getJoinedIds().count, 3)
        XCTAssertTrue(sut.isJoined(contestId: contest1.id))
        XCTAssertTrue(sut.isJoined(contestId: contest2.id))
        XCTAssertTrue(sut.isJoined(contestId: contest3.id))
    }

    // MARK: - Is Joined Tests

    @MainActor func testIsJoinedReturnsFalseForUnknownContest() {
        let unknownId = UUID()

        XCTAssertFalse(sut.isJoined(contestId: unknownId))
    }

    @MainActor func testIsJoinedReturnsTrueForJoinedContest() {
        let contest = createTestContest()
        sut.markJoined(contest)

        XCTAssertTrue(sut.isJoined(contestId: contest.id))
    }

    // MARK: - Get Contest Tests

    @MainActor func testGetContestReturnsNilForUnknownContest() {
        let unknownId = UUID()

        XCTAssertNil(sut.getContest(by: unknownId))
    }

    @MainActor func testGetContestReturnsJoinedContest() {
        let contest = createTestContest(name: "My Test Contest")
        sut.markJoined(contest)

        let retrieved = sut.getContest(by: contest.id)

        XCTAssertNotNil(retrieved)
        XCTAssertEqual(retrieved?.name, "My Test Contest")
        XCTAssertTrue(retrieved!.isJoined)
    }

    // MARK: - Update Contest Tests

    @MainActor func testUpdateContestModifiesStoredContest() {
        let contest = createTestContest(name: "Original Name")
        sut.markJoined(contest)

        let updatedContest = MockContest(
            id: contest.id,
            name: "Updated Name",
            entryCount: 10,
            maxEntries: contest.maxEntries,
            status: contest.status,
            creatorName: contest.creatorName,
            entryFee: contest.entryFee,
            joinToken: contest.joinToken,
            isJoined: true
        )
        sut.updateContest(updatedContest)

        let retrieved = sut.getContest(by: contest.id)
        XCTAssertEqual(retrieved?.name, "Updated Name")
        XCTAssertEqual(retrieved?.entryCount, 10)
    }

    @MainActor func testUpdateContestIgnoresUnknownContest() {
        let unknownContest = createTestContest(name: "Unknown")

        // Should not crash or add the contest
        sut.updateContest(unknownContest)

        XCTAssertNil(sut.getContest(by: unknownContest.id))
    }

    // MARK: - Clear Tests

    @MainActor func testClearRemovesAllJoinedContests() {
        let contest1 = createTestContest(name: "Contest 1")
        let contest2 = createTestContest(name: "Contest 2")

        sut.markJoined(contest1)
        sut.markJoined(contest2)

        sut.clear()

        XCTAssertTrue(sut.getJoinedIds().isEmpty)
        XCTAssertTrue(sut.getJoinedContests().isEmpty)
        XCTAssertFalse(sut.isJoined(contestId: contest1.id))
        XCTAssertFalse(sut.isJoined(contestId: contest2.id))
    }
}
