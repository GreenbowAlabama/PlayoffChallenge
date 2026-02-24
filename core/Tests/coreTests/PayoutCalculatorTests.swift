import XCTest
@testable import Core

final class PayoutCalculatorTests: XCTestCase {

    // MARK: - Winner Take All Tests

    func testCalculateWinnerTakeAll_returnsSingleLine100Percent() {
        let prizePool = 1000.0
        let result = PayoutCalculator.calculateWinnerTakeAll(prizePool: prizePool)

        XCTAssertEqual(result.count, 1)
        XCTAssertEqual(result[0].place, "1st")
        XCTAssertEqual(result[0].percentage, 100.0)
        XCTAssertEqual(result[0].amount, 1000.0)
    }

    func testCalculateWinnerTakeAll_withZeroPrizePool_stillReturnsLine() {
        let prizePool = 0.0
        let result = PayoutCalculator.calculateWinnerTakeAll(prizePool: prizePool)

        XCTAssertEqual(result.count, 1)
        XCTAssertEqual(result[0].place, "1st")
        XCTAssertEqual(result[0].percentage, 100.0)
        XCTAssertEqual(result[0].amount, 0.0)
    }

    // MARK: - Top N Split Tests

    func testCalculateTopNSplit_oneWinner_returns100Percent() {
        let result = PayoutCalculator.calculateTopNSplit(maxWinners: 1, prizePool: 1000.0)

        XCTAssertEqual(result.count, 1)
        XCTAssertEqual(result[0].place, "1st")
        XCTAssertEqual(result[0].percentage, 100.0)
        XCTAssertEqual(result[0].amount, 1000.0)
    }

    func testCalculateTopNSplit_twoWinners_returns60_40() {
        let result = PayoutCalculator.calculateTopNSplit(maxWinners: 2, prizePool: 1000.0)

        XCTAssertEqual(result.count, 2)
        XCTAssertEqual(result[0].place, "1st")
        XCTAssertEqual(result[0].percentage, 60.0)
        XCTAssertEqual(result[0].amount, 600.0)
        XCTAssertEqual(result[1].place, "2nd")
        XCTAssertEqual(result[1].percentage, 40.0)
        XCTAssertEqual(result[1].amount, 400.0)
    }

    func testCalculateTopNSplit_threeWinners_returns50_30_20() {
        let result = PayoutCalculator.calculateTopNSplit(maxWinners: 3, prizePool: 1000.0)

        XCTAssertEqual(result.count, 3)
        XCTAssertEqual(result[0].place, "1st")
        XCTAssertEqual(result[0].percentage, 50.0)
        XCTAssertEqual(result[0].amount, 500.0)
        XCTAssertEqual(result[1].place, "2nd")
        XCTAssertEqual(result[1].percentage, 30.0)
        XCTAssertEqual(result[1].amount, 300.0)
        XCTAssertEqual(result[2].place, "3rd")
        XCTAssertEqual(result[2].percentage, 20.0)
        XCTAssertEqual(result[2].amount, 200.0)
    }

    func testCalculateTopNSplit_fourWinners_returnsEvenSplit() {
        let result = PayoutCalculator.calculateTopNSplit(maxWinners: 4, prizePool: 1000.0)

        XCTAssertEqual(result.count, 4)
        XCTAssertEqual(result[0].place, "1st")
        XCTAssertEqual(result[0].percentage, 25.0)
        XCTAssertEqual(result[0].amount, 250.0)
        XCTAssertEqual(result[1].place, "2nd")
        XCTAssertEqual(result[1].percentage, 25.0)
        XCTAssertEqual(result[2].place, "3rd")
        XCTAssertEqual(result[2].percentage, 25.0)
        XCTAssertEqual(result[3].place, "4th")
        XCTAssertEqual(result[3].percentage, 25.0)
    }

    func testCalculateTopNSplit_negativeWinners_returnsEmpty() {
        let result = PayoutCalculator.calculateTopNSplit(maxWinners: -1, prizePool: 1000.0)
        XCTAssertEqual(result.count, 0)
    }

