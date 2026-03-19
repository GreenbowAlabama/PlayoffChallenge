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

    // MARK: - Constants
    private let golfPosition = "G"

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

    // INTENT TRACKING: Server-backed baseline for detecting intentional regression
    // Updated on load and after successful save
    // Used to compare: if currentCount < lastSavedCount → user intentionally removed players
    @Published private(set) var lastSavedPlayerIds: [String] = []

    // Available players for selection (loaded once)
    @Published var allPlayers: [Player] = []

    @Published var isLoading = false
    @Published var isSaving = false
    @Published var isLocked = false
    @Published var showError = false
    @Published var errorMessage: String?
    @Published var showingPlayerPicker = false
    @Published var selectedPosition: String?

    // PGA: Lineup size from contest rosterConfig
    var lineupSize: Int {
        contest.rosterConfig?.lineupSize ?? 7
    }

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
        if contest.sport == .golf {
            // GOLF: Complete when all golfer slots are filled
            return slots.filter { !$0.isEmpty }.count == lineupSize
        }
        // NFL: Complete when all positions have required count
        return filledCountForPosition("QB") == positionLimits.qb &&
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
        case "G": return positionLimits.golf
        default: return 0
        }
    }

    // MARK: - Helpers

    /// Create an empty golf slot (no player selected)
    private func makeEmptySlot() -> PickV2Slot {
        PickV2Slot(
            pickId: nil,
            playerId: nil,
            position: golfPosition,
            fullName: nil,
            team: nil,
            sleeperId: nil,
            imageUrl: nil,
            locked: false,
            multiplier: nil,
            consecutiveWeeks: nil,
            basePoints: nil,
            finalPoints: nil,
            isLive: nil,
            gameStatus: nil,
            opponent: nil,
            isHome: nil
        )
    }

    // MARK: - Lineup Data Loading

    // V2: Load data using /api/picks/v2 as single source of truth
    func loadData(userId: UUID) async {
        self.userId = userId
        print("[MYLINEUP][vm] loadData start contestId=\(contestId) userId=\(userId)")
        isLoading = true
        print("[MYLINEUP][vm] isLoading=true")

        // DEFENSIVE ROUTING: Log sport to catch routing bugs
        print("contest.sport = \(contest.sport.rawValue)")

        // GOVERNANCE: GOLF contests do not use NFL week logic.
        // Use /api/custom-contests/{id}/my-entry to load user's picks.
        if contest.sport == .golf {
            print("Loading GOLF entry")
            do {
                // Load user's entry and contest context from /api/custom-contests/{id}/my-entry
                print("[MYLINEUP][vm] calling getMyEntry for GOLF contest")
                let entryResponse = try await APIService.shared.getMyEntry(contestId: contestId)
                print("[MYLINEUP][vm] myEntry OK canEdit=\(entryResponse.canEdit) playerIds=\(entryResponse.playerIds.count) avail=\(entryResponse.availablePlayers?.count ?? 0)")

                // Extract lineup size from rosterConfig dictionary with numeric decoding
                guard
                    let lineupSizeValue = entryResponse.rosterConfig["lineup_size"]
                else {
                    throw APIError.decodingError
                }

                let rawValue: Any = lineupSizeValue.value

                let lineupSize: Int

                if let v = rawValue as? Int {
                    lineupSize = v
                } else if let v = rawValue as? Double {
                    lineupSize = Int(v)
                } else {
                    throw APIError.decodingError
                }

                print("[MYLINEUP][vm] lineupSize=\(lineupSize)")

                // INTENT TRACKING: Store server-backed baseline for regression detection
                // This is what user last successfully saved on server
                self.lastSavedPlayerIds = entryResponse.playerIds
                print("[MYLINEUP][vm] lastSavedPlayerIds updated to: \(entryResponse.playerIds.count) players")

                // DEBUG: Log API response
                print("MY_ENTRY roster_size:", lineupSize)
                print("MY_ENTRY player_ids:", entryResponse.playerIds)
                print("MY_ENTRY available_players_count:", entryResponse.availablePlayers?.count ?? 0)

                // Convert PlayerInfoContract → Player domain model
                let availablePlayers = entryResponse.availablePlayers ?? []

                // DEBUG: Log actual player IDs from API response
                let firstPlayerIds = availablePlayers.prefix(5).map { $0.playerId }
                print("[DEBUG][PGA] first player ids from API:", firstPlayerIds)

                var playersById: [String: Player] = [:]

                var withImages = 0
                for playerInfo in availablePlayers {
                    if playerInfo.imageUrl != nil {
                        withImages += 1
                    }
                    let player = Player(
                        id: playerInfo.playerId,
                        sleeperId: nil,
                        fullName: playerInfo.name,
                        position: golfPosition,
                        team: nil,
                        isActive: true,
                        gameTime: nil,
                        imageUrl: playerInfo.imageUrl
                    )
                    playersById[playerInfo.playerId] = player
                }
                print("[MYLINEUP][vm] Player image URLs: \(withImages)/\(availablePlayers.count) have imageUrl set")

                print("[MYLINEUP][vm] playersById=\(playersById.count)")

                // Preserve backend ordering by mapping availablePlayers
                self.allPlayers = availablePlayers.compactMap { playersById[$0.playerId] }
                hasLoadedPlayersOnce = true

                print("[MYLINEUP][vm] allPlayers set count=\(self.allPlayers.count) hasLoadedPlayersOnce=\(hasLoadedPlayersOnce)")

                // DEBUG: Log mapping results
                print("LINEUP players loaded:", self.allPlayers.count)

                // Pre-allocate slots based on lineup size
                var loadedSlots: [PickV2Slot] = []

                for index in 0..<lineupSize {
                    if index < entryResponse.playerIds.count {
                        let playerId = entryResponse.playerIds[index]
                        if let player = playersById[playerId] {
                            let slot = PickV2Slot(
                                pickId: nil,
                                playerId: playerId,
                                position: golfPosition,
                                fullName: player.fullName,
                                team: player.team,
                                sleeperId: player.sleeperId,
                                imageUrl: player.imageUrl,
                                locked: false,
                                multiplier: nil,
                                consecutiveWeeks: nil,
                                basePoints: nil,
                                finalPoints: nil,
                                isLive: nil,
                                gameStatus: nil,
                                opponent: nil,
                                isHome: nil
                            )
                            loadedSlots.append(slot)
                        } else {
                            loadedSlots.append(makeEmptySlot())
                        }
                    } else {
                        loadedSlots.append(makeEmptySlot())
                    }
                }

                self.slots = loadedSlots

                print("[MYLINEUP][vm] slots created=\(loadedSlots.count)")
                print("[MYLINEUP][vm] slots set count=\(self.slots.count)")

                // DEBUG: Log slot creation
                print("LINEUP slots created:", loadedSlots.count)

                // Set edit capability from entry response
                self.isLocked = !entryResponse.canEdit
                print("[MYLINEUP][vm] done isLocked=\(self.isLocked) isLoading=\(self.isLoading) showError=\(self.showError)")

            } catch {
                if error is CancellationError || (error as? URLError)?.code == .cancelled {
                    print("[MYLINEUP][vm] CANCELLED")
                    isLoading = false
                    return
                }
                print("[MYLINEUP][vm] ERROR \(error)")
                errorMessage = "Failed to load lineup: \(error.localizedDescription)"
                showError = true
            }

            isLoading = false
            print("[MYLINEUP][vm] isLoading=false")
            return
        }

        // DEFENSIVE GUARD: Reject unknown sports (never fallback to NFL)
        guard contest.sport != .unknown else {
            errorMessage = "Failed to load data: Unknown contest sport '\(contest.sport.rawValue)'"
            showError = true
            isLoading = false
            return
        }

        // NFL: Use existing week-based logic
        print("Loading NFL lineup")
        print("DEBUG: Loading v2 data for week \(selectedWeek)")

        do {
            // Load settings for lock status
            let settings = try await APIService.shared.getSettings()

            // Only load players once (for player picker)
            if !hasLoadedPlayersOnce {
                do {
                    print("Loading NFL players from /api/players...")
                    let response = try await APIService.shared.getPlayers(sport: "NFL", limit: 500)
                    self.allPlayers = response.players
                    hasLoadedPlayersOnce = true
                    print("DEBUG: loaded players count = \(self.allPlayers.count)")
                    print("DEBUG: player positions = \(Set(self.allPlayers.map { $0.position }))")
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

    // V2: Add player via operation-based API (NFL) or local state (PGA)
    func addPlayer(_ player: Player) async {
        guard let userId = userId else { return }
        guard let position = player.position else { return }

        let positionCount = filledCountForPosition(position)
        let limit = limitFor(position: position)

        guard positionCount < limit else { return }

        // GOLF: Add player to local state only
        // Do NOT submit automatically. Let user explicitly save via save button.
        if contest.sport == .golf {
            // Find first empty slot and fill it with new player
            if let emptyIndex = slots.firstIndex(where: { $0.isEmpty }) {
                let filledSlot = PickV2Slot(
                    pickId: nil,
                    playerId: player.id,
                    position: golfPosition,
                    fullName: player.fullName,
                    team: player.team,
                    sleeperId: player.sleeperId,
                    imageUrl: player.imageUrl,
                    locked: false,
                    multiplier: nil,
                    consecutiveWeeks: nil,
                    basePoints: nil,
                    finalPoints: nil,
                    isLive: nil,
                    gameStatus: nil,
                    opponent: nil,
                    isHome: nil
                )
                slots[emptyIndex] = filledSlot
            }

            // SAFETY LOG: Show how many players are currently selected
            let selectedCount = slots.filter { !$0.isEmpty }.count
            print("SUBMIT ROSTER COUNT: \(selectedCount) (not auto-submitting)")
            return
        }

        // NFL: Add player via API
        isSaving = true

        do {
            // Compute effective NFL week for mutations
            // currentWeek is playoff round from backend (1-5, may skip Pro Bowl at 4)
            // Cap offset at 3 to handle Pro Bowl skip where backend sends round 5 for Super Bowl
            let offset = min(currentWeek - 1, 3)
            let effectiveWeek = playoffStartWeek + offset
            let _ = try await APIService.shared.addPickV2(
                contestInstanceId: contestId,
                userId: userId,
                weekNumber: effectiveWeek,
                playerId: player.id,
                position: position
            )

            // Reload to get updated state
            await loadData(userId: userId)

        } catch {
            errorMessage = "Failed to add player: \(error.localizedDescription)"
            showError = true
        }

        isSaving = false
    }

    // V2: Remove player via operation-based API (NFL) or local state (PGA)
    func removeSlot(_ slot: PickV2Slot) async {
        guard let userId = userId else { return }

        // GOLF: Remove player from local state only
        // Do NOT submit automatically. Let user explicitly save via save button.
        if contest.sport == .golf {
            if let slotIndex = slots.firstIndex(where: { $0.id == slot.id }) {
                let clearedSlot = PickV2Slot(
                    pickId: slots[slotIndex].pickId,
                    playerId: nil,
                    position: slots[slotIndex].position,
                    fullName: nil,
                    team: nil,
                    sleeperId: nil,
                    imageUrl: nil,
                    locked: slots[slotIndex].locked,
                    multiplier: slots[slotIndex].multiplier,
                    consecutiveWeeks: slots[slotIndex].consecutiveWeeks,
                    basePoints: slots[slotIndex].basePoints,
                    finalPoints: slots[slotIndex].finalPoints,
                    isLive: slots[slotIndex].isLive,
                    gameStatus: slots[slotIndex].gameStatus,
                    opponent: slots[slotIndex].opponent,
                    isHome: slots[slotIndex].isHome
                )
                slots[slotIndex] = clearedSlot
            }

            // SAFETY LOG: Show how many players are currently selected
            let selectedCount = slots.filter { !$0.isEmpty }.count
            print("SUBMIT ROSTER COUNT: \(selectedCount) (not auto-submitting)")
            return
        }

        // NFL: Remove player via API
        guard let pickId = slot.pickId else { return }

        isSaving = true

        do {
            // Compute effective NFL week for mutations
            // currentWeek is playoff round from backend (1-5, may skip Pro Bowl at 4)
            // Cap offset at 3 to handle Pro Bowl skip where backend sends round 5 for Super Bowl
            let offset = min(currentWeek - 1, 3)
            let effectiveWeek = playoffStartWeek + offset
            let _ = try await APIService.shared.removePickV2(
                contestInstanceId: contestId,
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

    /// Submit all PGA picks to the backend.
    /// Called explicitly by user via "Save Lineup" button only.
    /// Never automatic.
    ///
    /// INTENT TRACKING:
    /// Compares currentCount vs lastSavedCount (server baseline)
    /// Only allows regression if user explicitly reduced from last saved state
    func submitPGAPicks() async {
        isSaving = true

        do {
            // Collect all player IDs from filled slots
            let playerIds = slots
                .filter { !$0.isEmpty }
                .compactMap { $0.playerId }

            let currentCount = playerIds.count
            let lastSavedCount = lastSavedPlayerIds.count

            // SAFETY LOG: Always log submission and intent
            print("SUBMIT ROSTER COUNT: \(currentCount)")
            print("[PGA][submit] player_ids: \(playerIds)")
            print("[PGA][submit] count: \(currentCount)")
            print("[MYLINEUP][submitPGAPicks] submitting \(currentCount) picks")

            // INTENT TRACKING: Detect if user explicitly reduced roster
            // Compare current count vs LAST SAVED count (not current UI state)
            // This is the ground truth for what user last successfully saved on server
            let allowRegression = currentCount < lastSavedCount

            if allowRegression {
                print("[PGA][submit] User explicitly reduced roster from last saved \(lastSavedCount) to \(currentCount)")
            } else if currentCount >= lastSavedCount {
                print("[PGA][submit] User maintained or increased roster from last saved \(lastSavedCount) to \(currentCount)")
            }

            let response = try await APIService.shared.submitPicks(
                contestId: contestId,
                playerIds: playerIds,
                allowRegression: allowRegression
            )

            // UPDATE BASELINE: Store new saved state from server response
            // This becomes the baseline for next comparison
            self.lastSavedPlayerIds = response.playerIds
            print("[MYLINEUP][submitPGAPicks] baseline updated to: \(response.playerIds.count) players")

            print("[MYLINEUP][submitPGAPicks] success, updated_at=\(response.updatedAt)")

            // Show success feedback briefly
            errorMessage = "Lineup saved!"
            showError = false

        } catch APIError.serverError(let message) where message.contains("409") {
            print("[PGA][submit] Conflict → retrying once")

            // STEP 1: Refresh from server
            if let userId = currentUserId {
                await loadData(userId: userId)

                do {
                    // STEP 2: Retry with fresh baseline
                    let retryPlayerIds = slots
                        .filter { !$0.isEmpty }
                        .compactMap { $0.playerId }

                    let retryAllowRegression = retryPlayerIds.count < lastSavedPlayerIds.count

                    let retryResponse = try await APIService.shared.submitPicks(
                        contestId: contestId,
                        playerIds: retryPlayerIds,
                        allowRegression: retryAllowRegression
                    )

                    self.lastSavedPlayerIds = retryResponse.playerIds
                    errorMessage = "Lineup saved!"
                    showError = false
                    print("[MYLINEUP][submitPGAPicks] success on retry")

                } catch {
                    print("[PGA][submit] retry failed: \(error)")
                    errorMessage = "Failed to save lineup after retry: \(error.localizedDescription)"
                    showError = true
                }
            }

        } catch {
            print("[PGA][submit] error: \(error)")
            errorMessage = "Failed to save lineup: \(error.localizedDescription)"
            showError = true
            print("[MYLINEUP][submitPGAPicks] error: \(error)")
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
    var golf: Int = 7
}
