//
//  JoinLinkModels.swift
//  PlayoffChallenge
//
//  Models for join flow - pure, immutable data structures
//

import Foundation

/// Status of a contest
enum ContestStatus: String, Codable, Equatable {
    case draft
    case open
    case locked
    case completed
    case cancelled
    case settled
}

/// Summary of a contest for join preview
struct ContestSummary: Codable, Equatable {
    let id: UUID
    let name: String
    let entryFee: Double
    let totalSlots: Int
    let filledSlots: Int
    let status: ContestStatus
    let lockTime: Date?

    /// Whether slot information is available from the backend.
    /// When totalSlots is 0, it means backend didn't provide slot counts.
    var hasSlotInfo: Bool { totalSlots > 0 }

    var slotsRemaining: Int { totalSlots - filledSlots }

    /// A contest is full only if we have slot information AND no slots remain.
    /// When slot info is missing (hasSlotInfo = false), we cannot determine
    /// if the contest is full, so we return false to allow join attempts.
    var isFull: Bool { hasSlotInfo && slotsRemaining <= 0 }

    /// Whether the contest is past its lock time
    var isLocked: Bool {
        guard let lockTime = lockTime else { return false }
        return Date() >= lockTime
    }

    init(
        id: UUID,
        name: String,
        entryFee: Double,
        totalSlots: Int,
        filledSlots: Int,
        status: ContestStatus,
        lockTime: Date? = nil
    ) {
        self.id = id
        self.name = name
        self.entryFee = entryFee
        self.totalSlots = totalSlots
        self.filledSlots = filledSlots
        self.status = status
        self.lockTime = lockTime
    }

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case entryFee = "entry_fee"
        case totalSlots = "total_slots"
        case filledSlots = "filled_slots"
        case status
        case lockTime = "lock_time"
    }
}

/// Describes an environment mismatch (e.g., prod link opened in dev app)
struct EnvironmentMismatch: Equatable {
    let expectedEnvironment: String
    let actualEnvironment: String
    let message: String
}

/// Result of resolving a join token via /api/join/:token
struct ResolvedJoinLink: Equatable {
    let token: String
    let contest: ContestSummary
    let isValidForEnvironment: Bool
    let environmentMismatch: EnvironmentMismatch?
}

/// Result of a successful contest join
struct ContestJoinResult: Equatable {
    let contestId: UUID
    let userId: UUID
    let joinedAt: Date
    let message: String
}

/// Represents a parsed deep link action
enum DeepLinkAction: Equatable {
    case joinContest(token: String)
    case unknown
}
