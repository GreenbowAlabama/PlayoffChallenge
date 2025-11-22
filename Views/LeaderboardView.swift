import SwiftUI

struct LeaderboardView: View {
    @State private var entries: [LeaderboardEntry] = []
    @State private var isLoading = false
    @State private var selectedUser: LeaderboardEntry?
    @State private var showingUserPicks = false
    @State private var selectedWeek: Int = 12  // Will be updated from settings
    
    var body: some View {
        NavigationView {
            VStack {
                if isLoading {
                    ProgressView("Loading leaderboard...")
                } else if entries.isEmpty {
                    VStack(spacing: 16) {
                        Image(systemName: "chart.bar")
                            .font(.system(size: 60))
                            .foregroundColor(.gray)
                        
                        Text("No scores yet")
                            .font(.title2)
                            .foregroundColor(.secondary)
                    }
                    .padding()
                } else {
                    List {
                        ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                            Button(action: {
                                selectedUser = entry
                                showingUserPicks = true
                            }) {
                                LeaderboardRow(rank: index + 1, entry: entry)
                            }
                            .buttonStyle(PlainButtonStyle())
                        }
                    }
                }
            }
            .navigationTitle("Leaderboard")
            .task {
                await loadCurrentWeek()
                await loadLeaderboard()
            }
            .refreshable {
                await loadLeaderboard()
            }
            .sheet(isPresented: $showingUserPicks) {
                if let user = selectedUser {
                    UserPicksQuickView(
                        userId: user.userId,
                        userName: user.name ?? user.username ?? "User",
                        teamName: user.teamName ?? "Team",
                        weekNumber: selectedWeek,
                        totalPoints: user.totalPoints
                    )
                }
            }
        }
    }
    
    func loadCurrentWeek() async {
        do {
            let settings = try await APIService.shared.getSettings()
            selectedWeek = settings.currentPlayoffWeek
        } catch {
            print("Failed to load current week: \(error)")
            selectedWeek = 12  // Default fallback
        }
    }
    
    func loadLeaderboard() async {
        isLoading = true
        
        do {
            entries = try await APIService.shared.getLeaderboard()
        } catch {
            print("Failed to load leaderboard: \(error)")
        }
        
        isLoading = false
    }
}

struct LeaderboardRow: View {
    let rank: Int
    let entry: LeaderboardEntry
    
    private var displayName: String {
        entry.name ?? entry.username ?? entry.email ?? "User"
    }
    
    var body: some View {
        HStack(spacing: 16) {
            // Rank
            Text("\(rank)")
                .font(.title2)
                .fontWeight(.bold)
                .foregroundColor(rankColor)
                .frame(width: 40)
            
            // User info
            VStack(alignment: .leading, spacing: 4) {
                Text(displayName)
                    .font(.headline)
                    .foregroundColor(.primary)
            }
            
            Spacer()
            
            // Points
            VStack(alignment: .trailing, spacing: 2) {
                Text(String(format: "%.1f", entry.totalPoints))
                    .font(.title3)
                    .fontWeight(.bold)
                    .foregroundColor(.primary)
                
                Text("points")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
            
            // Chevron indicator
            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())  // Makes entire row tappable
    }
    
    private var rankColor: Color {
        switch rank {
        case 1: return .yellow
        case 2: return .gray
        case 3: return .orange
        default: return .primary
        }
    }
}

#Preview {
    LeaderboardView()
}
