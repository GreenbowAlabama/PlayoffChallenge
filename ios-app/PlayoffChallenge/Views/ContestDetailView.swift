//
//  ContestDetailView.swift
//  PlayoffChallenge
//
//  Detail view for a specific contest.
//

import SwiftUI
import UIKit

struct ContestDetailView: View {
    @StateObject private var viewModel: ContestDetailViewModel
    @EnvironmentObject var authService: AuthService
    @EnvironmentObject var landingViewModel: LandingViewModel
    @Environment(\.dismiss) var dismiss
    @State private var navigateToLeaderboard = false
    @State private var navigateToLineup = false
    @State private var showRules = false
    @State private var showCopyConfirmation = false
    @State private var showDeleteConfirmation = false
    @State private var showUnjoinConfirmation = false

    /// If true, after cancel/leave, navigate to MyContests instead of dismissing.
    /// Used for create/deep-link flows where we need semantic redirection.
    let resetOnExit: Bool

    /// Primary initializer — contestId is the source of truth, placeholder is optional.
    init(contestId: UUID, placeholder: Contest? = nil, contestJoiner: ContestJoining? = nil, resetOnExit: Bool = false) {
        let joiner = contestJoiner ?? ContestJoinService()
        _viewModel = StateObject(wrappedValue: ContestDetailViewModel(
            contestId: contestId,
            placeholder: placeholder,
            contestJoiner: joiner
        ))
        self.resetOnExit = resetOnExit
    }

    /// Convenience initializer for callers that have a full Contest.
    /// contestId is extracted from the contest; the contest is used as placeholder only.
    init(contest: Contest, contestJoiner: ContestJoining? = nil, resetOnExit: Bool = false) {
        self.init(contestId: contest.id, placeholder: contest, contestJoiner: contestJoiner, resetOnExit: resetOnExit)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                // Contest Header Card
                VStack(spacing: 16) {
                    Image(systemName: "trophy.fill")
                        .font(.system(size: 60))
                        .foregroundColor(.orange)

                    Text(viewModel.contest.contestName)
                        .font(.title)
                        .fontWeight(.bold)

                    HStack(spacing: 20) {
                        StatView(value: "\(viewModel.contest.entryCount)", label: "Entries")
                        StatView(value: viewModel.displayStatusMessage, label: "Status")
                        StatView(value: "\(viewModel.contest.maxEntries ?? 0)", label: "Max")
                    }
                }
                .padding()
                .frame(maxWidth: .infinity)
                .background(Color(.systemGray6))
                .cornerRadius(16)
                .padding(.horizontal)
                .redacted(reason: viewModel.contest.contestName == "Loading…" ? .placeholder : [])

                // Entry Fee Card
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Entry Fee")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                        Text(viewModel.contest.entryFeeCents == 0 ? "Free" : String(format: "$%.2f", Double(viewModel.contest.entryFeeCents) / 100.0))
                            .font(.title2)
                            .fontWeight(.bold)
                            .foregroundColor(viewModel.contest.entryFeeCents == 0 ? .green : .primary)
                    }

                    Spacer()

