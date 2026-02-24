//
//  ContestActions.swift
//  core
//
//  Domain model for contest actions capability flags.
//

import Foundation

/// ContestActions domain model representing user capabilities and contest states.
/// Mapped from `ContestActionsContract`.
/// Immutable, Codable, Hashable, Equatable, and Sendable.
public struct ContestActions: Codable, Hashable, Equatable, Sendable {
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

    // MARK: - Mapping
    /// Initialize from a contract type.
    public static func from(_ contract: ContestActionsContract) -> ContestActions {
        return ContestActions(
            canJoin: contract.canJoin,
            canEditEntry: contract.canEditEntry,
            isLive: contract.isLive,
            isClosed: contract.isClosed,
            isScoring: contract.isScoring,
            isScored: contract.isScored,
            isReadOnly: contract.isReadOnly,
            canShareInvite: contract.canShareInvite,
            canManageContest: contract.canManageContest,
            canDelete: contract.canDelete,
            canUnjoin: contract.canUnjoin
        )
    }

    // MARK: - Testing Factory
    /// Stub factory for testing.
    public static func stub(
        canJoin: Bool = true,
        canEditEntry: Bool = true,
        isLive: Bool = false,
        isClosed: Bool = false,
        isScoring: Bool = false,
        isScored: Bool = false,
        isReadOnly: Bool = false,
        canShareInvite: Bool = true,
        canManageContest: Bool = true,
        canDelete: Bool = true,
        canUnjoin: Bool = true
    ) -> ContestActions {
        return ContestActions(
            canJoin: canJoin,
            canEditEntry: canEditEntry,
            isLive: isLive,
            isClosed: isClosed,
            isScoring: isScoring,
            isScored: isScored,
            isReadOnly: isReadOnly,
            canShareInvite: canShareInvite,
            canManageContest: canManageContest,
            canDelete: canDelete,
            canUnjoin: canUnjoin
        )
    }
}
