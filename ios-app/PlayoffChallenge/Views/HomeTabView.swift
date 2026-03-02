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
    @EnvironmentObject var myVM: MyContestsViewModel
    @StateObject private var viewModel = HomeTabViewModel()

    @State private var navigationPath: [HomeTabRoute] = []
    @State private var isRefreshing = false

    var body: some View {
        NavigationStack(path: $navigationPath) {
            ScrollView {
                VStack(spacing: DesignTokens.Spacing.lg) {
                    // Featured Hero Section
                    if let featured = viewModel.featuredContests.first {
                        FeaturedContestHeroView(contest: featured) {
                            navigationPath.append(.detail(featured.id, featured))
                        }
                        .padding(.horizontal, DesignTokens.Spacing.lg)
                    }

                    // Open Contests Section (limited to 5)
                    if viewModel.hasOpenContests {
                        VStack(alignment: .leading, spacing: DesignTokens.Spacing.md) {
                            Text("Open Contests")
                                .font(.headline)
                                .padding(.horizontal, DesignTokens.Spacing.lg)

                            VStack(spacing: DesignTokens.Spacing.md) {
                                ForEach(viewModel.openContests.prefix(5)) { contest in
                                    ContestCardView(
                                        contest: contest,
                                        style: .standard,
                                        onTap: {
                                            navigationPath.append(.detail(contest.id, contest))
                                        }
                                    )
                                }
                            }
                            .padding(.horizontal, DesignTokens.Spacing.lg)
                        }
                    }

                    // My Active Contests Section
                    // Displays all SCHEDULED contests sorted chronologically by start_time.
                    // This section shows contests the user has created or joined, in order of when they start.
                    if !viewModel.scheduledContests.isEmpty {
                        VStack(alignment: .leading, spacing: DesignTokens.Spacing.md) {
                            Text("My Active Contests")
                                .font(.headline)
                                .padding(.horizontal, DesignTokens.Spacing.lg)

                            VStack(spacing: DesignTokens.Spacing.md) {
                                ForEach(viewModel.scheduledContests) { contest in
                                    ContestCardView(
                                        contest: contest,
                                        style: .standard,
                                        onTap: {
                                            navigationPath.append(.detail(contest.id, contest))
                                        }
                                    )
                                }
                            }
                            .padding(.horizontal, DesignTokens.Spacing.lg)
                        }
                    }

                    // Empty State
                    if !viewModel.hasAnyContent && !viewModel.isLoading {
                        VStack(spacing: DesignTokens.Spacing.md) {
                            Image(systemName: "calendar.badge.plus")
                                .font(.system(size: 44))
                                .foregroundColor(DesignTokens.Color.Brand.primary)

                            Text("No Contests Available")
                                .font(.headline)
                                .foregroundColor(DesignTokens.Color.Text.primary)

                            Text("New contests will appear here as they become available.")
                                .font(.subheadline)
                                .foregroundColor(DesignTokens.Color.Text.secondary)
                                .multilineTextAlignment(.center)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .padding(DesignTokens.Spacing.xl)
                    }

                    Spacer(minLength: DesignTokens.Spacing.section)
                }
                .padding(.vertical, DesignTokens.Spacing.lg)
            }
            .navigationTitle("67 Games")
            .navigationDestination(for: HomeTabRoute.self) { route in
                switch route {
                case .detail(let contestId, let contest):
                    ContestDetailView(contestId: contestId, placeholder: contest)
                }
            }
            .refreshable {
                // Pull-to-refresh: reload both contest sources
                isRefreshing = true
                await availableVM.refresh()
                await myVM.loadMyContests()
                isRefreshing = false
            }
        }
        .onChange(of: availableVM.contests) { _, available in
            viewModel.updateSections(from: available, and: myVM.myContests)
        }
        .onChange(of: myVM.myContests) { _, mine in
            viewModel.updateSections(from: availableVM.contests, and: mine)
        }
        .onChange(of: availableVM.isLoading) { _, loading in
            viewModel.updateLoadingState(
                availableIsLoading: loading,
                myIsLoading: myVM.isLoading
            )
        }
        .onChange(of: myVM.isLoading) { _, loading in
            viewModel.updateLoadingState(
                availableIsLoading: availableVM.isLoading,
                myIsLoading: loading
            )
        }
    }
}

// MARK: - Previews

#Preview("Home Tab with Featured and Active") {
    let available = [
        MockContest.fixture(
            name: "NFL Playoffs 2026",
            status: .scheduled,
            lockTime: Calendar.current.date(byAdding: .hour, value: 2, to: Date()),
            isPlatformOwned: true
        ),
        MockContest.fixture(
            name: "Regular Season Challenge",
            status: .scheduled,
            isPlatformOwned: false
        ),
    ]

    let mine = [
        MockContest.fixture(
            name: "My Weekly Pick",
            status: .live,
            isPlatformOwned: false
        ),
    ]

    let homeVM = HomeTabViewModel()
    homeVM.updateSections(from: available, and: mine)
    homeVM.updateLoadingState(availableIsLoading: false, myIsLoading: false)

    return HomeTabView()
        .environmentObject(AvailableContestsViewModel())
        .environmentObject(MyContestsViewModel())
        .environmentObject(homeVM)
        .background(DesignTokens.Color.Brand.background)
}

#Preview("Home Tab - Empty") {
    let homeVM = HomeTabViewModel()
    homeVM.updateLoadingState(availableIsLoading: false, myIsLoading: false)

    return HomeTabView()
        .environmentObject(AvailableContestsViewModel())
        .environmentObject(MyContestsViewModel())
        .environmentObject(homeVM)
        .background(DesignTokens.Color.Brand.background)
}
