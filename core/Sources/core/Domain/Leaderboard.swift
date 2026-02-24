//
//  Leaderboard.swift
//  core
//
//  Domain model for contest leaderboard.
//

import Foundation

/// Leaderboard domain model representing the current standings of a contest.
/// Mapped from `LeaderboardResponseContract`.
/// Immutable, Codable, Hashable, Equatable, and Sendable.
public struct Leaderboard: Codable, Hashable, Equatable, Sendable {
    public let contestId: UUID
    public let contestType: String
    public let state: LeaderboardComputationState
    public let generatedAt: Date?
    public let columns: [LeaderboardColumn]
    public let rows: [Standing]
    
    public init(
        contestId: UUID,
        contestType: String,
        state: LeaderboardComputationState,
        generatedAt: Date?,
        columns: [LeaderboardColumn],
        rows: [Standing]
    ) {
        self.contestId = contestId
        self.contestType = contestType
        self.state = state
        self.generatedAt = generatedAt
        self.columns = columns
        self.rows = rows
    }
    
    enum CodingKeys: String, CodingKey {
        case contestId = "contest_id"
        case contestType = "contest_type"
        case state
        case generatedAt = "generated_at"
        case columns
        case rows
    }
    
    // MARK: - Mapping
    /// Initialize from a contract type.
    public static func from(_ contract: LeaderboardResponseContract) -> Leaderboard {
        let formatter = ISO8601DateFormatter()
        let generatedAt = contract.generated_at.flatMap { formatter.date(from: $0) }
        
        return Leaderboard(
            contestId: UUID(uuidString: contract.contest_id) ?? UUID(),
            contestType: contract.contest_type,
            state: LeaderboardComputationState.from(contract.leaderboard_state),
            generatedAt: generatedAt,
            columns: contract.column_schema.map { LeaderboardColumn.from($0) },
            rows: contract.rows.map { Standing.from($0) }
        )
    }
    
    // MARK: - Testing Factory
    /// Stub factory for testing.
    public static func stub(
        contestId: UUID = UUID(),
        contestType: String = "playoff",
        state: LeaderboardComputationState = .computed,
        generatedAt: Date? = Date(),
        columns: [LeaderboardColumn] = [LeaderboardColumn.stub()],
        rows: [Standing] = [Standing.stub()]
    ) -> Leaderboard {
        return Leaderboard(
            contestId: contestId,
            contestType: contestType,
            state: state,
            generatedAt: generatedAt,
            columns: columns,
            rows: rows
        )
    }
}

/// LeaderboardColumn domain model for column metadata.
/// Mapped from `LeaderboardColumnSchema`.
public struct LeaderboardColumn: Codable, Hashable, Equatable, Sendable {
    public let key: String
    public let label: String
    public let type: String?
    public let format: String?
    
    public init(key: String, label: String, type: String?, format: String?) {
        self.key = key
        self.label = label
        self.type = type
        self.format = format
    }
    
    // MARK: - Mapping
    /// Initialize from a contract type.
    public static func from(_ contract: LeaderboardColumnSchema) -> LeaderboardColumn {
        return LeaderboardColumn(
            key: contract.key,
            label: contract.label,
            type: contract.type,
            format: contract.format
        )
    }
    
    // MARK: - Testing Factory
    /// Stub factory for testing.
    public static func stub(
        key: String = "points",
        label: String = "Points",
        type: String? = "number",
        format: String? = nil
    ) -> LeaderboardColumn {
        return LeaderboardColumn(key: key, label: label, type: type, format: format)
    }
}
