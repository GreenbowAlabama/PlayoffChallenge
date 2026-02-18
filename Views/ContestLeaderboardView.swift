//
//  ContestLeaderboardView.swift
//  PlayoffChallenge
//
//  Leaderboard view for a specific contest.
//  Uses contract-driven rendering from LeaderboardResponseContract.
//

import SwiftUI

struct ContestLeaderboardView: View {
    @StateObject private var viewModel: ContestLeaderboardViewModel
    @EnvironmentObject var authService: AuthService

    private var currentUsername: String {
        authService.currentUser?.username ?? ""
    }

    init(contestId: UUID) {
        _viewModel = StateObject(wrappedValue: ContestLeaderboardViewModel(contestId: contestId))
    }

    var body: some View {
        Group {
            if viewModel.isLoading {
                ProgressView("Loading leaderboard...")
            } else if viewModel.isPending {
                VStack(spacing: 16) {
                    Image(systemName: "hourglass")
                        .font(.system(size: 60))
                        .foregroundColor(.gray)

                    Text("Leaderboard pending")
                        .font(.title2)
                        .foregroundColor(.secondary)
                }
            } else if viewModel.hasUnknownState {
                VStack(spacing: 16) {
                    Image(systemName: "questionmark.circle")
                        .font(.system(size: 60))
                        .foregroundColor(.orange)

                    Text("Leaderboard Format Not Supported")
                        .font(.title2)
                        .foregroundColor(.secondary)

                    Text("The leaderboard format is not yet supported on this version of the app. Please update or contact support.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                }
            } else if viewModel.hasError {
                VStack(spacing: 16) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 60))
                        .foregroundColor(.red)

                    Text("Error computing leaderboard")
                        .font(.title2)
                        .foregroundColor(.secondary)

                    if let error = viewModel.errorMessage {
                        Text(error)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            } else if viewModel.isEmpty {
                VStack(spacing: 16) {
                    Image(systemName: "chart.bar")
                        .font(.system(size: 60))
                        .foregroundColor(.gray)

                    Text("No entries yet")
                        .font(.title2)
                        .foregroundColor(.secondary)
                }
            } else {
                DynamicLeaderboardTableView(
                    columnSchema: viewModel.columnSchema,
                    rows: viewModel.rows,
                    isCurrentUserRow: { row in
                        // Check if this row represents the current user (customizable based on schema)
                        false
                    }
                )
            }
        }
        .navigationTitle("Leaderboard")
        .navigationBarTitleDisplayMode(.large)
        .task {
            await viewModel.loadLeaderboard()
        }
        .refreshable {
            await viewModel.refresh()
        }
    }
}

// MARK: - Mock Leaderboard Entry (legacy, kept for other views)

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

// MARK: - Leaderboard Row (legacy, kept for other views)

struct LeaderboardRowView: View {
    let entry: MockLeaderboardEntry
    var isCurrentUser: Bool = false

    var body: some View {
        HStack(spacing: 16) {
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
}

#Preview("Leaderboard") {
    NavigationStack {
        ContestLeaderboardView(contestId: UUID())
            .environmentObject(AuthService())
    }
}

#Preview("Leaderboard Row") {
    VStack(spacing: 0) {
        LeaderboardRowView(entry: MockLeaderboardEntry.samples[0])
        LeaderboardRowView(entry: MockLeaderboardEntry.samples[1], isCurrentUser: true)
        LeaderboardRowView(entry: MockLeaderboardEntry.samples[2])
    }
    .padding()
}
