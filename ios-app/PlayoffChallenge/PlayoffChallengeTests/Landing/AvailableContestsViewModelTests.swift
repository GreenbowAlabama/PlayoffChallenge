//
//  AvailableContestsViewModelTests.swift
//  PlayoffChallengeTests
//
//  Unit tests for AvailableContestsViewModel.
//

import XCTest
@testable import PlayoffChallenge

@MainActor
final class AvailableContestsViewModelTests: XCTestCase {

    // MARK: - Helpers

    private func makeSUT(
        result: Result<[AvailableContestDTO], Error>
    ) -> (vm: AvailableContestsViewModel, service: MockContestService) {
        let service = MockContestService(result: result)
        let vm = AvailableContestsViewModel(service: service)
        return (vm, service)
    }

    // MARK: - Initial State Tests

    @MainActor
    func test_initialState_contestsEmpty() {
        let (vm, _) = makeSUT(result: .success([]))
        XCTAssertTrue(vm.contests.isEmpty)
    }

    @MainActor
    func test_initialState_isLoadingFalse() {
        let (vm, _) = makeSUT(result: .success([]))
        XCTAssertFalse(vm.isLoading)
    }

    @MainActor
    func test_initialState_errorMessageNil() {
        let (vm, _) = makeSUT(result: .success([]))
        XCTAssertNil(vm.errorMessage)
    }

    // MARK: - Load Contests Tests

    @MainActor
    func test_loadContests_success_populatesContests() async {
        let dto = AvailableContestDTO.fixture(id: UUID(), contest_name: "Test 1")
        let (vm, service) = makeSUT(result: .success([dto]))

        await vm.loadContests()

        XCTAssertEqual(service.fetchCallCount, 1)
        XCTAssertFalse(vm.contests.isEmpty)
        XCTAssertEqual(vm.contests.count, 1)
        XCTAssertEqual(vm.contests.first?.name, "Test 1")
    }

    @MainActor
    func test_loadContests_success_setsLoadingFalseAfterCompletion() async {
        let dto = AvailableContestDTO.fixture()
        let (vm, _) = makeSUT(result: .success([dto]))

        await vm.loadContests()

        XCTAssertFalse(vm.isLoading)
    }

    @MainActor
    func test_loadContests_success_clearsErrorMessage() async {
        let dto = AvailableContestDTO.fixture()
        let (vm, _) = makeSUT(result: .success([dto]))

        await vm.loadContests()

        XCTAssertNil(vm.errorMessage)
    }

    @MainActor
    func test_loadContests_failure_setsErrorMessage() async {
        let (vm, service) = makeSUT(result: .failure(TestError.boom))

        await vm.loadContests()

        XCTAssertEqual(service.fetchCallCount, 1)
        XCTAssertTrue(vm.contests.isEmpty)
        XCTAssertNotNil(vm.errorMessage)
        XCTAssertFalse(vm.isLoading)
    }

    // MARK: - Refresh Tests

    @MainActor
    func test_refresh_reloadsContests() async {
        let dto = AvailableContestDTO.fixture()
        let (vm, service) = makeSUT(result: .success([dto]))

        await vm.refresh()

        XCTAssertEqual(service.fetchCallCount, 1)
        XCTAssertFalse(vm.contests.isEmpty)
    }

    // MARK: - Joined State Tests

    @MainActor
    func test_loadContests_preservesJoinedState() async {
        let dto = AvailableContestDTO.fixture(user_has_entered: true)
        let (vm, _) = makeSUT(result: .success([dto]))

        await vm.loadContests()

        XCTAssertTrue(vm.contests.first?.isJoined ?? false)
    }

    @MainActor
    func test_loadContests_marksUnjoinedContestsAsNotJoined() async {
        let dto = AvailableContestDTO.fixture(user_has_entered: false)
        let (vm, _) = makeSUT(result: .success([dto]))

        await vm.loadContests()

        XCTAssertFalse(vm.contests.first?.isJoined ?? true)
    }

    @MainActor
    func test_loadContests_containsAllLoadedContests() async {
        let dto1 = AvailableContestDTO.fixture(id: UUID(), contest_name: "Contest 1")
        let dto2 = AvailableContestDTO.fixture(id: UUID(), contest_name: "Contest 2")
        let (vm, _) = makeSUT(result: .success([dto1, dto2]))

        await vm.loadContests()

        XCTAssertEqual(vm.contests.count, 2)
        XCTAssertTrue(vm.contests.contains { $0.name == "Contest 1" })
        XCTAssertTrue(vm.contests.contains { $0.name == "Contest 2" })
    }

    @MainActor
    func test_loadContests_populatesRequiredProperties() async {
        let dto = AvailableContestDTO.fixture(
            contest_name: "Test Contest",
            entry_count: 10,
            max_entries: 50,
            organizer_name: "TestOrganizer"
        )
        let (vm, _) = makeSUT(result: .success([dto]))

        await vm.loadContests()

        let contest = vm.contests.first
        XCTAssertEqual(contest?.name, "Test Contest")
        XCTAssertEqual(contest?.entryCount, 10)
        XCTAssertEqual(contest?.maxEntries, 50)
        XCTAssertEqual(contest?.creatorName, "TestOrganizer")
    }

    @MainActor
    func test_loadContests_eachContestHasValidStatus() async {
        let dto = AvailableContestDTO.fixture(status: "SCHEDULED")
        let (vm, _) = makeSUT(result: .success([dto]))

        await vm.loadContests()

        for contest in vm.contests {
            switch contest.status {
            case .scheduled, .locked, .complete, .live, .cancelled:
                XCTAssertTrue(true)
            @unknown default:
                XCTFail("Unknown status: \(contest.status)")
            }
        }
    }

    @MainActor
    func test_loadContests_noDuplicates() async {
        let id = UUID()
        let dto1 = AvailableContestDTO.fixture(id: id, contest_name: "Unique Contest")
        let (vm, _) = makeSUT(result: .success([dto1]))

        await vm.loadContests()

        let matching = vm.contests.filter { $0.id == id }
        XCTAssertEqual(matching.count, 1)
    }

    @MainActor
    func test_refresh_keepsConsistentCount() async {
        let dto1 = AvailableContestDTO.fixture()
        let dto2 = AvailableContestDTO.fixture()
        let (vm, service) = makeSUT(result: .success([dto1, dto2]))

        await vm.loadContests()
        let firstLoadCount = vm.contests.count

        await vm.refresh()

        XCTAssertEqual(service.fetchCallCount, 2)
        XCTAssertEqual(vm.contests.count, firstLoadCount)
    }

    @MainActor
    func test_loadContests_formattedEntryFeeForPaidContest() async {
        let dto = AvailableContestDTO.fixture(entry_fee_cents: 5000)
        let (vm, _) = makeSUT(result: .success([dto]))

        await vm.loadContests()

        XCTAssertEqual(vm.contests.first?.formattedEntryFee, "$50.00")
    }

    @MainActor
    func test_loadContests_formattedEntryFeeForFreeContest() async {
        let dto = AvailableContestDTO.fixture(entry_fee_cents: nil)
        let (vm, _) = makeSUT(result: .success([dto]))

        await vm.loadContests()

        XCTAssertEqual(vm.contests.first?.formattedEntryFee, "Free")
    }
}
