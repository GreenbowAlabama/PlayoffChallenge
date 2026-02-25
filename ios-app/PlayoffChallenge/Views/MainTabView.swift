//
//  MainTabView.swift
//  PlayoffChallenge
//
//  Root view for authenticated users, providing tab-based navigation.
//  Phase 3 implementation: 4-tab structure with home-first layout.
//

import SwiftUI

struct MainTabView: View {
    @EnvironmentObject var authService: AuthService

    var body: some View {
        TabView {
            // Tab 0: Home
            // Featured hero section + my active contests + open contests
            HomeTabView()
                .tabItem {
                    Label("Home", systemImage: "house.fill")
                }

            // Tab 1: Contests Hub
            // Factory closure provided to the Hub to create the ViewModel,
            // mirroring the existing dependency boundary in LandingView.
            ContestsHubView(makeCreateViewModel: {
                CreateCustomContestViewModel(
                    service: CustomContestService(apiService: APIService.shared),
                    userId: authService.currentUser!.id
                )
            })
            .tabItem {
                Label("Contests", systemImage: "trophy.fill")
            }

            // Tab 2: Leaderboard
            NavigationStack {
                VStack {
                    Text("Leaderboard")
                        .font(.headline)
                    Spacer()
                }
                .navigationTitle("Leaderboard")
            }
            .tabItem {
                Label("Leaderboard", systemImage: "chart.bar.fill")
            }

            // Tab 3: Profile
            NavigationStack {
                ProfileView()
            }
            .tabItem {
                Label("Profile", systemImage: "person.circle.fill")
            }
        }
    }
}

#Preview {
    MainTabView()
        .environmentObject(AuthService())
        .environmentObject(AvailableContestsViewModel())
        .environmentObject(MyContestsViewModel())
}
