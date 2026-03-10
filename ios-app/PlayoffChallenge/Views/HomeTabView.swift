//
//  HomeTabView.swift
//  PlayoffChallenge
//
//  Home tab with featured hero section, my active contests, and open contests.
//  Phase 3 implementation of the UI Refresh.
//

import SwiftUI
import Core

/// Local routing for the Home tab
enum HomeTabRoute: Hashable {
    case detail(UUID, Contest? = nil)  // Include contest for placeholder rendering
}

struct HomeTabView: View {
    @EnvironmentObject var availableVM: AvailableContestsViewModel

    @State private var navigationPath: [HomeTabRoute] = []

    var body: some View {
        NavigationStack(path: $navigationPath) {
            List {
                ForEach(
                    availableVM.contests
                        .filter { $0.status == .scheduled }
                        .sorted { lhs, rhs in
                            guard let l = lhs.lockTime, let r = rhs.lockTime else { return false }
                            return l < r
                        }
                ) { contest in
                    NavigationLink(value: HomeTabRoute.detail(contest.id, contest)) {
                        ContestRowView(
                            contestName: contest.contestName,
                            isJoined: contest.actions?.canEditEntry == true || contest.actions?.canUnjoin == true,
                            entryCountText: "\(contest.entryCount)/\(contest.maxEntries ?? 0)",
                            statusText: contest.status.displayName,
                            lockText: nil,
                            entryFeeText: contest.entryFeeCents > 0 ? String(format: "$%.0f Entry", Double(contest.entryFeeCents) / 100.0) : nil,
                            payoutText: contest.status == .complete ? "Settled" : nil,
                            shareURL: nil
                        )
                    }
                }
            }
            .listStyle(.plain)
            .navigationTitle("'67 Games")
            .navigationDestination(for: HomeTabRoute.self) { route in
                switch route {
                case .detail(let contestId, let contest):
                    ContestDetailView(contestId: contestId, placeholder: contest)
                }
            }
            .refreshable {
                await availableVM.loadContests(forceRefresh: true)
            }
        }
        .onAppear {
            print("[HomeTabView] Appeared")
            // Only fetch if contests haven't loaded yet
            if availableVM.contests.isEmpty {
                Task {
                    await availableVM.loadContests()
                }
            }
        }
    }

}

// MARK: - Previews

#Preview("Home Tab") {
    HomeTabView()
        .environmentObject(AvailableContestsViewModel())
        .background(DesignTokens.Color.Brand.background)
}
