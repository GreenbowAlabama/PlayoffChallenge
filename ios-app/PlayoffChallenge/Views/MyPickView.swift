import SwiftUI
import Combine

struct MyPicksView: View {
    @EnvironmentObject var authService: AuthService
    @StateObject private var viewModel = MyPicksViewModel()
    
    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // Week Selector
                WeekSelector(selectedWeek: $viewModel.selectedWeek, currentWeek: viewModel.currentWeek)
                    .padding()
                
                if viewModel.isLoading {
                    ProgressView("Loading lineup...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if viewModel.picks.isEmpty {
                    EmptyLineupView()
                } else {
                    ScrollView {
                        VStack(spacing: 16) {
                            // Week Summary Card (now with live stats)
                            WeekSummaryCard(
                                weekNumber: viewModel.selectedWeek,
                                totalPoints: viewModel.totalPoints,
                                isComplete: viewModel.isLineupComplete,
                                userId: viewModel.userId,
                                liveScores: viewModel.liveScores
                            )
                            
                            // Picks by Position
                            ForEach(["QB", "RB", "WR", "TE", "K", "DEF"], id: \.self) { position in
                                if let picks = viewModel.picksByPosition[position], !picks.isEmpty {
                                    PositionPicksSection(
                                        position: position,
                                        picks: picks,
                                        viewModel: viewModel
                                    )
                                }
                            }
                        }
                        .padding()
                    }
                }
            }
            .navigationTitle("My Picks")
            .task {
                if let userId = authService.currentUser?.id {
                    await viewModel.loadCurrentWeek()
                    await viewModel.loadPicks(userId: userId)
                    await viewModel.loadLiveScores()
                }
            }
            .refreshable {
                if let userId = authService.currentUser?.id {
                    await viewModel.loadPicks(userId: userId)
                    await viewModel.loadLiveScores()
                }
            }
            .onChange(of: viewModel.selectedWeek) { oldValue, newValue in
                if let userId = authService.currentUser?.id {
                    Task {
                        await viewModel.loadPicks(userId: userId)
                        await viewModel.loadLiveScores()
                    }
                }
            }
            .onAppear {
                viewModel.startAutoRefresh()
            }
            .onDisappear {
                viewModel.stopAutoRefresh()
            }
        }
    }
}

// MARK: - Week Selector
struct WeekSelector: View {
    @Binding var selectedWeek: Int
    let currentWeek: Int

    var body: some View {
        Picker("Week", selection: $selectedWeek) {
            Text("Wild Card").tag(16)
            Text("Divisional").tag(17)
            Text("Conference").tag(18)
            Text("Super Bowl").tag(19)
        }
        .pickerStyle(.segmented)
    }
}

// MARK: - Empty Lineup View
struct EmptyLineupView: View {
    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "person.3.fill")
                .font(.system(size: 60))
                .foregroundColor(.gray)
            
            Text("No Picks Yet")
                .font(.title2)
                .fontWeight(.bold)
            
            Text("Head to Pick Players to build your lineup")
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }
}

// MARK: - Week Summary Card (Enhanced with Live Scores)
struct WeekSummaryCard: View {
    let weekNumber: Int
    let totalPoints: Double
    let isComplete: Bool
    let userId: UUID?
    let liveScores: [String: LivePickScore]
    
    @State private var weekScores: [PlayerScore] = []
    @State private var isLoadingScores = false
    
    var actualTotalPoints: Double {
        // Prioritize live scores over stored scores
        if !liveScores.isEmpty {
            return liveScores.values.reduce(0) { $0 + $1.finalPoints }
        }
        return weekScores.reduce(0) { $0 + $1.finalPoints }
    }
    
    var hasLiveGames: Bool {
        liveScores.values.contains { $0.isLive }
    }
    
    var body: some View {
        VStack(spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text("Week \(weekNumber)")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        
                        // Live indicator
                        if hasLiveGames {
                            HStack(spacing: 3) {
                                Circle()
                                    .fill(Color.red)
                                    .frame(width: 6, height: 6)
                                Text("LIVE")
                                    .font(.system(size: 9, weight: .bold))
                                    .foregroundColor(.red)
                            }
                        }
                    }
                    
                    if isLoadingScores {
                        HStack(spacing: 8) {
                            ProgressView()
                                .scaleEffect(0.8)
                            Text("Loading scores...")
                                .font(.caption)
                                .foregroundColor(.gray)
                        }
                    } else if actualTotalPoints == 0 {
                        Text("No scores yet")
                            .font(.title3)
                            .foregroundColor(.gray)
                    } else {
                        Text("\(String(format: "%.1f", actualTotalPoints)) pts")
                            .font(.title)
                            .fontWeight(.bold)
                    }
                }
                
