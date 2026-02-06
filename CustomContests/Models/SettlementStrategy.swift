import Foundation

// MARK: - Settlement Strategy Protocol

/// Protocol for distributing prize pool among winners.
/// Implementations must be pure functions: same input always produces same output.
protocol SettlementStrategy {
    /// Unique key identifying this strategy.
    var key: String { get }

    /// Settles the contest by distributing the prize pool.
    /// - Parameter input: The ranked entries and prize pool.
    /// - Returns: The settlement result with payouts.
    func settle(_ input: SettlementInput) -> SettlementResult
}

// MARK: - Settlement Input/Output Models

/// Input for settlement calculation.
struct SettlementInput: Equatable {
    let rankedEntries: [RankedEntry]
    let prizePool: Decimal
}

/// A ranked entry in a contest.
struct RankedEntry: Codable, Equatable {
    let userId: UUID
    let rank: Int
    let score: Double

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case rank
        case score
    }
}

/// Result of settlement calculation.
struct SettlementResult: Equatable {
    let payouts: [SettlementPayout]

    /// Total amount paid out.
    var totalPayout: Decimal {
        payouts.reduce(Decimal(0)) { $0 + $1.amount }
    }
}

/// A payout to a user.
struct SettlementPayout: Codable, Equatable {
    let userId: UUID
    let amount: Decimal
    let rank: Int

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case amount
        case rank
    }
}

// MARK: - Winner Take All Strategy

/// Settlement strategy where the winner(s) take the entire prize pool.
/// If there are ties for first, the prize is split equally.
struct WinnerTakeAllStrategy: SettlementStrategy {
    let key = "winner_take_all"

    func settle(_ input: SettlementInput) -> SettlementResult {
        guard !input.rankedEntries.isEmpty else {
            return SettlementResult(payouts: [])
        }

        // Find all entries with rank 1 (winners)
        let winners = input.rankedEntries.filter { $0.rank == 1 }

        guard !winners.isEmpty else {
            // No rank 1 entries - shouldn't happen in practice
            return SettlementResult(payouts: [])
        }

        // Split prize pool equally among winners
        let shareAmount = input.prizePool / Decimal(winners.count)

        let payouts = winners.map { winner in
            SettlementPayout(
                userId: winner.userId,
                amount: shareAmount,
                rank: 1
            )
        }

        return SettlementResult(payouts: payouts)
    }
}

// MARK: - Top N Split Strategy

/// Settlement strategy that pays out to the top N finishers.
/// Supports custom percentage splits or equal distribution.
struct TopNSplitStrategy: SettlementStrategy {
    let key = "top_n_split"

    let topN: Int
    let splitPercentages: [Decimal]

    /// Creates a top N split strategy.
    /// - Parameters:
    ///   - topN: Number of top finishers to pay.
    ///   - splitPercentages: Percentage for each position (1st, 2nd, etc.).
    ///                       If nil, equal split is used.
    init(topN: Int, splitPercentages: [Decimal]? = nil) {
        self.topN = topN
        if let percentages = splitPercentages {
            self.splitPercentages = percentages
        } else {
            // Equal split
            let equalShare = Decimal(100) / Decimal(topN)
            self.splitPercentages = Array(repeating: equalShare, count: topN)
        }
    }

    func settle(_ input: SettlementInput) -> SettlementResult {
        guard !input.rankedEntries.isEmpty else {
            return SettlementResult(payouts: [])
        }

        // Sort by rank
        let sortedEntries = input.rankedEntries.sorted { $0.rank < $1.rank }

        // Get entries that should be paid (up to topN unique positions)
        let entriesToPay = Array(sortedEntries.prefix(topN))

        guard !entriesToPay.isEmpty else {
            return SettlementResult(payouts: [])
        }

        // Handle ties: group entries by rank
        var entriesByRank: [Int: [RankedEntry]] = [:]
        for entry in entriesToPay {
            entriesByRank[entry.rank, default: []].append(entry)
        }

        // Calculate payouts handling ties
        var payouts: [SettlementPayout] = []
        let ranks = entriesByRank.keys.sorted()

        // Track how many positions we've allocated
        var positionIndex = 0

        for rank in ranks {
            guard positionIndex < splitPercentages.count else { break }

            let entriesAtRank = entriesByRank[rank]!
            let tiedCount = entriesAtRank.count

            // Calculate total percentage for this group
            // They share all the positions they would have occupied
            var totalPercentage: Decimal = 0
            for i in 0..<tiedCount {
                let idx = positionIndex + i
                if idx < splitPercentages.count {
                    totalPercentage += splitPercentages[idx]
                }
            }

            // Split total amount equally among tied entries
            let totalAmount = input.prizePool * (totalPercentage / Decimal(100))
            let perPersonAmount = totalAmount / Decimal(tiedCount)

            for entry in entriesAtRank {
                payouts.append(SettlementPayout(
                    userId: entry.userId,
                    amount: perPersonAmount,
                    rank: entry.rank
                ))
            }

            positionIndex += tiedCount
        }

        // If fewer entries than topN, redistribute remaining percentage
        if entriesToPay.count < topN && !payouts.isEmpty {
            // Calculate what percentage was actually used
            var usedPercentage: Decimal = 0
            for i in 0..<entriesToPay.count where i < splitPercentages.count {
                usedPercentage += splitPercentages[i]
            }

            // Redistribute based on actual used percentages
            payouts = payouts.map { payout in
                let originalShare = payout.amount
                let adjustedShare = originalShare * (Decimal(100) / usedPercentage)
                return SettlementPayout(
                    userId: payout.userId,
                    amount: adjustedShare,
                    rank: payout.rank
                )
            }
        }

        return SettlementResult(payouts: payouts)
    }
}

// MARK: - Settlement Strategy Registry

/// Registry for looking up settlement strategies by key.
final class SettlementStrategyRegistry {
    static let shared = SettlementStrategyRegistry()

    private var strategies: [String: SettlementStrategy]

    init() {
        let winnerTakeAll = WinnerTakeAllStrategy()
        let topNSplit = TopNSplitStrategy(topN: 3, splitPercentages: [50, 30, 20])

        strategies = [
            winnerTakeAll.key: winnerTakeAll,
            topNSplit.key: topNSplit
        ]
    }

    /// Returns the strategy for a given key, or nil if not found.
    func strategy(for key: String) -> SettlementStrategy? {
        strategies[key]
    }

    /// Returns all available strategy keys.
    var availableKeys: [String] {
        Array(strategies.keys)
    }

    /// Registers a new strategy. Used for testing or dynamic configuration.
    func register(_ strategy: SettlementStrategy) {
        strategies[strategy.key] = strategy
    }
}
