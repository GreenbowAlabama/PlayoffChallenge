import Foundation

/// DTO for wallet transaction from backend
struct WalletTransactionDTO: Codable, Identifiable {
    let id: String
    let entry_type: String
    let direction: String
    let amount_cents: Int
    let reference_type: String
    let reference_id: String
    let description: String
    let created_at: String

    enum CodingKeys: String, CodingKey {
        case id
        case entry_type
        case direction
        case amount_cents
        case reference_type
        case reference_id
        case description
        case created_at
    }
}

/// Response wrapper for wallet transactions endpoint
struct WalletTransactionsResponseDTO: Codable {
    let transactions: [WalletTransactionDTO]
    let total_count: Int

    enum CodingKeys: String, CodingKey {
        case transactions
        case total_count
    }
}
