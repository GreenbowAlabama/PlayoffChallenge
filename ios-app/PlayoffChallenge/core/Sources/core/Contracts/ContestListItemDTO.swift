//
//  ContestListItemDTO.swift
//  core
//
//  List item representation for contest mutation operations.
//  Mirrors backend DELETE /api/custom-contests/:id response.
//  Server-authoritative — no client-side inference allowed.
//

import Foundation

/// ContestListItemDTO: Authoritative list representation returned by mutation endpoints.
/// Backend-driven. Used for list mutations (delete, unjoin).
/// This is what DELETE /api/custom-contests/:id returns.
/// Only Decodable (we only receive these from server, never send them).
public struct ContestListItemDTO: Decodable, Identifiable {
    public let id: String
    public let organizerId: String
    public let status: String
    public let entryCount: Int
    public let contestName: String
    public let maxEntries: Int?
    public let entryFeeCents: Int
    public let lockTime: Date?
    public let createdAt: Date
    public let updatedAt: Date

    // Derived fields from server
    public let leaderboardState: String?
    public let actions: ContestActions?
    public let payoutTable: [PayoutTierContract]?
    public let rosterConfig: RosterConfigContract?

    enum CodingKeys: String, CodingKey {
        case id
        case organizerId = "organizer_id"
        case status
        case entryCount = "entry_count"
        case contestName = "contest_name"
        case maxEntries = "max_entries"
        case entryFeeCents = "entry_fee_cents"
        case lockTime = "lock_time"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case leaderboardState = "leaderboard_state"
        case actions
        case payoutTable = "payout_table"
        case rosterConfig = "roster_config"
    }

    public init(
        id: String,
        organizerId: String,
        status: String,
        entryCount: Int,
        contestName: String,
        maxEntries: Int?,
        entryFeeCents: Int,
        lockTime: Date?,
        createdAt: Date,
        updatedAt: Date,
        leaderboardState: String?,
        actions: ContestActions?,
        payoutTable: [PayoutTierContract]?,
        rosterConfig: RosterConfigContract?
    ) {
        self.id = id
        self.organizerId = organizerId
        self.status = status
        self.entryCount = entryCount
        self.contestName = contestName
        self.maxEntries = maxEntries
        self.entryFeeCents = entryFeeCents
        self.lockTime = lockTime
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.leaderboardState = leaderboardState
        self.actions = actions
        self.payoutTable = payoutTable
        self.rosterConfig = rosterConfig
    }
}
