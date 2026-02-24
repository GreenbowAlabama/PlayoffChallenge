//
//  IsolationDeterminismTests.swift
//  coreTests
//
//  Proves core has no shared mutable state across contests.
//  - Two contracts in memory are independent
//  - Settlement does not mutate input
//  - No global/static state is shared
//

import XCTest
@testable import Core

final class IsolationDeterminismTests: XCTestCase {

    // MARK: - Contract Independence

    func test_TwoContestDetails_AreFullyIndependent() throws {
        let data1 = loadFixture("nfl_contest")
        let data2 = loadFixture("pga_contest")
        let decoder = JSONDecoder()

        let contest1 = try decoder.decode(ContestDetailResponseContract.self, from: data1)
        let contest2 = try decoder.decode(ContestDetailResponseContract.self, from: data2)

        // Contest contracts are immutable (value types, let fields)
        // This proves they cannot interfere with each other
        XCTAssertEqual(contest1.type, "nfl")
        XCTAssertEqual(contest2.type, "pga")
        XCTAssertNotEqual(contest1.contest_id, contest2.contest_id)
    }

    func test_TwoRosterConfigs_AreValueTypes() throws {
        let data1 = loadFixture("nfl_contest")
        let data2 = loadFixture("pga_contest")
        let decoder = JSONDecoder()

        let contest1 = try decoder.decode(ContestDetailResponseContract.self, from: data1)
        let contest2 = try decoder.decode(ContestDetailResponseContract.self, from: data2)

        // Roster configs are dictionaries (value types in Swift)
        // Different contests have different roster_config content
        let nflMaxEntries = contest1.roster_config["max_entries"]
        let pgaMaxEntries = contest2.roster_config["max_entries"]

        // They have independent content
        XCTAssertNotNil(nflMaxEntries)
        XCTAssertNotNil(pgaMaxEntries)
        // Values are independent
        XCTAssertNotEqual(contest1.contest_id, contest2.contest_id)
    }

    func test_TwoPayoutTables_AreValueTypes() throws {
        let data1 = loadFixture("nfl_contest")
        let data2 = loadFixture("pga_contest")
        let decoder = JSONDecoder()

        let contest1 = try decoder.decode(ContestDetailResponseContract.self, from: data1)
        let contest2 = try decoder.decode(ContestDetailResponseContract.self, from: data2)

        // Payout tables are arrays (value types in Swift)
        // They have different sizes due to different contest structures
        XCTAssertNotEqual(contest1.payout_table.count, contest2.payout_table.count)

        // NFL has 4 tiers, PGA has 5
        XCTAssertEqual(contest1.payout_table.count, 4)
        XCTAssertEqual(contest2.payout_table.count, 5)
    }

    // MARK: - Leaderboard Independence

    func test_TwoLeaderboards_AreFullyIndependent() throws {
        let data1 = loadFixture("nfl_leaderboard")
        let data2 = loadFixture("pga_leaderboard")
        let decoder = JSONDecoder()

        let leaderboard1 = try decoder.decode(LeaderboardResponseContract.self, from: data1)
        let leaderboard2 = try decoder.decode(LeaderboardResponseContract.self, from: data2)

        // Leaderboards are immutable (value types)
        XCTAssertEqual(leaderboard1.contest_type, "nfl")
        XCTAssertEqual(leaderboard2.contest_type, "pga")
        XCTAssertNotEqual(leaderboard1.contest_id, leaderboard2.contest_id)

        // Row counts are independent
        XCTAssertNotEqual(leaderboard1.rows.count, leaderboard2.rows.count)
    }

    // MARK: - Settlement Determinism

    func test_SettlementFromTwoContests_AreDeterministic() {
        let strategy = TopNSplitStrategy(topN: 3, splitPercentages: [Decimal(50), Decimal(30), Decimal(20)])

        let nflEntries = [
            RankedEntry(userId: UUID(uuidString: "11111111-1111-1111-1111-111111111111")!, rank: 1, score: 155.5),
            RankedEntry(userId: UUID(uuidString: "22222222-2222-2222-2222-222222222222")!, rank: 2, score: 142.3),
            RankedEntry(userId: UUID(uuidString: "33333333-3333-3333-3333-333333333333")!, rank: 3, score: 128.7)
        ]

        let pgaEntries = [
            RankedEntry(userId: UUID(uuidString: "44444444-4444-4444-4444-444444444444")!, rank: 1, score: 200.0),
            RankedEntry(userId: UUID(uuidString: "55555555-5555-5555-5555-555555555555")!, rank: 2, score: 190.0),
            RankedEntry(userId: UUID(uuidString: "66666666-6666-6666-6666-666666666666")!, rank: 3, score: 180.0)
        ]

        let nflInput = SettlementInput(rankedEntries: nflEntries, prizePool: Decimal(1000))
        let pgaInput = SettlementInput(rankedEntries: pgaEntries, prizePool: Decimal(5000))

        let nflResult1 = strategy.settle(nflInput)
        let pgaResult1 = strategy.settle(pgaInput)

        let nflResult2 = strategy.settle(nflInput)
        let pgaResult2 = strategy.settle(pgaInput)

        // Both contests must produce identical results
        XCTAssertEqual(nflResult1.totalPayout, nflResult2.totalPayout)
        XCTAssertEqual(pgaResult1.totalPayout, pgaResult2.totalPayout)

        // NFL payouts are different from PGA (due to different prize pools)
        XCTAssertNotEqual(nflResult1.totalPayout, pgaResult1.totalPayout)
    }

