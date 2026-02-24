import Foundation

/// DTO for single payout tier.
/// Maps to OpenAPI PayoutRow schema.
struct PayoutRowDTO: Decodable {
    let place: String
    let rank_min: Int
    let rank_max: Int
    let amount: Int?  // Nullable until settlement
    let payout_percent: Int?  // Nullable until settlement
    let currency: String
}
