import XCTest
@testable import Core

/// Tests for SettlementStrategy protocol and implementations.
/// Settlement strategies are pure functions: deterministic payout distributions.
final class SettlementStrategyTests: XCTestCase {

    // MARK: - SettlementInput Tests

    func test_settlementInput_creation() {
        let entries = [
            RankedEntry(userId: UUID(), rank: 1, score: 100.0),
            RankedEntry(userId: UUID(), rank: 2, score: 80.0)
        ]
        let input = SettlementInput(
            rankedEntries: entries,
            prizePool: Decimal(100)
        )

        XCTAssertEqual(input.rankedEntries.count, 2)
        XCTAssertEqual(input.prizePool, 100)
    }

    func test_rankedEntry_creation() {
        let userId = UUID()
        let entry = RankedEntry(userId: userId, rank: 1, score: 150.5)

        XCTAssertEqual(entry.userId, userId)
        XCTAssertEqual(entry.rank, 1)
        XCTAssertEqual(entry.score, 150.5, accuracy: 0.001)
    }

    // MARK: - SettlementResult Tests

    func test_settlementResult_creation() {
        let userId = UUID()
        let payout = SettlementPayout(userId: userId, amount: Decimal(100), rank: 1)
        let result = SettlementResult(payouts: [payout])

        XCTAssertEqual(result.payouts.count, 1)
        XCTAssertEqual(result.payouts[0].amount, 100)
    }

    func test_settlementResult_totalPayout() {
        let payouts = [
            SettlementPayout(userId: UUID(), amount: Decimal(50), rank: 1),
            SettlementPayout(userId: UUID(), amount: Decimal(30), rank: 2),
            SettlementPayout(userId: UUID(), amount: Decimal(20), rank: 3)
        ]
        let result = SettlementResult(payouts: payouts)

        XCTAssertEqual(result.totalPayout, 100)
    }

    // MARK: - WinnerTakeAllStrategy Tests

    func test_winnerTakeAll_hasCorrectKey() {
        let strategy = WinnerTakeAllStrategy()

        XCTAssertEqual(strategy.key, "winner_take_all")
    }

    func test_winnerTakeAll_singleWinner_getsEntirePrizePool() {
        let strategy = WinnerTakeAllStrategy()
        let winnerId = UUID()
        let entries = [
            RankedEntry(userId: winnerId, rank: 1, score: 100.0),
            RankedEntry(userId: UUID(), rank: 2, score: 80.0),
            RankedEntry(userId: UUID(), rank: 3, score: 60.0)
        ]
        let input = SettlementInput(rankedEntries: entries, prizePool: Decimal(300))

        let result = strategy.settle(input)

        XCTAssertEqual(result.payouts.count, 1)
        XCTAssertEqual(result.payouts[0].userId, winnerId)
        XCTAssertEqual(result.payouts[0].amount, 300)
        XCTAssertEqual(result.payouts[0].rank, 1)
    }

    func test_winnerTakeAll_tiedForFirst_splitsPrizePool() {
        let strategy = WinnerTakeAllStrategy()
        let winner1 = UUID()
        let winner2 = UUID()
        let entries = [
            RankedEntry(userId: winner1, rank: 1, score: 100.0),
            RankedEntry(userId: winner2, rank: 1, score: 100.0), // Tied
            RankedEntry(userId: UUID(), rank: 3, score: 60.0)
        ]
        let input = SettlementInput(rankedEntries: entries, prizePool: Decimal(300))

        let result = strategy.settle(input)

        XCTAssertEqual(result.payouts.count, 2)
        XCTAssertEqual(result.payouts[0].amount, 150)
        XCTAssertEqual(result.payouts[1].amount, 150)
        XCTAssertEqual(result.totalPayout, 300)
    }

    func test_winnerTakeAll_noEntries_returnsEmptyPayouts() {
        let strategy = WinnerTakeAllStrategy()
        let input = SettlementInput(rankedEntries: [], prizePool: Decimal(100))

        let result = strategy.settle(input)

        XCTAssertTrue(result.payouts.isEmpty)
    }

    func test_winnerTakeAll_zeroPrizePool_returnsZeroPayout() {
        let strategy = WinnerTakeAllStrategy()
        let winnerId = UUID()
        let entries = [RankedEntry(userId: winnerId, rank: 1, score: 100.0)]
        let input = SettlementInput(rankedEntries: entries, prizePool: Decimal(0))

        let result = strategy.settle(input)

        XCTAssertEqual(result.payouts.count, 1)
        XCTAssertEqual(result.payouts[0].amount, 0)
    }

