//
//  ContestManagementView.swift
//  PlayoffChallenge
//
//  View for managing user's created contests.
//

import SwiftUI

struct ContestManagementView: View {
    @ObservedObject var viewModel: ContestManagementViewModel
    @State private var selectedContest: MockContest?

    var body: some View {
        Group {
            if viewModel.isLoading {
                ProgressView("Loading contests...")
            } else if viewModel.myContests.isEmpty {
                EmptyContestsView()
            } else {
                List {
                    Section {
                        ForEach(viewModel.myContests) { contest in
                            ManagedContestRowView(contest: contest)
                                .contentShape(Rectangle())
                                .onTapGesture {
                                    selectedContest = contest
                                }
                        }
                    } header: {
                        Text("My Contests")
                    }
                }
            }
        }
        .navigationTitle("Contest Management")
        .navigationBarTitleDisplayMode(.large)
        .navigationDestination(item: $selectedContest) { contest in
            ContestDetailView(contest: contest)
        }
        .task {
            await viewModel.loadOrganizerContests()
        }
        .refreshable {
            await viewModel.loadOrganizerContests()
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

            Text("No Contests Created")
                .font(.title2)
                .fontWeight(.semibold)

            Text("Create a contest to get started")
                .font(.body)
                .foregroundColor(.secondary)
        }
    }
}

// MARK: - Managed Contest Row

struct ManagedContestRowView: View {
    let contest: MockContest

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "gearshape.fill")
                .font(.title2)
                .foregroundColor(.orange)
                .frame(width: 44, height: 44)
                .background(Color.orange.opacity(0.15))
                .cornerRadius(10)

            VStack(alignment: .leading, spacing: 4) {
                Text(contest.name)
                    .font(.headline)

                HStack(spacing: 8) {
                    Label("\(contest.entryCount)/\(contest.maxEntries)", systemImage: "person.2")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    StatusBadge(status: contest.status)
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
        ContestManagementView(viewModel: ContestManagementViewModel(userId: "preview-user-id"))
    }
}
