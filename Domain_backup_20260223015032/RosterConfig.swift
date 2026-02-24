import Foundation

/// Domain model for roster configuration.
/// Mapped from RosterConfigDTO.
/// Keeps JSONValue uninterpreted at domain level.
struct RosterConfig: Equatable {
    let entryFields: [JSONValue]
    let validationRules: JSONValue
}
