//
//  ContestManagementViewModelTests.swift
//  PlayoffChallengeTests
//
//  Unit tests for ContestManagementViewModel.
//

import SwiftUI
import XCTest
@testable import PlayoffChallenge

final class ContestManagementViewModelTests: XCTestCase {

    private var sut: ContestManagementViewModel!

    @MainActor
    override func setUp() {
        super.setUp()
        // Clear the shared store before each test
        CreatedContestsStore.shared.clear()
        sut = ContestManagementViewModel(userId: UUID().uuidString)
    }

    override func tearDown() {
        sut = nil
        super.tearDown()
    }

    // MARK: - Initial State Tests

    @MainActor
    func testInitialMyContestsIsEmpty() {
        XCTAssertTrue(sut.myContests.isEmpty)
    }

    @MainActor
    func testInitialIsLoadingIsFalse() {
        XCTAssertFalse(sut.isLoading)
    }

    @MainActor
    func testInitialErrorMessageIsNil() {
        XCTAssertNil(sut.errorMessage)
    }

    // MARK: - Load My Contests Tests

    @MainActor
    func testLoadMyContestsPopulatesContests() async {
        await sut.loadContests()

        XCTAssertFalse(sut.myContests.isEmpty)
    }

    @MainActor
    func testLoadMyContestsSetsLoadingFalseAfterCompletion() async {
        await sut.loadContests()

        XCTAssertFalse(sut.isLoading)
    }

    @MainActor
    func testLoadMyContestsClearsErrorMessage() async {
        await sut.loadContests()

        XCTAssertNil(sut.errorMessage)
    }

    // MARK: - Refresh Tests

    @MainActor
    func testRefreshReloadsContests() async {
        await sut.refresh()

        XCTAssertFalse(sut.myContests.isEmpty)
    }

    // MARK: - Add Created Contest Tests

    @MainActor
    func testAddCreatedContestAddsToList() {
        let newContest = MockContest(
            id: UUID(),
            name: "New Test Contest",
            entryCount: 1,
            maxEntries: 10,
            status: .scheduled,
            creatorName: "Test User",
            entryFee: 25.0,
            joinToken: "testtoken",
            isJoined: true
        )

        sut.addCreatedContest(newContest)

        XCTAssertTrue(sut.myContests.contains(where: { $0.id == newContest.id }))
    }

    @MainActor
    func testAddCreatedContestInsertsAtBeginning() {
        let firstContest = MockContest(
            id: UUID(),
            name: "First Contest",
            entryCount: 1,
            maxEntries: 10,
            status: .scheduled,
            creatorName: "Test User"
        )
        let secondContest = MockContest(
            id: UUID(),
            name: "Second Contest",
            entryCount: 1,
            maxEntries: 10,
            status: .scheduled,
            creatorName: "Test User"
        )

        sut.addCreatedContest(firstContest)
        sut.addCreatedContest(secondContest)

        XCTAssertEqual(sut.myContests.first?.id, secondContest.id)
    }

    @MainActor
    func testAddCreatedContestDoesNotCreateDuplicates() {
        let contest = MockContest(
            id: UUID(),
            name: "Test Contest",
            entryCount: 1,
            maxEntries: 10,
            status: .scheduled,
            creatorName: "Test User"
        )

        sut.addCreatedContest(contest)
        sut.addCreatedContest(contest)

        let count = sut.myContests.filter { $0.id == contest.id }.count
        XCTAssertEqual(count, 1)
    }

    // MARK: - Created Contest Persistence Tests

    @MainActor
    func testCreatedContestsAppearAfterRefresh() async {
        let contest = MockContest(
            id: UUID(),
            name: "Persistent Contest",
            entryCount: 1,
            maxEntries: 10,
            status: .scheduled,
            creatorName: "Test User"
        )

        // Add contest to shared store
        CreatedContestsStore.shared.add(contest)

        // Create fresh ViewModel and load
        let freshVM = ContestManagementViewModel(userId: UUID().uuidString)
        await freshVM.loadContests()

        XCTAssertTrue(freshVM.myContests.contains(where: { $0.id == contest.id }))
    }

