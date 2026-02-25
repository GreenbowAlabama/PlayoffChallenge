import SwiftUI

struct LeaderboardView: View {
    @State private var entries: [LeaderboardEntry] = []
    @State private var isLoading = false
    @State private var expandedUserId: UUID? = nil
    @State private var currentWeek: Int = 12
    @State private var filterWeek: Int? = nil

    // V2: Leaderboard metadata from response headers
    @State private var leaderboardMeta: LeaderboardMeta? = nil

    // Playoff rounds mapped to current NFL weeks
    // During regular season: weeks 16-18
    // During playoffs: weeks 19-22
    let playoffRounds = [
        (16, "Wild Card"),
        (17, "Divisional"),
        (18, "Conference"),
        (19, "Super Bowl")
    ]

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // Week filter picker with playoff round names
                Picker("Week", selection: $filterWeek) {
                    Text("All Weeks").tag(nil as Int?)
                    ForEach(playoffRounds, id: \.0) { round in
                        Text(round.1).tag(round.0 as Int?)
                    }
                }
                .pickerStyle(.segmented)
                .padding()
                .onChange(of: filterWeek) { _ in
                    Task {
                        await loadLeaderboard()
                    }
                }

                // V2: Pre-game message when capability headers indicate games haven't started
                if let meta = leaderboardMeta, !meta.gamesStarted {
                    PreGameBanner()
                }

                if isLoading {
                    ProgressView("Loading leaderboard...")
                } else if entries.isEmpty {
                    VStack(spacing: 16) {
                        Image(systemName: "chart.bar")
                            .font(.system(size: 60))
                            .foregroundColor(DesignTokens.Color.Action.disabled)

                        Text("No scores yet")
                            .font(.title2)
                            .foregroundColor(.secondary)
                    }
                    .padding()
                } else {
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(entries, id: \.id) { entry in
                                ExpandableLeaderboardRow(
                                    entry: entry,
                                    isExpanded: expandedUserId == entry.id,
                                    onTap: {
                                        withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                                            expandedUserId = (expandedUserId == entry.id) ? nil : entry.id
                                        }
                                    },
                                    weekNumber: filterWeek ?? currentWeek
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
            // Keep filterWeek as nil to default to "All Weeks" tab
        } catch {
            print("Failed to load current week: \(error)")
            currentWeek = 16 // Default to week 16 during regular season
        }
    }

    func loadLeaderboard() async {
        isLoading = true

        do {
            let includePicks = true // Always include picks to show matchups and live scores

            // Phase 2: Send explicit mode to disambiguate intent
            // - "All Weeks" (filterWeek == nil): mode=cumulative, no weekNumber
            // - Explicit round selection: mode=week with weekNumber
            let fetchedEntries: [LeaderboardEntry]
            let meta: LeaderboardMeta?

            if let selectedRound = filterWeek {
                // User explicitly selected a round (Wild Card, Divisional, etc.)
                print("DEBUG: Loading leaderboard v2: weekNumber=\(selectedRound), mode=week, includePicks=\(includePicks)")
                (fetchedEntries, meta) = try await APIService.shared.getLeaderboardV2(
                    weekNumber: selectedRound,
                    includePicks: includePicks,
                    mode: "week"
                )
            } else {
                // User selected "All Weeks" tab
                print("DEBUG: Loading leaderboard v2: mode=cumulative, includePicks=\(includePicks)")
                (fetchedEntries, meta) = try await APIService.shared.getLeaderboardV2(
                    includePicks: includePicks,
                    mode: "cumulative"
                )
            }

            entries = fetchedEntries
            leaderboardMeta = meta

            print("DEBUG: Loaded \(entries.count) entries")
            if let meta = meta {
                print("DEBUG: Leaderboard meta - gamesStarted: \(meta.gamesStarted)")
            } else {
                print("DEBUG: No leaderboard meta received (legacy response)")
            }

            if let first = entries.first {
                print("DEBUG: First entry has \(first.picks?.count ?? 0) picks")
            }
        } catch {
            print("ERROR: Failed to load leaderboard: \(error)")
        }

        isLoading = false
    }
}

// MARK: - Pre-Game Banner
// Shown when capability headers indicate games have not started yet
struct PreGameBanner: View {
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "clock.fill")
                .foregroundColor(DesignTokens.Color.Action.secondary)

            VStack(alignment: .leading, spacing: 2) {
                Text("Games haven't started yet")
                    .font(.subheadline)
                    .fontWeight(.medium)

                Text("Scores will update when games begin")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()
        }
        .padding()
        .background(DesignTokens.Color.Action.secondary.opacity(0.1))
        .cornerRadius(DesignTokens.Radius.lg)
        .padding(.horizontal)
        .padding(.bottom, 8)
    }
}

struct ExpandableLeaderboardRow: View {
    let entry: LeaderboardEntry
    let isExpanded: Bool
    let onTap: () -> Void
    let weekNumber: Int

    private var displayName: String {
        // Leaderboards always show username, never the user's real name
        entry.username ?? entry.email ?? "User"
    }

    var body: some View {
        VStack(spacing: 0) {
            // Main row - tap to expand/collapse picks
            Button(action: onTap) {
                HStack(spacing: 16) {
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

                    // Chevron indicator for expand/collapse
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .frame(width: DesignTokens.Size.iconLarge, height: DesignTokens.Size.iconLarge)
                }
                .padding(.vertical, 12)
                .padding(.horizontal, 16)
                .background(DesignTokens.Color.Surface.elevated)
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
                .background(DesignTokens.Color.Surface.card)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }

            Divider()
                .padding(.leading, 16)
        }
    }
}

struct PickRowCard: View {
    let pick: LeaderboardPick

    var body: some View {
        HStack(spacing: 12) {
            PlayerImageView(
                imageUrl: pick.imageUrl,
                size: 44,
                position: pick.position
            )

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
                            .foregroundColor(DesignTokens.Color.Brand.primary)
                    }
                }
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 2) {
                if pick.points != 0 {
                    Text(String(format: "%.1f", pick.points))
                        .font(.title3)
                        .fontWeight(.bold)
                        .foregroundColor(pick.points > 0 ? DesignTokens.Color.Action.primary : DesignTokens.Color.Action.destructive)

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
                                .foregroundColor(DesignTokens.Color.Brand.primary)
                                .fontWeight(.semibold)
                        }
                    }
                } else {
                    Text("−")
                        .font(.title3)
                        .foregroundColor(DesignTokens.Color.Action.disabled)

                    Text("No score")
                        .font(.caption2)
                        .foregroundColor(DesignTokens.Color.Action.disabled)
                }
            }
        }
        .padding(12)
        .background(DesignTokens.Color.Surface.elevated)
        .cornerRadius(DesignTokens.Radius.lg)
        .shadow(color: Color.black.opacity(0.05), radius: 2, x: 0, y: 1)
    }
}

#Preview {
    LeaderboardView()
}
