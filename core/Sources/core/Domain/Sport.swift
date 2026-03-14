import Foundation

/// Contest sport type (e.g., GOLF, NFL).
/// Maps from OpenAPI template_sport field.
public enum Sport: String, Codable, Sendable, Equatable {
    case golf = "GOLF"
    case nfl = "NFL"
    case unknown = "UNKNOWN"

    /// Initialize from backend template_sport string.
    /// Backend returns: "GOLF", "NFL", or other values.
    /// Defaults to .nfl if nil or unrecognized.
    public init(_ value: String?) {
        guard let value = value else {
            self = .nfl
            return
        }

        self = Sport(rawValue: value.uppercased()) ?? .nfl
    }
}
