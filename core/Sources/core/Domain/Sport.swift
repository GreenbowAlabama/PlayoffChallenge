import Foundation

/// Contest sport type (e.g., GOLF, NFL).
/// Maps from OpenAPI template_sport field.
public enum Sport: String, Codable, Sendable, Equatable {
    case golf = "GOLF"
    case nfl = "NFL"
    case unknown = "UNKNOWN"

    /// Initialize from backend template_sport string.
    /// Backend returns: "GOLF", "NFL", or other values.
    /// Defaults to .unknown if nil or unrecognized (explicit, not silent).
    public init(_ value: String?) {
        guard let value = value else {
            self = .unknown
            return
        }

        self = Sport(rawValue: value.uppercased()) ?? .unknown
    }
}
