//
//  LineupView.swift
//  PlayoffChallenge
//
//  V2: Unified view using /api/picks/v2 as single source of truth
//  Shows all 4 playoff weeks with live scoring integration
//  Enforces contest lifecycle permissions (SCHEDULED, LOCKED, LIVE, COMPLETE).
//

import SwiftUI
import Combine

struct LineupView: View {
    let contestId: UUID
    let placeholder: Contest?
    @EnvironmentObject var authService: AuthService
    @StateObject private var viewModel: LineupViewModel

    init(contestId: UUID, placeholder: Contest? = nil) {
        self.contestId = contestId
        self.placeholder = placeholder
        _viewModel = StateObject(wrappedValue: LineupViewModel(
            contestId: contestId,
            placeholder: placeholder
        ))
    }

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // Week Selector (All 4 playoff weeks)
                PlayoffWeekPicker(selectedWeek: $viewModel.selectedWeek, currentWeek: viewModel.currentWeek, playoffStartWeek: viewModel.playoffStartWeek)
                    .padding(.horizontal)
                    .padding(.top, DesignTokens.Spacing.sm)

                if viewModel.isLocked {
                    LockedBanner()
                }

                ScrollView {
                    VStack(spacing: DesignTokens.Spacing.lg) {
                        if viewModel.isLoading {
                            ProgressView("Loading lineup...")
                                .frame(maxWidth: .infinity)
                                .padding()
                        } else {
                            // V2: Check if any slots have picks
                            let hasAnyPicks = viewModel.slots.contains { !$0.isEmpty }

                            // Week Summary Card with live scores (only show if has picks)
                            if hasAnyPicks {
                                WeekSummaryCardV2(
                                    weekNumber: viewModel.selectedWeek,
                                    totalPoints: viewModel.totalPoints,
                                    isComplete: viewModel.isLineupComplete,
                                    slots: viewModel.slots
                                )
                            } else {
                                // Show empty state message above position sections
                                EmptyWeekView(weekNumber: viewModel.selectedWeek, playoffStartWeek: viewModel.playoffStartWeek)
                                    .padding(.bottom, DesignTokens.Spacing.sm)
                            }

                            // Position Sections - V2: uses slots as single source of truth
                            ForEach(["QB", "RB", "WR", "TE", "K", "DEF"], id: \.self) { position in
                                LineupPositionSectionV2(
                                    position: position,
                                    limit: viewModel.limitFor(position: position),
                                    slots: viewModel.filledSlotsForPosition(position),
                                    viewModel: viewModel
                                )
                            }
                        }
                    }
                    .padding()
                }

                // V2: Show saving indicator overlay instead of submit button
                // (Operations are now immediate, no batch submit needed)
                if viewModel.isSaving {
                    HStack {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                        Text("Saving...")
                            .font(.headline)
                    }
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(DesignTokens.Color.Action.secondary)
                    .cornerRadius(DesignTokens.Radius.lg)
                    .padding()
                }
            }
            .navigationTitle("My Lineup")
            .task {
                if let userId = authService.currentUser?.id {
                    viewModel.configure(currentUserId: userId)
                    await viewModel.loadData(userId: userId)
                }
            }
            .onChange(of: viewModel.selectedWeek) { oldValue, newValue in
                if let userId = authService.currentUser?.id {
                    Task {
                        await viewModel.loadData(userId: userId)
                    }
                }
            }
            .onAppear {
                viewModel.startAutoRefresh()
            }
            .onDisappear {
                viewModel.stopAutoRefresh()
            }
            .refreshable {
                if let userId = authService.currentUser?.id {
                    await viewModel.loadData(userId: userId)
                }
            }
            .alert("Error", isPresented: $viewModel.showError) {
                Button("OK", role: .cancel) { }
            } message: {
                Text(viewModel.errorMessage ?? "An error occurred")
            }
            .sheet(isPresented: $viewModel.showingPlayerPicker) {
                if let position = viewModel.selectedPosition {
                    LineupPlayerPickerSheetV2(
                        position: position,
                        viewModel: viewModel
                    )
                }
            }
        }
    }
}

// MARK: - Playoff Week Picker
struct PlayoffWeekPicker: View {
    @Binding var selectedWeek: Int
    let currentWeek: Int
    let playoffStartWeek: Int

    // Compute playoff weeks dynamically from playoff_start_week
    var playoffWeeks: [(Int, String)] {
        [
            (playoffStartWeek, "Wild Card"),
            (playoffStartWeek + 1, "Divisional"),
            (playoffStartWeek + 2, "Conference"),
            (playoffStartWeek + 3, "Super Bowl")
        ]
    }

