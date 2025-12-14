//
//  LineupView.swift
//  PlayoffChallenge
//
//  Unified view combining player selection and picks display
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
                PlayoffWeekPicker(selectedWeek: $viewModel.selectedWeek, currentWeek: viewModel.currentWeek)
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
                            // Week Summary Card with live scores (only show if has picks)
                            if !viewModel.picks.isEmpty {
                                WeekSummaryCard(
                                    weekNumber: viewModel.selectedWeek,
                                    totalPoints: viewModel.totalPoints,
                                    isComplete: viewModel.isLineupComplete,
                                    userId: viewModel.userId,
                                    liveScores: viewModel.liveScores
                                )
                            } else {
                                // Show empty state message above position sections
                                EmptyWeekView(weekNumber: viewModel.selectedWeek)
                                    .padding(.bottom, 8)
                            }

                            // Position Sections - always show (they handle empty state internally)
                            ForEach(["QB", "RB", "WR", "TE", "K", "DEF"], id: \.self) { position in
                                LineupPositionSection(
                                    position: position,
                                    limit: viewModel.limitFor(position: position),
                                    picks: viewModel.picksForPosition(position),
                                    players: viewModel.playersForPosition(position),
                                    viewModel: viewModel
                                )
                            }
                        }
                    }
                    .padding()
                }

                // Submit Button (only if not locked and has changes)
                if !viewModel.isLocked && viewModel.hasChanges {
                    Button(action: {
                        Task {
                            await viewModel.submitLineup()
                        }
                    }) {
                        HStack {
                            if viewModel.isSaving {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                            }
                            Text(viewModel.isSaving ? "Saving..." : "Save Lineup")
                                .font(.headline)
                        }
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.green)
                        .cornerRadius(12)
                    }
                    .disabled(viewModel.isSaving)
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
                    LineupPlayerPickerSheet(
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

    // Map NFL weeks to playoff round names
    // Week 19 = Wild Card, Week 20 = Divisional, etc.
    let playoffWeeks = [
        (19, "Wild Card"),
        (20, "Divisional"),
        (21, "Conference"),
        (22, "Super Bowl")
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Playoff Week")
                .font(.caption)
                .foregroundColor(.secondary)

            Picker("Week", selection: $selectedWeek) {
                ForEach(playoffWeeks, id: \.0) { week in
                    Text(week.1).tag(week.0)
                }
            }
            .pickerStyle(.segmented)
        }
    }
}

// MARK: - Empty Week View
struct EmptyWeekView: View {
    let weekNumber: Int

