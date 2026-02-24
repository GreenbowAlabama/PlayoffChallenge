import SwiftUI
import Core

/// Minimal UI for creating and publishing a custom contest.
/// This view is intentionally simple - no design polish, just functional.
struct CreateCustomContestView: View {
    @StateObject private var viewModel: CreateCustomContestViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var lockTimeEnabled = false

    init(viewModel: CreateCustomContestViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel)
    }

    var body: some View {
        Form {
            contestTemplateSection
            contestDetailsSection
            payoutStructureSection
            lockTimeSection
            actionSection
            statusSection
        }
        .navigationTitle("NEW TEMPLATE FLOW")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") {
                    dismiss()
                }
            }
        }
        .disabled(viewModel.isSubmitting)
        .task {
            await viewModel.loadTemplates()
        }
    }

    // MARK: - Sections

    private var contestTemplateSection: some View {
        Section("Contest Template") {
            Picker("Contest Template", selection: $viewModel.selectedTemplate) {
                ForEach(viewModel.templates) { template in
                    Text(template.name)
                        .tag(Optional(template))
                }
            }
        }
    }

    private var contestDetailsSection: some View {
        Section("Contest Details") {
            TextField("Contest Name", text: $viewModel.contestName)
                .autocorrectionDisabled()

            Stepper(
                "Max Entries: \(viewModel.maxEntries)",
                value: $viewModel.maxEntries,
                in: 2...1000
            )

            Picker("Entry Fee", selection: $viewModel.selectedEntryFeeCents) {
                ForEach(viewModel.allowedEntryFeeOptions, id: \.self) { fee in
                    Text(viewModel.formatDollars(fee))
                        .tag(fee)
                }
            }
        }
    }

    private var payoutStructureSection: some View {
        Section {
            if let structure = viewModel.selectedPayoutStructure {
                LabeledContent("Type", value: structure.type.replacingOccurrences(of: "_", with: " ").capitalized)
                if let n = structure.maxWinners {
                    LabeledContent("Max Winners", value: "\(n)")
                }

                ForEach(Array(viewModel.payoutPreview.enumerated()), id: \.offset) { _, line in
                    HStack {
                        Text(line.place)
                        Spacer()
                        Text(String(format: "%.0f%%", line.percentage))
                            .foregroundStyle(.secondary)
                        Text(String(format: "$%.2f", line.amount))
                            .monospacedDigit()
                    }
                }
            } else {
                Text("No payout structure available")
                    .foregroundStyle(.red)
                    .font(.caption)
            }
        } header: {
            Text("Payout Preview")
        } footer: {
            let feeText = viewModel.selectedEntryFeeCents == 0
                ? "Free"
                : viewModel.formatDollars(viewModel.selectedEntryFeeCents)
            Text("Based on \(viewModel.maxEntries) entries × \(feeText)")
                .font(.caption)
        }
    }

    private var lockTimeSection: some View {
        Section {
            Toggle("Contest locks", isOn: $lockTimeEnabled)
                .onChange(of: lockTimeEnabled) { _, enabled in
                    viewModel.lockTime = enabled ? Date().addingTimeInterval(3600) : nil
                }

            if lockTimeEnabled {
                DatePicker(
                    "Date & Time",
                    selection: Binding(
                        get: { viewModel.lockTime ?? Date().addingTimeInterval(3600) },
                        set: { viewModel.lockTime = $0 }
                    ),
                    in: Date()...,
                    displayedComponents: [.date, .hourAndMinute]
                )
            }
        } footer: {
            Text("Optional. After this time, the contest locks and new entries are not accepted.")
                .font(.caption)
        }
    }

    private var actionSection: some View {
        Section {
            primaryButton
        }
    }

    @ViewBuilder
    private var primaryButton: some View {
        switch viewModel.state {
        case .idle, .error:
            Button {
                Task {
                    await viewModel.createDraft()
                }
            } label: {
                HStack {
                    Spacer()
                    Text("Create Contest")
                    Spacer()
                }
            }
            .disabled(!viewModel.isCreateEnabled)

        case .creating:
            HStack {
                Spacer()
                ProgressView()
                Text("Creating...")
                    .padding(.leading, 8)
                Spacer()
            }

        case .created:
            Button {
                Task {
                    await viewModel.publishDraft()
                }
            } label: {
                HStack {
                    Spacer()
                    Text("Publish Contest")
                    Spacer()
                }
            }

        case .publishing:
            HStack {
                Spacer()
                ProgressView()
                Text("Publishing...")
                    .padding(.leading, 8)
                Spacer()
            }

        case .published:
            VStack(spacing: 12) {
                HStack {
                    Spacer()
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                    Text("Published!")
                    Spacer()
                }
                Button("Done") {
                    dismiss()
                }
                .padding(.top, 8)
            }
        }
    }

    @ViewBuilder
    private var statusSection: some View {
        // Validation error
        if let error = viewModel.validationError, viewModel.state == .idle {
            Section {
                Text(error.errorDescription ?? "Invalid input")
                    .foregroundStyle(.red)
                    .font(.caption)
            }
        }

        // Service error
        if case .error(let error) = viewModel.state {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text(error.title)
                        .font(.headline)
                        .foregroundStyle(.red)
                    Text(error.errorDescription ?? "An error occurred")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Button("Dismiss") {
                        viewModel.clearError()
                    }
                    .font(.caption)
                }
            }
        }

        // Success info
        if let result = viewModel.publishResult {
            Section("Share Link") {
                VStack(alignment: .leading, spacing: 8) {
                    Text(result.joinLink)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Button {
                        UIPasteboard.general.string = result.joinLink
                    } label: {
                        Label("Copy Link", systemImage: "doc.on.doc")
                    }
                    .font(.caption)
                }
            }
        }

        // Draft info (debug)
        if let draft = viewModel.draft {
            Section("Draft Info") {
                LabeledContent("ID", value: draft.id.uuidString.prefix(8).description)
                LabeledContent("Status", value: draft.status.rawValue)
            }
            .font(.caption)
        }
    }
}