    func testCalculateTopNSplit_zeroWinners_returnsEmpty() {
        let result = PayoutCalculator.calculateTopNSplit(maxWinners: 0, prizePool: 1000.0)
        XCTAssertEqual(result.count, 0)
    }

    func testCalculateTopNSplit_withZeroPrizePool_stillReturnsLines() {
        let result = PayoutCalculator.calculateTopNSplit(maxWinners: 3, prizePool: 0.0)

        XCTAssertEqual(result.count, 3)
        XCTAssertEqual(result[0].amount, 0.0)
        XCTAssertEqual(result[1].amount, 0.0)
        XCTAssertEqual(result[2].amount, 0.0)
    }

    // MARK: - Payout Table Tests

    func testCalculatePayoutTable_winnerTakeAll_returnsCorrectStructure() {
        let structure = PayoutStructureData(type: "winner_take_all", maxWinners: nil)
        let result = PayoutCalculator.calculatePayoutTable(structure: structure, prizePool: 1000.0)

        XCTAssertEqual(result.count, 1)
        XCTAssertEqual(result[0].place, "1st")
        XCTAssertEqual(result[0].percentage, 100.0)
        XCTAssertEqual(result[0].amount, 1000.0)
    }

    func testCalculatePayoutTable_topNSplit_returnsCorrectStructure() {
        let structure = PayoutStructureData(type: "top_n_split", maxWinners: 3)
        let result = PayoutCalculator.calculatePayoutTable(structure: structure, prizePool: 1000.0)

        XCTAssertEqual(result.count, 3)
        XCTAssertEqual(result[0].percentage, 50.0)
        XCTAssertEqual(result[1].percentage, 30.0)
        XCTAssertEqual(result[2].percentage, 20.0)
    }

    func testCalculatePayoutTable_topNSplit_withNoMaxWinners_defaultsToOne() {
        let structure = PayoutStructureData(type: "top_n_split", maxWinners: nil)
        let result = PayoutCalculator.calculatePayoutTable(structure: structure, prizePool: 1000.0)

        XCTAssertEqual(result.count, 1)
        XCTAssertEqual(result[0].percentage, 100.0)
    }

    func testCalculatePayoutTable_unknownType_returnsEmpty() {
        let structure = PayoutStructureData(type: "unknown_type", maxWinners: nil)
        let result = PayoutCalculator.calculatePayoutTable(structure: structure, prizePool: 1000.0)

        XCTAssertEqual(result.count, 0)
    }

    // MARK: - Edge Cases

    func testPayoutLineData_equatability() {
        let line1 = PayoutLineData(place: "1st", percentage: 50.0, amount: 500.0)
        let line2 = PayoutLineData(place: "1st", percentage: 50.0, amount: 500.0)
        let line3 = PayoutLineData(place: "2nd", percentage: 50.0, amount: 500.0)

        XCTAssertEqual(line1, line2)
        XCTAssertNotEqual(line1, line3)
    }

    func testCalculateTopNSplit_precisionWithOddDivisors() {
        let result = PayoutCalculator.calculateTopNSplit(maxWinners: 3, prizePool: 100.0)

        // Verify percentages sum to 100
        let totalPercentage = result.reduce(0.0) { $0 + $1.percentage }
        XCTAssertEqual(totalPercentage, 100.0)

        // Verify amounts match percentages
        XCTAssertEqual(result[0].amount, 50.0)
        XCTAssertEqual(result[1].amount, 30.0)
        XCTAssertEqual(result[2].amount, 20.0)
    }

    func testCalculateTopNSplit_fiveWinners_evenSplit() {
        let result = PayoutCalculator.calculateTopNSplit(maxWinners: 5, prizePool: 100.0)

        XCTAssertEqual(result.count, 5)
        for line in result {
            XCTAssertEqual(line.percentage, 20.0)
            XCTAssertEqual(line.amount, 20.0)
        }
    }
}
