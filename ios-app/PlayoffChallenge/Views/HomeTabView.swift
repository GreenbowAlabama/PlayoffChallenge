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

    /// Featured contest from screen state (already derived by ViewModel from DTOs)
    private var featuredContest: Contest? {
        let featured = availableVM.screenState.featuredContest
        // Only show as featured if it's scheduled
        return featured?.status == .scheduled ? featured : nil
    }

    /// Remaining contests, excluding the featured one
    private var remainingContests: [Contest] {
        let featured = featuredContest
        return availableVM.screenState.contests
            .filter { $0.status == .scheduled && $0.id != featured?.id }
            .sorted { lhs, rhs in
                guard let l = lhs.lockTime, let r = rhs.lockTime else { return false }
                return l < r
            }
    }

    var body: some View {
        NavigationStack(path: $navigationPath) {
            List {
                // Featured hero section (if a featured contest exists)
                if let featuredContest {
                    Section {
                        NavigationLink(value: HomeTabRoute.detail(featuredContest.id, featuredContest)) {
                            FeaturedContestHeroView(
                                contest: featuredContest,
                                onTap: {}
                            )
                            .listRowInsets(EdgeInsets())
                            .listRowSeparator(.hidden)
                            .listRowBackground(Color.clear)
                        }
                    }
                }

                // Remaining contests (non-featured)
                if !remainingContests.isEmpty {
                    Section {
                        ForEach(remainingContests) { contest in
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
