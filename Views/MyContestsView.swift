//
//  MyContestsView.swift
//  PlayoffChallenge
//
//  View for displaying contests the user has joined or created.
//

import SwiftUI

struct MyContestsView: View {
    @ObservedObject var viewModel: MyContestsViewModel
    @State private var selectedContest: MockContest?
    @State private var isRefreshing = false
    @State private var pendingDeleteId: UUID?
    @State private var pendingUnjoinId: UUID?

    var body: some View {
        Group {
            if viewModel.isLoading && !isRefreshing {
                ProgressView("Loading contests...")
            } else if viewModel.myContests.isEmpty {
                EmptyContestsView()
            } else {
                List {
                    Section {
                        ForEach(viewModel.sortedContests) { contest in
                            ContestRowView(
                                contestName: contest.name,
                                isJoined: contest.isJoined,
                                entryCountText: "\(contest.entryCount)/\(contest.maxEntries)",
                                statusText: contest.displayStatus,
                                lockText: formatLockTimeForDisplay(lockTime: contest.lockTime, status: contest.status)?.text,
                                entryFeeText: contest.entryFee > 0 ? String(format: "$%.0f Entry", contest.entryFee) : nil
                            )
                            .contentShape(Rectangle())
                            .onTapGesture {
                                selectedContest = contest
                            }
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                if contest.actions?.can_delete == true {
                                    Button(role: .destructive) {
                                        pendingDeleteId = contest.id
                                    } label: {
                                        Label("Delete", systemImage: "trash")
                                    }
                                    .disabled(viewModel.deletingIds.contains(contest.id))
                                }

                                if contest.actions?.can_unjoin == true {
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
                        Text("My Contests")
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
        .task {
            await viewModel.loadMyContests()
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
        VStack(spacing: 20) {
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
        MyContestsView(viewModel: MyContestsViewModel(userId: "preview-user-id"))
    }
}
