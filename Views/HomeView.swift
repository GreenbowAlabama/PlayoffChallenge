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
    
    var isPaid: Bool {
        return authService.currentUser?.paid ?? false
    }
    
    var body: some View {
        VStack(spacing: 0) {
            if !isPaid {
                PaymentBanner(username: authService.currentUser?.username ?? "YourName")
            }
            
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

                RulesView()
                    .tabItem {
                        Label("Rules", systemImage: "book")
                    }
                    .tag(2)

                ProfileView()
                    .tabItem {
                        Label("Profile", systemImage: "person")
                    }
                    .tag(3)
            }
        }
    }
}

struct PaymentBanner: View {
    let username: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundColor(.white)
                .font(.title3)

            VStack(alignment: .leading, spacing: 2) {
                Text("Payment Pending - Send $50")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundColor(.white)

                Text("Include: PlayoffChallenge-\(username)")
                    .font(.caption2)
                    .foregroundColor(.white.opacity(0.9))
            }

            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity)
        .background(Color.orange)
    }
}

#Preview {
    HomeView()
        .environmentObject(AuthService())
}
