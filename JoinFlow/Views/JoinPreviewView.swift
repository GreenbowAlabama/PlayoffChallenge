//
//  JoinPreviewView.swift
//  PlayoffChallenge
//
//  Join preview screen showing contest details and join CTA.
//

import SwiftUI

/// Join preview screen showing contest details and join CTA.
struct JoinPreviewView: View {
    let resolvedLink: ResolvedJoinLink
    let isAuthenticated: Bool
    let coordinator: DeepLinkCoordinator

    @State private var isJoining = false
    @State private var joinError: JoinLinkError?
    @State private var showError = false

    @Environment(\.dismiss) private var dismiss

    // Computed properties from the resolved link
    private var contestName: String { resolvedLink.contest.name }
    private var entryFee: String { String(format: "$%.2f", resolvedLink.contest.entryFee) }
    private var hasSlotsInfo: Bool { resolvedLink.contest.hasSlotInfo }

    /// Capacity text for the availability label.
    /// Shows "X / Y entries" when slot info is available, otherwise "Open".
    private var capacityText: String {
        guard hasSlotsInfo else {
            return "Open"
        }
        return "\(resolvedLink.contest.filledSlots) / \(resolvedLink.contest.totalSlots) entries"
    }

    private var isLocked: Bool {
        resolvedLink.contest.isLocked
    }

    private var primaryButtonTitle: String {
        if isLocked {
            return "Entries Closed"
        }
        return isAuthenticated ? "Join Contest" : "Sign In to Join"
    }

    private var canJoin: Bool {
        !resolvedLink.contest.isFull && resolvedLink.contest.status == .open && !isLocked
    }

    private var lockTimeText: String? {
        guard let lockTime = resolvedLink.contest.lockTime else { return nil }
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return "Entries close at \(formatter.string(from: lockTime))"
    }

    var body: some View {
        NavigationView {
            VStack(spacing: 24) {
                // Contest Info Card
                VStack(spacing: 16) {
                    Text(contestName)
                        .font(.title)
                        .fontWeight(.bold)
                        .multilineTextAlignment(.center)

                    Divider()

                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Entry Fee")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            Text(entryFee)
                                .font(.title3)
                                .fontWeight(.semibold)
                        }

                        Spacer()

                        VStack(alignment: .trailing, spacing: 4) {
                            Text("Entries")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            Text(capacityText)
                                .font(.title3)
                                .fontWeight(.semibold)
                                .foregroundColor(canJoin ? .primary : .red)
                        }
                    }

                    if let lockTimeText = lockTimeText {
                        Divider()
                        HStack {
                            Image(systemName: "clock")
                                .foregroundColor(isLocked ? .red : .secondary)
                            Text(lockTimeText)
                                .font(.subheadline)
                                .foregroundColor(isLocked ? .red : .secondary)
                        }
                    }
                }
                .padding(20)
                .background(Color(.systemBackground))
                .cornerRadius(12)
                .shadow(color: Color.black.opacity(0.1), radius: 4, x: 0, y: 2)

                Spacer()

                // Action Button
                Button(action: primaryButtonTapped) {
                    if isJoining {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                            .frame(maxWidth: .infinity)
                            .frame(height: 50)
                    } else {
                        Text(primaryButtonTitle)
                            .font(.headline)
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .frame(height: 50)
                    }
                }
                .background(canJoin ? Color.blue : Color.gray)
                .cornerRadius(10)
                .disabled(!canJoin || isJoining)

                // Cancel Button
                Button("Cancel") {
                    coordinator.dismiss()
                    dismiss()
                }
                .foregroundColor(.secondary)
            }
            .padding(24)
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Join Contest")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Close") {
                        coordinator.dismiss()
                        dismiss()
                    }
                }
            }
            .alert("Error", isPresented: $showError) {
                Button("OK") {
                    joinError = nil
                }
            } message: {
                if let error = joinError {
                    Text(error.errorDescription ?? "An error occurred")
                }
            }
        }
    }

    private func primaryButtonTapped() {
        if isAuthenticated {
            Task { await confirmJoin() }
        } else {
            // Store token for resume after auth, then dismiss to show sign in
            coordinator.storeTokenForLaterJoin()
            coordinator.dismiss()
            dismiss()
        }
    }

    private func confirmJoin() async {
        isJoining = true
        do {
            _ = try await coordinator.confirmJoin()
            // Dismiss preview - the coordinator will show contest detail
            dismiss()
        } catch let error as JoinLinkError {
            // Handle "already joined" as success - navigate to contest
            if case .alreadyJoined = error {
                dismiss()
                return
            }
            joinError = error
            showError = true
        } catch {
            joinError = .serverError(message: error.localizedDescription)
            showError = true
        }
        isJoining = false
    }
}
