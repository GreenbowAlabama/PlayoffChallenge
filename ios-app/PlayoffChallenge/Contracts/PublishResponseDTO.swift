import Foundation

/// DTO for publish response.
/// Maps to OpenAPI PublishResponse.
/// CAMELCASE (per OpenAPI schema).
/// Used by:
/// - POST /api/custom-contests/{id}/publish (200)
struct PublishResponseDTO: Decodable {
    let contestId: UUID
    let joinToken: String
    let joinURL: URL

    enum CodingKeys: String, CodingKey {
        case contestId, joinToken, joinURL
    }
}
