//
//  MyContestsViewModelCacheInvalidationTests.swift
//  PlayoffChallengeTests
//
//  Tests for cache invalidation on auth state changes in MyContestsViewModel.
//

import XCTest
@testable import PlayoffChallenge

@MainActor
final class MyContestsViewModelCacheInvalidationTests: XCTestCase {

    // MARK: - Cache Invalidation on Auth Change

    func testCacheInvalidatesOnAuthStateChange() async {
        // Arrange
        let dto = CreatedContestDTO.fixture(contest_name: "My Contest")
        let service = MockContestService(createdResult: .success([dto]))
        let authService = MockAuthService()

        // FIXED: Pass authService to ViewModel
        let vm = MyContestsViewModel(service: service, authService: authService)

        // Load initial contests
        await vm.loadMyContests()
        XCTAssertEqual(vm.myContests.count, 1)

        // Simulate auth state change (e.g., logout then login)
        authService.simulateAuthStateChange()

        // Wait for async observation to process
        try? await Task.sleep(nanoseconds: 100_000_000)

        // Assert: contests should be cleared
        XCTAssertTrue(vm.myContests.isEmpty, "Contests should be cleared on auth state change")
    }

    func testContestsClearedWhenAuthChanges() async {
        // Arrange
        let dto = CreatedContestDTO.fixture(contest_name: "User A Contest")
        let service = MockContestService(createdResult: .success([dto]))
        let authService = MockAuthService()

        // FIXED: Pass authService to ViewModel
        let vm = MyContestsViewModel(service: service, authService: authService)

        // User A loads contests
        await vm.loadMyContests()
        XCTAssertEqual(vm.myContests.count, 1)

        // Auth state changes (user logged out, different user logs in)
        authService.simulateAuthStateChange()

        // Wait for async observation
        try? await Task.sleep(nanoseconds: 100_000_000)

        // Assert: old contests cleared, ready for new user's data
        XCTAssertTrue(vm.myContests.isEmpty, "Old contests should be cleared on auth change")
    }
}
