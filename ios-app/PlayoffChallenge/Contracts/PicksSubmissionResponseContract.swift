//
//  PicksSubmissionResponseContract.swift
//  PlayoffChallenge
//
//  DTO for POST /api/custom-contests/:id/picks response.
//  Returned when user submits their PGA golfer picks.
//

import Foundation

struct PicksSubmissionResponseContract: Decodable {
    let success: Bool
    let playerIds: [String]
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case success
        case playerIds = "player_ids"
        case updatedAt = "updated_at"
    }
}
