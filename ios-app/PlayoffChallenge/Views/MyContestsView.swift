//
//  MyContestsView.swift
//  PlayoffChallenge
//
//  View for displaying contests the user has joined or created.
//

import SwiftUI

struct MyContestsView: View {
    @EnvironmentObject var authService: AuthService
    @ObservedObject var viewModel: MyContestsViewModel
    @State private var selectedContest: Contest?
    @State private var isRefreshing = false
    @State private var pendingDeleteId: UUID?
    @State private var pendingUnjoinId: UUID?
    @State private var showPastContests = false
    @State private var hasLoadedAfterAuth = false

    private func shareURL(for contest: Contest) -> URL? {
        guard let token = contest.shareURLToken else { return nil }
        let shareString = "\(AppEnvironment.shared.baseURL.absoluteString)/join/\(token)"
        return URL(string: shareString)
    }

    var body: some View {
        Group {
            if viewModel.isLoading && !isRefreshing {
                ProgressView("Loading contests...")
            } else if viewModel.myContests.isEmpty {
                EmptyContestsView()
            } else {
                List {
                    // MARK: - Active Contests Section
                    if !viewModel.activeContests.isEmpty {
                        Section {
                            ForEach(viewModel.activeContests) { contest in
                            // Payout display: only show "Settled" for complete contests.
                            // Backend-computed payouts available in payout_table at settlement.
                            // Client does not compute pot/payout (no rake/rounding/tie logic).
                            let payoutText: String? = contest.status == .complete ? "Settled" : nil

                            ContestRowView(
                                contestName: contest.contestName,
                                isJoined: contest.actions?.canEditEntry == true || contest.actions?.canUnjoin == true,
                                entryCountText: "\(contest.entryCount)/\(contest.maxEntries ?? 0)",
                                statusText: contest.status.displayName,
                                lockText: formatLockTimeForDisplay(lockTime: contest.lockTime, status: contest.status)?.text,
                                entryFeeText: contest.entryFeeCents > 0 ? String(format: "$%.0f Entry", Double(contest.entryFeeCents) / 100.0) : nil,
                                payoutText: payoutText,
                                shareURL: shareURL(for: contest)
                            )
                            .contentShape(Rectangle())
                            .onTapGesture {
                                selectedContest = contest
                            }
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                if contest.actions?.canDelete == true {
                                    Button(role: .destructive) {
                                        pendingDeleteId = contest.id
                                    } label: {
                                        Label("Delete", systemImage: "trash")
                                    }
                                    .disabled(viewModel.deletingIds.contains(contest.id))
                                }

                                if contest.actions?.canUnjoin == true {
                                    Button(role: .destructive) {
                                        pendingUnjoinId = contest.id
                                    } label: {
                                        Label("Leave", systemImage: "arrow.left.circle")
                                    }
                                    .disabled(viewModel.deletingIds.contains(contest.id))
                                }
                            }
                        }
                    } header: {
                        Text("Active")
                    }
                    }

                    // MARK: - Past Contests Section (Collapsible)
                    if !viewModel.pastContests.isEmpty {
                        Section {
                            if showPastContests {
                                ForEach(viewModel.pastContests) { contest in
                            // Payout display: only show "Settled" for complete contests.
                            // Backend-computed payouts available in payout_table at settlement.
                            // Client does not compute pot/payout (no rake/rounding/tie logic).
                            let payoutText: String? = contest.status == .complete ? "Settled" : nil

                            ContestRowView(
                                contestName: contest.contestName,
                                isJoined: contest.actions?.canEditEntry == true || contest.actions?.canUnjoin == true,
                                entryCountText: "\(contest.entryCount)/\(contest.maxEntries ?? 0)",
                                statusText: contest.status.displayName,
                                lockText: formatLockTimeForDisplay(lockTime: contest.lockTime, status: contest.status)?.text,
                                entryFeeText: contest.entryFeeCents > 0 ? String(format: "$%.0f Entry", Double(contest.entryFeeCents) / 100.0) : nil,
                                payoutText: payoutText,
                                shareURL: shareURL(for: contest)
                            )
                            .contentShape(Rectangle())
                            .onTapGesture {
                                selectedContest = contest
                            }
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                if contest.actions?.canDelete == true {
                                    Button(role: .destructive) {
                                        pendingDeleteId = contest.id
                                    } label: {
                                        Label("Delete", systemImage: "trash")
                                    }
                                    .disabled(viewModel.deletingIds.contains(contest.id))
                                }

                                if contest.actions?.canUnjoin == true {
                                    Button(role: .destructive) {
                                        pendingUnjoinId = contest.id
                                    } label: {
                                        Label("Leave", systemImage: "arrow.left.circle")
                                    }
                                    .disabled(viewModel.deletingIds.contains(contest.id))
                                }
                            }
                                }
                            }
                        } header: {
                            HStack {
                                Text("Past Contests")
                                Spacer()
                                Image(systemName: showPastContests ? "chevron.up" : "chevron.down")
                                    .font(.caption)
                            }
                        }
                        .onTapGesture {
                            withAnimation {
                                showPastContests.toggle()
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("My Contests")
        .navigationBarTitleDisplayMode(.large)
        .navigationDestination(item: $selectedContest) { contest in
            ContestDetailView(contest: contest)
        }
        .confirmationDialog(
            "Are you sure?",
            isPresented: Binding(
                get: { pendingDeleteId != nil || pendingUnjoinId != nil },
                set: { if !$0 { pendingDeleteId = nil; pendingUnjoinId = nil } }
            )
        ) {
            if let id = pendingDeleteId {
                Button("Cancel Contest", role: .destructive) {
                    Task { await viewModel.deleteContest(id) }
                    pendingDeleteId = nil
                }
            }

            if let id = pendingUnjoinId {
                Button("Leave Contest", role: .destructive) {
                    Task { await viewModel.unjoinContest(id) }
                    pendingUnjoinId = nil
                }
            }

            Button("Cancel", role: .cancel) {
                pendingDeleteId = nil
                pendingUnjoinId = nil
            }
        }
        .onChange(of: authService.isAuthenticated) { isAuthenticated in
            // Load contests only after authentication completes.
            // This gate ensures we have a valid userId before making API calls.
            guard isAuthenticated else { return }

            if !hasLoadedAfterAuth {
                hasLoadedAfterAuth = true
                Task {
                    await viewModel.loadMyContests()
                }
            }
        }
        .refreshable {
            isRefreshing = true
            defer { isRefreshing = false }
            await viewModel.loadMyContests()
        }
    }
}

// MARK: - Empty State

struct EmptyContestsView: View {
    var body: some View {
        VStack(spacing: DesignTokens.Spacing.xl) {
            Image(systemName: "tray")
                .font(.system(size: 60))
                .foregroundColor(.gray)

            Text("No Contests")
                .font(.title2)
                .fontWeight(.semibold)

            Text("Join or create a contest to get started")
                .font(.body)
                .foregroundColor(.secondary)
        }
    }
}


#Preview {
    NavigationStack {
        MyContestsView(viewModel: MyContestsViewModel())
    }
}
