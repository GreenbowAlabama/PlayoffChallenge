//
//  ContestLeaderboardViewModel.swift
//  PlayoffChallenge
//
//  ViewModel for managing contest leaderboard state and participant tracking.
//  Uses LeaderboardResponseContract as the source of truth.
//

import Combine
import Foundation

/// ViewModel for Contest Leaderboard screen.
/// Manages leaderboard data from the authoritative backend contract.
@MainActor
final class ContestLeaderboardViewModel: ObservableObject {

    // MARK: - Published State

    @Published internal(set) var leaderboardContract: LeaderboardResponseContract?
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?

    // MARK: - Dependencies

    internal let contestId: UUID
    private let fetcher: ContestDetailFetching

    // MARK: - Initialization

    init(
        contestId: UUID,
        fetcher: ContestDetailFetching? = nil
    ) {
        self.contestId = contestId
        self.fetcher = fetcher ?? ContestDetailService()
    }

    // MARK: - Computed Properties

    var leaderboardState: LeaderboardState? {
        leaderboardContract?.leaderboard_state
    }

    var columnSchema: [LeaderboardColumnSchema] {
        leaderboardContract?.column_schema ?? []
    }

    var rows: [LeaderboardRow] {
        leaderboardContract?.rows ?? []
    }

    var isPending: Bool {
        leaderboardState == .pending
    }

    var isComputed: Bool {
        leaderboardState == .computed
    }

    var hasError: Bool {
        leaderboardState == .error
    }

    var isEmpty: Bool {
        isComputed && rows.isEmpty
    }

    // MARK: - Actions

    func loadLeaderboard() async {
        isLoading = true
        errorMessage = nil

        do {
            let contract = try await fetcher.fetchLeaderboard(contestId: contestId)
            leaderboardContract = contract
        } catch {
            errorMessage = error.localizedDescription
            print("ContestLeaderboardViewModel: fetch failed — \(error.localizedDescription)")
        }

        isLoading = false
    }

    func refresh() async {
        await loadLeaderboard()
    }
}
