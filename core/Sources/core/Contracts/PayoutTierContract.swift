//
//  PayoutTierContract.swift
//  core
//
//  Payout tier definition in contest detail contract.
//  Strict Decimal parsing—malformed values fail loudly.
//

import Foundation

/// PayoutTierContract: Contest payout bracket definition.
/// rank_min, rank_max, and amount are required.
/// Amount must parse as Decimal—no silent fallback to 0.
public struct PayoutTierContract: Decodable, Sendable {
    public let rank_min: Int
    public let rank_max: Int
    public let amount: Decimal

    enum CodingKeys: String, CodingKey {
        case rank_min
        case rank_max
        case amount
    }

    public init(rank_min: Int, rank_max: Int, amount: Decimal) {
        self.rank_min = rank_min
        self.rank_max = rank_max
        self.amount = amount
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        rank_min = try c.decode(Int.self, forKey: .rank_min)
        rank_max = try c.decode(Int.self, forKey: .rank_max)

        // Handle amount as string or number — fail loudly on malformed value
        if let s = try? c.decode(String.self, forKey: .amount) {
            guard let parsed = Decimal(string: s) else {
                throw DecodingError.dataCorruptedError(
                    forKey: .amount,
                    in: c,
                    debugDescription: "Invalid decimal string for amount: \(s)"
                )
            }
            amount = parsed
        } else {
            let d = try c.decode(Double.self, forKey: .amount)
            amount = Decimal(d)
        }
    }
}
