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
                            MyContestRowView(contest: contest)
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

// MARK: - My Contest Row

struct MyContestRowView: View {
    let contest: MockContest

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "trophy.fill")
                .font(.title2)
                .foregroundColor(.blue)
                .frame(width: 44, height: 44)
                .background(Color.blue.opacity(0.15))
                .cornerRadius(10)

            VStack(alignment: .leading, spacing: 4) {
                Text(contest.name)
                    .font(.headline)

                HStack(spacing: 8) {
                    Label("\(contest.entryCount)/\(contest.maxEntries)", systemImage: "person.2")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    StatusBadge(status: contest.displayStatus)
                }
            }

            Spacer()

            Image(systemName: "chevron.right")
                .foregroundColor(.secondary)
        }
        .padding(.vertical, 8)
    }
}

// MARK: - Status Badge

struct StatusBadge: View {
    let status: String

    var body: some View {
        Text(status)
            .font(.caption)
            .fontWeight(.medium)
            .foregroundColor(statusColor)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(statusColor.opacity(0.15))
            .cornerRadius(4)
    }

    private var statusColor: Color {
        switch status {
        case "SCHEDULED": return .green
        case "LOCKED": return .orange
        case "COMPLETE": return .blue
        case "LIVE": return .red
        case "CANCELLED": return .gray
        case "ERROR": return .red
        default: return .secondary
        }
    }
}

#Preview {
    NavigationStack {
        MyContestsView(viewModel: MyContestsViewModel(userId: "preview-user-id"))
    }
}
