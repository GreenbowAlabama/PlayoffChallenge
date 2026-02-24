import XCTest
@testable import Core

final class SettlementSmokeTests: XCTestCase {

    func test_equalSplit_twoPlayers() {
        let strategy = TopNSplitStrategy(topN: 2)

        let entries = [
            RankedEntry(userId: UUID(), rank: 1, score: 100),
            RankedEntry(userId: UUID(), rank: 2, score: 90)
        ]

        let input = SettlementInput(
            rankedEntries: entries,
            prizePool: 100
        )

        let result = strategy.settle(input)

        XCTAssertEqual(result.payouts.count, 2)
        XCTAssertEqual(result.totalPayout, 100)
    }

}
