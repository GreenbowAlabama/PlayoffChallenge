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

    enum CodingKeys: String, CodingKey {
        case playerIds = "player_ids"
        case canEdit = "can_edit"
        case lockTime = "lock_time"
        case rosterConfig = "roster_config"
        case availablePlayers = "available_players"
    }

    public init(
        playerIds: [String],
        canEdit: Bool,
        lockTime: Date?,
        rosterConfig: RosterConfigContract,
        availablePlayers: [PlayerInfoContract]?
    ) {
        self.playerIds = playerIds
        self.canEdit = canEdit
        self.lockTime = lockTime
        self.rosterConfig = rosterConfig
        self.availablePlayers = availablePlayers
    }
}

/// DTO for player info available for selection
/// Maps OpenAPI PlayerInfo schema: { player_id: string, name: string }
public struct PlayerInfoContract: Decodable {
    public let playerId: String
    public let name: String

    enum CodingKeys: String, CodingKey {
        case playerId = "player_id"
        case name
    }

    public init(playerId: String, name: String) {
        self.playerId = playerId
        self.name = name
    }
}