#Preview {
    CreateCustomContestView(
        viewModel: CreateCustomContestViewModel(
            creator: PreviewCustomContestCreator(),
            publisher: PreviewCustomContestPublisher(),
            userId: UUID()
        )
    )
}

// MARK: - Preview Helpers

private final class PreviewCustomContestCreator: CustomContestCreating {
    func loadTemplates() async throws -> [ContestTemplate] {
        return [
            ContestTemplate(
                id: UUID(),
                name: "Masters Golf V2",
                defaultEntryFeeCents: 5000,
                allowedEntryFeeMinCents: 0,
                allowedEntryFeeMaxCents: 10000,
                allowedPayoutStructures: [PayoutStructure(type: "top_n_split", maxWinners: 3)]
            ),
            ContestTemplate(
                id: UUID(),
                name: "NFL Playoff Pool",
                defaultEntryFeeCents: 2500,
                allowedEntryFeeMinCents: 0,
                allowedEntryFeeMaxCents: 5000,
                allowedPayoutStructures: [PayoutStructure(type: "winner_take_all", maxWinners: nil)]
            )
        ]
    }

    func createDraft(templateId: UUID, name: String, settings: CustomContestSettings, payoutStructure: PayoutStructure, userId: UUID, lockTime: Date?) async throws -> CustomContestDraft {
        try await Task.sleep(for: .seconds(1))
        return CustomContestDraft(name: name, settings: settings)
    }
}

private final class PreviewCustomContestPublisher: CustomContestPublishing {
    func publish(contestId: UUID, userId: UUID) async throws -> PublishContestResult {
        try await Task.sleep(for: .seconds(1))
        return PublishContestResult(
            contestId: contestId,
            joinToken: "preview-token",
            joinURL: URL(string: "https://playoffchallenge.app/join/preview-token")!
        )
    }
}
