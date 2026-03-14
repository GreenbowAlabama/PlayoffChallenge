import Foundation

/// Contest sport type (e.g., GOLF, NFL).
/// Maps from OpenAPI template_sport field.
public enum Sport: String, Codable, Sendable, Equatable {
    case golf = "GOLF"
    case nfl = "NFL"
    case unknown = "UNKNOWN"

    /// Initialize from backend template_sport string.
    /// Backend returns: "GOLF", "NFL", or other values.
    public init(_ rawValue: String?) {
        guard let rawValue = rawValue else {
            self = .unknown
            return
        }

        switch rawValue.uppercased() {
        case "GOLF":
            self = .golf
        case "NFL":
            self = .nfl
        default:
            self = .unknown
        }
    }
}
