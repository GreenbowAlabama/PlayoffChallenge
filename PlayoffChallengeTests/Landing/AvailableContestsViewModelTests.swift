//
//  AvailableContestsViewModelTests.swift
//  PlayoffChallengeTests
//
//  Unit tests for AvailableContestsViewModel.
//

import SwiftUI
import XCTest
@testable import PlayoffChallenge

final class AvailableContestsViewModelTests: XCTestCase {

    private var sut: AvailableContestsViewModel!
    private var testStore: JoinedContestsStore!

    @MainActor
    override func setUp() {
        super.setUp()
        testStore = JoinedContestsStore.makeForTesting()
        sut = AvailableContestsViewModel(joinedStore: testStore)
    }

    @MainActor
    override func tearDown() {
        sut = nil
        testStore?.clear()
        testStore = nil
        super.tearDown()
    }

    // MARK: - Initial State Tests

    @MainActor func testInitialContestsIsEmpty() {
        XCTAssertTrue(sut.contests.isEmpty)
    }

    @MainActor func testInitialIsLoadingIsFalse() {
        XCTAssertFalse(sut.isLoading)
    }

    @MainActor func testInitialErrorMessageIsNil() {
        XCTAssertNil(sut.errorMessage)
    }

    // MARK: - Load Contests Tests

    @MainActor func testLoadContestsPopulatesContests() async {
        await sut.loadContests()

        XCTAssertFalse(sut.contests.isEmpty)
        XCTAssertEqual(sut.contests.count, MockContest.samples.count)
    }

    @MainActor func testLoadContestsSetsLoadingFalseAfterCompletion() async {
        await sut.loadContests()

        XCTAssertFalse(sut.isLoading)
    }

    @MainActor func testLoadContestsClearsErrorMessage() async {
        await sut.loadContests()

        XCTAssertNil(sut.errorMessage)
    }

    // MARK: - Refresh Tests

    @MainActor func testRefreshReloadsContests() async {
        await sut.refresh()

        XCTAssertFalse(sut.contests.isEmpty)
    }

    // MARK: - Joined State Reflection Tests (KEY TESTS)

    @MainActor func testLoadContestsReflectsJoinedStateFromStore() async {
        // Given: User has joined a sample contest
        guard let sampleContest = MockContest.samples.first else {
            XCTFail("MockContest.samples is empty")
            return
        }
        testStore.markJoined(sampleContest)

        // When: Contests are loaded
        await sut.loadContests()

        // Then: The joined contest shows isJoined = true
        let loadedContest = sut.contests.first { $0.id == sampleContest.id }
        XCTAssertNotNil(loadedContest)
        XCTAssertTrue(loadedContest!.isJoined)
    }

    @MainActor func testLoadContestsShowsUnjoinedContestsAsNotJoined() async {
        // Given: No contests are joined
        // (JoinedContestsStore is cleared in setUp)

        // When: Contests are loaded
        await sut.loadContests()

        // Then: All contests show isJoined = false
        for contest in sut.contests {
            XCTAssertFalse(contest.isJoined, "Contest \(contest.name) should not be joined")
        }
    }

    @MainActor func testUnjoinedContestsFilterReturnsOnlyUnjoinedContests() async {
        // Given: One sample contest is joined
        guard let firstSample = MockContest.samples.first else {
            XCTFail("MockContest.samples is empty")
            return
        }
        testStore.markJoined(firstSample)

        // When: Contests are loaded
        await sut.loadContests()

        // Then: unjoinedContests filter excludes joined ones
        XCTAssertFalse(sut.unjoinedContests.contains { $0.id == firstSample.id })
        XCTAssertEqual(sut.unjoinedContests.count, MockContest.samples.count - 1)
    }

    @MainActor func testJoinedContestsFilterReturnsOnlyJoinedContests() async {
        // Given: One sample contest is joined
        guard let firstSample = MockContest.samples.first else {
            XCTFail("MockContest.samples is empty")
            return
        }
        testStore.markJoined(firstSample)

        // When: Contests are loaded
        await sut.loadContests()

        // Then: joinedContests filter includes only joined ones
        XCTAssertTrue(sut.joinedContests.contains { $0.id == firstSample.id })
        XCTAssertEqual(sut.joinedContests.count, 1)
    }

    @MainActor func testIsContestJoinedReturnsCorrectStatus() async {
        // Given: One contest is joined
        guard let firstSample = MockContest.samples.first else {
            XCTFail("MockContest.samples is empty")
            return
        }
        testStore.markJoined(firstSample)

        // Then: isContestJoined returns correct values
        XCTAssertTrue(sut.isContestJoined(firstSample.id))

        if MockContest.samples.count > 1 {
            let secondSample = MockContest.samples[1]
            XCTAssertFalse(sut.isContestJoined(secondSample.id))
        }
    }

    @MainActor func testRefreshUpdatesJoinedState() async {
        // Given: Contests are loaded with nothing joined
        await sut.loadContests()
        let allUnjoined = sut.contests.allSatisfy { !$0.isJoined }
        XCTAssertTrue(allUnjoined, "Initially all contests should be unjoined")

        // When: User joins a contest (simulated) and refreshes
        guard let firstSample = MockContest.samples.first else { return }
        testStore.markJoined(firstSample)
        await sut.refresh()

        // Then: The joined contest is now marked as joined
        let loadedContest = sut.contests.first { $0.id == firstSample.id }
        XCTAssertTrue(loadedContest?.isJoined == true)
    }

    // MARK: - Duplicate Join Prevention Tests

    @MainActor func testJoinedContestAppearsInListOnce() async {
        // Given: User joins a contest
        guard let sampleContest = MockContest.samples.first else { return }
        testStore.markJoined(sampleContest)

        // When: Contests are loaded
        await sut.loadContests()

        // Then: Contest appears exactly once in list
        let matchingContests = sut.contests.filter { $0.id == sampleContest.id }
        XCTAssertEqual(matchingContests.count, 1)
    }
}