    var body: some View {
        // Match Leaderboard style: no label, just the picker
        Picker("Week", selection: $selectedWeek) {
            ForEach(playoffWeeks, id: \.0) { week in
                Text(week.1).tag(week.0)
            }
        }
        .pickerStyle(.segmented)
    }
}

// MARK: - Empty Week View
struct EmptyWeekView: View {
    let weekNumber: Int
    let playoffStartWeek: Int

    // Compute week name from offset relative to playoff_start_week
    var weekName: String {
        let offset = weekNumber - playoffStartWeek
        switch offset {
        case 0: return "Wild Card"
        case 1: return "Divisional"
        case 2: return "Conference"
        case 3: return "Super Bowl"
        default: return "Week \(weekNumber)"
        }
    }

    var body: some View {
        VStack(spacing: DesignTokens.Spacing.xl) {
            Image(systemName: "person.3.fill")
                .font(.system(size: 60))
                .foregroundColor(.gray)

            Text("No Picks Yet")
                .font(.title2)
                .fontWeight(.bold)

            Text("Add players to your \(weekName) lineup below")
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
    }
}

// MARK: - Week Summary Card V2
struct WeekSummaryCardV2: View {
    let weekNumber: Int
    let totalPoints: Double
    let isComplete: Bool
    let slots: [PickV2Slot]

    var liveCount: Int {
        slots.filter { $0.isLive == true }.count
    }

    var body: some View {
        VStack(spacing: DesignTokens.Spacing.md) {
            HStack {
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.xxs) {
                    Text("Total Score")
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .foregroundColor(.secondary)
                    if liveCount > 0 {
                        HStack(spacing: DesignTokens.Spacing.xxs) {
                            Circle()
                                .fill(DesignTokens.Color.Action.destructive)
                                .frame(width: DesignTokens.Size.dotSmall, height: DesignTokens.Size.dotSmall)
                            Text("\(liveCount) \(liveCount == 1 ? "game" : "games") in progress")
                                .font(.caption)
                                .foregroundColor(DesignTokens.Color.Action.destructive)
                        }
                    }
                }

                Spacer()

                VStack(alignment: .trailing, spacing: 2) {
                    Text(String(format: "%.1f", totalPoints))
                        .font(.system(size: 32, weight: .bold))
                        .foregroundColor(liveCount > 0 ? .red : .primary)
                    Text("points")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }

            if isComplete {
                HStack(spacing: DesignTokens.Spacing.xs) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(.green)
                        .font(.subheadline)
                    Text("Lineup complete")
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .foregroundColor(.green)
                    Spacer()
                }
            }
        }
        .padding(DesignTokens.Spacing.lg)
        .background(DesignTokens.Color.Surface.elevated)
        .cornerRadius(DesignTokens.Radius.lg)
        .shadow(color: Color.black.opacity(0.05), radius: 4, x: 0, y: 2)
    }
}

// MARK: - Lineup Position Section V2
struct LineupPositionSectionV2: View {
    let position: String
    let limit: Int
    let slots: [PickV2Slot]  // V2: Filled slots only
    @ObservedObject var viewModel: LineupViewModel

    // Position display names
    private var positionName: String {
        switch position {
        case "QB": return "Quarterback"
        case "RB": return "Running Back"
        case "WR": return "Wide Receiver"
        case "TE": return "Tight End"
        case "K": return "Kicker"
        case "DEF": return "Defense"
        default: return position
        }
    }

    private var positionColor: Color {
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

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Section header - outside card styling
            HStack(alignment: .firstTextBaseline) {
                HStack(spacing: DesignTokens.Spacing.sm) {
                    // Position color indicator
                    RoundedRectangle(cornerRadius: 2)
                        .fill(positionColor)
                        .frame(width: 4, height: 16)

                    Text(positionName)
                        .font(.headline)
                        .foregroundColor(.primary)
                }

                Spacer()

                Text("\(slots.count)/\(limit)")
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundColor(.secondary)
            }
            .padding(.bottom, DesignTokens.Spacing.xxs)

            // V2: Show filled slots (single source of truth)
            ForEach(slots) { slot in
                LineupSlotRow(slot: slot, viewModel: viewModel)
            }

            // Empty slots (if can still add more)
            // GOVERNANCE: Editing permission enforced by canEditLineup (contest status-driven)
            if slots.count < limit && viewModel.canEditLineup {
                ForEach(0..<(limit - slots.count), id: \.self) { _ in
                    EmptySlotButton(position: position, viewModel: viewModel)
                }
            }
        }
    }
}

