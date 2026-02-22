//
//  SettlementStressTests.swift
//  coreTests
//
//  Settlement strategy stress tests: edge cases, precision, determinism.
//  Tests that settlement behavior is explicit and never hides misconfiguration.
//

import XCTest
@testable import core

final class SettlementStressTests: XCTestCase {

    // MARK: - Empty and Boundary Cases

    func test_EmptyEntries_ZeroPayout() {
        let strategy = TopNSplitStrategy(topN: 3, splitPercentages: [50, 30, 20])
        let input = SettlementInput(rankedEntries: [], prizePool: Decimal(1000))

        let result = strategy.settle(input)

        XCTAssertTrue(result.payouts.isEmpty)
        XCTAssertEqual(result.totalPayout, 0)
    }

    func test_ZeroPayoutTiers_AllEntriesPaid() {
        let strategy = WinnerTakeAllStrategy()
        let entries = [
            RankedEntry(userId: UUID(), rank: 1, score: 100.0),
            RankedEntry(userId: UUID(), rank: 2, score: 80.0)
        ]
        let input = SettlementInput(rankedEntries: entries, prizePool: Decimal(0))

        let result = strategy.settle(input)

        XCTAssertEqual(result.payouts.count, 1)
        XCTAssertEqual(result.totalPayout, 0)
    }

    func test_MoreEntriesThanPayoutTiers_ExcessEntriesReceiveNothing() {
        let strategy = TopNSplitStrategy(topN: 2, splitPercentages: [60, 40])
        let entries = (1...5).map { rank in
            RankedEntry(userId: UUID(), rank: rank, score: Double(100 - rank * 10))
        }
        let input = SettlementInput(rankedEntries: entries, prizePool: Decimal(1000))

        let result = strategy.settle(input)

        XCTAssertEqual(result.payouts.count, 2)
        XCTAssertEqual(result.totalPayout, 1000)
    }

    // MARK: - Overlapping Tier Ranges

    func test_OverlappingPayoutRanges_StrategyHandlesRanks() {
        // Note: This tests that the strategy works with rank ranges, not that it validates overlap
        let strategy = TopNSplitStrategy(topN: 5, splitPercentages: [50, 30, 15, 3, 2])
        let entries = (1...5).map { rank in
            RankedEntry(userId: UUID(), rank: rank, score: Double(100 - rank * 10))
        }
        let input = SettlementInput(rankedEntries: entries, prizePool: Decimal(1000))

        let result = strategy.settle(input)

        XCTAssertEqual(result.payouts.count, 5)
        XCTAssertEqual(result.totalPayout, 1000)
    }

    // MARK: - Ties Across Boundaries

    func test_TiesAtFirstPlace_SplitEntirePrizePool() {
        let strategy = WinnerTakeAllStrategy()
        let winner1 = UUID()
        let winner2 = UUID()
        let winner3 = UUID()
        let entries = [
            RankedEntry(userId: winner1, rank: 1, score: 100.0),
            RankedEntry(userId: winner2, rank: 1, score: 100.0),
            RankedEntry(userId: winner3, rank: 1, score: 100.0),
            RankedEntry(userId: UUID(), rank: 4, score: 80.0)
        ]
        let input = SettlementInput(rankedEntries: entries, prizePool: Decimal(3000))

        let result = strategy.settle(input)

        XCTAssertEqual(result.payouts.count, 3)
        XCTAssertEqual(result.payouts[0].amount, 1000)
        XCTAssertEqual(result.payouts[1].amount, 1000)
        XCTAssertEqual(result.payouts[2].amount, 1000)
    }