    var weekName: String {
        switch weekNumber {
        case 12: return "Wild Card"
        case 13: return "Divisional"
        case 14: return "Conference"
        case 15: return "Super Bowl"
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

// MARK: - Lineup Position Section
struct LineupPositionSection: View {
    let position: String
    let limit: Int
    let picks: [Pick]
    let players: [Player]  // Current lineup players for editing
    @ObservedObject var viewModel: LineupViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header
            HStack {
                Text(position)
                    .font(.headline)
                    .foregroundColor(.blue)

                Spacer()

                Text("\(players.count)/\(limit)")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            // Show picks with scores (if they exist) OR show editable players
            if !picks.isEmpty {
                // Display mode: show picks with scores
                ForEach(picks) { pick in
                    LineupPickRow(pick: pick, viewModel: viewModel)
                }
            } else if !players.isEmpty {
                // Edit mode: show selected players
                ForEach(players) { player in
                    LineupPlayerRow(player: player, viewModel: viewModel)
                }
            }

            // Empty slots (if can still add more)
            if players.count < limit && !viewModel.isLocked {
                ForEach(0..<(limit - players.count), id: \.self) { _ in
                    EmptySlotButton(position: position, viewModel: viewModel)
                }
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }
}

// MARK: - Lineup Player Row (simple display for editing)
struct LineupPlayerRow: View {
    let player: Player
    @ObservedObject var viewModel: LineupViewModel
    @Environment(\.colorScheme) var colorScheme

    var body: some View {
        HStack(spacing: 12) {
            PlayerImageView(
                imageUrl: player.imageUrl,
                size: 50,
                position: player.position
            )

            VStack(alignment: .leading, spacing: 4) {
                Text(player.fullName)
                    .font(.body)
                    .fontWeight(.semibold)

                HStack(spacing: 8) {
                    Text(player.position)
                        .font(.caption)
                        .foregroundColor(.secondary)

                    if let team = player.team {
                        Text(team)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            }

            Spacer()

            // Delete button
            if !viewModel.isLocked {
                Button(action: {
                    viewModel.removePlayer(playerId: player.id, position: player.position)
                }) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(.red)
                        .imageScale(.large)
                }
            }
        }
        .padding()
        .background(colorScheme == .dark ? Color(.systemGray5) : Color.white)
        .cornerRadius(8)
        .shadow(color: .black.opacity(0.1), radius: 2, x: 0, y: 1)
    }
}

// MARK: - Lineup Pick Row (with live scoring)
struct LineupPickRow: View {
    let pick: Pick
    @ObservedObject var viewModel: LineupViewModel
    @State private var playerScore: PlayerScore?
    @State private var showingDeleteAlert = false
    @Environment(\.colorScheme) var colorScheme

    var liveScore: LivePickScore? {
        viewModel.liveScores[pick.id.uuidString]
    }

    var displayPoints: Double {
        if let live = liveScore {
            return live.finalPoints
        }
        return playerScore?.finalPoints ?? 0
    }

    var displayBasePoints: Double {
        if let live = liveScore {
            return live.basePoints
        }
        return playerScore?.basePoints ?? 0
    }

    var displayMultiplier: Double {
        if let live = liveScore {
            return live.multiplier
        }
        return playerScore?.multiplier ?? pick.multiplier ?? 1.0
    }

    var isLive: Bool {
        liveScore?.isLive ?? false
    }

    var canDelete: Bool {
        // Can delete if: week is current/future, not locked, and no score yet
        viewModel.selectedWeek >= viewModel.currentWeek && !viewModel.isLocked && playerScore == nil && liveScore == nil
    }

    var body: some View {
        HStack(spacing: 12) {
            PlayerImageView(
                imageUrl: pick.imageUrl,
                size: 50,
                position: pick.playerPosition ?? pick.position
            )

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(pick.fullName ?? "Unknown Player")
                        .font(.body)
                        .fontWeight(.semibold)

                    // Multiplier Badge
                    MultiplierBadge(multiplier: displayMultiplier)
                }

                HStack(spacing: 8) {
                    Text(pick.playerPosition ?? pick.position)
                        .font(.caption)
                        .foregroundColor(.secondary)

                    if let team = pick.team {
                        Text(team)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }

                    if isLive {
                        HStack(spacing: 3) {
                            Circle()
                                .fill(Color.red)
                                .frame(width: 5, height: 5)
                            Text("LIVE")
                                .font(.system(size: 8, weight: .bold))
                                .foregroundColor(.red)
                        }
                    }
                }
            }

            Spacer()

            // Score display
            if displayPoints > 0 || liveScore != nil {
                VStack(alignment: .trailing, spacing: 4) {
                    Text(String(format: "%.1f", displayPoints))
                        .font(.title3)
                        .fontWeight(.bold)
                        .foregroundColor(isLive ? .red : .primary)

                    Text("pts")
                        .font(.caption2)
                        .foregroundColor(.secondary)

                    // Base points and multiplier breakdown
                    if displayMultiplier > 1.0 {
                        HStack(spacing: 4) {
                            Text(String(format: "%.1f", displayBasePoints))
                                .font(.caption2)
                                .foregroundColor(.secondary)

                            Image(systemName: "xmark")
                                .font(.system(size: 8))
                                .foregroundColor(.secondary)

                            Text(String(format: "%.1fx", displayMultiplier))
                                .font(.caption2)
                                .fontWeight(.bold)
                                .foregroundColor(.orange)
                        }
                    }
                }
            } else if !canDelete {
                // No score yet, but locked
                Text("Not scored")
                    .font(.caption2)
                    .foregroundColor(.gray)
            }

            // Delete button
            if canDelete {
                Button(action: {
                    showingDeleteAlert = true
                }) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(.red)
                        .imageScale(.large)
                }
            }
        }
        .padding()
        .background(colorScheme == .dark ? Color(.systemGray5) : Color.white)
        .cornerRadius(8)
        .shadow(color: .black.opacity(0.1), radius: 2, x: 0, y: 1)
        .task {
            await loadScore()
        }
        .alert("Remove Player?", isPresented: $showingDeleteAlert) {
            Button("Cancel", role: .cancel) { }
            Button("Remove", role: .destructive) {
                Task {
                    await viewModel.removePlayer(pick: pick)
                }
            }
        } message: {
            Text("Are you sure you want to remove \(pick.fullName ?? "this player") from your lineup?")
        }
    }

    private func loadScore() async {
        guard let userId = viewModel.userId else { return }

        do {
            let scores = try await APIService.shared.getScores(
                userId: userId,
                weekNumber: pick.weekNumber
            )

            playerScore = scores.first { $0.playerId == pick.playerId }
        } catch {
            print("Failed to load score for \(pick.fullName ?? "player"): \(error)")
        }
    }
}

// MARK: - Empty Slot Button
struct EmptySlotButton: View {
    let position: String
    @ObservedObject var viewModel: LineupViewModel
    @Environment(\.colorScheme) var colorScheme

    var body: some View {
        Button(action: {
            viewModel.openPlayerPicker(for: position)
        }) {
            HStack(spacing: 8) {
                Image(systemName: "plus.circle.fill")
                    .font(.title3)
                    .foregroundColor(.blue)

                Text("Add \(position)")
                    .font(.subheadline)
                    .foregroundColor(.secondary)

                Spacer()
            }
            .padding()
            .frame(maxWidth: .infinity, minHeight: 60)
            .background(colorScheme == .dark ? Color(.systemGray5) : Color.white)
            .cornerRadius(8)
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Color.blue.opacity(0.3), style: StrokeStyle(lineWidth: 1, dash: [5]))
            )
        }
    }
}

