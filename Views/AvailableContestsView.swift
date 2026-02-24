//
//  AvailableContestsView.swift
//  PlayoffChallenge
//
//  List of available contests that users can join.
//

import SwiftUI

struct AvailableContestsView: View {
    @EnvironmentObject var authService: AuthService
    @ObservedObject var viewModel: AvailableContestsViewModel
    @State private var selectedContest: MockContest?

    init(viewModel: AvailableContestsViewModel) {
        self.viewModel = viewModel
    }

    var body: some View {
        List {
            Section {
                if let errorMessage = viewModel.errorMessage {
                    ScrollView {
                        Text(errorMessage)
                            .font(.caption)
                            .foregroundColor(.red)
                            .padding()
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                } else if viewModel.contests.isEmpty {
                    Text("No contests available")
                        .foregroundColor(.secondary)
                        .onAppear {
                            print("[AvailableContestsView] No contests to display. Loading: \(viewModel.isLoading), Error: \(viewModel.errorMessage ?? "none")")
                        }
                } else {
                    ForEach(viewModel.contests) { contest in
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
                    }
                }
            } header: {
                Text("Open Contests")
            } footer: {
                Text("Tap a contest to view details and join")
                    .font(.caption)
            }
        }
        .navigationTitle("Available Contests")
        .navigationBarTitleDisplayMode(.large)
        .navigationDestination(item: $selectedContest) { contest in
            ContestDetailView(contest: contest)
        }
        .refreshable {
            await viewModel.refresh()
        }
        .task(id: authService.isAuthenticated) {
            if authService.isAuthenticated && viewModel.contests.isEmpty && !viewModel.isLoading {
                await viewModel.loadContests()
            }
        }
    }
}

#Preview {
    NavigationStack {
        AvailableContestsView(viewModel: AvailableContestsViewModel())
    }
}
