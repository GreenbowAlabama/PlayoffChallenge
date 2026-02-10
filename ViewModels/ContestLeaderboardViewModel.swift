//
//  ContestLeaderboardViewModel.swift
//  PlayoffChallenge
//
//  ViewModel for managing contest leaderboard state and participant tracking.
//

import Combine
import Foundation

/// Protocol for leaderboard data source to enable testing
@MainActor
protocol LeaderboardDataProviding {
    func getEntries(for contestId: UUID) async -> [MockLeaderboardEntry]
    func getCurrentUserEntry(contestId: UUID, username: String) -> MockLeaderboardEntry?
}

/// Default implementation that uses JoinedContestsStore and mock data
@MainActor
struct DefaultLeaderboardDataProvider: LeaderboardDataProviding {
    private let joinedStore: JoinedContestsStore

    init(joinedStore: JoinedContestsStore? = nil) {
        self.joinedStore = joinedStore ?? JoinedContestsStore.shared
    }

    func getEntries(for contestId: UUID) async -> [MockLeaderboardEntry] {
        // In a real app, this would make a network request to fetch leaderboard entries.
        // For now, we'll just return an empty array to show an empty state.
        return []
    }

    func getCurrentUserEntry(contestId: UUID, username: String) -> MockLeaderboardEntry? {
        // In a real app, this would fetch the current user's entry from the backend.
        // For now, we'll just return nil to show an empty state.
        return nil
    }
}

/// ViewModel for Contest Leaderboard screen.
/// Manages leaderboard entries and ensures joined users appear in the list.
@MainActor
final class ContestLeaderboardViewModel: ObservableObject {

    // MARK: - Published State

    @Published private(set) var entries: [MockLeaderboardEntry] = []
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var currentUserRank: Int?

    // MARK: - Dependencies

    private let contest: MockContest
    private let dataProvider: LeaderboardDataProviding
    private let joinedStore: JoinedContestsStore
    private var currentUsername: String

    // MARK: - Initialization

    init(
        contest: MockContest,
        dataProvider: LeaderboardDataProviding? = nil,
        joinedStore: JoinedContestsStore? = nil,
        currentUsername: String = "You"
    ) {
        self.contest = contest
        self.joinedStore = joinedStore ?? JoinedContestsStore.shared
        self.dataProvider = dataProvider ?? DefaultLeaderboardDataProvider(joinedStore: self.joinedStore)
        self.currentUsername = currentUsername
    }

    // MARK: - Computed Properties

    var contestName: String {
        contest.name
    }

    var contestId: UUID {
        contest.id
    }

    var isCurrentUserOnLeaderboard: Bool {
        entries.contains { $0.username == currentUsername }
    }

    // MARK: - Configuration

    /// Configure the actual username (called from view after EnvironmentObject is available)
    func configure(currentUsername: String) {
        self.currentUsername = currentUsername
    }

    // MARK: - Actions

    func loadLeaderboard() async {
        isLoading = true
        errorMessage = nil

        var loadedEntries = await dataProvider.getEntries(for: contest.id)

        // Replace placeholder "You" entries with actual username
        loadedEntries = loadedEntries.map { entry in
            if entry.username == "You" && currentUsername != "You" {
                return MockLeaderboardEntry(
                    id: entry.id,
                    username: currentUsername,
                    teamName: entry.teamName,
                    totalPoints: entry.totalPoints
                )
            }
            return entry
        }

        // Sort by total points (descending)
        loadedEntries.sort { $0.totalPoints > $1.totalPoints }

        entries = loadedEntries

        // Find current user's rank
        if let userIndex = entries.firstIndex(where: { $0.username == currentUsername }) {
            currentUserRank = userIndex + 1
        } else {
            currentUserRank = nil
        }

        isLoading = false
    }

    func refresh() async {
        await loadLeaderboard()
    }

    /// Add current user to leaderboard after joining
    /// Called when a user joins the contest from ContestDetailView
    func addCurrentUserIfJoined() {
        guard joinedStore.isJoined(contestId: contest.id) else { return }
        guard !isCurrentUserOnLeaderboard else { return }

        let userEntry = MockLeaderboardEntry(
            id: UUID(),
            username: currentUsername,
            teamName: nil,
            totalPoints: 0.0
        )

        entries.append(userEntry)
        entries.sort { $0.totalPoints > $1.totalPoints }

        if let userIndex = entries.firstIndex(where: { $0.username == currentUsername }) {
            currentUserRank = userIndex + 1
        }
    }
}