    // MARK: - TopNSplitStrategy Tests

    func test_topNSplit_hasCorrectKey() {
        let strategy = TopNSplitStrategy(topN: 3, splitPercentages: [50, 30, 20])

        XCTAssertEqual(strategy.key, "top_n_split")
    }

    func test_topNSplit_distributesAccordingToPercentages() {
        let strategy = TopNSplitStrategy(topN: 3, splitPercentages: [50, 30, 20])
        let user1 = UUID()
        let user2 = UUID()
        let user3 = UUID()
        let entries = [
            RankedEntry(userId: user1, rank: 1, score: 100.0),
            RankedEntry(userId: user2, rank: 2, score: 80.0),
            RankedEntry(userId: user3, rank: 3, score: 60.0),
            RankedEntry(userId: UUID(), rank: 4, score: 40.0)
        ]
        let input = SettlementInput(rankedEntries: entries, prizePool: Decimal(1000))

        let result = strategy.settle(input)

        XCTAssertEqual(result.payouts.count, 3)
        XCTAssertEqual(result.payouts[0].userId, user1)
        XCTAssertEqual(result.payouts[0].amount, 500) // 50%
        XCTAssertEqual(result.payouts[1].userId, user2)
        XCTAssertEqual(result.payouts[1].amount, 300) // 30%
        XCTAssertEqual(result.payouts[2].userId, user3)
        XCTAssertEqual(result.payouts[2].amount, 200) // 20%
    }

    func test_topNSplit_fewerEntriesThanN_paysOnlyExistingEntries() {
        let strategy = TopNSplitStrategy(topN: 3, splitPercentages: [50, 30, 20])
        let user1 = UUID()
        let user2 = UUID()
        let entries = [
            RankedEntry(userId: user1, rank: 1, score: 100.0),
            RankedEntry(userId: user2, rank: 2, score: 80.0)
        ]
        let input = SettlementInput(rankedEntries: entries, prizePool: Decimal(1000))

        let result = strategy.settle(input)

        // Only 2 entries, so redistribute among top 2
        // Percentages become 50+30=80 total, each gets their share of 80
        // User1: 50/80 * 1000 = 625, User2: 30/80 * 1000 = 375
        XCTAssertEqual(result.payouts.count, 2)
        XCTAssertEqual(result.totalPayout, 1000)
    }

    func test_topNSplit_tiedRanks_splitsTheirShare() {
        let strategy = TopNSplitStrategy(topN: 3, splitPercentages: [50, 30, 20])
        let user1 = UUID()
        let user2 = UUID()
        let user3 = UUID()
        let entries = [
            RankedEntry(userId: user1, rank: 1, score: 100.0),
            RankedEntry(userId: user2, rank: 2, score: 80.0),
            RankedEntry(userId: user3, rank: 2, score: 80.0) // Tied for 2nd
        ]
        let input = SettlementInput(rankedEntries: entries, prizePool: Decimal(1000))

        let result = strategy.settle(input)

        XCTAssertEqual(result.payouts.count, 3)
        XCTAssertEqual(result.payouts[0].amount, 500) // 1st place: 50%
        // 2nd and 3rd place combined: 30% + 20% = 50% = 500, split evenly
        XCTAssertEqual(result.payouts[1].amount, 250)
        XCTAssertEqual(result.payouts[2].amount, 250)
    }

    func test_topNSplit_noEntries_returnsEmptyPayouts() {
        let strategy = TopNSplitStrategy(topN: 3, splitPercentages: [50, 30, 20])
        let input = SettlementInput(rankedEntries: [], prizePool: Decimal(1000))

        let result = strategy.settle(input)

        XCTAssertTrue(result.payouts.isEmpty)
    }

