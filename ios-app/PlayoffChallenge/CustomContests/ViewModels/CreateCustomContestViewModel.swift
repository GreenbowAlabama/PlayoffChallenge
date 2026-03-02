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
            // Reset fee and payout structure to defaults when template changes
            if let template = selectedTemplate {
                selectedEntryFeeCents = defaultEntryFeeCents

                // Template has required allowedPayoutStructures array.
                // Still guard against empty array to avoid invalid state.
                if let first = template.allowedPayoutStructures.first {
                    selectedPayoutStructure = first
                } else {
                    selectedPayoutStructure = nil
                }
            }
        }
    }

    /// Selected payout structure for the contest.
    @Published var selectedPayoutStructure: PayoutStructure?

    /// Selected entry fee in cents (non-optional; defaults to 5000).
    @Published var selectedEntryFeeCents: Int = 5000

    /// The created draft (available after successful creation).
    @Published private(set) var draft: Contest?

    // MARK: - ViewModel-owned financial defaults

    /// Default entry fee in cents for new contests.
    private let defaultEntryFeeCents = 5000

    /// Allowed entry fee range in cents.
    private let allowedEntryFeeRange: ClosedRange<Int> = 0...100000

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
            let loadedTemplates = try await creator.loadTemplates()
            self.templates = loadedTemplates
            
            // Select first template by default if none selected and templates available
            if selectedTemplate == nil, !loadedTemplates.isEmpty {
                selectedTemplate = loadedTemplates[0]
            }
        } catch {
            print("⚠️ Failed to load templates: \(error)")
        }
    }

    // MARK: - Computed Properties

    /// Available entry fee options in cents.
    var allowedEntryFeeOptions: [Int] {
        [0, 500, 1000, 2500, 5000, 10000]
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
        let hasName = !contestName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let hasTemplate = selectedTemplate != nil

        let payoutIsRequired: Bool = {
            guard let t = selectedTemplate else { return false }
            return !t.allowedPayoutStructures.isEmpty
        }()

        let hasPayout = !payoutIsRequired || (selectedPayoutStructure != nil)

        // COMPLIANCE: For percentage type, payout_percentages must be present and non-empty.
        // This prevents sending incomplete payoutStructure to backend.
        let payoutValid = {
            guard let structure = selectedPayoutStructure else { return true }
            if structure.type == "percentage" {
                return !(structure.payoutPercentages?.isEmpty ?? true)
            }
            return true
        }()

        return validationError == nil && hasName && hasTemplate && hasPayout && payoutValid
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

    /// Creates a draft contest and immediately publishes it.
    func createDraft() async {
        guard isCreateEnabled else { return }
        guard let templateIdString = selectedTemplate?.id,
              let templateId = UUID(uuidString: templateIdString) else { return }
        guard let payoutStructure = selectedPayoutStructure else {
            state = .error(.serverError(message: "Template has no allowed payout structures"))
            return
        }

        let trimmedName = contestName.trimmingCharacters(in: .whitespacesAndNewlines)
        let settings = CustomContestSettings(
            entryFeeCents: selectedEntryFeeCents,
            maxEntries: maxEntries
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
            print("===== VIEWMODEL DRAFT ASSIGNMENT =====")
            print("Draft Contest ID: \(createdDraft.id.uuidString)")
            print("Draft Contest Status: \(createdDraft.status)")
            print("Draft Contest Name: \(createdDraft.contestName)")
            print("===== VIEWMODEL ASSIGNMENT END =====")
            draft = createdDraft

            // Auto-publish immediately after creating draft
            await publishDraftInternal(createdDraft)
        } catch let error as CustomContestError {
            state = .error(error)
        } catch {
            state = .error(.networkError(underlying: error.localizedDescription))
        }
    }

    /// Internal publish method that updates state and result.
    private func publishDraftInternal(_ currentDraft: Contest) async {
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
