//
//  LineupViewModel.swift
//  PlayoffChallenge
//
//  ViewModel for managing lineup state with contest lifecycle enforcement.
//  Always fetches contest detail from backend by contestId.
//  Enforces editing permissions based on contest.status:
//  - SCHEDULED: editing enabled
//  - LOCKED: editing disabled, lineup visible
//  - LIVE: read-only
//  - COMPLETE: read-only
//

import Combine
import Foundation
import Core

/// ViewModel for Lineup screen.
/// Manages both contest state and lineup/picks state.
/// Sole owner of lineup-related mutations.
@MainActor
final class LineupViewModel: ObservableObject {

    // MARK: - Published State: Contest
    // GOVERNANCE: Contest state is authoritative from placeholder (passed from ContestDetailView).
    // Contest contains status for lifecycle enforcement (SCHEDULED, LOCKED, LIVE, COMPLETE).
    // Lineup operations are independent of contest refresh.

    @Published private(set) var contest: Contest

    // MARK: - Published State: Lineup

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

    // MARK: - Dependencies

    let contestId: UUID
    private var currentUserId: UUID?
    private(set) var userId: UUID?
    private var hasLoadedPlayersOnce = false
    private var refreshTimer: Timer?

    // MARK: - Initialization

    init(
        contestId: UUID,
        placeholder: Contest? = nil
    ) {
        self.contestId = contestId

        // Use placeholder if provided, otherwise create a minimal loading state
        // GOVERNANCE: Contest state is authoritative from placeholder.
        // LineupViewModel does not fetch contest details; caller provides them.
        let initial = placeholder ?? Contest.stub(
            id: contestId,
            contestName: "Loading…",
            status: .scheduled
        )
        self.contest = initial

        Task {
            await loadCurrentWeek()
        }
    }

    // MARK: - Lifecycle Enforcement

    /// Whether the user can edit the lineup.
    /// Gated by contest status:
    /// - SCHEDULED: editing enabled
    /// - LOCKED: editing disabled
    /// - LIVE: read-only
    /// - COMPLETE: read-only
    var canEditLineup: Bool {
        switch contest.status {
        case .scheduled:
            return true
        case .locked, .live, .complete, .cancelled, .error:
            return false
        }
    }

    /// Configure the user ID for lineup operations.
    /// Called from LineupView.onAppear() with fresh authService.currentUser?.id.
    func configure(currentUserId: UUID?) {
        self.currentUserId = currentUserId
    }

    // MARK: - Lineup Data Loading

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
