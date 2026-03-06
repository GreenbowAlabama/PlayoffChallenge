//
//  AvailableContestsViewModelCacheInvalidationTests.swift
//  PlayoffChallengeTests
//
//  Tests for cache invalidation on auth state changes.
//

import XCTest
@testable import PlayoffChallenge

@MainActor
final class AvailableContestsViewModelCacheInvalidationTests: XCTestCase {

    // MARK: - Cache Invalidation on Auth Change

    func testCacheInvalidatesOnAuthStateChange() async {
        // Arrange
        let dto = AvailableContestDTO.fixture(contest_name: "Test Contest")
        let service = MockContestService(result: .success([dto]))
        let authService = MockAuthService()

        // FIXED: Pass authService to ViewModel
        let vm = AvailableContestsViewModel(service: service, authService: authService)

        // Load initial contests
        await vm.loadContests()
        XCTAssertEqual(vm.contests.count, 1)

        // Simulate auth state change (e.g., logout then login)
        // This should trigger cache invalidation
        authService.simulateAuthStateChange()

        // Wait for async observation to process
        try? await Task.sleep(nanoseconds: 100_000_000) // 0.1 seconds

        // Assert: contests should be cleared
        XCTAssertTrue(vm.contests.isEmpty, "Contests should be cleared on auth state change")
    }

    func testManualRefreshBypassesHasLoadedGuard() async {
        // Arrange
        let dto1 = AvailableContestDTO.fixture(id: UUID(), contest_name: "Contest 1")
        let dto2 = AvailableContestDTO.fixture(id: UUID(), contest_name: "Contest 2")
        let service = MockContestService(result: .success([dto1]))
        let authService = MockAuthService()

        // FIXED: Pass authService to ViewModel
        let vm = AvailableContestsViewModel(service: service, authService: authService)

        // Load initial contests
        await vm.loadContests()
        XCTAssertEqual(service.fetchCallCount, 1)
        XCTAssertEqual(vm.contests.count, 1)

        // Update service to return new data
        service.result = .success([dto2])

        // Refresh should bypass hasLoaded guard and fetch again
        await vm.refresh()

        // Assert: should have called fetch twice and loaded new data
        XCTAssertEqual(service.fetchCallCount, 2, "Refresh should call fetch even after hasLoaded=true")
        XCTAssertEqual(vm.contests.count, 1)
        XCTAssertEqual(vm.contests.first?.name, "Contest 2", "Should have fresh data from refresh")
    }

    func testContestsClearedWhenAuthChanges() async {
        // Arrange
        let dto = AvailableContestDTO.fixture(contest_name: "User A Contest")
        let service = MockContestService(result: .success([dto]))
        let authService = MockAuthService()

        // FIXED: Pass authService to ViewModel
        let vm = AvailableContestsViewModel(service: service, authService: authService)

        // User A loads contests
        await vm.loadContests()
        XCTAssertEqual(vm.contests.count, 1)
        XCTAssertEqual(vm.contests.first?.name, "User A Contest")

        // Auth state changes (user logged out, different user logs in)
        authService.simulateAuthStateChange()

        // Wait for async observation to process
        try? await Task.sleep(nanoseconds: 100_000_000)

        // Assert: old contests cleared, ready for new user's data
        XCTAssertTrue(vm.contests.isEmpty, "Old contests should be cleared on auth change")
    }

    func testLoadingStateResetAfterAuthChange() async {
        // Arrange
        let dto = AvailableContestDTO.fixture()
        let service = MockContestService(result: .success([dto]))
        let authService = MockAuthService()

        // FIXED: Pass authService to ViewModel
        let vm = AvailableContestsViewModel(service: service, authService: authService)

        // Load contests
        await vm.loadContests()
        XCTAssertFalse(vm.isLoading)

        // Simulate auth change
        authService.simulateAuthStateChange()

        // Wait for async observation
        try? await Task.sleep(nanoseconds: 100_000_000)

        // Assert: contests cleared, ready for next load
        XCTAssertTrue(vm.contests.isEmpty)
    }
}
