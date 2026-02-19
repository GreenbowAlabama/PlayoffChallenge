import Foundation
import Combine

/// State machine for the create custom contest flow.
enum CreateCustomContestState: Equatable {
    case idle
    case creating
    case created
    case publishing
    case published
    case error(CustomContestError)
}

/// ViewModel for creating and publishing a custom contest.
/// Uses strict MVVM pattern with no SwiftUI dependencies.
@MainActor
final class CreateCustomContestViewModel: ObservableObject {

    // MARK: - Published State

    /// The current state of the contest creation flow.
    @Published private(set) var state: CreateCustomContestState = .idle

    /// User-editable contest name.
    @Published var contestName: String = ""

    /// User-editable max entries count.
    @Published var maxEntries: Int = 10

    /// Optional lock time for closing entries.
    @Published var lockTime: Date?

    /// Selected contest type for the creation flow.
    @Published var selectedContestType: ContestType = .nflPlayoff

    /// The created draft (available after successful creation).
    @Published private(set) var draft: CustomContestDraft?

    /// The publish result (available after successful publish).
    @Published private(set) var publishResult: PublishContestResult?

    // MARK: - Dependencies

    private let creator: CustomContestCreating
    private let publisher: CustomContestPublishing
    private let userId: UUID

    // MARK: - Initialization

    init(
        creator: CustomContestCreating,
        publisher: CustomContestPublishing,
        userId: UUID
    ) {
        self.creator = creator
        self.publisher = publisher
        self.userId = userId
    }

    // MARK: - Computed Properties

    /// First validation error for current inputs, if any.
    var validationError: CustomContestError? {
        let errors = CustomContestValidation.validateDraftCreation(
            name: contestName,
            maxEntries: maxEntries,
            lockTime: lockTime
        )
        return errors.first
    }

    /// Whether the create button should be enabled.
    var isCreateEnabled: Bool {
        validationError == nil && !contestName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Whether the publish button should be enabled.
    var isPublishEnabled: Bool {
        draft != nil && state == .created
    }

    /// Whether a submission is in progress.
    var isSubmitting: Bool {
        state == .creating || state == .publishing
    }

    /// Dynamic primary button title based on state.
    var primaryButtonTitle: String {
        switch state {
        case .idle, .creating, .error:
            return draft == nil ? "Create Contest" : "Publish Contest"
        case .created, .publishing:
            return "Publish Contest"
        case .published:
            return "Published"
        }
    }

    // MARK: - Actions

    /// Creates a draft contest on the backend.
    func createDraft() async {
        guard isCreateEnabled else { return }

        let trimmedName = contestName.trimmingCharacters(in: .whitespacesAndNewlines)
        let settings = CustomContestSettings(maxEntries: maxEntries)

        state = .creating

        do {
            let createdDraft = try await creator.createDraft(
                name: trimmedName,
                settings: settings,
                userId: userId,
                lockTime: lockTime
            )
            draft = createdDraft
            state = .created
        } catch let error as CustomContestError {
            state = .error(error)
        } catch {
            state = .error(.networkError(underlying: error.localizedDescription))
        }
    }

    /// Publishes the current draft contest.
    func publishDraft() async {
        guard let currentDraft = draft else { return }

        state = .publishing

        do {
            let result = try await publisher.publish(
                contestId: currentDraft.id,
                userId: userId
            )
            publishResult = result
            state = .published
        } catch let error as CustomContestError {
            state = .error(error)
        } catch {
            state = .error(.networkError(underlying: error.localizedDescription))
        }
    }

    /// Clears any error state and returns to the appropriate state.
    func clearError() {
        guard case .error = state else { return }

        if draft != nil {
            state = .created
        } else {
            state = .idle
        }
    }
}