// MARK: - Lineup Player Picker Sheet
struct LineupPlayerPickerSheet: View {
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
                        viewModel.addPlayer(player)
                        dismiss()
                    }) {
                        HStack(spacing: 12) {
                            PlayerImageView(
                                imageUrl: player.imageUrl,
                                size: 50,
                                position: player.position
                            )

                            VStack(alignment: .leading, spacing: 4) {
                                Text(player.fullName)
                                    .font(.body)
                                    .foregroundColor(.primary)

                                Text("\(player.position) - \(player.team ?? "FA")")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }

                            Spacer()

                            Image(systemName: "plus.circle.fill")
                                .foregroundColor(.green)
                        }
                    }
                }
            }
            .searchable(text: $searchText, prompt: "Search players")
            .navigationTitle("Add \(position)")
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
    @Published var selectedWeek: Int = 19
    @Published var currentWeek: Int = 19
    @Published var picks: [Pick] = []
    @Published var allPlayers: [Player] = []
    @Published var currentLineup: [Player] = []  // Track selected players for editing
    @Published var positionLimits = LineupPositionLimits()
    @Published var isLoading = false
    @Published var isSaving = false
    @Published var isLocked = false
    @Published var hasChanges = false
    @Published var showError = false
    @Published var errorMessage: String?
    @Published var showingPlayerPicker = false
    @Published var selectedPosition: String?
    @Published var liveScores: [String: LivePickScore] = [:]

    private(set) var userId: UUID?
    private var originalPickIds: Set<String> = []
    private var originalLineup: [Player] = []
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

            // Default to current week
            if selectedWeek == 12 || selectedWeek == 10 {
                selectedWeek = currentWeek
            }
        } catch {
            print("Failed to load current week: \(error)")
            currentWeek = 12
        }
    }

    var availablePlayers: [Player] {
        let currentPickPlayerIds = Set(currentLineup.map { $0.id })
        return allPlayers.filter { !currentPickPlayerIds.contains($0.id) }
    }

    var isLineupComplete: Bool {
        playersForPosition("QB").count == positionLimits.qb &&
        playersForPosition("RB").count == positionLimits.rb &&
        playersForPosition("WR").count == positionLimits.wr &&
        playersForPosition("TE").count == positionLimits.te &&
        playersForPosition("K").count == positionLimits.k &&
        playersForPosition("DEF").count == positionLimits.def
    }

    var totalPoints: Double {
        // Prioritize live scores
        if !liveScores.isEmpty {
            return liveScores.values.reduce(0) { $0 + $1.finalPoints }
        }
        return 0
    }

    func picksForPosition(_ position: String) -> [Pick] {
        picks.filter { ($0.playerPosition ?? $0.position) == position }
    }

    func playersForPosition(_ position: String) -> [Player] {
        currentLineup.filter { $0.position == position }
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

    func loadData(userId: UUID) async {
        self.userId = userId
        isLoading = true

        print("DEBUG: Loading data for week \(selectedWeek)")

        do {
            async let settings = APIService.shared.getSettings()
            async let picksResponse = APIService.shared.getUserPicks(userId: userId)

            // Only load players once
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

            let (settingsResult, allPicks) = try await (settings, picksResponse)

            // Update position limits
            self.positionLimits = LineupPositionLimits(
                qb: settingsResult.qbLimit ?? 1,
                rb: settingsResult.rbLimit ?? 2,
                wr: settingsResult.wrLimit ?? 3,
                te: settingsResult.teLimit ?? 1,
                k: settingsResult.kLimit ?? 1,
                def: settingsResult.defLimit ?? 1
            )

            // Filter picks for selected week
            self.picks = allPicks.filter { $0.weekNumber == selectedWeek }
            print("DEBUG: Loaded \(self.picks.count) picks for week \(selectedWeek)")

            // Convert picks to lineup players
            self.currentLineup = picks.compactMap { pick in
                allPlayers.first(where: { $0.id == pick.playerId })
            }
            print("DEBUG: Loaded \(self.currentLineup.count) players into currentLineup")

            // Store original state
            self.originalPickIds = Set(picks.map { $0.id.uuidString })
            self.originalLineup = currentLineup

            // Check lock status
            if selectedWeek < currentWeek {
                self.isLocked = true
                print("DEBUG: Week \(selectedWeek) is locked (past week)")
            } else if selectedWeek == currentWeek {
                self.isLocked = !(settingsResult.isWeekActive ?? true)
                print("DEBUG: Week \(selectedWeek) locked: \(self.isLocked)")
            } else {
                self.isLocked = false
                print("DEBUG: Week \(selectedWeek) is unlocked (future week)")
            }

            // Load live scores
            await loadLiveScores()

        } catch {
            print("ERROR loading data: \(error)")
            errorMessage = "Failed to load data: \(error.localizedDescription)"
            showError = true
        }

        isLoading = false
    }

    func loadLiveScores() async {
        do {
            let response = try await APIService.shared.getLiveScores(weekNumber: selectedWeek)

            var scoresMap: [String: LivePickScore] = [:]
            for pick in response.picks {
                scoresMap[pick.pickId] = pick
            }

            self.liveScores = scoresMap
            print("DEBUG: Loaded \(scoresMap.count) live scores for week \(selectedWeek)")
        } catch {
            print("Failed to load live scores: \(error)")
        }
    }

    func startAutoRefresh() {
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            Task { @MainActor in
                await self?.loadLiveScores()
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

    func addPlayer(_ player: Player) {
        let positionCount = playersForPosition(player.position).count
        let limit = limitFor(position: player.position)

        guard positionCount < limit else { return }

        currentLineup.append(player)
        checkForChanges()
    }

    func removePlayer(playerId: String, position: String) {
        // Find the corresponding pick
        guard let pick = picks.first(where: { $0.playerId == playerId && ($0.playerPosition ?? $0.position) == position }) else {
            // If no pick found, just remove from currentLineup (shouldn't happen in normal flow)
            currentLineup.removeAll { $0.id == playerId && $0.position == position }
            checkForChanges()
            return
        }

        Task {
            await removePlayer(pick: pick)
        }
    }

    func removePlayer(pick: Pick) async {
        guard let userId = userId else { return }

        do {
            // Delete from backend
            try await APIService.shared.deletePick(pickId: pick.id, userId: userId)

            // Remove from local arrays
            currentLineup.removeAll { $0.id == pick.playerId }
            picks.removeAll { $0.id == pick.id }

            checkForChanges()
        } catch {
            errorMessage = "Failed to remove player: \(error.localizedDescription)"
            showError = true
        }
    }

    func submitLineup() async {
        guard let userId = userId else { return }

        isSaving = true

        do {
            // Submit all current lineup players
            for player in currentLineup {
                try await APIService.shared.submitPick(
                    userId: userId,
                    playerId: player.id,
                    position: player.position,
                    weekNumber: selectedWeek
                )
            }

            // Update original state
            originalLineup = currentLineup
            hasChanges = false

            // Reload picks to get updated data with multipliers, etc.
            await loadData(userId: userId)

        } catch {
            errorMessage = "Failed to save lineup: \(error.localizedDescription)"
            showError = true
        }

        isSaving = false
    }

    private func checkForChanges() {
        let currentPlayerIds = Set(currentLineup.map { $0.id })
        let originalPlayerIds = Set(originalLineup.map { $0.id })
        hasChanges = currentPlayerIds != originalPlayerIds
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
