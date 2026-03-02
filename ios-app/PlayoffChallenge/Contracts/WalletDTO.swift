//
//  WalletDTO.swift
//  PlayoffChallenge
//
//  Network contract for wallet endpoint: GET /api/wallet
//  Maps to backend wallet balance and ledger response.
//

import Foundation

/// DTO for wallet response from GET /api/wallet
/// Backend is authoritative for balance — iOS treats as display-only.
/// FINANCIAL BOUNDARY: No client-side wallet math. Balance is backend-computed.
struct WalletResponseDTO: Decodable {
    /// User's wallet balance in cents (USD).
    /// Computed by backend from ledger SUM(CREDIT - DEBIT).
    /// iOS MUST display only; never multiply, compute, or modify.
    let balance_cents: Int

    /// Transaction ledger entries (optional; may be paginated).
    /// Each entry represents a wallet transaction (deposit, contest debit, bonus, etc.)
    let ledger: [LedgerEntryDTO]?

    enum CodingKeys: String, CodingKey {
        case balance_cents = "balance_cents"
        case ledger = "ledger"
    }

    init(balance_cents: Int, ledger: [LedgerEntryDTO]? = nil) {
        self.balance_cents = balance_cents
        self.ledger = ledger
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        balance_cents = try c.decode(Int.self, forKey: .balance_cents)
        ledger = try c.decodeIfPresent([LedgerEntryDTO].self, forKey: .ledger)
    }
}

/// DTO for individual ledger entry.
/// Represents a transaction affecting the wallet balance.
struct LedgerEntryDTO: Decodable {
    /// Unique ledger entry ID
    let id: UUID

    /// Amount in cents
    let amount_cents: Int

    /// Direction: "CREDIT" (money in) or "DEBIT" (money out)
    let direction: String

    /// Entry type: "WALLET_DEPOSIT", "WALLET_DEBIT", "REFERRAL_BONUS", etc.
    /// Describes what caused the transaction.
    let entry_type: String

    /// Reference context: "WALLET", "CONTEST", etc.
    let reference_type: String

    /// Reference ID (e.g., contest_instance_id for contest debits)
    let reference_id: String?

    /// ISO8601 timestamp when entry was created
    let created_at: String

    enum CodingKeys: String, CodingKey {
        case id = "id"
        case amount_cents = "amount_cents"
        case direction = "direction"
        case entry_type = "entry_type"
        case reference_type = "reference_type"
        case reference_id = "reference_id"
        case created_at = "created_at"
    }

    init(id: UUID, amount_cents: Int, direction: String, entry_type: String, reference_type: String, reference_id: String? = nil, created_at: String) {
        self.id = id
        self.amount_cents = amount_cents
        self.direction = direction
        self.entry_type = entry_type
        self.reference_type = reference_type
        self.reference_id = reference_id
        self.created_at = created_at
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        amount_cents = try c.decode(Int.self, forKey: .amount_cents)
        direction = try c.decode(String.self, forKey: .direction)
        entry_type = try c.decode(String.self, forKey: .entry_type)
        reference_type = try c.decode(String.self, forKey: .reference_type)
        reference_id = try c.decodeIfPresent(String.self, forKey: .reference_id)
        created_at = try c.decode(String.self, forKey: .created_at)
    }
}
