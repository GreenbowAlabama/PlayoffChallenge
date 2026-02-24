import Foundation
import Combine
import Core

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

    /// Available contest templates loaded from backend.
    @Published private(set) var templates: [ContestTemplate] = []

    /// Selected contest template for the creation flow.
    @Published var selectedTemplate: ContestTemplate? {
        didSet {
            // Reset fee and payout structure to template defaults when template changes
            if let template = selectedTemplate {
                selectedEntryFeeCents = template.defaultEntryFeeCents
                selectedPayoutStructure = template.allowedPayoutStructures.first
            }
        }
    }

    /// Selected payout structure for the contest.
    @Published var selectedPayoutStructure: PayoutStructure?

    /// Selected entry fee in cents.
    @Published var selectedEntryFeeCents: Int = 0

    /// The created draft (available after successful creation).
    @Published private(set) var draft: Contest?

    /// The publish result (available after successful publish).
    @Published private(set) var publishResult: PublishResult?

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

    convenience init(service: CustomContestService, userId: UUID) {
        self.init(creator: service, publisher: service, userId: userId)
    }

    /// Loads templates on initialization.
    func loadTemplates() async {
        do {
            templates = try await creator.loadTemplates()
            // Select first template by default
            selectedTemplate = templates.first
        } catch {
            print("⚠️ Failed to load templates: \(error)")
        }
    }

    // MARK: - Computed Properties

    /// Available entry fee options in cents, derived from template constraints.
    var allowedEntryFeeOptions: [Int] {
        guard let template = selectedTemplate else { return [] }

        let min = template.allowedEntryFeeMinCents
        let max = template.allowedEntryFeeMaxCents
        guard min <= max else { return [] }

        let step = 500 // $5 increment to match legacy implementation

        var options = Array(stride(from: min, through: max, by: step))
            .filter { $0 >= 0 }

        // Ensure default is included even if not aligned to step
        if !options.contains(template.defaultEntryFeeCents) {
            options.append(template.defaultEntryFeeCents)
            options.sort()
        }

        return options
    }

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

    /// Estimated prize pool for preview purposes (entry fee × max entries).
    /// No rake applied — this is an approximate user-facing preview.
    var estimatedPrizePool: Double {
        Double(selectedEntryFeeCents) / 100.0 * Double(maxEntries)
    }

    /// Payout preview based on selected payout structure and entry fee.
    var payoutPreview: [PayoutLineData] {
        guard let structure = selectedPayoutStructure else { return [] }
        let coreStructure = PayoutStructureData(type: structure.type, maxWinners: structure.maxWinners)
        return PayoutCalculator.calculatePayoutTable(structure: coreStructure, prizePool: estimatedPrizePool)
    }

    /// Whether the selected template has valid payout structures.
    var isPayoutValid: Bool {
        guard let template = selectedTemplate else { return false }
        return !template.allowedPayoutStructures.isEmpty
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
        guard let templateId = selectedTemplate?.id else { return }
        guard let payoutStructure = selectedPayoutStructure else {
            state = .error(.serverError(message: "Template has no allowed payout structures"))
            return
        }

        let trimmedName = contestName.trimmingCharacters(in: .whitespacesAndNewlines)
        let settings = CustomContestSettings(
            maxEntries: maxEntries,
            entryFeeCents: selectedEntryFeeCents
        )

        state = .creating

        do {
            let createdDraft = try await creator.createDraft(
                templateId: templateId,
                name: trimmedName,
                settings: settings,
                payoutStructure: payoutStructure,
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

/// Formats cents as a dollar string (e.g., 500 -> "$5", 0 -> "Free").
    func formatDollars(_ cents: Int) -> String {
        if cents == 0 {
            return "Free"
        }
        let dollars = cents / 100
        return "$\(dollars)"
    }
}
