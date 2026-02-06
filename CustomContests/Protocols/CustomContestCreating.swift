import Foundation

/// Protocol for creating custom contest drafts.
/// Implementations wrap the backend API for contest creation.
protocol CustomContestCreating {
    /// Creates a new draft contest on the backend.
    /// - Parameters:
    ///   - name: The contest name.
    ///   - settings: The contest settings.
    ///   - userId: The ID of the user creating the contest.
    /// - Returns: The created draft contest with backend-assigned ID.
    /// - Throws: `CustomContestError` on validation or network failure.
    func createDraft(
        name: String,
        settings: CustomContestSettings,
        userId: UUID,
        lockTime: Date?
    ) async throws -> CustomContestDraft
}

extension CustomContestCreating {
    func createDraft(
        name: String,
        settings: CustomContestSettings,
        userId: UUID
    ) async throws -> CustomContestDraft {
        try await createDraft(name: name, settings: settings, userId: userId, lockTime: nil)
    }
}
