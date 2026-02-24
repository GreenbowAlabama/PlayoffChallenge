//
//  PayoutRowContract.swift
//  core
//
//  Contract for a payout row.
//

import Foundation

/// PayoutRowContract: Represents a user's payout.
public struct PayoutRowContract: Decodable, Sendable {
    public let id: String
    public let userId: String
    public let username: String
    public let rank: Int
    public let payoutCents: Int
    public let tier: Int?
    
    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case username
        case rank
        case payoutCents = "payout_cents"
        case tier
    }
}
