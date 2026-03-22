//
//  MyEntryResponseContract.swift
//  core
//
//  DTO for /api/custom-contests/{id}/my-entry response
//  Contains user's current picks and entry context for a contest.
//

import Foundation

/// DTO for /api/custom-contests/{id}/my-entry response
/// Contains user's current picks and entry context for a contest
public struct MyEntryResponseContract: Decodable {
    public let playerIds: [String]
    public let canEdit: Bool
    public let lockTime: Date?
    public let rosterConfig: RosterConfigContract
    public let availablePlayers: [PlayerInfoContract]?
    public let updatedAt: String?
    public let tierDefinition: TierDefinitionContract?

    enum CodingKeys: String, CodingKey {
        case playerIds = "player_ids"
        case canEdit = "can_edit"
        case lockTime = "lock_time"
        case rosterConfig = "roster_config"
        case availablePlayers = "available_players"
        case updatedAt = "updated_at"
        case tierDefinition = "tier_definition"
    }
}

/// DTO for tier definition with tier details
public struct TierDefinitionContract: Decodable {
    public let selectionMode: String?
    public let tiers: [TierContract]

    enum CodingKeys: String, CodingKey {
        case selectionMode = "selection_mode"
        case tiers
    }
}

/// DTO for individual tier info
public struct TierContract: Decodable {
    public let id: String
    public let fieldName: String
    public let rankMin: Int
    public let rankMax: Int

    enum CodingKeys: String, CodingKey {
        case id
        case fieldName = "field_name"
        case rankMin = "rank_min"
        case rankMax = "rank_max"
    }
}

/// DTO for player info available for selection
/// Maps OpenAPI PlayerInfo schema: { player_id: string, name: string, image_url?: string }
public struct PlayerInfoContract: Decodable {
    public let playerId: String
    public let name: String
    public let imageUrl: String?

    enum CodingKeys: String, CodingKey {
        case playerId = "player_id"
        case name
        case imageUrl = "image_url"
    }

    public init(playerId: String, name: String, imageUrl: String? = nil) {
        self.playerId = playerId
        self.name = name
        self.imageUrl = imageUrl
    }
}
