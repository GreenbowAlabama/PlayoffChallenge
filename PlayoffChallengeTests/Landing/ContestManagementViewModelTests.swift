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


    // MARK: - Get Contest By ID Tests

    @MainActor
    func testGetContestByIdReturnsNilForUnknownId() {
        let found = sut.getContest(by: UUID())

        XCTAssertNil(found)
    }
}
