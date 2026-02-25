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
    @EnvironmentObject var availableContestsVM: AvailableContestsViewModel
    @EnvironmentObject var myContestsVM: MyContestsViewModel
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
            VStack(spacing: DesignTokens.Spacing.xxl) {
                // MARK: - Header Section
                VStack(spacing: DesignTokens.Spacing.lg) {
                    // Top bar: Status badge + Entry fee
                    HStack(spacing: DesignTokens.Spacing.lg) {
                        StatusBadgeView(status: viewModel.contest.status)

                        Spacer()

                        Text(viewModel.contest.entryFeeCents == 0 ? "Free" : String(format: "$%.2f", Double(viewModel.contest.entryFeeCents) / 100.0))
                            .font(.headline)
                            .fontWeight(.bold)
                    }

                    // Contest name
                    Text(viewModel.contest.contestName)
                        .font(.title)
                        .fontWeight(.bold)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    // Capacity bar
                    CapacityBarView(entryCount: viewModel.contest.entryCount, maxEntries: viewModel.contest.maxEntries)

                    // Lock urgency
                    if let lockDisplay = formatLockTimeForDisplay(lockTime: viewModel.contest.lockTime, status: viewModel.contest.status) {
                        Text(lockDisplay.text)
                            .font(.caption)
                            .foregroundColor(.orange)
                    }
                }
                .padding()
                .frame(maxWidth: .infinity)
                .background(DesignTokens.Color.Surface.card)
                .cornerRadius(DesignTokens.Radius.xl)
                .padding(.horizontal)
                .redacted(reason: viewModel.contest.contestName == "Loading…" ? .placeholder : [])

                // MARK: - Primary Action: Join Button
                if viewModel.canJoinContest {
                    Button {
                        Task {
                            await viewModel.joinContest()
                            if viewModel.errorMessage == nil {
                                await availableContestsVM.loadContests()
                                await myContestsVM.loadMyContests()
                            }
                        }
                    } label: {
                        HStack {
                            if viewModel.isJoining {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: DesignTokens.Color.Text.inverse))
                            } else {
                                Image(systemName: "person.badge.plus")
                                Text(viewModel.joinButtonTitle)
                            }
                        }
                        .font(.headline)
                        .foregroundColor(DesignTokens.Color.Text.inverse)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(DesignTokens.Color.Action.primary)
                        .cornerRadius(DesignTokens.Radius.lg)
                    }
                    .disabled(!viewModel.canJoinContest || viewModel.isJoining)
                    .padding(.horizontal)
                }

                // MARK: - Quick Actions: Horizontal Buttons
                VStack(spacing: DesignTokens.Spacing.md) {
                    Text("Quick Actions")
                        .font(.headline)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    HStack(spacing: DesignTokens.Spacing.lg) {
                        // Leaderboard
                        Button {
                            navigateToLeaderboard = true
                        } label: {
                            VStack(spacing: DesignTokens.Spacing.xs) {
                                Image(systemName: "chart.bar.fill")
                                    .font(.headline)
                                Text("Leaderboard")
                                    .font(.caption)
                                    .lineLimit(1)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(DesignTokens.Spacing.md)
                            .background(DesignTokens.Color.Surface.card)
                            .foregroundColor(DesignTokens.Color.Action.secondary)
                            .cornerRadius(DesignTokens.Radius.lg)
                        }

                        // Lineup
                        Button {
                            navigateToLineup = true
                        } label: {
                            VStack(spacing: DesignTokens.Spacing.xs) {
                                Image(systemName: "person.3.fill")
                                    .font(.headline)
                                Text("Lineup")
                                    .font(.caption)
                                    .lineLimit(1)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(DesignTokens.Spacing.md)
                            .background(viewModel.canSelectLineup ? DesignTokens.Color.Surface.card : DesignTokens.Color.Surface.cardDisabled)
                            .foregroundColor(viewModel.canSelectLineup ? DesignTokens.Color.Action.secondary : DesignTokens.Color.Action.disabled)
                            .cornerRadius(DesignTokens.Radius.lg)
                        }
                        .disabled(!viewModel.canSelectLineup)

                        // Rules
                        Button {
                            showRules = true
                        } label: {
                            VStack(spacing: DesignTokens.Spacing.xs) {
                                Image(systemName: "book.fill")
                                    .font(.headline)
                                Text("Rules")
                                    .font(.caption)
                                    .lineLimit(1)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(DesignTokens.Spacing.md)
                            .background(DesignTokens.Color.Surface.card)
                            .foregroundColor(DesignTokens.Color.Action.secondary)
                            .cornerRadius(DesignTokens.Radius.lg)
                        }
                    }
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(DesignTokens.Color.Surface.elevated)
                .cornerRadius(DesignTokens.Radius.lg)
                .padding(.horizontal)

                // MARK: - Contest Details Section
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.md) {
                    Text("Contest Details")
                        .font(.headline)

                    InfoRowView(label: "Status", value: viewModel.displayStatusMessage)
                    if let lockTime = viewModel.contest.lockTime {
                        InfoRowView(label: "Lock Time", value: viewModel.formattedLockTime(lockTime))
                    }
                    InfoRowView(label: "Created", value: formattedCreatedDate(viewModel.contest.createdAt))
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(DesignTokens.Color.Surface.card)
                .cornerRadius(DesignTokens.Radius.lg)
                .padding(.horizontal)
                .redacted(reason: viewModel.contest.contestName == "Loading…" ? .placeholder : [])

                // MARK: - Share Link Section (conditional)
                if viewModel.actionState?.actions.canShareInvite == true, let joinToken = viewModel.contest.joinToken {
                    let joinURL = AppEnvironment.shared.baseURL.appendingPathComponent("join/\(joinToken)")
                    VStack(alignment: .leading, spacing: DesignTokens.Spacing.md) {
                        HStack {
                            Text("Share Invite")
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
                            .foregroundColor(DesignTokens.Color.Text.inverse)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, DesignTokens.Spacing.md)
                            .background(DesignTokens.Color.Brand.primary)
                            .cornerRadius(DesignTokens.Radius.md)
                        }
                    }
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(DesignTokens.Color.Surface.card)
                    .cornerRadius(DesignTokens.Radius.lg)
                    .padding(.horizontal)
                }

                // MARK: - Destructive Actions (Delete/Leave)
                if viewModel.canDeleteContest || viewModel.canUnjoinContest {
                    VStack(spacing: DesignTokens.Spacing.md) {
                        if viewModel.canDeleteContest {
                            Button(role: .destructive) {
                                showDeleteConfirmation = true
                            } label: {
                                HStack {
                                    Image(systemName: "xmark.circle")
                                    Text("Cancel Contest")
                                }
                                .font(.headline)
                                .foregroundColor(DesignTokens.Color.Text.inverse)
                                .frame(maxWidth: .infinity)
                                .padding()
                                .background(DesignTokens.Color.Action.destructive)
                                .cornerRadius(DesignTokens.Radius.lg)
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
                                .foregroundColor(DesignTokens.Color.Text.inverse)
                                .frame(maxWidth: .infinity)
                                .padding()
                                .background(DesignTokens.Color.Action.destructive)
                                .cornerRadius(DesignTokens.Radius.lg)
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
                    if viewModel.errorMessage == nil {
                        await availableContestsVM.loadContests()
                        await myContestsVM.loadMyContests()
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
                    if viewModel.errorMessage == nil {
                        await availableContestsVM.loadContests()
                        await myContestsVM.loadMyContests()
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

// MARK: - Formatting Helpers

/// Format created date for display
func formattedCreatedDate(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.dateStyle = .medium
    return formatter.string(from: date)
}

#Preview {
    NavigationStack {
        ContestDetailView(contest: MockContest.samples[0])
            .environmentObject(AuthService())
            .environmentObject(LandingViewModel())
            .environmentObject(AvailableContestsViewModel())
            .environmentObject(MyContestsViewModel())
    }
}
