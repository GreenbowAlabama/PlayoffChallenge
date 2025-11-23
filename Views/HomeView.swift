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
    @State private var selectedTab = 2  // Default to Leaderboard tab
    
    var isPaid: Bool {
        return authService.currentUser?.paid ?? false
    }
    
    var body: some View {
        VStack(spacing: 0) {
            if !isPaid {
                PaymentBanner(username: authService.currentUser?.username ?? "YourName")
            }
            
            TabView(selection: $selectedTab) {
                PlayerSelectionView()
                    .tabItem {
                        Label("Pick Players", systemImage: "person.3.fill")
                    }
                    .tag(0)
                
                MyPicksView()
                    .tabItem {
                        Label("My Picks", systemImage: "list.bullet")
                    }
                    .tag(1)
                
                LeaderboardView()
                    .tabItem {
                        Label("Leaderboard", systemImage: "chart.bar")
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

struct PaymentBanner: View {
    let username: String
    
    var body: some View {
        VStack(spacing: 8) {
            Text("Payment Pending")
                .font(.headline)
                .foregroundColor(.white)
            
            Text("Send $50 via Venmo/Cash App/Zelle")
                .font(.caption)
                .foregroundColor(.white.opacity(0.9))
            
            Text("Include: PlayoffChallenge-\(username)")
                .font(.caption2)
                .foregroundColor(.white.opacity(0.8))
        }
        .padding()
        .frame(maxWidth: .infinity)
        .background(Color.orange)
    }
}

#Preview {
    HomeView()
        .environmentObject(AuthService())
}
