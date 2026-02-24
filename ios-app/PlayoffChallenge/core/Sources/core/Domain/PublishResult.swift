import Foundation

/// Domain model for publish operation result.
/// Mapped from PublishResponseDTO.
struct PublishResult: Equatable {
    let contestId: UUID
    let joinToken: String
    let joinURL: URL
}