// MARK: - Lineup Slot Row V2 (unified display for picks with scores)
// Styled to match PickRowCard from LeaderboardView
struct LineupSlotRow: View {
    let slot: PickV2Slot
    @ObservedObject var viewModel: LineupViewModel
    @State private var showingDeleteAlert = false

    var displayPoints: Double {
        slot.finalPoints ?? 0
    }

    var displayBasePoints: Double {
        slot.basePoints ?? 0
    }

    var displayMultiplier: Double {
        slot.multiplier ?? 1.0
    }

    var isLive: Bool {
        slot.isLive ?? false
    }

    var canDelete: Bool {
        // Can delete if: week is CURRENT (not future), not locked, and no score yet
        // Users can only modify picks for the active playoff week
        // Note: currentWeek is playoff round from backend (1-5, may skip Pro Bowl at 4)
        // Cap offset at 3 to handle Pro Bowl skip where backend sends round 5 for Super Bowl
        let offset = min(viewModel.currentWeek - 1, 3)
        let effectiveCurrentWeek = viewModel.playoffStartWeek + offset
        return viewModel.selectedWeek == effectiveCurrentWeek && !viewModel.isLocked && !slot.locked && (slot.finalPoints ?? 0) == 0
    }

    var body: some View {
        HStack(spacing: 12) {
            // Player image - match Leaderboard size (44)
            PlayerImageView(
                imageUrl: slot.imageUrl,
                size: 44,
                position: slot.position
            )

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: DesignTokens.Spacing.xs) {
                    Text(slot.fullName ?? "Unknown Player")
                        .font(.body)
                        .fontWeight(.medium)
                        .foregroundColor(.primary)

                    MultiplierBadge(multiplier: displayMultiplier)
                }

                HStack(spacing: DesignTokens.Spacing.xs) {
                    // Matchup display - use MatchupView when opponent data available,
                    // fall back to team-only display otherwise
                    if let team = slot.team {
                        if let opponent = slot.opponent, let isHome = slot.isHome {
                            // Full matchup display (matches Leaderboard style)
                            MatchupView(
                                team: team,
                                opponent: opponent,
                                isHome: isHome,
                                logoSize: 18
                            )
                        } else {
                            // Fallback: team logo and abbreviation only
                            HStack(spacing: DesignTokens.Spacing.xxs) {
                                TeamLogoView(teamAbbreviation: team, size: 18)
                                Text(team)
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        }
                    }

                    // Locked indicator
                    if slot.locked && !canDelete {
                        Image(systemName: "lock.fill")
                            .font(.caption2)
                            .foregroundColor(.orange)
                    }

                    // Live indicator
                    if isLive {
                        HStack(spacing: 3) {
                            Circle()
                                .fill(DesignTokens.Color.Action.destructive)
                                .frame(width: DesignTokens.Size.dotSmall, height: DesignTokens.Size.dotSmall)
                            Text("LIVE")
                                .font(.system(size: 8, weight: .bold))
                                .foregroundColor(DesignTokens.Color.Action.destructive)
                        }
                    }
                }
            }

            Spacer()

            // Score display - match Leaderboard style
            VStack(alignment: .trailing, spacing: 2) {
                if displayPoints != 0 || isLive {
                    Text(String(format: "%.1f", displayPoints))
                        .font(.title3)
                        .fontWeight(.bold)
                        .foregroundColor(isLive ? .red : (displayPoints > 0 ? .green : .red))

                    if displayMultiplier > 1.0 {
                        HStack(spacing: 2) {
                            Text(String(format: "%.1f", displayBasePoints))
                                .font(.caption2)
                                .foregroundColor(.secondary)
                            Text("×")
                                .font(.caption2)
                                .foregroundColor(.secondary)
                            Text(String(format: "%.1fx", displayMultiplier))
                                .font(.caption2)
                                .foregroundColor(.orange)
                                .fontWeight(.semibold)
                        }
                    }
                } else {
                    // No score yet - match Leaderboard "−" style
                    Text("−")
                        .font(.title3)
                        .foregroundColor(.gray)

                    Text("No score")
                        .font(.caption2)
                        .foregroundColor(.gray)
                }
            }

            // Delete button - V2: calls removeSlot
            if canDelete {
                Button(action: {
                    showingDeleteAlert = true
                }) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(.red.opacity(0.8))
                        .imageScale(.large)
                }
            }
        }
        .padding(DesignTokens.Spacing.md)
        .background(DesignTokens.Color.Surface.elevated)
        .cornerRadius(DesignTokens.Radius.lg)
        .shadow(color: Color.black.opacity(0.05), radius: 2, x: 0, y: 1)
        .alert("Remove Player?", isPresented: $showingDeleteAlert) {
            Button("Cancel", role: .cancel) { }
            Button("Remove", role: .destructive) {
                Task {
                    // V2: Use removeSlot which calls the v2 API
                    await viewModel.removeSlot(slot)
                }
            }
        } message: {
            Text("Are you sure you want to remove \(slot.fullName ?? "this player") from your lineup?")
        }
    }
}

