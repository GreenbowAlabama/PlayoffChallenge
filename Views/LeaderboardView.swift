import SwiftUI

struct LeaderboardView: View {
    @State private var entries: [LeaderboardEntry] = []
    @State private var isLoading = false
    @State private var expandedUserId: UUID? = nil
    @State private var currentWeek: Int = 12
    @State private var filterWeek: Int? = nil

    // Map NFL weeks to playoff round names for testing
    let playoffWeeks = [
        (12, "Wild Card"),
        (13, "Divisional"),
        (14, "Conference"),
        (15, "Super Bowl")
    ]

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // Week filter picker with playoff week names
                Picker("Week", selection: $filterWeek) {
                    Text("All Weeks").tag(nil as Int?)
                    ForEach(playoffWeeks, id: \.0) { week in
                        Text(week.1).tag(week.0 as Int?)
                    }
                }
                .pickerStyle(.segmented)
                .padding()
                .onChange(of: filterWeek) { _ in
                    Task {
                        await loadLeaderboard()
                    }
                }

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
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                                ExpandableLeaderboardRow(
                                    rank: index + 1,
                                    entry: entry,
                                    isExpanded: expandedUserId == entry.id,
                                    onTap: {
                                        withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                                            expandedUserId = (expandedUserId == entry.id) ? nil : entry.id
                                        }
                                    }
                                )
                            }
                        }
                        .padding(.horizontal)
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
        }
    }

    func loadCurrentWeek() async {
        do {
            let settings = try await APIService.shared.getSettings()
            currentWeek = settings.currentPlayoffWeek
            // Default to "All Weeks" view
            if filterWeek == nil {
                filterWeek = nil
            }
        } catch {
            print("Failed to load current week: \(error)")
            currentWeek = 12
        }
    }

    func loadLeaderboard() async {
        isLoading = true

        do {
            // Request picks to be included when filtering by specific week
            let includePicks = filterWeek != nil
            print("DEBUG: Loading leaderboard: weekNumber=\(String(describing: filterWeek)), includePicks=\(includePicks)")
            entries = try await APIService.shared.getLeaderboard(
                weekNumber: filterWeek,
                includePicks: includePicks
            )
            print("DEBUG: Loaded \(entries.count) entries")
            if let first = entries.first {
                print("DEBUG: First entry has \(first.picks?.count ?? 0) picks")
                if let picks = first.picks {
                    for pick in picks {
                        print("  - \(pick.position): \(pick.fullName) (\(pick.points) pts)")
                    }
                }
            }
        } catch {
            print("ERROR: Failed to load leaderboard: \(error)")
        }

        isLoading = false
    }
}

struct ExpandableLeaderboardRow: View {
    let rank: Int
    let entry: LeaderboardEntry
    let isExpanded: Bool
    let onTap: () -> Void

    private var displayName: String {
        entry.name ?? entry.username ?? entry.email ?? "User"
    }

    var body: some View {
        VStack(spacing: 0) {
            // Main row
            Button(action: onTap) {
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
                            .foregroundColor(.primary)

                        Text("points")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }

                    // Chevron indicator
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .rotationEffect(.degrees(0))
                }
                .padding(.vertical, 12)
                .padding(.horizontal, 16)
                .background(Color(.systemBackground))
                .contentShape(Rectangle())
            }
            .buttonStyle(PlainButtonStyle())

            // Expanded picks section
            if isExpanded, let picks = entry.picks, !picks.isEmpty {
                VStack(spacing: 8) {
                    ForEach(picks) { pick in
                        PickRowCard(pick: pick)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(Color(.systemGray6))
                .transition(.opacity.combined(with: .move(edge: .top)))
            }

            Divider()
                .padding(.leading, 72)
        }
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

struct PickRowCard: View {
    let pick: LeaderboardPick

    var body: some View {
        HStack(spacing: 12) {
            // Player image
            PlayerImageView(
                imageUrl: pick.imageUrl,
                size: 44,
                position: pick.position
            )

            // Player info
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(pick.fullName)
                        .font(.body)
                        .fontWeight(.medium)
                        .foregroundColor(.primary)

                    MultiplierBadge(multiplier: pick.multiplier)
                }

                HStack(spacing: 6) {
                    MatchupView(
                        team: pick.team,
                        opponent: pick.opponent,
                        isHome: pick.isHome,
                        logoSize: 18
                    )

                    if pick.locked {
                        Image(systemName: "lock.fill")
                            .font(.caption2)
                            .foregroundColor(.orange)
                    }
                }
            }

            Spacer()

            // Points
            VStack(alignment: .trailing, spacing: 2) {
                if pick.points != 0 {
                    Text(String(format: "%.1f", pick.points))
                        .font(.title3)
                        .fontWeight(.bold)
                        .foregroundColor(pick.points > 0 ? .green : .red)

                    if pick.multiplier > 1.0 {
                        HStack(spacing: 2) {
                            Text(String(format: "%.1f", pick.basePoints))
                                .font(.caption2)
                                .foregroundColor(.secondary)
                            Text("×")
                                .font(.caption2)
                                .foregroundColor(.secondary)
                            Text(String(format: "%.1fx", pick.multiplier))
                                .font(.caption2)
                                .foregroundColor(.orange)
                                .fontWeight(.semibold)
                        }
                    }
                } else {
                    Text("−")
                        .font(.title3)
                        .foregroundColor(.gray)

                    Text("No score")
                        .font(.caption2)
                        .foregroundColor(.gray)
                }
            }
        }
        .padding(12)
        .background(Color(.systemBackground))
        .cornerRadius(10)
        .shadow(color: Color.black.opacity(0.05), radius: 2, x: 0, y: 1)
    }

    private func positionColor(_ position: String) -> Color {
        switch position {
        case "QB": return .blue
        case "RB": return .green
        case "WR": return .orange
        case "TE": return .purple
        case "K": return .red
        case "DEF": return .indigo
        default: return .gray
        }
    }
}

#Preview {
    LeaderboardView()
}
