//
//  LandingViewModelTests.swift
//  PlayoffChallengeTests
//
//  Unit tests for LandingViewModel.
//

import SwiftUI
import XCTest
@testable import PlayoffChallenge

final class LandingViewModelTests: XCTestCase {

    private var sut: LandingViewModel!

    @MainActor
    override func setUp() {
        super.setUp()
        sut = LandingViewModel()
    }

    override func tearDown() {
        sut = nil
        super.tearDown()
    }

    // MARK: - Initial State Tests

    @MainActor
    func testInitialNavigationPathIsEmpty() {
        XCTAssertTrue(sut.navigationPath.isEmpty)
    }

    // MARK: - Navigation Tests

    @MainActor
    func testNavigateToAvailableContestsAppendsPath() {
        sut.navigateToAvailableContests()
        XCTAssertEqual(sut.navigationPath.count, 1)
    }

    @MainActor
    func testNavigateToCreateContestAppendsPath() {
        sut.navigateToCreateContest()
        XCTAssertEqual(sut.navigationPath.count, 1)
    }

    @MainActor
    func testNavigateToContestManagementAppendsPath() {
        sut.navigateToContestManagement()
        XCTAssertEqual(sut.navigationPath.count, 1)
    }

    @MainActor
    func testNavigateToProfileAppendsPath() {
        sut.navigateToProfile()
        XCTAssertEqual(sut.navigationPath.count, 1)
    }

    @MainActor
    func testMultipleNavigationsAccumulate() {
        sut.navigateToAvailableContests()
        sut.navigateToCreateContest()
        sut.navigateToProfile()
        XCTAssertEqual(sut.navigationPath.count, 3)
    }

    @MainActor
    func testNavigateToRulesPreviewWithContest() {
        let contest = MockContest.samples[0]
        sut.navigateToRulesPreview(contest: contest)
        XCTAssertEqual(sut.navigationPath.count, 1)
    }

    @MainActor
    func testNavigateToContestDetailWithContestId() {
        let contest = MockContest.samples[0]
        sut.navigateToContestDetail(contestId: contest.id)
        XCTAssertEqual(sut.navigationPath.count, 1)
    }

    @MainActor
    func testNavigateToLeaderboardWithContest() {
        let contest = MockContest.samples[0]
        sut.navigateToLeaderboard(contest: contest)
        XCTAssertEqual(sut.navigationPath.count, 1)
    }
}
