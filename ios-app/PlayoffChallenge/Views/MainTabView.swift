//
//  MainTabView.swift
//  PlayoffChallenge
//
//  Root view for authenticated users, providing tab-based navigation.
//

import SwiftUI

struct MainTabView: View {
    @EnvironmentObject var authService: AuthService
    
    var body: some View {
        TabView {
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
            
            // Tab 2: Profile
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
