import Foundation

/// Domain model for payout tier in contest action state.
/// Mapped from PayoutTierContract.
/// 1:1 representation: no field loss, no invention.
/// Endpoint-specific to ContestDetailResponseContract.
struct PayoutTier {
    let rankMin: Int
    let rankMax: Int
    let amount: Decimal?
}