                    if viewModel.canSelectLineup {
                        Label("Joined", systemImage: "checkmark.circle.fill")
                            .font(.headline)
                            .foregroundColor(.green)
                    }
                }
                .padding()
                .background(Color(.systemGray6))
                .cornerRadius(12)
                .padding(.horizontal)

                // Status Message
                if let message = viewModel.statusMessage {
                    Text(message)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                }

                // Action Buttons
                VStack(spacing: 12) {
                    // Join Button (only shown if can join)
                    if viewModel.canJoinContest {
                        Button {
                            Task {
                                await viewModel.joinContest()
                            }
                        } label: {
                            HStack {
                                if viewModel.isJoining {
                                    ProgressView()
                                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                } else {
                                    Image(systemName: "person.badge.plus")
                                    Text(viewModel.joinButtonTitle)
                                }
                            }
                            .font(.headline)
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(viewModel.canJoinContest ? Color.green : Color.gray)
                            .cornerRadius(12)
                        }
                        .disabled(!viewModel.canJoinContest || viewModel.isJoining)
                    }

                    // Leaderboard Button
                    Button {
                        navigateToLeaderboard = true
                    } label: {
                        HStack {
                            Image(systemName: "chart.bar.fill")
                            Text("View Leaderboard")
                        }
                        .font(.headline)
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.blue)
                        .cornerRadius(12)
                    }

                    // My Lineup Button
                    Button {
                        navigateToLineup = true
                    } label: {
                        HStack {
                            Image(systemName: "person.3.fill")
                            Text("Select Lineup")
                        }
                        .font(.headline)
                        .foregroundColor(viewModel.canSelectLineup ? .blue : .gray)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(viewModel.canSelectLineup ? Color.blue.opacity(0.15) : Color(.systemGray5))
                        .cornerRadius(12)
                    }
                    .disabled(!viewModel.canSelectLineup)

                    // Rules Button
                    Button {
                        showRules = true
                    } label: {
                        HStack {
                            Image(systemName: "book.fill")
                            Text("View Rules")
                        }
                        .font(.headline)
                        .foregroundColor(.blue)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.blue.opacity(0.15))
                        .cornerRadius(12)
                    }
                }
                .padding(.horizontal)

                // Contest Info
                VStack(alignment: .leading, spacing: 12) {
                    Text("Contest Info")
                        .font(.headline)

                    InfoRowView(label: "Organizer", value: viewModel.contest.organizerId)
                    InfoRowView(label: "Participants", value: "\(viewModel.contest.entryCount) of \(viewModel.contest.maxEntries ?? 0)")
                    InfoRowView(label: "Entry Fee", value: viewModel.contest.entryFeeCents == 0 ? "Free" : String(format: "$%.2f", Double(viewModel.contest.entryFeeCents) / 100.0))
                    InfoRowView(label: "Status", value: viewModel.displayStatusMessage)
                    if let lockTime = viewModel.contest.lockTime {
                        InfoRowView(label: "Contest Locks", value: viewModel.formattedLockTime(lockTime))
                    }
                    if viewModel.canSelectLineup {
                        InfoRowView(label: "Your Status", value: "Joined")
                    }
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(.systemGray6))
                .cornerRadius(12)
                .padding(.horizontal)
                .redacted(reason: viewModel.contest.contestName == "Loading…" ? .placeholder : [])

                // Share Link (contract-driven capability)
                if viewModel.actionState?.actions.canShareInvite == true, let joinToken = viewModel.contest.joinToken {
                    let joinURL = AppEnvironment.shared.baseURL.appendingPathComponent("join/\(joinToken)")
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text("Share Link")
                                .font(.headline)
                            Spacer()
                            if showCopyConfirmation {
                                Label("Copied!", systemImage: "checkmark.circle.fill")
                                    .font(.caption)
                                    .foregroundColor(.green)
                            }
                        }

                        Text("Share this link to invite others to join your contest:")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        HStack {
                            Text(joinURL.absoluteString)
                                .font(.caption)
                                .foregroundColor(.blue)
                                .lineLimit(1)
                                .truncationMode(.middle)

                            Spacer()

                            Button {
                                UIPasteboard.general.string = joinURL.absoluteString
                                showCopyConfirmation = true
                                // Reset after 2 seconds
                                DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                                    showCopyConfirmation = false
                                }
                            } label: {
                                Label("Copy", systemImage: "doc.on.doc")
                                    .font(.caption)
                            }
                            .buttonStyle(.bordered)
                        }

                        // Share button
                        Button {
                            let message = "Join my contest: \(viewModel.contest.contestName)"
                            let items: [Any] = [message, joinURL]
                            let ac = UIActivityViewController(activityItems: items, applicationActivities: nil)
                            if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                               let root = windowScene.windows.first?.rootViewController {
                                // Find the topmost presented controller
                                var presenter = root
                                while let presented = presenter.presentedViewController {
                                    presenter = presented
                                }
                                ac.popoverPresentationController?.sourceView = presenter.view
                                presenter.present(ac, animated: true)
                            }
                        } label: {
                            HStack {
                                Image(systemName: "square.and.arrow.up")
                                Text("Share Invite Link")
                            }
                            .font(.subheadline)
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(Color.orange)
                            .cornerRadius(8)
                        }
                    }
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(.systemGray6))
                    .cornerRadius(12)
                    .padding(.horizontal)
                }

                // Destructive Actions (Delete/Leave)
                if viewModel.canDeleteContest || viewModel.canUnjoinContest {
                    VStack(spacing: 12) {
                        if viewModel.canDeleteContest {
                            Button(role: .destructive) {
                                showDeleteConfirmation = true
                            } label: {
                                HStack {
                                    Image(systemName: "xmark.circle")
                                    Text("Cancel Contest")
                                }
                                .font(.headline)
                                .foregroundColor(.white)
                                .frame(maxWidth: .infinity)
                                .padding()
                                .background(Color.red)
                                .cornerRadius(12)
                            }
                            .disabled(viewModel.isDeleting || viewModel.actionState == nil)
                        }

                        if viewModel.canUnjoinContest {
                            Button(role: .destructive) {
                                showUnjoinConfirmation = true
                            } label: {
                                HStack {
                                    Image(systemName: "arrow.left.circle")
                                    Text("Leave Contest")
                                }
                                .font(.headline)
                                .foregroundColor(.white)
                                .frame(maxWidth: .infinity)
                                .padding()
                                .background(Color.red)
                                .cornerRadius(12)
                            }
                            .disabled(viewModel.isDeleting || viewModel.actionState == nil)
                        }
                    }
                    .padding(.horizontal)
                }

                Spacer()
            }
            .padding(.top)
        }
        .navigationTitle("Contest")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(isPresented: $navigateToLeaderboard) {
            ContestLeaderboardView(contestId: viewModel.contestId)
        }
        .navigationDestination(isPresented: $navigateToLineup) {
            // Navigate to lineup view (using existing LineupView or similar)
            LineupView()
        }
        .sheet(isPresented: $showRules) {
            NavigationStack {
                RulesView()
                    .navigationTitle("Rules")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .navigationBarTrailing) {
                            Button("Done") {
                                showRules = false
                            }
                        }
                    }
            }
        }
        .confirmationDialog(
            "Cancel Contest?",
            isPresented: $showDeleteConfirmation
        ) {
            Button("Cancel Contest", role: .destructive) {
                Task {
                    await viewModel.deleteContest()
                    // On success (no error message set), exit deterministically
                    if viewModel.errorMessage == nil {
                        if resetOnExit {
                            landingViewModel.resetToMyContests()
                        } else {
                            dismiss()
                        }
                    }
                }
            }
            Button("Keep Contest", role: .cancel) { }
        } message: {
            Text("Are you sure you want to cancel this contest?\n\nThis will lock the contest and mark it as cancelled. This action cannot be undone.")
        }
        .confirmationDialog(
            "Leave Contest?",
            isPresented: $showUnjoinConfirmation
        ) {
            Button("Leave Contest", role: .destructive) {
                Task {
                    await viewModel.unjoinContest()
                    // On success (no error message set), exit deterministically
                    if viewModel.errorMessage == nil {
                        if resetOnExit {
                            landingViewModel.resetToMyContests()
                        } else {
                            dismiss()
                        }
                    }
                }
            }
            Button("Stay", role: .cancel) { }
        } message: {
            Text("Are you sure you want to leave this contest?\n\nYour entry will be removed.")
        }
        .alert("Error", isPresented: .constant(viewModel.errorMessage != nil)) {
            Button("OK") {
                viewModel.clearError()
            }
        } message: {
            if let error = viewModel.errorMessage {
                Text(error)
            }
        }
        .onAppear {
            viewModel.configure(currentUserId: authService.currentUser?.id)
            if !viewModel.isFetching {
                viewModel.fetchContestDetailDetached()
            }
            print("ContestDetailView.onAppear: contestId=\(viewModel.contestId), canDelete=\(viewModel.canDeleteContest), canUnjoin=\(viewModel.canUnjoinContest)")
        }
        .refreshable {
            await viewModel.refresh()
        }
    }
}

// MARK: - Stat View

struct StatView: View {
    let value: String
    let label: String

    var body: some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.title2)
                .fontWeight(.bold)

            Text(label)
                .font(.caption)
                .foregroundColor(.secondary)
        }
    }
}

// MARK: - Info Row

struct InfoRowView: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
                .foregroundColor(.secondary)
            Spacer()
            Text(value)
                .fontWeight(.medium)
        }
    }
}

#Preview {
    NavigationStack {
        ContestDetailView(contest: MockContest.samples[0])
            .environmentObject(AuthService())
            .environmentObject(LandingViewModel())
    }
}