    func test_topNSplit_defaultPercentages() {
        let strategy = TopNSplitStrategy(topN: 3)

        // Default should be equal split: 33.33% each
        let user1 = UUID()
        let user2 = UUID()
        let user3 = UUID()
        let entries = [
            RankedEntry(userId: user1, rank: 1, score: 100.0),
            RankedEntry(userId: user2, rank: 2, score: 80.0),
            RankedEntry(userId: user3, rank: 3, score: 60.0)
        ]
        let input = SettlementInput(rankedEntries: entries, prizePool: Decimal(900))

        let result = strategy.settle(input)

        XCTAssertEqual(result.payouts.count, 3)
        // Allow for small Decimal precision variance when dividing by 3
        let expectedShare = Decimal(300)
        let tolerance = Decimal(string: "0.01")!
        XCTAssertTrue(abs(result.payouts[0].amount - expectedShare) < tolerance)
        XCTAssertTrue(abs(result.payouts[1].amount - expectedShare) < tolerance)
        XCTAssertTrue(abs(result.payouts[2].amount - expectedShare) < tolerance)
        // Total should be close to prize pool (within tolerance due to division)
        XCTAssertTrue(abs(result.totalPayout - Decimal(900)) < tolerance)
    }

    // MARK: - Strategy Determinism Tests

    func test_winnerTakeAll_isDeterministic() {
        let strategy = WinnerTakeAllStrategy()
        let entries = [
            RankedEntry(userId: UUID(), rank: 1, score: 100.0),
            RankedEntry(userId: UUID(), rank: 2, score: 80.0)
        ]
        let input = SettlementInput(rankedEntries: entries, prizePool: Decimal(500))

        let result1 = strategy.settle(input)
        let result2 = strategy.settle(input)
        let result3 = strategy.settle(input)

        XCTAssertEqual(result1.totalPayout, result2.totalPayout)
        XCTAssertEqual(result2.totalPayout, result3.totalPayout)
    }

    func test_topNSplit_isDeterministic() {
        let strategy = TopNSplitStrategy(topN: 3, splitPercentages: [50, 30, 20])
        let entries = [
            RankedEntry(userId: UUID(), rank: 1, score: 100.0),
            RankedEntry(userId: UUID(), rank: 2, score: 80.0),
            RankedEntry(userId: UUID(), rank: 3, score: 60.0)
        ]
        let input = SettlementInput(rankedEntries: entries, prizePool: Decimal(1000))

        let result1 = strategy.settle(input)
        let result2 = strategy.settle(input)

        XCTAssertEqual(result1.totalPayout, result2.totalPayout)
        XCTAssertEqual(result1.payouts[0].amount, result2.payouts[0].amount)
    }

    // MARK: - Encoding Tests

    func test_rankedEntry_encodesToSnakeCaseJSON() throws {
        let userId = UUID(uuidString: "12345678-1234-1234-1234-123456789012")!
        let entry = RankedEntry(userId: userId, rank: 1, score: 150.5)

        let encoder = JSONEncoder()
        let data = try encoder.encode(entry)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]

        XCTAssertEqual(json["user_id"] as? String, "12345678-1234-1234-1234-123456789012")
        XCTAssertEqual(json["rank"] as? Int, 1)
        XCTAssertEqual((json["score"] as? Double) ?? 0, 150.5, accuracy: 0.001)
    }

    func test_settlementPayout_encodesToSnakeCaseJSON() throws {
        let userId = UUID(uuidString: "12345678-1234-1234-1234-123456789012")!
        let payout = SettlementPayout(userId: userId, amount: Decimal(500), rank: 1)

        let encoder = JSONEncoder()
        let data = try encoder.encode(payout)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]

        XCTAssertEqual(json["user_id"] as? String, "12345678-1234-1234-1234-123456789012")
        XCTAssertEqual(json["rank"] as? Int, 1)
        XCTAssertNotNil(json["amount"])
    }

    // MARK: - SettlementStrategyRegistry Tests

    func test_registry_retrievesWinnerTakeAllStrategy() {
        let registry = SettlementStrategyRegistry()

        let strategy = registry.strategy(for: "winner_take_all")

        XCTAssertNotNil(strategy)
        XCTAssertEqual(strategy?.key, "winner_take_all")
    }

    func test_registry_retrievesTopNSplitStrategy() {
        let registry = SettlementStrategyRegistry()

        // Default top_n_split with top 3
        let strategy = registry.strategy(for: "top_n_split")

        XCTAssertNotNil(strategy)
        XCTAssertEqual(strategy?.key, "top_n_split")
    }

    func test_registry_returnsNilForUnknownKey() {
        let registry = SettlementStrategyRegistry()

        let strategy = registry.strategy(for: "unknown_strategy")

        XCTAssertNil(strategy)
    }

    func test_registry_listsAvailableKeys() {
        let registry = SettlementStrategyRegistry()

        let keys = registry.availableKeys

        XCTAssertTrue(keys.contains("winner_take_all"))
        XCTAssertTrue(keys.contains("top_n_split"))
    }
}
