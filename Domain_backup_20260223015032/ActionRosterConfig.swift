import Foundation

/// Domain model for roster configuration in contest action state.
/// Mapped from RosterConfigContract ([String: AnyCodable]).
/// Preserves raw contract data without interpretation.
/// Endpoint-specific to ContestDetailResponseContract.
struct ActionRosterConfig {
    let raw: [String: AnyCodable]
}
