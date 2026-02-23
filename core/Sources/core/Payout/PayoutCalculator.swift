import Foundation

/// Pure payout calculation engine for contest previews.
public enum PayoutCalculator {

    /// Calculates ordinal suffix for a number (1st, 2nd, 3rd, etc).
    private static func ordinal(_ n: Int) -> String {
        switch n % 10 {
        case 1 where n % 100 != 11: return "\(n)st"
        case 2 where n % 100 != 12: return "\(n)nd"
        case 3 where n % 100 != 13: return "\(n)rd"
        default: return "\(n)th"
        }
    }

    /// Calculates payout distribution for winner-take-all structure.
    public static func calculateWinnerTakeAll(prizePool: Double) -> [PayoutLineData] {
        [PayoutLineData(place: "1st", percentage: 100.0, amount: prizePool)]
    }

    /// Calculates payout distribution for top-N split structure.
    /// Uses fixed percentage tiers: 1 winner (100%), 2 (60/40), 3 (50/30/20), N>3 (even split).
    public static func calculateTopNSplit(maxWinners: Int, prizePool: Double) -> [PayoutLineData] {
        guard maxWinners > 0 else { return [] }

        let percentages: [Double]
        switch maxWinners {
        case 1:
            percentages = [100.0]
        case 2:
            percentages = [60.0, 40.0]
        case 3:
            percentages = [50.0, 30.0, 20.0]
        default:
            let evenSplit = 100.0 / Double(maxWinners)
            percentages = Array(repeating: evenSplit, count: maxWinners)
        }

        return percentages.enumerated().map { index, percentage in
            let place = ordinal(index + 1)
            let amount = prizePool * (percentage / 100.0)
            return PayoutLineData(place: place, percentage: percentage, amount: amount)
        }
    }

    /// Calculates payout table for a given structure and prize pool.
    public static func calculatePayoutTable(structure: PayoutStructureData, prizePool: Double) -> [PayoutLineData] {
        switch structure.type {
        case "top_n_split":
            let maxWinners = structure.maxWinners ?? 1
            return calculateTopNSplit(maxWinners: maxWinners, prizePool: prizePool)
        case "winner_take_all":
            return calculateWinnerTakeAll(prizePool: prizePool)
        default:
            return []
        }
    }
}
