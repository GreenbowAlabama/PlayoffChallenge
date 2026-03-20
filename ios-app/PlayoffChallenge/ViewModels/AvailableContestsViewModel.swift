//
//  AvailableContestsViewModel.swift
//  PlayoffChallenge
//
//  ViewModel for the Available Contests list.
//

import Combine
import Foundation
import Core

/// Presentation state for available contests screen
/// Separates featured contest (marketing flag) from remaining contests
struct AvailableContestsScreenState {
    let featuredContest: Contest?
    let contests: [Contest]
}

/// ViewModel for the Available Contests screen.
/// Loads and manages the list of joinable contests from backend.
/// Backend is authoritative for filtering, capacity, sorting, and user_has_entered.
/// Resolves DTO presentation metadata (isPrimaryMarketing) into screen state.
@MainActor
final class AvailableContestsViewModel: ObservableObject {

    // MARK: - Published State

    @Published private(set) var screenState: AvailableContestsScreenState = AvailableContestsScreenState(featuredContest: nil, contests: [])

    /// For backward compatibility
    var contests: [Contest] {
        screenState.contests
    }
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
        screenState = AvailableContestsScreenState(featuredContest: nil, contests: [])
        errorMessage = nil
    }

    // MARK: - Actions

    func loadContests(forceRefresh: Bool = false) async {
        // Guard 0: Only load if authenticated
        guard authService.currentUser != nil else {
            // Not authenticated yet; silently skip. Will retry when auth becomes available.
            return
        }

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
            // Fetch DTOs and domain objects from service for presentation state derivation
            let (dtos, contests) = try await service.fetchAvailableContestsWithPresentationMetadata()
            print("[AvailableContestsViewModel] Loaded \(contests.count) domain objects from backend")

            // Derive presentation state from DTOs
            // Deterministic: when multiple marketing contests exist, select the one
            // with the latest startTime (fallback to createdAt if startTime is nil)
            let featuredDTO = dtos
                .filter { $0.isPrimaryMarketing == true }
                .sorted { lhs, rhs in
                    let lDate = lhs.startTime ?? lhs.createdAt
                    let rDate = rhs.startTime ?? rhs.createdAt
                    return lDate < rDate
                }
                .last
            let featuredContest = featuredDTO.map { Contest.from($0) }

            // Update screen state with featured and remaining contests
            screenState = AvailableContestsScreenState(
                featuredContest: featuredContest,
                contests: contests
            )
            hasLoaded = true  // Set after successful fetch, not before

            print("[AvailableContestsViewModel] Loaded \(contests.count) Contest objects")
            if let featured = featuredContest {
                print("[AvailableContestsViewModel] Featured: \(featured.contestName)")
            }
            for (index, contest) in contests.enumerated() {
                print("[AvailableContestsViewModel] Contest \(index): \(contest.contestName) (status: \(contest.status), entries: \(contest.entryCount))")
            }

            errorMessage = nil
        } catch {
            print("[AvailableContestsViewModel] ERROR loading contests: \(error)")

            // On pull-to-refresh, keep existing state; on initial load, clear
            if !hasLoaded {
                screenState = AvailableContestsScreenState(featuredContest: nil, contests: [])
            }
            errorMessage = error.localizedDescription
        }
    }

    func refresh() async {
        await loadContests(forceRefresh: true)
    }
}
