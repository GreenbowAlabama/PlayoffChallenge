//
//  LineupView.swift
//  PlayoffChallenge
//
//  V2: Unified view using /api/picks/v2 as single source of truth
//  Shows all 4 playoff weeks with live scoring integration
//

import SwiftUI
import Combine

struct LineupView: View {
    @EnvironmentObject var authService: AuthService
    @StateObject private var viewModel = LineupViewModel()

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // Week Selector (All 4 playoff weeks)
                PlayoffWeekPicker(selectedWeek: $viewModel.selectedWeek, currentWeek: viewModel.currentWeek, playoffStartWeek: viewModel.playoffStartWeek)
                    .padding(.horizontal)
                    .padding(.top, 8)

                if viewModel.isLocked {
                    LockedBanner()
                }

                ScrollView {
                    VStack(spacing: 16) {
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
                                    .padding(.bottom, 8)
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
        VStack(spacing: 20) {
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
        VStack(spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Total Score")
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .foregroundColor(.secondary)
                    if liveCount > 0 {
                        HStack(spacing: 4) {
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
                HStack(spacing: 6) {
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
        .padding(16)
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
                HStack(spacing: 8) {
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
            .padding(.bottom, 4)

            // V2: Show filled slots (single source of truth)
            ForEach(slots) { slot in
                LineupSlotRow(slot: slot, viewModel: viewModel)
            }

            // Empty slots (if can still add more)
            if slots.count < limit && !viewModel.isLocked {
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
                HStack(spacing: 6) {
                    Text(slot.fullName ?? "Unknown Player")
                        .font(.body)
                        .fontWeight(.medium)
                        .foregroundColor(.primary)

                    MultiplierBadge(multiplier: displayMultiplier)
                }

                HStack(spacing: 6) {
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
                            HStack(spacing: 4) {
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
        .padding(12)
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
            HStack(spacing: 12) {
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

                VStack(alignment: .leading, spacing: 4) {
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
            .padding(12)
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
                        HStack(spacing: 12) {
                            PlayerImageView(
                                imageUrl: player.imageUrl,
                                size: 44,
                                position: player.position
                            )

                            VStack(alignment: .leading, spacing: 4) {
                                Text(player.fullName)
                                    .font(.body)
                                    .fontWeight(.medium)
                                    .foregroundColor(.primary)

                                HStack(spacing: 4) {
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
                            HStack(spacing: 4) {
                                Text("Add")
                                    .font(.subheadline)
                                    .fontWeight(.medium)
                                Image(systemName: "plus.circle.fill")
                            }
                            .foregroundColor(.green)
                        }
                        .padding(.vertical, 4)
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

// MARK: - View Model
@MainActor
class LineupViewModel: ObservableObject {
    @Published var selectedWeek: Int = 0
    @Published var currentWeek: Int = 0
    @Published var playoffStartWeek: Int = 0

    // V2: Single source of truth - slots from /api/picks/v2
    @Published var slots: [PickV2Slot] = []
    @Published var positionLimits = LineupPositionLimits()

    // Available players for selection (loaded once)
    @Published var allPlayers: [Player] = []

    @Published var isLoading = false
    @Published var isSaving = false
    @Published var isLocked = false
    @Published var showError = false
    @Published var errorMessage: String?
    @Published var showingPlayerPicker = false
    @Published var selectedPosition: String?

    private(set) var userId: UUID?
    private var hasLoadedPlayersOnce = false
    private var refreshTimer: Timer?

    init() {
        Task {
            await loadCurrentWeek()
        }
    }

    func loadCurrentWeek() async {
        do {
            let settings = try await APIService.shared.getSettings()
            currentWeek = settings.currentPlayoffWeek
            playoffStartWeek = settings.playoffStartWeek

            print("DEBUG SETTINGS: currentPlayoffWeek = \(currentWeek), playoffStartWeek = \(playoffStartWeek), selectedWeek = \(selectedWeek)")

            // Default to current week if not yet initialized or out of valid range
            let validWeekRange = playoffStartWeek...(playoffStartWeek + 3)
            if selectedWeek == 0 || !validWeekRange.contains(selectedWeek) {
                selectedWeek = playoffStartWeek
            }
        } catch {
            print("Failed to load current week: \(error)")
            currentWeek = 0
            playoffStartWeek = 0
        }
    }

    // V2: Available players excludes those already in slots
    var availablePlayers: [Player] {
        let currentPlayerIds = Set(slots.compactMap { $0.playerId })
        return allPlayers.filter { !currentPlayerIds.contains($0.id) }
    }

    var isLineupComplete: Bool {
        filledCountForPosition("QB") == positionLimits.qb &&
        filledCountForPosition("RB") == positionLimits.rb &&
        filledCountForPosition("WR") == positionLimits.wr &&
        filledCountForPosition("TE") == positionLimits.te &&
        filledCountForPosition("K") == positionLimits.k &&
        filledCountForPosition("DEF") == positionLimits.def
    }

    var totalPoints: Double {
        slots.reduce(0) { $0 + ($1.finalPoints ?? 0) }
    }

    // Filled slots for a position (for display)
    func filledSlotsForPosition(_ position: String) -> [PickV2Slot] {
        slots.filter { $0.position == position && !$0.isEmpty }
    }

    // Count of filled slots for a position
    func filledCountForPosition(_ position: String) -> Int {
        filledSlotsForPosition(position).count
    }

    func limitFor(position: String) -> Int {
        switch position {
        case "QB": return positionLimits.qb
        case "RB": return positionLimits.rb
        case "WR": return positionLimits.wr
        case "TE": return positionLimits.te
        case "K": return positionLimits.k
        case "DEF": return positionLimits.def
        default: return 0
        }
    }

    // V2: Load data using /api/picks/v2 as single source of truth
    func loadData(userId: UUID) async {
        self.userId = userId
        isLoading = true

        print("DEBUG: Loading v2 data for week \(selectedWeek)")

        do {
            // Load settings for lock status
            let settings = try await APIService.shared.getSettings()

            // Only load players once (for player picker)
            if !hasLoadedPlayersOnce {
                do {
                    print("Loading players from API...")
                    let response = try await APIService.shared.getPlayers(limit: 500)
                    self.allPlayers = response.players
                    hasLoadedPlayersOnce = true
                    print("Loaded \(self.allPlayers.count) players")
                } catch {
                    print("Failed to load players: \(error)")
                    self.allPlayers = []
                }
            }

            // V2: Load lineup state from single source of truth
            let lineupState = try await APIService.shared.getPicksV2(userId: userId, weekNumber: selectedWeek)

            // Update from v2 response
            self.slots = lineupState.picks
            self.positionLimits = LineupPositionLimits(
                qb: lineupState.positionLimits.qb,
                rb: lineupState.positionLimits.rb,
                wr: lineupState.positionLimits.wr,
                te: lineupState.positionLimits.te,
                k: lineupState.positionLimits.k,
                def: lineupState.positionLimits.def
            )

            print("DEBUG: Loaded \(self.slots.count) slots for week \(selectedWeek)")

            // Check lock status
            // Only the CURRENT week can be edited (when active)
            // Past weeks and future weeks are always read-only
            // Note: currentWeek is playoff round from backend (1-5, may skip Pro Bowl at 4)
            // selectedWeek is NFL week (e.g., 16-19 for playoff weeks)
            // Compute effective NFL week: playoffStartWeek + offset, capped at Super Bowl (offset 3)
            // This handles Pro Bowl skip where backend sends round 5 for Super Bowl
            let offset = min(currentWeek - 1, 3)  // Cap at 3 (Super Bowl is final tab)
            let effectiveCurrentWeek = playoffStartWeek + offset

            if selectedWeek < effectiveCurrentWeek {
                self.isLocked = true
                print("DEBUG: Week \(selectedWeek) is locked (past week, effective=\(effectiveCurrentWeek))")
            } else if selectedWeek == effectiveCurrentWeek {
                self.isLocked = !(settings.isWeekActive ?? true)
                print("DEBUG: Week \(selectedWeek) locked: \(self.isLocked) (effective=\(effectiveCurrentWeek))")
            } else {
                // Future weeks are read-only - users cannot add picks ahead of time
                self.isLocked = true
                print("DEBUG: Week \(selectedWeek) is locked (future week, effective=\(effectiveCurrentWeek))")
            }

        } catch {
            // Silently ignore cancellation - this is expected when pull-to-refresh
            // or navigation triggers a new load while one is in progress
            if error is CancellationError || (error as? URLError)?.code == .cancelled {
                print("DEBUG: Load cancelled (expected during refresh)")
                isLoading = false
                return
            }
            print("ERROR loading v2 data: \(error)")
            errorMessage = "Failed to load data: \(error.localizedDescription)"
            showError = true
        }

        isLoading = false
    }

    func startAutoRefresh() {
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self = self, let userId = self.userId else { return }
                // Refresh lineup state (includes live scores in v2)
                await self.loadData(userId: userId)
            }
        }
    }

    func stopAutoRefresh() {
        refreshTimer?.invalidate()
        refreshTimer = nil
    }

    func openPlayerPicker(for position: String) {
        selectedPosition = position
        showingPlayerPicker = true
    }

    // V2: Add player via operation-based API
    func addPlayer(_ player: Player) async {
        guard let userId = userId else { return }

        let positionCount = filledCountForPosition(player.position)
        let limit = limitFor(position: player.position)

        guard positionCount < limit else { return }

        isSaving = true

        do {
            // Compute effective NFL week for mutations
            // currentWeek is playoff round from backend (1-5, may skip Pro Bowl at 4)
            // Cap offset at 3 to handle Pro Bowl skip where backend sends round 5 for Super Bowl
            let offset = min(currentWeek - 1, 3)
            let effectiveWeek = playoffStartWeek + offset
            let _ = try await APIService.shared.addPickV2(
                userId: userId,
                weekNumber: effectiveWeek,
                playerId: player.id,
                position: player.position
            )

            // Reload to get updated state
            await loadData(userId: userId)

        } catch {
            errorMessage = "Failed to add player: \(error.localizedDescription)"
            showError = true
        }

        isSaving = false
    }

    // V2: Remove player via operation-based API
    func removeSlot(_ slot: PickV2Slot) async {
        guard let userId = userId, let pickId = slot.pickId else { return }

        isSaving = true

        do {
            // Compute effective NFL week for mutations
            // currentWeek is playoff round from backend (1-5, may skip Pro Bowl at 4)
            // Cap offset at 3 to handle Pro Bowl skip where backend sends round 5 for Super Bowl
            let offset = min(currentWeek - 1, 3)
            let effectiveWeek = playoffStartWeek + offset
            let _ = try await APIService.shared.removePickV2(
                userId: userId,
                weekNumber: effectiveWeek,
                pickId: pickId
            )

            // Reload to get updated state
            await loadData(userId: userId)

        } catch {
            errorMessage = "Failed to remove player: \(error.localizedDescription)"
            showError = true
        }

        isSaving = false
    }
}

// MARK: - Lineup Position Limits
struct LineupPositionLimits {
    var qb: Int = 1
    var rb: Int = 2
    var wr: Int = 3
    var te: Int = 1
    var k: Int = 1
    var def: Int = 1
}

#Preview {
    LineupView()
        .environmentObject(AuthService())
}
