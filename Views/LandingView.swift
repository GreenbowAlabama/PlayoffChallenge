//
//  LandingView.swift
//  PlayoffChallenge
//
//  Landing page after login with main navigation options.
//

import SwiftUI

struct LandingView: View {
    @EnvironmentObject var authService: AuthService
    @StateObject private var viewModel = LandingViewModel()

    var body: some View {
        NavigationStack(path: $viewModel.navigationPath) {
            VStack(spacing: 24) {
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
        }
        .environmentObject(viewModel)
    }

    @ViewBuilder
    private func destinationView(for destination: LandingDestination) -> some View {
        switch destination {
        case .availableContests:
            AvailableContestsView()
        case .createContest:
            CreateContestFlowView()
        case .myContests:
            MyContestsView(
                viewModel: MyContestsViewModel(
                    apiClient: APIService.shared,
                    userId: authService.currentUser?.id.uuidString ?? "00000000-0000-0000-0000-000000000000"
                )
            )
        case .profile:
            ProfileView()
        case .contestDetail(let contestId):
            ContestDetailView(contestId: contestId)
        case .leaderboard(let contest):
            ContestLeaderboardView(contestId: contest.id)
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
                    .frame(width: 44, height: 44)
                    .background(color)
                    .cornerRadius(12)

                Text(title)
                    .font(.headline)
                    .foregroundColor(.primary)

                Spacer()

                Image(systemName: "chevron.right")
                    .foregroundColor(.secondary)
            }
            .padding()
            .background(Color(.systemGray6))
            .cornerRadius(16)
        }
        .buttonStyle(PlainButtonStyle())
    }
}

#Preview {
    LandingView()
        .environmentObject(AuthService())
}
