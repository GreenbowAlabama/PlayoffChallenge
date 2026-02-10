//
//  DeepLinkCoordinatorTests.swift
//  PlayoffChallengeTests
//
//  Unit tests for DeepLinkCoordinator - URL parsing and resolve-only behavior
//

import XCTest
@testable import PlayoffChallenge

@MainActor
final class DeepLinkCoordinatorTests: XCTestCase {

    var sut: DeepLinkCoordinator!

    override func setUp() {
        super.setUp()
        sut = DeepLinkCoordinator(
            joinLinkResolver: StubJoinLinkResolver(),
            pendingJoinStore: StubPendingJoinStore()
        )
    }

    override func tearDown() {
        sut = nil
        super.tearDown()
    }

    // MARK: - URL Parsing Tests

    func test_parse_validJoinURL_returnsJoinAction() {
        let url = URL(string: "https://app.playoffchallenge.com/join/abc123")!
        let action = sut.parse(url: url)
        XCTAssertEqual(action, .joinContest(token: "abc123"))
    }

    func test_parse_customSchemeJoinURL_returnsJoinAction() {
        let url = URL(string: "playoffchallenge://join/xyz789")!
        let action = sut.parse(url: url)
        XCTAssertEqual(action, .joinContest(token: "xyz789"))
    }

    func test_parse_invalidURL_returnsUnknown() {
        let url = URL(string: "https://app.playoffchallenge.com/other/page")!
        let action = sut.parse(url: url)
        XCTAssertEqual(action, .unknown)
    }

    func test_parse_rootURL_returnsUnknown() {
        let url = URL(string: "https://app.playoffchallenge.com/")!
        let action = sut.parse(url: url)
        XCTAssertEqual(action, .unknown)
    }

    func test_parse_joinURLWithNestedPath_returnsJoinAction() {
        let url = URL(string: "https://app.playoffchallenge.com/contests/join/token123")!
        let action = sut.parse(url: url)
        XCTAssertEqual(action, .joinContest(token: "token123"))
    }

    // MARK: - Resolve + Preview Tests (coordinator never joins)

    func test_handle_joinAction_navigatesToContest() async {
        let resolver = ConfigurableJoinLinkResolver()
        resolver.resolveResult = .success(createTestResolvedLink())

        let sut = DeepLinkCoordinator(
            joinLinkResolver: resolver,
            pendingJoinStore: StubPendingJoinStore()
        )

        await sut.handle(action: .joinContest(token: "test123"))

        XCTAssertTrue(sut.shouldNavigateToContest)
        XCTAssertNotNil(sut.resolvedJoinLink)
    }

    func test_handle_openContestWithMissingSlotInfo_navigatesToContest() async {
        // No client-side gatekeeping — all resolved contests navigate directly
        let resolver = ConfigurableJoinLinkResolver()
        resolver.resolveResult = .success(createResolvedLinkWithMissingSlotInfo())

        let sut = DeepLinkCoordinator(
            joinLinkResolver: resolver,
            pendingJoinStore: StubPendingJoinStore()
        )

        await sut.handle(action: .joinContest(token: "test123"))

        XCTAssertTrue(sut.shouldNavigateToContest, "Open contest with missing slot info should navigate to contest")
        XCTAssertNotNil(sut.resolvedJoinLink)
        XCTAssertNil(sut.error)
    }

    func test_handle_fullContest_stillNavigatesToContest() async {
        // Coordinator no longer gatekeeps — ContestDetailView handles joinability
        let resolver = ConfigurableJoinLinkResolver()
        resolver.resolveResult = .success(createResolvedLinkWithFullSlots())

        let sut = DeepLinkCoordinator(
            joinLinkResolver: resolver,
            pendingJoinStore: StubPendingJoinStore()
        )

        await sut.handle(action: .joinContest(token: "test123"))

        XCTAssertTrue(sut.shouldNavigateToContest, "Full contest should still navigate — joinability is ContestDetailView's concern")
        XCTAssertNotNil(sut.resolvedJoinLink)
        XCTAssertNil(sut.error)
    }

