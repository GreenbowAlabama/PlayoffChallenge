//
//  LandingView.swift
//  PlayoffChallenge
//
//  Landing page after login with main navigation options.
//

import SwiftUI

struct LandingView: View {
    @EnvironmentObject var authService: AuthService
    @EnvironmentObject var availableVM: AvailableContestsViewModel
    @EnvironmentObject var myVM: MyContestsViewModel
    @ObservedObject var viewModel: LandingViewModel

    var body: some View {
        NavigationStack(path: $viewModel.navigationPath) {
            VStack(spacing: 24) {
                // Next Lock Banner (if applicable)
                if let nextContest = viewModel.nextRelevantScheduledContest(
                    available: availableVM.regularContests,
                    mine: myVM.myContests
                ),
                   let display = formatLockTimeForDisplay(
                       lockTime: nextContest.lockTime,
                       status: nextContest.status
                   ) {
                    NextLockBanner(
                        contestName: nextContest.contestName,
                        lockTimeText: display.text,
                        urgency: display.urgency,
                        isJoinable: !(nextContest.actions?.canEditEntry == true || nextContest.actions?.canUnjoin == true)
                    )
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
                }

                // Featured Section
                if availableVM.showFeaturedSection {
                    if availableVM.featuredContests.count == 1 {
                        FeaturedContestHeroView(
                            contest: availableVM.featuredContests[0],
                            onTap: {
                                viewModel.navigateToContestDetail(contestId: availableVM.featuredContests[0].id)
                            }
                        )
                        .padding(.horizontal, 16)
                    } else {
                        TabView {
                            ForEach(availableVM.featuredContests) { contest in
                                FeaturedContestHeroView(
                                    contest: contest,
                                    onTap: {
                                        viewModel.navigateToContestDetail(contestId: contest.id)
                                    }
                                )
                                .padding(.horizontal, 16)
                            }
                        }
                        .tabViewStyle(.page)
                        .frame(height: 280)
                    }
                }

                Spacer()

                // App Title
                VStack(spacing: 8) {
                    Text("Playoff Challenge")
                        .font(.largeTitle)
                        .fontWeight(.bold)

                    Text("Fantasy Football Playoffs")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }

                Spacer()

                // Navigation Buttons
                VStack(spacing: 16) {
                    NavigationButton(
                        title: "Available Contests",
                        systemImage: "trophy.fill",
                        color: .blue
                    ) {
                        viewModel.navigateToAvailableContests()
                    }

                    NavigationButton(
                        title: "Create Contest",
                        systemImage: "plus.circle.fill",
                        color: .green
                    ) {
                        viewModel.navigateToCreateContest()
                    }

                    NavigationButton(
                        title: "My Contests",
                        systemImage: "trophy.fill",
                        color: .blue
                    ) {
                        viewModel.navigateToMyContests()
                    }

                    NavigationButton(
                        title: "Profile",
                        systemImage: "person.circle.fill",
                        color: .purple
                    ) {
                        viewModel.navigateToProfile()
                    }
                }
                .padding(.horizontal, 24)

                Spacer()
            }
            .navigationTitle("Home")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: LandingDestination.self) { destination in
                destinationView(for: destination)
            }
            .onAppear { print("LandingView appear") }
        }
    }

    @ViewBuilder
    private func destinationView(for destination: LandingDestination) -> some View {
        let _ = print("RESOLVE: \(destination)")
        switch destination {
        case .availableContests:
            AvailableContestsView(viewModel: availableVM)
        case .createContest:
            CreateCustomContestView(
                viewModel: CreateCustomContestViewModel(
                    service: CustomContestService(
                        apiService: APIService.shared
                    ),
                    userId: authService.currentUser!.id
                )
            )
        case .myContests:
            MyContestsView(viewModel: myVM)
        case .profile:
            ProfileView()
        case .contestDetail(let contestId):
            ContestDetailView(contestId: contestId)
        case .leaderboard(let contestId):
            ContestLeaderboardView(contestId: contestId)
        }
    }
}

// MARK: - Navigation Button

struct NavigationButton: View {
    let title: String
    let systemImage: String
    let color: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 16) {
                Image(systemName: systemImage)
                    .font(.title2)
                    .foregroundColor(.white)
                    .frame(width: DesignTokens.Size.iconLarge, height: DesignTokens.Size.iconLarge)
                    .background(color)
                    .cornerRadius(DesignTokens.Radius.lg)

                Text(title)
                    .font(.headline)
                    .foregroundColor(.primary)

                Spacer()

                Image(systemName: "chevron.right")
                    .foregroundColor(.secondary)
            }
            .padding()
            .background(DesignTokens.Color.Surface.card)
            .cornerRadius(DesignTokens.Radius.xl)
        }
        .buttonStyle(PlainButtonStyle())
    }
}

#Preview {
    LandingView(viewModel: LandingViewModel())
        .environmentObject(AuthService())
}
