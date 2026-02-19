//
//  ContestActions.swift
//  core
//
//  Behavior flags driven by backend contest state.
//  These are the source of truth for UI gating.
//  REQUIRED: All fields must decode strictly—no optional fallbacks.
//

import Foundation

/// ContestActions: Backend-derived behavior flags for UI gating.
/// Source of truth for all contest capability decisions.
/// Non-negotiable: Missing any required field = decode failure.
public struct ContestActions: Codable, Hashable, Equatable, Sendable {
    public let can_join: Bool
    public let can_edit_entry: Bool
    public let is_live: Bool
    public let is_closed: Bool
    public let is_scoring: Bool
    public let is_scored: Bool
    public let is_read_only: Bool
    public let can_share_invite: Bool
    public let can_manage_contest: Bool
    public let can_delete: Bool
    public let can_unjoin: Bool

    enum CodingKeys: String, CodingKey {
        case can_join
        case can_edit_entry
        case is_live
        case is_closed
        case is_scoring
        case is_scored
        case is_read_only
        case can_share_invite
        case can_manage_contest
        case can_delete
        case can_unjoin
    }

    public init(
        can_join: Bool,
        can_edit_entry: Bool,
        is_live: Bool,
        is_closed: Bool,
        is_scoring: Bool,
        is_scored: Bool,
        is_read_only: Bool,
        can_share_invite: Bool,
        can_manage_contest: Bool,
        can_delete: Bool,
        can_unjoin: Bool
    ) {
        self.can_join = can_join
        self.can_edit_entry = can_edit_entry
        self.is_live = is_live
        self.is_closed = is_closed
        self.is_scoring = is_scoring
        self.is_scored = is_scored
        self.is_read_only = is_read_only
        self.can_share_invite = can_share_invite
        self.can_manage_contest = can_manage_contest
        self.can_delete = can_delete
        self.can_unjoin = can_unjoin
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        can_join = try c.decode(Bool.self, forKey: .can_join)
        can_edit_entry = try c.decode(Bool.self, forKey: .can_edit_entry)
        is_live = try c.decode(Bool.self, forKey: .is_live)
        is_closed = try c.decode(Bool.self, forKey: .is_closed)
        is_scoring = try c.decode(Bool.self, forKey: .is_scoring)
        is_scored = try c.decode(Bool.self, forKey: .is_scored)
        is_read_only = try c.decode(Bool.self, forKey: .is_read_only)
        can_share_invite = try c.decode(Bool.self, forKey: .can_share_invite)
        can_manage_contest = try c.decode(Bool.self, forKey: .can_manage_contest)
        can_delete = try c.decode(Bool.self, forKey: .can_delete)
        can_unjoin = try c.decode(Bool.self, forKey: .can_unjoin)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(can_join, forKey: .can_join)
        try c.encode(can_edit_entry, forKey: .can_edit_entry)
        try c.encode(is_live, forKey: .is_live)
        try c.encode(is_closed, forKey: .is_closed)
        try c.encode(is_scoring, forKey: .is_scoring)
        try c.encode(is_scored, forKey: .is_scored)
        try c.encode(is_read_only, forKey: .is_read_only)
        try c.encode(can_share_invite, forKey: .can_share_invite)
        try c.encode(can_manage_contest, forKey: .can_manage_contest)
        try c.encode(can_delete, forKey: .can_delete)
        try c.encode(can_unjoin, forKey: .can_unjoin)
    }
}