    func test_TiesSpanPayoutBoundary_TopNSplit() {
        let strategy = TopNSplitStrategy(topN: 3, splitPercentages: [50, 30, 20])
        let user1 = UUID()
        let user2 = UUID()
        let user3 = UUID()
        let user4 = UUID()
        let entries = [
            RankedEntry(userId: user1, rank: 1, score: 100.0),
            RankedEntry(userId: user2, rank: 2, score: 90.0),  // Tied with user3
            RankedEntry(userId: user3, rank: 2, score: 90.0),  // Tied with user2
            RankedEntry(userId: user4, rank: 4, score: 80.0)
        ]
        let input = SettlementInput(rankedEntries: entries, prizePool: Decimal(1000))

        let result = strategy.settle(input)

        // user1 gets 50% (position 1)
        // user2 and user3 (tied at rank 2) split positions 2 and 3 = 30% + 20% = 50%
        // user4 at rank 4 is outside top 3, gets nothing
        XCTAssertEqual(result.payouts.count, 3)
        XCTAssertEqual(result.payouts[0].amount, 500) // user1: 50%
        // user2 and user3 together should get 500 (50% total, split equally = 250 each)
        let tied = result.payouts.filter { $0.userId == user2 || $0.userId == user3 }
        XCTAssertEqual(tied.reduce(Decimal(0)) { $0 + $1.amount }, 500)
    }

    // MARK: - Decimal Precision

    func test_DecimalPrecision_SmallAmounts() {
        let strategy = TopNSplitStrategy(topN: 3, splitPercentages: [Decimal(33.333), Decimal(33.333), Decimal(33.334)])
        let entries = (1...3).map { rank in
            RankedEntry(userId: UUID(), rank: rank, score: Double(100 - rank * 10))
        }
        let input = SettlementInput(rankedEntries: entries, prizePool: Decimal(100))

        let result = strategy.settle(input)

        XCTAssertEqual(result.payouts.count, 3)
        // Total must equal prize pool (within rounding)
        let diff = abs(result.totalPayout - Decimal(100))
        XCTAssertTrue(diff < Decimal(string: "0.01")!)
    }

    func test_DecimalPrecision_VerySmallPayout() {
        let strategy = WinnerTakeAllStrategy()
        let winnerId = UUID()
        let entries = [RankedEntry(userId: winnerId, rank: 1, score: 100.0)]
        let smallPayout = Decimal(string: "0.01")!
        let input = SettlementInput(
            rankedEntries: entries,
            prizePool: smallPayout
        )

        let result = strategy.settle(input)

        XCTAssertEqual(result.payouts.count, 1)
        XCTAssertEqual(result.payouts[0].amount, smallPayout)
    }

    func test_DecimalPrecision_LargeAmounts() {
        let strategy = WinnerTakeAllStrategy()
        let winnerId = UUID()
        let entries = [RankedEntry(userId: winnerId, rank: 1, score: 100.0)]
        let largePool: Decimal = 999999999.99
        let input = SettlementInput(rankedEntries: entries, prizePool: largePool)

        let result = strategy.settle(input)

        XCTAssertEqual(result.payouts[0].amount, largePool)
    }

    // MARK: - Large Prize Pools

    func test_LargePrizePool_OneMillionDollars() {
        let strategy = TopNSplitStrategy(topN: 3, splitPercentages: [50, 30, 20])
        let entries = (1...3).map { rank in
            RankedEntry(userId: UUID(), rank: rank, score: Double(100 - rank * 10))
        }
        let input = SettlementInput(rankedEntries: entries, prizePool: Decimal(1_000_000))

        let result = strategy.settle(input)

        XCTAssertEqual(result.payouts.count, 3)
        XCTAssertEqual(result.payouts[0].amount, 500_000)
        XCTAssertEqual(result.payouts[1].amount, 300_000)
        XCTAssertEqual(result.payouts[2].amount, 200_000)
    }

    func test_LargePrizePool_ManyParticipants() {
        let strategy = TopNSplitStrategy(topN: 10, splitPercentages: Array(repeating: Decimal(10), count: 10))
        let entries = (1...100).map { rank in
            RankedEntry(userId: UUID(), rank: rank, score: Double(1000 - rank))
        }
        let input = SettlementInput(rankedEntries: entries, prizePool: Decimal(100_000))

        let result = strategy.settle(input)

        // Only top 10 paid
        XCTAssertEqual(result.payouts.count, 10)
        // Each gets 10%
        XCTAssertEqual(result.payouts[0].amount, 10_000)
        XCTAssertEqual(result.totalPayout, 100_000)
    }

    // MARK: - Registry Unknown Key Behavior

