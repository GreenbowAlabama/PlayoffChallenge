//
//  HomeTabViewModel.swift
//  PlayoffChallenge
//
//  Composition layer for the Home tab.
//  Organizes contests into featured, active, and open sections.
//  Pure composition: no fetching, no mutations, only filtering and organization.
//

import Combine
import Foundation
import Core

/// ViewModel for the Home tab.
/// Composes data from AvailableContestsViewModel and MyContestsViewModel.
/// Provides organized contest sections for display: featured, my active, and open.
@MainActor
final class HomeTabViewModel: ObservableObject {

    // MARK: - Published State

    @Published private(set) var featuredContests: [Contest] = []
    @Published private(set) var myActiveContests: [Contest] = []
    @Published private(set) var openContests: [Contest] = []
    @Published private(set) var isLoading = false

    // MARK: - Computed Properties

    var hasFeaturedContests: Bool { !featuredContests.isEmpty }
    var hasActiveContests: Bool { !myActiveContests.isEmpty }
    var hasOpenContests: Bool { !openContests.isEmpty }
    var hasAnyContent: Bool { hasFeaturedContests || hasActiveContests || hasOpenContests }

    // MARK: - Data Organization

    /// Updates home tab sections from available and my contests.
    /// Pure filtering function: no state mutation, no side effects.
    /// - Parameters:
    ///   - available: Contests from AvailableContestsViewModel
    ///   - myContests: Contests from MyContestsViewModel
    func updateSections(from available: [Contest], and myContests: [Contest]) {
        // Featured: platform-owned and not ended
        featuredContests = available
            .filter { contest in
                contest.isPlatformOwned == true &&
                contest.status != .complete &&
                contest.status != .cancelled
            }
            .sorted { lhs, rhs in
                // Live contests first, then by lock time
                if lhs.status == .live && rhs.status != .live { return true }
                if lhs.status != .live && rhs.status == .live { return false }

                guard let l = lhs.lockTime, let r = rhs.lockTime else {
                    return false
                }

                return l < r
            }

        // My Active: status is scheduled or live (excludes locked/complete/cancelled)
        myActiveContests = myContests
            .filter { contest in
                contest.status == .scheduled || contest.status == .live
            }
            .sorted { lhs, rhs in
                // Live first, then by lock time
                if lhs.status == .live && rhs.status != .live { return true }
                if lhs.status != .live && rhs.status == .live { return false }

                guard let l = lhs.lockTime, let r = rhs.lockTime else {
                    return false
                }

                return l < r
            }

        // Open: joinable, not full, not yet joined
        openContests = available
            .filter { contest in
                contest.actions?.canJoin == true &&
                !(contest.actions?.canEditEntry ?? false) &&
                !(contest.actions?.canUnjoin ?? false)
            }
            .sorted { lhs, rhs in
                guard let l = lhs.lockTime, let r = rhs.lockTime else {
                    return false
                }
                return l < r
            }
    }

    /// Sync loading state from source ViewModels.
    /// - Parameters:
    ///   - availableIsLoading: Loading state from AvailableContestsViewModel
    ///   - myIsLoading: Loading state from MyContestsViewModel
    func updateLoadingState(availableIsLoading: Bool, myIsLoading: Bool) {
        isLoading = availableIsLoading || myIsLoading
    }
}