                Spacer()
                
                if isComplete {
                    HStack(spacing: 4) {
                        Image(systemName: "checkmark.circle.fill")
                        Text("Complete")
                    }
                    .font(.caption)
                    .foregroundColor(.green)
                } else {
                    HStack(spacing: 4) {
                        Image(systemName: "exclamationmark.circle.fill")
                        Text("Incomplete")
                    }
                    .font(.caption)
                    .foregroundColor(.orange)
                }
            }
        }
        .padding()
        .background(
            LinearGradient(
                gradient: Gradient(colors: [Color.blue.opacity(0.1), Color.purple.opacity(0.1)]),
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .cornerRadius(DesignTokens.Radius.lg)
        .task {
            await loadWeekScores()
        }
    }
    
    private func loadWeekScores() async {
        guard let userId = userId else { return }
        isLoadingScores = true
        
        do {
            weekScores = try await APIService.shared.getScores(userId: userId, weekNumber: weekNumber)
        } catch {
            print("Failed to load week scores: \(error)")
        }
        
        isLoadingScores = false
    }
}

// MARK: - Position Picks Section
struct PositionPicksSection: View {
    let position: String
    let picks: [Pick]
    @ObservedObject var viewModel: MyPicksViewModel
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(position)
                .font(.headline)
                .foregroundColor(.blue)
            
            ForEach(picks) { pick in
                PickRow(pick: pick, viewModel: viewModel)
            }
        }
    }
}

// MARK: - Pick Row (Enhanced with Live Scoring)
struct PickRow: View {
    let pick: Pick
    @ObservedObject var viewModel: MyPicksViewModel
    @State private var playerScore: PlayerScore?
    @State private var isLoadingScore = false
    @State private var showingDeleteAlert = false
    
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
    