    @MainActor
    func testLoadMyContestsMergesCreatedAndMockContests() async {
        let createdContest = MockContest(
            id: UUID(),
            name: "Created Contest",
            entryCount: 1,
            maxEntries: 10,
            status: .scheduled,
            creatorName: "Me"
        )

        CreatedContestsStore.shared.add(createdContest)
        await sut.loadContests()

        // Should contain both created contest and mock contests
        XCTAssertTrue(sut.myContests.contains(where: { $0.id == createdContest.id }))
        // Mock contests should also be present
        XCTAssertTrue(sut.myContests.count > 1)
    }

    // MARK: - Get Contest By ID Tests

    @MainActor
    func testGetContestByIdReturnsCorrectContest() async {
        let contest = MockContest(
            id: UUID(),
            name: "Findable Contest",
            entryCount: 1,
            maxEntries: 10,
            status: .scheduled,
            creatorName: "Test User"
        )

        sut.addCreatedContest(contest)

        let found = sut.getContest(by: contest.id)

        XCTAssertNotNil(found)
        XCTAssertEqual(found?.name, "Findable Contest")
    }

    @MainActor
    func testGetContestByIdReturnsNilForUnknownId() {
        let found = sut.getContest(by: UUID())

        XCTAssertNil(found)
    }
}

// MARK: - CreatedContestsStore Tests

final class CreatedContestsStoreTests: XCTestCase {

    override func setUp() {
        super.setUp()
        CreatedContestsStore.shared.clear()
    }

    override func tearDown() {
        CreatedContestsStore.shared.clear()
        super.tearDown()
    }

    func testAddContestStoresContest() {
        let contest = MockContest(
            id: UUID(),
            name: "Store Test Contest",
            entryCount: 1,
            maxEntries: 10,
            status: .scheduled,
            creatorName: "Test"
        )

        CreatedContestsStore.shared.add(contest)

        let stored = CreatedContestsStore.shared.getAll()
        XCTAssertTrue(stored.contains(where: { $0.id == contest.id }))
    }

    func testUpdateContestModifiesStoredContest() {
        let id = UUID()
        let original = MockContest(
            id: id,
            name: "Original Name",
            entryCount: 1,
            maxEntries: 10,
            status: .scheduled,
            creatorName: "Test"
        )

        CreatedContestsStore.shared.add(original)

        let updated = MockContest(
            id: id,
            name: "Updated Name",
            entryCount: 5,
            maxEntries: 10,
            status: .scheduled,
            creatorName: "Test"
        )

        CreatedContestsStore.shared.update(updated)

        let stored = CreatedContestsStore.shared.getAll()
        XCTAssertEqual(stored.first(where: { $0.id == id })?.name, "Updated Name")
        XCTAssertEqual(stored.first(where: { $0.id == id })?.entryCount, 5)
    }

    func testClearRemovesAllContests() {
        let contest = MockContest(
            id: UUID(),
            name: "To Be Cleared",
            entryCount: 1,
            maxEntries: 10,
            status: .scheduled,
            creatorName: "Test"
        )

        CreatedContestsStore.shared.add(contest)
        CreatedContestsStore.shared.clear()

        let stored = CreatedContestsStore.shared.getAll()
        XCTAssertTrue(stored.isEmpty)
    }

    func testNoDuplicateContestsWithSameId() {
        let id = UUID()
        let contest1 = MockContest(
            id: id,
            name: "Contest 1",
            entryCount: 1,
            maxEntries: 10,
            status: .scheduled,
            creatorName: "Test"
        )
        let contest2 = MockContest(
            id: id,
            name: "Contest 2",
            entryCount: 2,
            maxEntries: 10,
            status: .scheduled,
            creatorName: "Test"
        )

        CreatedContestsStore.shared.add(contest1)
        CreatedContestsStore.shared.add(contest2)

        let stored = CreatedContestsStore.shared.getAll()
        let count = stored.filter { $0.id == id }.count
        XCTAssertEqual(count, 1)
        // First one should be preserved
        XCTAssertEqual(stored.first(where: { $0.id == id })?.name, "Contest 1")
    }
}
