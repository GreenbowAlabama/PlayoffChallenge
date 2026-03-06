import Foundation

/// Centralized JSONDecoder configuration for all DTO decoding.
/// Single source of truth for date format, strategy, and other decoder settings.
extension JSONDecoder {
    /// Standard ISO8601 decoder used for all API response decoding.
    /// Uses custom ISO8601DateFormatter with fractional seconds support.
    /// Ensures compatibility with iOS 11.2+ when backend sends timestamps with milliseconds.
    static let iso8601Decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let dateString = try container.decode(String.self)
            if let date = formatter.date(from: dateString) {
                return date
            }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Cannot decode date string \(dateString)")
        }
        return decoder
    }()
}

/// Minimal acknowledgment DTO for POST /api/custom-contests response.
/// Contains only the contest id returned by the backend.
/// Full details are available via GET /api/custom-contests/{id}.
struct CreateContestAckDTO: Decodable {
    let id: UUID
}
