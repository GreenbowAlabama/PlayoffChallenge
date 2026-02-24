import Foundation

/// Enumeration of available contest types for contest creation.
/// Currently only one type is supported. This scaffolds for future expansion.
enum ContestType: CaseIterable, Identifiable {
    case nflPlayoff

    var id: String {
        switch self {
        case .nflPlayoff:
            return "nfl_playoff"
        }
    }

    var displayName: String {
        switch self {
        case .nflPlayoff:
            return "NFL Playoff Challenge"
        }
    }
}