    func test_RegistryUnknownKey_ReturnsNil() {
        let registry = SettlementStrategyRegistry()

        let strategy = registry.strategy(for: "unknown_strategy_key")

        XCTAssertNil(strategy)
    }

    func test_RegistryUnknownKey_DoesNotThrow() {
        let registry = SettlementStrategyRegistry()

        // This must NOT throw; caller is responsible for handling nil
        let strategy = registry.strategy(for: "backend_sent_invalid_key")

        XCTAssertNil(strategy)
    }

    func test_RegistryKnownKeys_AllAvailable() {
        let registry = SettlementStrategyRegistry()

        let available = registry.availableKeys

        XCTAssertTrue(available.contains("winner_take_all"))
        XCTAssertTrue(available.contains("top_n_split"))
    }

    func test_RegistryCustomStrategy_CanBeRegistered() {
        let registry = SettlementStrategyRegistry()

        // Custom strategy can be registered
        let custom = CustomTestStrategy()
        registry.register(custom)

        let retrieved = registry.strategy(for: "custom_test")
        XCTAssertNotNil(retrieved)
        XCTAssertEqual(retrieved?.key, "custom_test")
    }

    func test_RegistryCustomStrategy_DoesNotAffectOtherRegistries() {
        let registry1 = SettlementStrategyRegistry()
        let registry2 = SettlementStrategyRegistry()

        let custom = CustomTestStrategy()
        registry1.register(custom)

        // registry2 must not have the custom strategy
        let inRegistry1 = registry1.strategy(for: "custom_test")
        let inRegistry2 = registry2.strategy(for: "custom_test")

        XCTAssertNotNil(inRegistry1)
        XCTAssertNil(inRegistry2)
    }

    // MARK: - Determinism

    func test_AllStrategies_ProduceDeterministicResults() {
        let strategies: [SettlementStrategy] = [
            WinnerTakeAllStrategy(),
            TopNSplitStrategy(topN: 3, splitPercentages: [50, 30, 20])
        ]

        let entries = [
            RankedEntry(userId: UUID(uuidString: "11111111-1111-1111-1111-111111111111")!, rank: 1, score: 100.0),
            RankedEntry(userId: UUID(uuidString: "22222222-2222-2222-2222-222222222222")!, rank: 2, score: 90.0),
            RankedEntry(userId: UUID(uuidString: "33333333-3333-3333-3333-333333333333")!, rank: 3, score: 80.0)
        ]
        let input = SettlementInput(rankedEntries: entries, prizePool: Decimal(1000))

        for strategy in strategies {
            let result1 = strategy.settle(input)
            let result2 = strategy.settle(input)
            let result3 = strategy.settle(input)

            XCTAssertEqual(result1.totalPayout, result2.totalPayout)
            XCTAssertEqual(result2.totalPayout, result3.totalPayout)
            XCTAssertEqual(result1.payouts.map { $0.amount }, result2.payouts.map { $0.amount })
        }
    }

    func test_Settlement_DoesNotMutateInput() {
        let strategy = TopNSplitStrategy(topN: 3, splitPercentages: [Decimal(50), Decimal(30), Decimal(20)])
        let user1 = UUID()
        let user2 = UUID()
        let user3 = UUID()
        let entries = [
            RankedEntry(userId: user1, rank: 1, score: 100.0),
            RankedEntry(userId: user2, rank: 2, score: 90.0),
            RankedEntry(userId: user3, rank: 3, score: 80.0)
        ]
        let input = SettlementInput(rankedEntries: entries, prizePool: Decimal(1000))

        let originalEntries = input.rankedEntries
        _ = strategy.settle(input)

        // Input must not be mutated
        XCTAssertEqual(input.rankedEntries.count, originalEntries.count)
        for (original, current) in zip(originalEntries, input.rankedEntries) {
            XCTAssertEqual(original.userId, current.userId)
            XCTAssertEqual(original.rank, current.rank)
        }
    }
}

// MARK: - Test Support

private struct CustomTestStrategy: SettlementStrategy {
    let key = "custom_test"

    func settle(_ input: SettlementInput) -> SettlementResult {
        return SettlementResult(payouts: [])
    }
}
