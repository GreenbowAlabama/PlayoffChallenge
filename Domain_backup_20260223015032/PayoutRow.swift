import Foundation

/// Domain model for payout tier.
/// Mapped from PayoutRowDTO.
struct PayoutRow: Equatable {
    let place: String
    let rankMin: Int
    let rankMax: Int
    let amountCents: Int?  // Null until settlement
    let payoutPercent: Int?  // Null until settlement
    let currency: String
}