// MARK: - Empty Slot Button
// Styled to feel like an intentional card, not a dashed placeholder
struct EmptySlotButton: View {
    let position: String
    @ObservedObject var viewModel: LineupViewModel

    private var positionColor: Color {
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

    var body: some View {
        Button(action: {
            viewModel.openPlayerPicker(for: position)
        }) {
            HStack(spacing: DesignTokens.Spacing.md) {
                // Position placeholder circle - matches PlayerImageView style
                ZStack {
                    Circle()
                        .fill(positionColor.opacity(0.15))
                        .frame(width: DesignTokens.Size.iconLarge, height: DesignTokens.Size.iconLarge)

                    Image(systemName: "plus")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundColor(positionColor)
                }
                .overlay(
                    Circle()
                        .stroke(positionColor.opacity(0.3), lineWidth: 2)
                )

                VStack(alignment: .leading, spacing: DesignTokens.Spacing.xxs) {
                    Text("Add \(position)")
                        .font(.body)
                        .fontWeight(.medium)
                        .foregroundColor(.primary)

                    Text("Tap to select player")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .padding(DesignTokens.Spacing.md)
            .frame(maxWidth: .infinity)
            .background(DesignTokens.Color.Surface.elevated)
            .cornerRadius(DesignTokens.Radius.lg)
            .shadow(color: Color.black.opacity(0.05), radius: 2, x: 0, y: 1)
        }
        .buttonStyle(PlainButtonStyle())
    }
}

// MARK: - Lineup Player Picker Sheet V2
// Polished styling to match overall app visual language
struct LineupPlayerPickerSheetV2: View {
    let position: String
    @ObservedObject var viewModel: LineupViewModel
    @Environment(\.dismiss) var dismiss
    @State private var searchText = ""

    var filteredPlayers: [Player] {
        let availablePlayers = viewModel.availablePlayers.filter { $0.position == position }

        if searchText.isEmpty {
            return availablePlayers
        } else {
            return availablePlayers.filter {
                $0.fullName.lowercased().contains(searchText.lowercased()) ||
                ($0.team?.lowercased().contains(searchText.lowercased()) ?? false)
            }
        }
    }

    var body: some View {
        NavigationView {
            List {
                ForEach(filteredPlayers) { player in
                    Button(action: {
                        // V2: Use async addPlayer which calls the v2 API
                        Task {
                            await viewModel.addPlayer(player)
                            dismiss()
                        }
                    }) {
                        HStack(spacing: DesignTokens.Spacing.md) {
                            PlayerImageView(
                                imageUrl: player.imageUrl,
                                size: 44,
                                position: player.position
                            )

                            VStack(alignment: .leading, spacing: DesignTokens.Spacing.xxs) {
                                Text(player.fullName)
                                    .font(.body)
                                    .fontWeight(.medium)
                                    .foregroundColor(.primary)

                                HStack(spacing: DesignTokens.Spacing.xxs) {
                                    if let team = player.team {
                                        TeamLogoView(teamAbbreviation: team, size: 16)
                                        Text(team)
                                            .font(.caption)
                                            .foregroundColor(.secondary)
                                    } else {
                                        Text("Free Agent")
                                            .font(.caption)
                                            .foregroundColor(.secondary)
                                    }
                                }
                            }

                            Spacer()

                            // Add button with clear affordance
                            HStack(spacing: DesignTokens.Spacing.xxs) {
                                Text("Add")
                                    .font(.subheadline)
                                    .fontWeight(.medium)
                                Image(systemName: "plus.circle.fill")
                            }
                            .foregroundColor(.green)
                        }
                        .padding(.vertical, DesignTokens.Spacing.xxs)
                    }
                }
            }
            .listStyle(.plain)
            .searchable(text: $searchText, prompt: "Search by name or team")
            .navigationTitle("Select \(position)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
        }
    }
}

#Preview {
    LineupView(contestId: UUID())
        .environmentObject(AuthService())
}
