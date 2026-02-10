//
//  ContestLeaderboardView.swift
//  PlayoffChallenge
//
//  Leaderboard view for a specific contest.
//

import SwiftUI

struct ContestLeaderboardView: View {
    @StateObject private var viewModel: ContestLeaderboardViewModel
    @EnvironmentObject var authService: AuthService

    private var currentUsername: String {
        authService.currentUser?.username ?? ""
    }

    init(contest: MockContest) {
        _viewModel = StateObject(wrappedValue: ContestLeaderboardViewModel(contest: contest))
    }

    var body: some View {
        Group {
            if viewModel.isLoading {
                ProgressView("Loading leaderboard...")
            } else if viewModel.entries.isEmpty {
                VStack(spacing: 16) {
                    Image(systemName: "chart.bar")
                        .font(.system(size: 60))
                        .foregroundColor(.gray)

                    Text("No entries yet")
                        .font(.title2)
                        .foregroundColor(.secondary)
                }
            } else {
                ScrollView {
                    // Show user's rank if on leaderboard
                    if let rank = viewModel.currentUserRank {
                        HStack {
                            Image(systemName: "person.circle.fill")
                                .foregroundColor(.blue)
                            Text("Your rank: #\(rank)")
                                .font(.subheadline)
                                .fontWeight(.medium)
                        }
                        .padding()
                        .frame(maxWidth: .infinity)
                        .background(Color.blue.opacity(0.1))
                        .cornerRadius(8)
                        .padding(.horizontal)
                    }

                    LazyVStack(spacing: 0) {
                        ForEach(Array(viewModel.entries.enumerated()), id: \.element.id) { index, entry in
                            LeaderboardRowView(
                                rank: index + 1,
                                entry: entry,
                                isCurrentUser: entry.username == currentUsername
                            )
                        }
                    }
                    .padding(.horizontal)
                }
            }
        }
        .navigationTitle("Leaderboard")
        .navigationBarTitleDisplayMode(.large)
        .task {
            viewModel.configure(currentUsername: currentUsername)
            await viewModel.loadLeaderboard()
        }
        .refreshable {
            await viewModel.refresh()
        }
    }
}

// MARK: - Mock Leaderboard Entry

struct MockLeaderboardEntry: Identifiable {
    let id: UUID
    let username: String
    let teamName: String?
    let totalPoints: Double

    static let samples: [MockLeaderboardEntry] = [
        MockLeaderboardEntry(id: UUID(), username: "Champion2026", teamName: "Dynasty", totalPoints: 245.5),
        MockLeaderboardEntry(id: UUID(), username: "GridironKing", teamName: "Ironmen", totalPoints: 232.8),
        MockLeaderboardEntry(id: UUID(), username: "PlayoffPro", teamName: nil, totalPoints: 218.3),
        MockLeaderboardEntry(id: UUID(), username: "TouchdownTom", teamName: "Legends", totalPoints: 205.1),
        MockLeaderboardEntry(id: UUID(), username: "FantasyGuru", teamName: nil, totalPoints: 198.7),
        MockLeaderboardEntry(id: UUID(), username: "EndZoneKing", teamName: "Thunder", totalPoints: 187.2),
        MockLeaderboardEntry(id: UUID(), username: "BlitzMaster", teamName: nil, totalPoints: 175.9),
        MockLeaderboardEntry(id: UUID(), username: "RedZoneRuler", teamName: "Hawks", totalPoints: 162.4)
    ]
}

// MARK: - Leaderboard Row

struct LeaderboardRowView: View {
    let rank: Int
    let entry: MockLeaderboardEntry
    var isCurrentUser: Bool = false

    var body: some View {
        HStack(spacing: 16) {
            // Rank
            Text("\(rank)")
                .font(.title2)
                .fontWeight(.bold)
                .foregroundColor(rankColor)
                .frame(width: 40)

            // User Info
            VStack(alignment: .leading, spacing: 4) {
                Text(entry.username)
                    .font(.headline)
                    .foregroundColor(isCurrentUser ? .blue : .primary)

                if let teamName = entry.teamName {
                    Text(teamName)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            Spacer()

            // Points
            VStack(alignment: .trailing, spacing: 2) {
                Text(String(format: "%.1f", entry.totalPoints))
                    .font(.title3)
                    .fontWeight(.bold)
                    .foregroundColor(isCurrentUser ? .blue : .primary)

                Text("points")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 16)
        .background(isCurrentUser ? Color.blue.opacity(0.08) : Color(.systemBackground))
    }

    private var rankColor: Color {
        if isCurrentUser { return .blue }
        switch rank {
        case 1: return .yellow
        case 2: return .gray
        case 3: return .orange
        default: return .primary
        }
    }
}

#Preview("Leaderboard") {
    NavigationStack {
        ContestLeaderboardView(contest: MockContest.samples[0])
            .environmentObject(AuthService())
    }
}

#Preview("Leaderboard Row") {
    VStack(spacing: 0) {
        LeaderboardRowView(rank: 1, entry: MockLeaderboardEntry.samples[0])
        LeaderboardRowView(rank: 2, entry: MockLeaderboardEntry.samples[1], isCurrentUser: true)
        LeaderboardRowView(rank: 3, entry: MockLeaderboardEntry.samples[2])
    }
    .padding()
}
