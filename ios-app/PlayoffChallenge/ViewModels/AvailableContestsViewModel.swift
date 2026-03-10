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

    // MARK: - Load Guard

    private var hasLoaded = false

    // MARK: - Computed Properties

    /// All scheduled contests, sorted by lock time (upcoming first).
    /// Single source of truth for Home tab display.
    var scheduledContests: [Contest] {
        contests
            .filter { $0.status == .scheduled }
            .sorted { lhs, rhs in
                guard let l = lhs.lockTime, let r = rhs.lockTime else {
                    return false
                }
                return l < r
            }
    }

    // MARK: - Dependencies

    private let service: ContestServiceing
    private var authService: AuthService
    private var cancellables = Set<AnyCancellable>()

    // MARK: - Initialization

    init(service: ContestServiceing = CustomContestService(), authService: AuthService = .shared) {
        self.service = service
        self.authService = authService

        // Observe auth state changes and invalidate cache
        self.authService.$hasAuthStateChanged
            .sink { [weak self] _ in
                Task { @MainActor in
                    self?.resetCacheForNewAuth()
                    // Reload after cache reset
                    await self?.loadContests()
                }
            }
            .store(in: &cancellables)
    }

    private func resetCacheForNewAuth() {
        hasLoaded = false
        contests = []
        errorMessage = nil
    }

    // MARK: - Actions

    func loadContests(forceRefresh: Bool = false) async {
        // Guard 1: Prevent concurrent fetches
        guard !isLoading else {
            print("[AvailableContestsViewModel] Load already in progress, skipping duplicate")
            return
        }

        // Guard 2: Prevent duplicate initial load, unless forceRefresh is true
        guard forceRefresh || !hasLoaded else {
            print("[AvailableContestsViewModel] Already loaded and no forceRefresh requested")
            return
        }

        isLoading = true
        errorMessage = nil

        // CRITICAL: Always reset loading state, even on early return or cancellation
        defer {
            isLoading = false
        }

        do {
            let domainContests = try await service.fetchAvailableContests()
            print("[AvailableContestsViewModel] Loaded \(domainContests.count) domain objects from backend")

            // Use Domain objects directly. Always replace, never merge.
            // Backend handles filtering, capacity, sorting, and user_has_entered (via actions.isJoined if applicable).
            // Client does NOT filter, sort, or modify entry counts.
            contests = domainContests
            hasLoaded = true  // Set after successful fetch, not before

            print("[AvailableContestsViewModel] Loaded \(contests.count) Contest objects")
            for (index, contest) in contests.enumerated() {
                print("[AvailableContestsViewModel] Contest \(index): \(contest.contestName) (status: \(contest.status), entries: \(contest.entryCount))")
            }

            errorMessage = nil
        } catch {
            print("[AvailableContestsViewModel] ERROR loading contests: \(error)")

            // On pull-to-refresh, keep existing contests; on initial load, clear
            if !hasLoaded {
                contests = []
            }
            errorMessage = error.localizedDescription
        }
    }

    func refresh() async {
        await loadContests(forceRefresh: true)
    }
}
