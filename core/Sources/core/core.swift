//
//  core.swift
//  core
//
//  Main entry point for the core module.
//  Exports all public Domain and Contract types for iOS client usage.
//

import Foundation

// MARK: - Domain Model Exports
// These types represent the stable business logic layer.
// They are immutable, thread-safe (Sendable), and decoupled from backend snake_case.

/*
 Publicly exported Domain types:
 - Standing
 - PayoutRow
 - RosterConfig
 - PayoutTier
 - ContestActions
 - LeaderboardComputationState
 - ContestActionState
 - Leaderboard
 - LeaderboardColumn
 - Contest
 - ContestStatus
 - ContestTemplate
 - CustomContestDraft
 - CustomContestSettings
 - PayoutStructure
 - PublishResult
*/

// MARK: - Contract Exports
// These types represent the raw backend data structures.
// Used primarily by the networking layer to decode responses.

/*
 Publicly exported Contract types:
 - LeaderboardResponseContract
 - ContestDetailResponseContract
 - ContestListItemDTO
 - LeaderboardRowContract
 - PayoutRowContract
 - PayoutTierContract
 - LeaderboardStateContract
 - ContestActionsContract
 - LeaderboardColumnSchema
 - AnyCodable
*/
