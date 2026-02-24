//
//  HomeView.swift
//  PlayoffChallenge
//
//  V2 - Matching Actual Database Schema
//  Updated: Payment banner shows actual username
//

import SwiftUI

struct HomeView: View {
    @EnvironmentObject var authService: AuthService
    @State private var selectedTab = 1  // Default to Leaderboard tab

    var body: some View {
        VStack(spacing: 0) {
            TabView(selection: $selectedTab) {
                LineupView()
                    .tabItem {
                        Label("My Lineup", systemImage: "person.3.fill")
                    }
                    .tag(0)

                LeaderboardView()
                    .tabItem {
                        Label("Leaderboard", systemImage: "chart.bar")
                    }
                    .tag(1)

                ContestsLandingView(
                    viewModel: ContestsLandingViewModel(
                        pendingJoinChecker: PendingJoinManager()
                    )
                )
                    .tabItem {
                        Label("Contests", systemImage: "trophy")
                    }
                    .tag(2)

                RulesView()
                    .tabItem {
                        Label("Rules", systemImage: "book")
                    }
                    .tag(3)

                ProfileView()
                    .tabItem {
                        Label("Profile", systemImage: "person")
                    }
                    .tag(4)
            }
        }
    }
}

#Preview {
    HomeView()
        .environmentObject(AuthService())
}
