//
//  ContestActionsContract.swift
//  core
//
//  Behavior flags driven by backend contest state.
//  These are the source of truth for UI gating.
//  REQUIRED: All fields must decode strictly—no optional fallbacks.
//

import Foundation

/// ContestActionsContract: Backend-derived behavior flags for UI gating.
/// Source of truth for all contest capability decisions.
/// Non-negotiable: Missing any required field = decode failure.
public struct ContestActionsContract: Codable, Hashable, Equatable, Sendable {
    public let canJoin: Bool
    public let canEditEntry: Bool
    public let isLive: Bool
    public let isClosed: Bool
    public let isScoring: Bool
    public let isScored: Bool
    public let isReadOnly: Bool
    public let canShareInvite: Bool
    public let canManageContest: Bool
    public let canDelete: Bool
    public let canUnjoin: Bool

    enum CodingKeys: String, CodingKey {
        case canJoin = "can_join"
        case canEditEntry = "can_edit_entry"
        case isLive = "is_live"
        case isClosed = "is_closed"
        case isScoring = "is_scoring"
        case isScored = "is_scored"
        case isReadOnly = "is_read_only"
        case canShareInvite = "can_share_invite"
        case canManageContest = "can_manage_contest"
        case canDelete = "can_delete"
        case canUnjoin = "can_unjoin"
    }

    public init(
        canJoin: Bool,
        canEditEntry: Bool,
        isLive: Bool,
        isClosed: Bool,
        isScoring: Bool,
        isScored: Bool,
        isReadOnly: Bool,
        canShareInvite: Bool,
        canManageContest: Bool,
        canDelete: Bool,
        canUnjoin: Bool
    ) {
        self.canJoin = canJoin
        self.canEditEntry = canEditEntry
        self.isLive = isLive
        self.isClosed = isClosed
        self.isScoring = isScoring
        self.isScored = isScored
        self.isReadOnly = isReadOnly
        self.canShareInvite = canShareInvite
        self.canManageContest = canManageContest
        self.canDelete = canDelete
        self.canUnjoin = canUnjoin
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        canJoin = try c.decode(Bool.self, forKey: .canJoin)
        canEditEntry = try c.decode(Bool.self, forKey: .canEditEntry)
        isLive = try c.decode(Bool.self, forKey: .isLive)
        isClosed = try c.decode(Bool.self, forKey: .isClosed)
        isScoring = try c.decode(Bool.self, forKey: .isScoring)
        isScored = try c.decode(Bool.self, forKey: .isScored)
        isReadOnly = try c.decode(Bool.self, forKey: .isReadOnly)
        canShareInvite = try c.decode(Bool.self, forKey: .canShareInvite)
        canManageContest = try c.decode(Bool.self, forKey: .canManageContest)
        canDelete = try c.decode(Bool.self, forKey: .canDelete)
        canUnjoin = try c.decode(Bool.self, forKey: .canUnjoin)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(canJoin, forKey: .canJoin)
        try c.encode(canEditEntry, forKey: .canEditEntry)
        try c.encode(isLive, forKey: .isLive)
        try c.encode(isClosed, forKey: .isClosed)
        try c.encode(isScoring, forKey: .isScoring)
        try c.encode(isScored, forKey: .isScored)
        try c.encode(isReadOnly, forKey: .isReadOnly)
        try c.encode(canShareInvite, forKey: .canShareInvite)
        try c.encode(canManageContest, forKey: .canManageContest)
        try c.encode(canDelete, forKey: .canDelete)
        try c.encode(canUnjoin, forKey: .canUnjoin)
    }
}
