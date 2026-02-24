import Foundation

/// Centralized JSONDecoder configuration for all DTO decoding.
/// Single source of truth for date format, strategy, and other decoder settings.
extension JSONDecoder {
    /// Standard ISO8601 decoder used for all API response decoding.
    static let iso8601Decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()
}

/// Minimal acknowledgment DTO for POST /api/custom-contests response.
/// Contains only the contest id returned by the backend.
/// Full details are available via GET /api/custom-contests/{id}.
struct CreateContestAckDTO: Decodable {
    let id: UUID
}
