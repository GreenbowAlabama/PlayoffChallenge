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

    enum CodingKeys: String, CodingKey {
        case playerIds = "player_ids"
        case canEdit = "can_edit"
        case lockTime = "lock_time"
        case rosterConfig = "roster_config"
        case availablePlayers = "available_players"
        case updatedAt = "updated_at"
    }

    public init(
        playerIds: [String],
        canEdit: Bool,
        lockTime: Date?,
        rosterConfig: RosterConfigContract,
        availablePlayers: [PlayerInfoContract]?,
        updatedAt: String? = nil
    ) {
        self.playerIds = playerIds
        self.canEdit = canEdit
        self.lockTime = lockTime
        self.rosterConfig = rosterConfig
        self.availablePlayers = availablePlayers
        self.updatedAt = updatedAt
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
