import Foundation
import core

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