    var body: some View {
        HStack(spacing: 12) {
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
            } else {
                // NO SCORE YET - show multiplier info
                VStack(alignment: .trailing, spacing: 4) {
                    if let multiplier = pick.multiplier, multiplier > 1.0 {
                        HStack(spacing: 4) {
                            Image(systemName: "flame.fill")
                                .foregroundColor(.orange)
                            Text(String(format: "%.1fx", multiplier))
                                .font(.caption)
                                .fontWeight(.bold)
                                .foregroundColor(.orange)
                        }
                    }
                    
                    if let consecutiveWeeks = pick.consecutiveWeeks, consecutiveWeeks > 0 {
                        Text("\(consecutiveWeeks) week\(consecutiveWeeks > 1 ? "s" : "")")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                    
                    // "No score yet" indicator
                    Text("Not scored")
                        .font(.caption2)
                        .foregroundColor(.gray)
                }
            }
            
            // Delete button (only for CURRENT week, not locked, and only if no score)
            // Users can only modify picks for the active playoff week
            if viewModel.selectedWeek == viewModel.currentWeek && !pick.locked && playerScore == nil && liveScore == nil {
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
        .background(DesignTokens.Color.Surface.card)
        .cornerRadius(DesignTokens.Radius.md)
        .task {
            // Load stored score for this pick (fallback if live not available)
            await loadScore()
        }
        .alert("Remove Player?", isPresented: $showingDeleteAlert) {
            Button("Cancel", role: .cancel) { }
            Button("Remove", role: .destructive) {
                Task {
                    await viewModel.deletePick(pick)
                }
            }
        } message: {
            Text("Are you sure you want to remove \(pick.fullName ?? "this player") from your Week \(viewModel.selectedWeek) lineup?")
        }
    }
    
    private func loadScore() async {
        guard let userId = viewModel.userId else { return }
        isLoadingScore = true
        
        do {
            let scores = try await APIService.shared.getScores(
                userId: userId,
                weekNumber: pick.weekNumber
            )
            
            // Find score for this specific player
            playerScore = scores.first { $0.playerId == pick.playerId }
        } catch {
            print("Failed to load score for \(pick.fullName ?? "player"): \(error)")
        }
        
        isLoadingScore = false
    }
}

// MARK: - View Model (Enhanced with Live Scoring)
@MainActor
class MyPicksViewModel: ObservableObject {
    @Published var picks: [Pick] = []
    @Published var selectedWeek: Int = 16
    @Published var isLoading = false
    @Published var currentWeek: Int = 10
    @Published var liveScores: [String: LivePickScore] = [:]
    
    private var positionLimits: (qb: Int, rb: Int, wr: Int, te: Int, k: Int, def: Int)?
    private var refreshTimer: Timer?
    private(set) var userId: UUID?
    
    var picksByPosition: [String: [Pick]] {
        Dictionary(grouping: picks) { $0.playerPosition ?? $0.position }
    }
    
    var totalPoints: Double {
        // Calculate from live scores if available, otherwise use stored scores
        if !liveScores.isEmpty {
            return liveScores.values.reduce(0) { $0 + $1.finalPoints }
        }
        return 0
    }
    
    init() {
        Task {
            await loadCurrentWeek()
            selectedWeek = currentWeek
        }
    }
    
    var isLineupComplete: Bool {
        guard let limits = positionLimits else { return false }
        let positionCounts = picksByPosition.mapValues { $0.count }
        return positionCounts["QB"] == limits.qb &&
               positionCounts["RB"] == limits.rb &&
               positionCounts["WR"] == limits.wr &&
               positionCounts["TE"] == limits.te &&
               positionCounts["K"] == limits.k &&
               positionCounts["DEF"] == limits.def
    }
    
    func loadPicks(userId: UUID) async {
        self.userId = userId
        isLoading = true
        
        do {
            // Load settings to get position limits
            let settings = try await APIService.shared.getSettings()
            self.positionLimits = (
                qb: settings.qbLimit ?? 1,
                rb: settings.rbLimit ?? 2,
                wr: settings.wrLimit ?? 2,
                te: settings.teLimit ?? 1,
                k: settings.kLimit ?? 1,
                def: settings.defLimit ?? 1
            )
            
            let allPicks = try await APIService.shared.getUserPicks(userId: userId)
            self.picks = allPicks.filter { $0.weekNumber == selectedWeek }
            print("DEBUG MyPicks: Loaded \(self.picks.count) picks for week \(selectedWeek)")
        } catch {
            print("Failed to load picks: \(error)")
        }
        
        isLoading = false
    }
    
    // Load live scores from backend using the correct endpoint
    func loadLiveScores() async {
        do {
            let response = try await APIService.shared.getLiveScores(weekNumber: selectedWeek)
            
            // Map by pickId for quick lookup
            var scoresMap: [String: LivePickScore] = [:]
            for pick in response.picks {
                scoresMap[pick.pickId] = pick
            }
            
            self.liveScores = scoresMap
            print("DEBUG MyPicks: Loaded \(scoresMap.count) live scores for week \(selectedWeek)")
        } catch {
            print("Failed to load live scores: \(error)")
        }
    }
    
    // Auto-refresh every 60 seconds
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
    
    func loadCurrentWeek() async {
        do {
            let settings = try await APIService.shared.getSettings()
            currentWeek = settings.currentPlayoffWeek
            
            // If selectedWeek hasn't been changed by user, default to current
            if selectedWeek == 10 {
                selectedWeek = currentWeek
            }
        } catch {
            print("Failed to load current week: \(error)")
            currentWeek = 10
        }
    }
    
    @discardableResult
    func deletePick(_ pick: Pick) async -> Bool {
        guard let userId = userId else { return false }
        
        do {
            // Call delete endpoint
            try await APIService.shared.deletePick(pickId: pick.id, userId: userId)
            
            // Remove from local array
            picks.removeAll { $0.id == pick.id }
            
            // Remove live score if present
            liveScores.removeValue(forKey: pick.id.uuidString)
            
            return true
        } catch {
            print("Failed to delete pick: \(error)")
            return false
        }
    }
}

// MARK: - Multiplier Badge
struct MultiplierBadge: View {
    let multiplier: Double

    var badgeColor: Color {
        switch multiplier {
        case 1.0:
            return .gray
        case 2.0:
            return .green
        case 3.0:
            return .blue
        case 4.0:
            return .purple
        default:
            return .gray
        }
    }

    var body: some View {
        Text(String(format: "%.0fx", multiplier))
            .font(.system(size: 11, weight: .bold))
            .foregroundColor(.white)
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(badgeColor)
            .cornerRadius(DesignTokens.Radius.sm)
    }
}

#Preview {
    MyPicksView()
        .environmentObject(AuthService())
}
