import SwiftUI
import Combine

struct PlayerSelectionView: View {
    @EnvironmentObject var authService: AuthService
    @StateObject private var viewModel = PlayerSelectionViewModel()

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // Week Selector
                WeekPickerView(selectedWeek: $viewModel.selectedWeek, currentWeek: viewModel.currentWeek)
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
                            // Position Sections
                            PositionSection(
                                position: "QB",
                                limit: viewModel.positionLimits.qb,
                                picks: viewModel.picksForPosition("QB"),
                                viewModel: viewModel
                            )
                            
                            PositionSection(
                                position: "RB",
                                limit: viewModel.positionLimits.rb,
                                picks: viewModel.picksForPosition("RB"),
                                viewModel: viewModel
                            )
                            
                            PositionSection(
                                position: "WR",
                                limit: viewModel.positionLimits.wr,
                                picks: viewModel.picksForPosition("WR"),
                                viewModel: viewModel
                            )
                            
                            PositionSection(
                                position: "TE",
                                limit: viewModel.positionLimits.te,
                                picks: viewModel.picksForPosition("TE"),
                                viewModel: viewModel
                            )
                            
                            PositionSection(
                                position: "K",
                                limit: viewModel.positionLimits.k,
                                picks: viewModel.picksForPosition("K"),
                                viewModel: viewModel
                            )
                            
                            PositionSection(
                                position: "DEF",
                                limit: viewModel.positionLimits.def,
                                picks: viewModel.picksForPosition("DEF"),
                                viewModel: viewModel
                            )
                        }
                    }
                    .padding()
                }
                
                // Submit Button
                if !viewModel.isLocked {
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
                        .background(viewModel.hasChanges ? Color.green : Color.gray)
                        .cornerRadius(DesignTokens.Radius.lg)
                    }
                    .disabled(!viewModel.hasChanges || viewModel.isSaving)
                    .padding()
                }
            }
            .navigationTitle("Pick Players")
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
            .alert("Error", isPresented: $viewModel.showError) {
                Button("OK", role: .cancel) { }
            } message: {
                Text(viewModel.errorMessage ?? "An error occurred")
            }
            .sheet(isPresented: $viewModel.showingPlayerPicker) {
                if let position = viewModel.selectedPosition {
                    PlayerPickerSheet(
                        position: position,
                        viewModel: viewModel
                    )
                }
            }
        }
    }
}

// MARK: - Week Picker
struct WeekPickerView: View {
    @Binding var selectedWeek: Int
    let currentWeek: Int

    var weeks: [(Int, String)] {
        [
            (16, "Wild Card"),
            (17, "Divisional"),
            (18, "Conference"),
            (19, "Super Bowl")
        ]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Playoff Week")
                .font(.caption)
                .foregroundColor(.secondary)

            Picker("Week", selection: $selectedWeek) {
                ForEach(weeks, id: \.0) { week in
                    Text(week.1).tag(week.0)
                }
            }
            .pickerStyle(.segmented)
        }
    }
}

// MARK: - Locked Banner
struct LockedBanner: View {
    var body: some View {
        HStack {
            Image(systemName: "lock.fill")
            Text("Lineup locked - previous round still in progress")
                .font(.subheadline)
        }
        .foregroundColor(.white)
        .padding()
        .frame(maxWidth: .infinity)
        .background(Color.orange)
    }
}

// MARK: - Position Section
struct PositionSection: View {
    let position: String
    let limit: Int
    let picks: [Player]
    @ObservedObject var viewModel: PlayerSelectionViewModel
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header
            HStack {
                Text(position)
                    .font(.headline)
                    .foregroundColor(.blue)
                
                Spacer()
                
                Text("\(picks.count)/\(limit)")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            
            // Player Slots Grid
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                // Filled slots
                ForEach(picks) { player in
                    PlayerSlotCard(player: player, viewModel: viewModel)
                }
                
                // Empty slots
                ForEach(0..<(limit - picks.count), id: \.self) { _ in
                    EmptySlotCard(position: position, viewModel: viewModel)
                }
            }
        }
        .padding()
        .background(DesignTokens.Color.Surface.card)
        .cornerRadius(DesignTokens.Radius.lg)
    }
}

// MARK: - Player Slot Card
struct PlayerSlotCard: View {
    let player: Player
    @ObservedObject var viewModel: PlayerSelectionViewModel
    @Environment(\.colorScheme) var colorScheme
    
    var body: some View {
        VStack(spacing: 8) {
            if !viewModel.isLocked {
                HStack {
                    Spacer()
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(.red)
                        .imageScale(.small)
                }
            }
            
            VStack(spacing: 6) {
                PlayerImageView(
                    imageUrl: player.imageUrl,
                    size: 50,
                    position: player.position
                )

                Text(player.fullName)
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundColor(.primary)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)

                Text(player.team ?? "FA")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
            .padding(.top, viewModel.isLocked ? 8 : 0)
        }
        .padding(10)
        .frame(maxWidth: .infinity)
        .background(colorScheme == .dark ? Color(.systemGray5) : Color.white)
        .cornerRadius(DesignTokens.Radius.md)
        .shadow(color: .black.opacity(0.1), radius: 2, x: 0, y: 1)
        .onTapGesture {
            if !viewModel.isLocked {
                viewModel.removePlayer(player)
            }
        }
    }
}

