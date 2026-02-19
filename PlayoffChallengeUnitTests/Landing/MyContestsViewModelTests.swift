//
//  MyContestsViewModelTests.swift
//  PlayoffChallengeTests
//
//  Unit tests for MyContestsViewModel.
//

import SwiftUI
import XCTest
@testable import PlayoffChallenge

final class MyContestsViewModelTests: XCTestCase {

    private var sut: MyContestsViewModel!

    @MainActor
    override func setUp() {
        super.setUp()
        sut = MyContestsViewModel(userId: UUID().uuidString)
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
        await sut.loadMyContests()

        XCTAssertFalse(sut.myContests.isEmpty)
    }

    @MainActor
    func testLoadMyContestsSetsLoadingFalseAfterCompletion() async {
        await sut.loadMyContests()

        XCTAssertFalse(sut.isLoading)
    }

    @MainActor
    func testLoadMyContestsClearsErrorMessage() async {
        await sut.loadMyContests()

        XCTAssertNil(sut.errorMessage)
    }

    // MARK: - Get Contest By ID Tests

    @MainActor
    func testGetContestByIdReturnsNilForUnknownId() {
        let found = sut.getContest(by: UUID())

        XCTAssertNil(found)
    }
}
