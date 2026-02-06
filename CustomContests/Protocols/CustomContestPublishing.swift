import Foundation

/// Protocol for publishing custom contest drafts.
/// Implementations wrap the existing backend publishContest function.
protocol CustomContestPublishing {
    /// Publishes a draft contest, making it open for entries.
    /// - Parameters:
    ///   - contestId: The ID of the draft contest to publish.
    ///   - userId: The ID of the user (must be contest owner).
    /// - Returns: The publish result containing the join link.
    /// - Throws: `CustomContestError` if not in draft state or on failure.
    func publish(
        contestId: UUID,
        userId: UUID
    ) async throws -> PublishContestResult
}