// MARK: - Empty Slot Card
struct EmptySlotCard: View {
    let position: String
    @ObservedObject var viewModel: PlayerSelectionViewModel
    @Environment(\.colorScheme) var colorScheme
    
    var body: some View {
        Button(action: {
            viewModel.openPlayerPicker(for: position)
        }) {
            VStack(spacing: 8) {
                Image(systemName: "plus.circle.fill")
                    .font(.title2)
                    .foregroundColor(.blue)
                
                Text("Add \(position)")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .padding()
            .frame(maxWidth: .infinity, minHeight: 80)
            .background(colorScheme == .dark ? Color(.systemGray5) : Color.white)
            .cornerRadius(DesignTokens.Radius.md)
            .overlay(
                RoundedRectangle(cornerRadius: DesignTokens.Radius.md)
                    .stroke(Color.blue.opacity(0.3), style: StrokeStyle(lineWidth: 1, dash: [5]))
            )
        }
        .disabled(viewModel.isLocked)
    }
}

// MARK: - Player Picker Sheet
struct PlayerPickerSheet: View {
    let position: String
    @ObservedObject var viewModel: PlayerSelectionViewModel
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
                        HStack {
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
class PlayerSelectionViewModel: ObservableObject {
    @Published var selectedWeek: Int = 10
    @Published var currentWeek: Int = 10
    @Published var playoffStartWeek: Int = 0
    @Published var allPlayers: [Player] = []
    @Published var currentLineup: [Player] = []
    @Published var positionLimits = PositionLimits()
    @Published var isLoading = false
    @Published var isSaving = false
    @Published var isLocked = false
    @Published var hasChanges = false
    @Published var showError = false
    @Published var errorMessage: String?
    @Published var showingPlayerPicker = false
    @Published var selectedPosition: String?
    
    private var userId: UUID?
    private var originalLineup: [Player] = []
    private var hasLoadedPlayersOnce = false
    
    init() {
        Task {
            await loadCurrentWeek()
            selectedWeek = currentWeek
        }
    }
    
    func loadCurrentWeek() async {
        do {
            let settings = try await APIService.shared.getSettings()
            currentWeek = settings.currentPlayoffWeek
            if selectedWeek == 10 {
                selectedWeek = currentWeek
            }
        } catch {
            print("Failed to load current week: \(error)")
            currentWeek = 10
        }
    }
    
    var availablePlayers: [Player] {
        allPlayers.filter { player in
            !currentLineup.contains(where: { $0.id == player.id })
        }
    }
    
    var isLineupComplete: Bool {
        picksForPosition("QB").count == positionLimits.qb &&
        picksForPosition("RB").count == positionLimits.rb &&
        picksForPosition("WR").count == positionLimits.wr &&
        picksForPosition("TE").count == positionLimits.te &&
        picksForPosition("K").count == positionLimits.k &&
        picksForPosition("DEF").count == positionLimits.def
    }
    
    func picksForPosition(_ position: String) -> [Player] {
        currentLineup.filter { $0.position == position }
    }
    
    func loadData(userId: UUID) async {
        self.userId = userId
        isLoading = true
        
        print("DEBUG: Loading data for week \(selectedWeek)")
        
        do {
            async let settings = APIService.shared.getSettings()
            async let picks = APIService.shared.getUserPicks(userId: userId)
            
            // Only load players if we haven't loaded them before
            if !hasLoadedPlayersOnce {
                do {
                    print("Loading players from API...")
                    let response = try await APIService.shared.getPlayers(limit: 500)
                    self.allPlayers = response.players
                    hasLoadedPlayersOnce = true
                    print("Loaded \(self.allPlayers.count) players")
                } catch let decodingError as DecodingError {
                    print("DECODE ERROR: \(decodingError)")
                    self.allPlayers = []
                } catch {
                    print("Failed to load players: \(error)")
                    self.allPlayers = []
                }
            } else {
                print("Using cached players (\(self.allPlayers.count) players)")
            }
            
            let (settingsResult, picksResult) = try await (settings, picks)
            
            print("DEBUG: Settings received - qbLimit: \(settingsResult.qbLimit ?? -1), rbLimit: \(settingsResult.rbLimit ?? -1), wrLimit: \(settingsResult.wrLimit ?? -1), teLimit: \(settingsResult.teLimit ?? -1), kLimit: \(settingsResult.kLimit ?? -1), defLimit: \(settingsResult.defLimit ?? -1)")
            print("DEBUG: currentPlayoffWeek from settings: \(settingsResult.currentPlayoffWeek)")

            // Wire playoffStartWeek from settings for effective week calculation
            self.playoffStartWeek = settingsResult.playoffStartWeek
            
            self.positionLimits = PositionLimits(
                qb: settingsResult.qbLimit ?? 1,
                rb: settingsResult.rbLimit ?? 2,
                wr: settingsResult.wrLimit ?? 3,
                te: settingsResult.teLimit ?? 1,
                k: settingsResult.kLimit ?? 1,
                def: settingsResult.defLimit ?? 1
            )
            
            print("DEBUG: Applied position limits - QB: \(self.positionLimits.qb), RB: \(self.positionLimits.rb), WR: \(self.positionLimits.wr), TE: \(self.positionLimits.te), K: \(self.positionLimits.k), DEF: \(self.positionLimits.def)")
            
            // DEBUG: Print all picks to see what we got
            print("DEBUG: Total picks received: \(picksResult.count)")
            print("DEBUG: Filtering for week: \(selectedWeek)")
            
            for pick in picksResult {
                print("DEBUG: Pick - weekNumber: \(pick.weekNumber), playerId: \(pick.playerId), position: \(pick.position)")
            }
            
            // Load current week's picks
            let weekPicks = picksResult.filter { $0.weekNumber == selectedWeek }
            print("DEBUG: Found \(weekPicks.count) picks for week \(selectedWeek)")
            
            self.currentLineup = weekPicks.compactMap { pick in
                let player = allPlayers.first(where: { $0.id == pick.playerId })
                if player == nil {
                    print("DEBUG: WARNING - Could not find player for pick playerId: \(pick.playerId)")
                }
                return player
            }
            print("DEBUG: Loaded \(self.currentLineup.count) players into currentLineup")
            
            self.originalLineup = currentLineup
            
            // Check if week is locked based on settings
            // Lock if: (1) viewing past weeks, or (2) current week is not active
            // Note: currentWeek is playoff round from backend (1-5, may skip Pro Bowl at 4)
            // selectedWeek is NFL week (e.g., 16-19 for playoff weeks)
            // Compute effective NFL week: playoffStartWeek + offset, capped at Super Bowl (offset 3)
            // This handles Pro Bowl skip where backend sends round 5 for Super Bowl
            let offset = min(currentWeek - 1, 3)  // Cap at 3 (Super Bowl is final tab)
            let effectiveCurrentWeek = playoffStartWeek + offset

            if selectedWeek < effectiveCurrentWeek {
                // Past weeks are always locked
                self.isLocked = true
                print("DEBUG: Week \(selectedWeek) is locked (past week, effective=\(effectiveCurrentWeek))")
            } else if selectedWeek == effectiveCurrentWeek {
                // Current week: check if active
                self.isLocked = !(settingsResult.isWeekActive ?? true)
                print("DEBUG: Week \(selectedWeek) locked status: \(self.isLocked) (isWeekActive: \(settingsResult.isWeekActive ?? true), effective=\(effectiveCurrentWeek))")
            } else {
                // Future weeks are read-only - users cannot add picks ahead of time
                self.isLocked = true
                print("DEBUG: Week \(selectedWeek) is locked (future week, effective=\(effectiveCurrentWeek))")
            }
            
        } catch {
            print("ERROR loading data: \(error)")
            errorMessage = "Failed to load data: \(error.localizedDescription)"
            showError = true
        }
        
        isLoading = false
    }
    
    func openPlayerPicker(for position: String) {
        selectedPosition = position
        showingPlayerPicker = true
    }
    
    func addPlayer(_ player: Player) {
        let positionCount = picksForPosition(player.position).count
        let limit = limitFor(position: player.position)
        
        guard positionCount < limit else { return }
        
        currentLineup.append(player)
        checkForChanges()
    }
    
    func removePlayer(_ player: Player) {
        currentLineup.removeAll { $0.id == player.id }
        checkForChanges()
    }
    
    func submitLineup() async {
        guard let userId = userId else { return }
        
        isSaving = true
        
        do {
            // Submit all picks in the current lineup
            // Compute effective NFL week for mutations
            // currentWeek is playoff round from backend (1-5, may skip Pro Bowl at 4)
            // Cap offset at 3 to handle Pro Bowl skip where backend sends round 5 for Super Bowl
            let offset = min(currentWeek - 1, 3)
            let effectiveWeek = playoffStartWeek + offset
            for player in currentLineup {
                try await APIService.shared.submitPick(
                    userId: userId,
                    playerId: player.id,
                    position: player.position,
                    weekNumber: effectiveWeek
                )
            }
            
            originalLineup = currentLineup
            hasChanges = false
            
        } catch {
            errorMessage = "Failed to save lineup: \(error.localizedDescription)"
            showError = true
        }
        
        isSaving = false
    }
    
    private func checkForChanges() {
        hasChanges = Set(currentLineup.map { $0.id }) != Set(originalLineup.map { $0.id })
    }
    
    private func limitFor(position: String) -> Int {
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
}

// MARK: - Position Limits
struct PositionLimits {
    var qb: Int = 1
    var rb: Int = 2
    var wr: Int = 3
    var te: Int = 1
    var k: Int = 1
    var def: Int = 1
}

#Preview {
    PlayerSelectionView()
        .environmentObject(AuthService())
}
