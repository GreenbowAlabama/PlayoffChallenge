//
//  AvailableContestsViewModel.swift
//  PlayoffChallenge
//
//  ViewModel for the Available Contests list.
//

import Combine
import Foundation

/// ViewModel for the Available Contests screen.
/// Loads and manages the list of joinable contests.
@MainActor
final class AvailableContestsViewModel: ObservableObject {

    // MARK: - Published State

    @Published private(set) var contests: [MockContest] = []
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?

    // MARK: - Dependencies

    private let joinedStore: JoinedContestsStore

    // MARK: - Initialization

    init(joinedStore: JoinedContestsStore? = nil) {
        self.joinedStore = joinedStore ?? JoinedContestsStore.shared
    }

    // MARK: - Computed Properties

    /// Returns only contests the user has not joined
    var unjoinedContests: [MockContest] {
        contests.filter { !$0.isJoined }
    }

    /// Returns contests the user has already joined
    var joinedContests: [MockContest] {
        contests.filter { $0.isJoined }
    }

    // MARK: - Actions

    func loadContests() async {
        isLoading = true
        errorMessage = nil

        // In a real app, this would make a network request.
        // For now, we'll just clear the contests to show an empty state.
        contests = []

        isLoading = false
    }

    func refresh() async {
        await loadContests()
    }

    /// Check if a specific contest has been joined
    func isContestJoined(_ contestId: UUID) -> Bool {
        joinedStore.isJoined(contestId: contestId)
    }
}
