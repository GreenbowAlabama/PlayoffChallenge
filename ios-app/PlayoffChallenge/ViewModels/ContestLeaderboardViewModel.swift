//
//  ContestLeaderboardViewModel.swift
//  PlayoffChallenge
//
//  ViewModel for managing contest leaderboard state and participant tracking.
//  Uses LeaderboardResponseContract as the source of truth.
//

import Combine
import Foundation
import Core

/// ViewModel for Contest Leaderboard screen.
/// Manages leaderboard data from the authoritative backend contract.
///
/// SNAPSHOT IMMUTABILITY CONTRACT:
/// - LIVE leaderboards: Dynamic standings (refresh-capable, mutable)
/// - COMPLETE leaderboards: Frozen settlement standings (single-fetch-only, immutable)
/// - leaderboard_state=computed indicates final settlement
/// - COMPLETE leaderboards will not refresh; treated as authoritative settlement record
@MainActor
final class ContestLeaderboardViewModel: ObservableObject {

    // MARK: - Published State

    @Published internal(set) var leaderboard: Leaderboard?
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?

    // MARK: - Dependencies

    internal let contestId: UUID
    private let fetcher: ContestDetailFetching
    private let contestStatus: ContestStatus  // Injected to determine immutability
    private var currentUserId: UUID?

    // MARK: - Initialization

    init(
        contestId: UUID,
        status: ContestStatus = .scheduled,
        fetcher: ContestDetailFetching? = nil
    ) {
        self.contestId = contestId
        self.contestStatus = status
        self.fetcher = fetcher ?? ContestDetailService()
    }

    /// Configure the user ID for leaderboard fetches.
    /// Called from parent View with fresh authService.currentUser?.id.
    func configure(currentUserId: UUID?) {
        self.currentUserId = currentUserId
    }

    // MARK: - Computed Properties

    var leaderboardState: LeaderboardComputationState? {
        leaderboard?.state
    }

    var columns: [LeaderboardColumn] {
        leaderboard?.columns ?? []
    }

    var rows: [Standing] {
        leaderboard?.rows ?? []
    }

    var isPending: Bool {
        leaderboardState == .pending
    }

    var isComputed: Bool {
        leaderboardState == .computed
    }

    var hasError: Bool {
        errorMessage != nil || leaderboardState == .error
    }

    var hasUnknownState: Bool {
        leaderboardState == .unknown || (leaderboard == nil && !isLoading && errorMessage == nil)
    }

    var isEmpty: Bool {
        isComputed && rows.isEmpty
    }

    // MARK: - Actions

    func loadLeaderboard() async {
        isLoading = true
        errorMessage = nil

        do {
            // Pass currentUserId explicitly — set via configure() from View
            let fetched = try await fetcher.fetchLeaderboard(
                contestId: contestId,
                userId: currentUserId
            )
            leaderboard = fetched
        } catch {
            errorMessage = error.localizedDescription
            print("ContestLeaderboardViewModel: fetch failed — \(error.localizedDescription)")
        }

        isLoading = false
    }

    func refresh() async {
        // IMMUTABILITY ENFORCEMENT: COMPLETE leaderboards are frozen.
        // Do not refresh; settlement snapshot is authoritative and immutable.
        guard contestStatus != .complete else {
            print("ContestLeaderboardViewModel: Refresh blocked for COMPLETE contest (settlement is immutable)")
            return
        }

        await loadLeaderboard()
    }
}