    func test_handle_openContestWithAvailableSlots_navigatesToContest() async {
        let resolver = ConfigurableJoinLinkResolver()
        resolver.resolveResult = .success(createTestResolvedLink())

        let sut = DeepLinkCoordinator(
            joinLinkResolver: resolver,
            pendingJoinStore: StubPendingJoinStore()
        )

        await sut.handle(action: .joinContest(token: "test123"))

        XCTAssertTrue(sut.shouldNavigateToContest, "Open contest with available slots should navigate to contest")
        XCTAssertNotNil(sut.resolvedJoinLink)
        XCTAssertNil(sut.error)
    }

    // MARK: - Navigation Tests

    func test_dismiss_clearsState() {
        sut.dismiss()

        XCTAssertNil(sut.resolvedJoinLink)
        XCTAssertFalse(sut.shouldNavigateToContest)
        XCTAssertNil(sut.currentAction)
    }

    func test_clearError_clearsErrorState() {
        sut.clearError()

        XCTAssertNil(sut.error)
    }

    // MARK: - ContestSummary Model Tests

    func test_contestSummary_missingSlotInfo_isNotFull() {
        let contest = ContestSummary(
            id: UUID(),
            name: "Test",
            entryFee: 10.0,
            totalSlots: 0,
            filledSlots: 0,
            status: .open
        )

        XCTAssertFalse(contest.hasSlotInfo, "totalSlots=0 means no slot info")
        XCTAssertFalse(contest.isFull, "Contest with missing slot info should NOT be considered full")
    }

    func test_contestSummary_knownSlotInfo_fullWhenNoSlotsRemain() {
        let contest = ContestSummary(
            id: UUID(),
            name: "Test",
            entryFee: 10.0,
            totalSlots: 10,
            filledSlots: 10,
            status: .open
        )

        XCTAssertTrue(contest.hasSlotInfo, "totalSlots > 0 means slot info is known")
        XCTAssertEqual(contest.slotsRemaining, 0)
        XCTAssertTrue(contest.isFull, "Contest with no remaining slots should be full")
    }

    func test_contestSummary_knownSlotInfo_notFullWhenSlotsRemain() {
        let contest = ContestSummary(
            id: UUID(),
            name: "Test",
            entryFee: 10.0,
            totalSlots: 10,
            filledSlots: 5,
            status: .open
        )

        XCTAssertTrue(contest.hasSlotInfo)
        XCTAssertEqual(contest.slotsRemaining, 5)
        XCTAssertFalse(contest.isFull, "Contest with remaining slots should not be full")
    }

    // MARK: - Helper Methods

    private func createResolvedLinkWithMissingSlotInfo() -> ResolvedJoinLink {
        return ResolvedJoinLink(
            token: "test123",
            contestId: UUID(),
            isValidForEnvironment: true,
            environmentMismatch: nil
        )
    }

    private func createResolvedLinkWithFullSlots() -> ResolvedJoinLink {
        return ResolvedJoinLink(
            token: "test123",
            contestId: UUID(),
            isValidForEnvironment: true,
            environmentMismatch: nil
        )
    }

    private func createTestResolvedLink() -> ResolvedJoinLink {
        return ResolvedJoinLink(
            token: "test123",
            contestId: UUID(),
            isValidForEnvironment: true,
            environmentMismatch: nil
        )
    }
}

// MARK: - Test Stubs

private final class StubJoinLinkResolver: JoinLinkResolving {
    func resolve(token: String) async throws -> ResolvedJoinLink {
        fatalError("Not used in URL parsing tests")
    }
}

private final class StubPendingJoinStore: PendingJoinStoring {
    func store(token: String) {}
    func retrieve() -> String? { nil }
    func clear() {}
    var hasPendingJoin: Bool { false }
}

// MARK: - Configurable Test Doubles

private final class ConfigurableJoinLinkResolver: JoinLinkResolving {
    var resolveResult: Result<ResolvedJoinLink, Error> = .failure(JoinLinkError.contestNotFound)

    func resolve(token: String) async throws -> ResolvedJoinLink {
        switch resolveResult {
        case .success(let link):
            return link
        case .failure(let error):
            throw error
        }
    }
}
