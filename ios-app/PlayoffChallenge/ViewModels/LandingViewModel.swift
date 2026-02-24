//
//  LandingViewModel.swift
//  PlayoffChallenge
//
//  ViewModel for the Landing page navigation.
//

import Combine
import Foundation
import SwiftUI

/// Navigation destinations from the Landing page
enum LandingDestination: Hashable {
    case availableContests
    case createContest
    case myContests
    case profile
    case contestDetail(UUID)
    case leaderboard(UUID)
}

/// ViewModel for the Landing page.
/// Handles navigation state and path management.
@MainActor
final class LandingViewModel: ObservableObject {

    // MARK: - Published State

    @Published var navigationPath = NavigationPath()

    // MARK: - Navigation Actions

    func navigateToAvailableContests() {
        navigationPath.append(LandingDestination.availableContests)
    }

    func navigateToCreateContest() {
        print("NAV: append createContest, pathCount=\(navigationPath.count+1)")
        navigationPath.append(LandingDestination.createContest)
    }

    func navigateToMyContests() {
        navigationPath.append(LandingDestination.myContests)
    }

    func navigateToProfile() {
        navigationPath.append(LandingDestination.profile)
    }

    func navigateToContestDetail(contestId: UUID) {
        navigationPath.append(LandingDestination.contestDetail(contestId))
    }

    func navigateToLeaderboard(contestId: UUID) {
        navigationPath.append(LandingDestination.leaderboard(contestId))
    }

    /// Navigate to contest detail after successful creation.
    /// Atomically replaces .createContest with .contestDetail(contestId).
    /// This prevents CreateContestFlowView from remaining in the stack.
    func navigateToContestDetailAfterCreation(contestId: UUID) {
        // Remove the last item (.createContest) and append contestDetail
        if !navigationPath.isEmpty {
            navigationPath.removeLast()
        }
        navigationPath.append(LandingDestination.contestDetail(contestId))
    }

    /// Reset navigation to MyContests root.
    /// Used after lifecycle mutations (cancel contest, leave contest).
    func resetToMyContests() {
        navigationPath = NavigationPath()
        navigationPath.append(LandingDestination.myContests)
    }

    // MARK: - Contest Selection (Pure Function, No State Ownership)

    /// Selects the next contest to display in the lock banner.
    /// Pure function: no side effects, no state mutation.
    /// Filters by: status == .scheduled, lockTime exists and in future.
    /// Priority: joinable (isJoined == false) first, then already joined.
    /// - Parameters:
    ///   - available: Contests from AvailableContestsViewModel (VMs own this data)
    ///   - mine: Contests from MyContestsViewModel (VMs own this data)
    /// - Returns: Next scheduled contest with future lock time, or nil
    func nextRelevantScheduledContest(
        available: [Contest],
        mine: [Contest]
    ) -> Contest? {
        let now = Date()

        // Filter both lists: scheduled, has lock time, lock time is in future
        let isValidForBanner: (Contest) -> Bool = { contest in
            contest.status == .scheduled &&
            contest.lockTime != nil &&
            (contest.lockTime ?? .distantPast) > now
        }

        let validAvailable = available.filter(isValidForBanner)
        let validMine = mine.filter(isValidForBanner)

        // Priority 1: Next joinable (not yet joined)
        let joinable = validAvailable
            .filter { !($0.actions?.canEditEntry ?? false) && !($0.actions?.canUnjoin ?? false) }
            .sorted { ($0.lockTime ?? .distantFuture) < ($1.lockTime ?? .distantFuture) }
            .first

        if let joinable = joinable {
            return joinable
        }

        // Priority 2: Next already joined
        let joined = (validAvailable + validMine)
            .filter { $0.actions?.canEditEntry == true || $0.actions?.canUnjoin == true }
            .sorted { ($0.lockTime ?? .distantFuture) < ($1.lockTime ?? .distantFuture) }
            .first

        return joined
    }
}
