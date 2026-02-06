import SwiftUI

/// Minimal UI for creating and publishing a custom contest.
/// This view is intentionally simple - no design polish, just functional.
struct CreateCustomContestView: View {
    @ObservedObject var viewModel: CreateCustomContestViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var lockTimeEnabled = false

    var body: some View {
        NavigationStack {
            Form {
                contestDetailsSection
                lockTimeSection
                actionSection
                statusSection
            }
            .navigationTitle("Create Contest")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
            .disabled(viewModel.isSubmitting)
        }
    }

    // MARK: - Sections

    private var contestDetailsSection: some View {
        Section("Contest Details") {
            TextField("Contest Name", text: $viewModel.contestName)
                .autocorrectionDisabled()

            Stepper(
                "Max Entries: \(viewModel.maxEntries)",
                value: $viewModel.maxEntries,
                in: 2...1000
            )
        }
    }

    private var lockTimeSection: some View {
        Section {
            Toggle("Entries close", isOn: $lockTimeEnabled)
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
            Text("Optional. After this time, new entries are disabled.")
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
            HStack {
                Spacer()
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                Text("Published!")
                Spacer()
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
    func createDraft(name: String, settings: CustomContestSettings, userId: UUID, lockTime: Date?) async throws -> CustomContestDraft {
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
