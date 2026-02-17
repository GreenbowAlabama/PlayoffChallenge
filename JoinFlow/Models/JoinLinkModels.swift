//
//  JoinLinkModels.swift
//  PlayoffChallenge
//
//  Models for join flow - pure, immutable data structures
//

import Foundation

/// Status of a contest
enum ContestStatus: String, Codable, Equatable {
    case scheduled = "SCHEDULED"
    case locked = "LOCKED"
    case live = "LIVE"
    case complete = "COMPLETE"
    case cancelled = "CANCELLED"
    case error = "ERROR"
}

/// Backend-computed join state — single source of truth for joinability
enum ComputedJoinState: String, Codable, Equatable {
    case joinable = "JOINABLE"
    case locked = "LOCKED"
    case completed = "COMPLETED"
    case unavailable = "UNAVAILABLE"
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
    let computedJoinState: ComputedJoinState?
    let creatorName: String?

    /// Whether the contest has a finite entry cap.
    /// totalSlots <= 0 means unlimited entries.
    var hasSlotInfo: Bool { totalSlots > 0 }

    var slotsRemaining: Int { totalSlots - filledSlots }

    init(
        id: UUID,
        name: String,
        entryFee: Double,
        totalSlots: Int,
        filledSlots: Int,
        status: ContestStatus,
        lockTime: Date? = nil,
        computedJoinState: ComputedJoinState? = nil,
        creatorName: String? = nil
    ) {
        self.id = id
        self.name = name
        self.entryFee = entryFee
        self.totalSlots = totalSlots
        self.filledSlots = filledSlots
        self.status = status
        self.lockTime = lockTime
        self.computedJoinState = computedJoinState
        self.creatorName = creatorName
    }

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case entryFee = "entry_fee"
        case totalSlots = "total_slots"
        case filledSlots = "filled_slots"
        case status
        case lockTime = "lock_time"
        case computedJoinState = "computed_join_state"
        case creatorName = "creator_name"
    }
}

/// Describes an environment mismatch (e.g., prod link opened in dev app)
struct EnvironmentMismatch: Equatable {
    let expectedEnvironment: String
    let actualEnvironment: String
    let message: String
}

/// Result of resolving a join token via /api/custom-contests/join/:token.
/// Contains only routing data — contest metadata is fetched separately via GET /api/custom-contests/:id.
struct ResolvedJoinLink: Equatable {
    let token: String
    let contestId: UUID
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
