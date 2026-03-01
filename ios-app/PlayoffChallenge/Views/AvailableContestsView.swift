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
    @State private var selectedContest: Contest?

    init(viewModel: AvailableContestsViewModel) {
        self.viewModel = viewModel
    }

    private func shareURL(for contest: Contest) -> URL? {
        guard let token = contest.shareURLToken else { return nil }
        let shareString = "\(AppEnvironment.shared.baseURL.absoluteString)/join/\(token)"
        return URL(string: shareString)
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
                } else if viewModel.regularContests.isEmpty {
                    Text("No contests available")
                        .foregroundColor(.secondary)
                        .onAppear {
                            print("[AvailableContestsView] No contests to display. Loading: \(viewModel.isLoading), Error: \(viewModel.errorMessage ?? "none")")
                        }
                } else {
                    ForEach(viewModel.regularContests) { contest in
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
    }
}

#Preview {
    NavigationStack {
        AvailableContestsView(viewModel: AvailableContestsViewModel())
    }
}
