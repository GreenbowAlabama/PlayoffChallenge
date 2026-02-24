import Foundation

/// Protocol for creating custom contest drafts.
/// Implementations wrap the backend API for contest creation.
protocol CustomContestCreating {
    /// Loads available contest templates (minimal: id, name only).
    /// No authentication required.
    /// - Returns: Array of contest templates.
    /// - Throws: `CustomContestError` on network failure.
    func loadTemplates() async throws -> [ContestTemplate]

    /// Creates a new draft contest on the backend.
    /// - Parameters:
    ///   - templateId: The ID of the contest template defining rules and constraints.
    ///   - name: The contest name.
    ///   - settings: The contest settings.
    ///   - payoutStructure: The payout structure (from template's allowed structures).
    ///   - userId: The ID of the user creating the contest.
    /// - Returns: The created draft contest with backend-assigned ID.
    /// - Throws: `CustomContestError` on validation or network failure.
    func createDraft(
        templateId: UUID,
        name: String,
        settings: CustomContestSettings,
        payoutStructure: PayoutStructure,
        userId: UUID,
        lockTime: Date?
    ) async throws -> Contest
}

extension CustomContestCreating {
    func createDraft(
        templateId: UUID,
        name: String,
        settings: CustomContestSettings,
        payoutStructure: PayoutStructure,
        userId: UUID
    ) async throws -> Contest {
        try await createDraft(templateId: templateId, name: name, settings: settings, payoutStructure: payoutStructure, userId: userId, lockTime: nil)
    }
}