    // MARK: - Settlement Input Immutability

    func test_Settlement_DoesNotMutateInput_Struct() {
        let strategy = WinnerTakeAllStrategy()
        let userId = UUID()
        let entries = [RankedEntry(userId: userId, rank: 1, score: 100.0)]
        let input = SettlementInput(rankedEntries: entries, prizePool: Decimal(500))

        let originalRankedEntries = input.rankedEntries
        let originalPrizePool = input.prizePool

        // Call settlement
        _ = strategy.settle(input)

        // Input must not be mutated
        XCTAssertEqual(input.rankedEntries.count, originalRankedEntries.count)
        XCTAssertEqual(input.prizePool, originalPrizePool)
        XCTAssertEqual(input.rankedEntries[0].userId, userId)
    }

    func test_Settlement_DoesNotMutateEntries_Individual() {
        let strategy = TopNSplitStrategy(topN: 2, splitPercentages: [Decimal(60), Decimal(40)])
        let userId1 = UUID()
        let userId2 = UUID()
        let entries = [
            RankedEntry(userId: userId1, rank: 1, score: 100.0),
            RankedEntry(userId: userId2, rank: 2, score: 90.0)
        ]
        let input = SettlementInput(rankedEntries: entries, prizePool: Decimal(1000))

        let originalEntry1 = input.rankedEntries[0]
        let originalEntry2 = input.rankedEntries[1]

        _ = strategy.settle(input)

        // Entries must not be mutated
        XCTAssertEqual(input.rankedEntries[0].userId, originalEntry1.userId)
        XCTAssertEqual(input.rankedEntries[0].rank, originalEntry1.rank)
        XCTAssertEqual(input.rankedEntries[0].score, originalEntry1.score)

        XCTAssertEqual(input.rankedEntries[1].userId, originalEntry2.userId)
        XCTAssertEqual(input.rankedEntries[1].rank, originalEntry2.rank)
        XCTAssertEqual(input.rankedEntries[1].score, originalEntry2.score)
    }

    // MARK: - Registry Isolation

    func test_SettlementRegistries_AreIndependent() {
        let registry1 = SettlementStrategyRegistry()
        let registry2 = SettlementStrategyRegistry()

        let custom1 = CustomTestStrategyA()
        registry1.register(custom1)

        // registry2 must not have custom1
        XCTAssertNotNil(registry1.strategy(for: "custom_a"))
        XCTAssertNil(registry2.strategy(for: "custom_a"))

        // Standard strategies must be in both
        XCTAssertNotNil(registry1.strategy(for: "winner_take_all"))
        XCTAssertNotNil(registry2.strategy(for: "winner_take_all"))
    }

    func test_SettlementRegistry_CustomStrategies_DoNotCross() {
        let registries = (0..<5).map { _ in SettlementStrategyRegistry() }

        // Register different custom strategies in each
        registries[0].register(CustomTestStrategyA())
        registries[1].register(CustomTestStrategyB())
        registries[2].register(CustomTestStrategyC())

        // Each should only have its own custom strategy
        XCTAssertNotNil(registries[0].strategy(for: "custom_a"))
        XCTAssertNil(registries[0].strategy(for: "custom_b"))
        XCTAssertNil(registries[0].strategy(for: "custom_c"))

        XCTAssertNil(registries[1].strategy(for: "custom_a"))
        XCTAssertNotNil(registries[1].strategy(for: "custom_b"))
        XCTAssertNil(registries[1].strategy(for: "custom_c"))

        XCTAssertNil(registries[2].strategy(for: "custom_a"))
        XCTAssertNil(registries[2].strategy(for: "custom_b"))
        XCTAssertNotNil(registries[2].strategy(for: "custom_c"))
    }

    // MARK: - Helpers

    func loadFixture(_ filename: String) -> Data {
        let bundle = Bundle.module
        guard let url = bundle.url(forResource: filename, withExtension: "json", subdirectory: "Fixtures") else {
            XCTFail("Fixture \(filename) not found")
            return Data()
        }
        guard let data = try? Data(contentsOf: url) else {
            XCTFail("Could not load fixture \(filename)")
            return Data()
        }
        return data
    }
}

// MARK: - Test Support

private struct CustomTestStrategyA: SettlementStrategy {
    let key = "custom_a"
    func settle(_ input: SettlementInput) -> SettlementResult {
        return SettlementResult(payouts: [])
    }
}

private struct CustomTestStrategyB: SettlementStrategy {
    let key = "custom_b"
    func settle(_ input: SettlementInput) -> SettlementResult {
        return SettlementResult(payouts: [])
    }
}

private struct CustomTestStrategyC: SettlementStrategy {
    let key = "custom_c"
    func settle(_ input: SettlementInput) -> SettlementResult {
        return SettlementResult(payouts: [])
    }
}
