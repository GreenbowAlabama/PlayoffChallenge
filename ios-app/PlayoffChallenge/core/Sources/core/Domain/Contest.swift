import Foundation

/// Domain contest model - single persisted contest representation.
/// Mapped from ContestDetailResponseContract or ContestListItemDTO.
/// Never decodes JSON.
/// STUB: Full implementation pending type definitions.
struct Contest: Identifiable {
    let id: UUID

    /// Stub initializer for testing.
    static func from(_ contract: ContestDetailResponseContract) -> Contest {
        return Contest(id: UUID(uuidString: contract.contest_id) ?? UUID())
    }
}
