//
//  AvailableContestsViewModel.swift
//  PlayoffChallenge
//
//  ViewModel for the Available Contests list.
//

import Combine
import Foundation
import Core

/// ViewModel for the Available Contests screen.
/// Loads and manages the list of joinable contests from backend.
/// Backend is authoritative for filtering, capacity, sorting, and user_has_entered.
@MainActor
final class AvailableContestsViewModel: ObservableObject {

    // MARK: - Published State

    @Published private(set) var contests: [Contest] = []
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?

    // MARK: - Dependencies

    private let service: ContestServiceing

    // MARK: - Initialization

    init(service: ContestServiceing = CustomContestService()) {
        self.service = service
    }

    // MARK: - Actions

    func loadContests() async {
        isLoading = true
        errorMessage = nil

        do {
            let domainContests = try await service.fetchAvailableContests()
            print("[AvailableContestsViewModel] Loaded \(domainContests.count) domain objects from backend")

            // Use Domain objects directly.
            // Backend handles filtering, capacity, sorting, and user_has_entered (via actions.isJoined if applicable).
            // Client does NOT filter, sort, or modify entry counts.
            contests = domainContests

            print("[AvailableContestsViewModel] Loaded \(contests.count) Contest objects")
            for (index, contest) in contests.enumerated() {
                print("[AvailableContestsViewModel] Contest \(index): \(contest.contestName) (status: \(contest.status), entries: \(contest.entryCount))")
            }

            errorMessage = nil
        } catch {
            print("[AvailableContestsViewModel] ERROR loading contests: \(error)")
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }

    func refresh() async {
        await loadContests()
    }
}
