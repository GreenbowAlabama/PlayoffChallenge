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
    case leaderboard(MockContest)
}

/// Mock contest model for UI flow demonstration
struct MockContest: Identifiable, Hashable, Codable {
    let id: UUID
    let name: String
    let entryCount: Int
    let maxEntries: Int
    let status: ContestStatus
    let creatorName: String
    let entryFee: Double
    let joinToken: String?
    let joinURL: URL?
    let isJoined: Bool
    let lockTime: Date?
    let startTime: Date?
    let endTime: Date?
    let createdAt: Date?
    let actions: ContestActions?

    init(
        id: UUID = UUID(),
        name: String,
        entryCount: Int,
        maxEntries: Int,
        status: ContestStatus,
        creatorName: String,
        entryFee: Double = 0.0,
        joinToken: String? = nil,
        joinURL: URL? = nil,
        isJoined: Bool = false,
        lockTime: Date? = nil,
        startTime: Date? = nil,
        endTime: Date? = nil,
        createdAt: Date? = nil,
        actions: ContestActions? = nil
    ) {
        self.id = id
        self.name = name
        self.entryCount = entryCount
        self.maxEntries = maxEntries
        self.status = status
        self.creatorName = creatorName
        self.entryFee = entryFee
        self.joinToken = joinToken
        self.joinURL = joinURL
        self.isJoined = isJoined
        self.lockTime = lockTime
        self.startTime = startTime
        self.endTime = endTime
        self.createdAt = createdAt
        self.actions = actions
    }

    var displayStatus: String {
        status.rawValue.capitalized
    }

    var formattedEntryFee: String {
        if entryFee == 0 {
            return "Free"
        }
        return String(format: "$%.2f", entryFee)
    }

    var slotsRemaining: Int {
        maxEntries - entryCount
    }

    static let samples: [MockContest] = [
        MockContest(
            id: UUID(),
            name: "NFL Playoffs 2026",
            entryCount: 45,
            maxEntries: 100,
            status: .scheduled,
            creatorName: "Admin",
            entryFee: 50.00,
            joinToken: "nfl2026token"
        ),
        MockContest(
            id: UUID(),
            name: "Friends League",
            entryCount: 8,
            maxEntries: 20,
            status: .scheduled,
            creatorName: "JohnDoe",
            entryFee: 25.00,
            joinToken: "friendstoken"
        ),
        MockContest(
            id: UUID(),
            name: "Office Pool",
            entryCount: 12,
            maxEntries: 50,
            status: .scheduled,
            creatorName: "Sarah",
            entryFee: 10.00,
            joinToken: "officetoken"
        )
    ]
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

    func navigateToLeaderboard(contest: MockContest) {
        navigationPath.append(LandingDestination.leaderboard(contest))
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
        available: [MockContest],
        mine: [MockContest]
    ) -> MockContest? {
        let now = Date()

        // Filter both lists: scheduled, has lock time, lock time is in future
        let isValidForBanner: (MockContest) -> Bool = { contest in
            contest.status == .scheduled &&
            contest.lockTime != nil &&
            (contest.lockTime ?? .distantPast) > now
        }

        let validAvailable = available.filter(isValidForBanner)
        let validMine = mine.filter(isValidForBanner)

        // Priority 1: Next joinable (not yet joined)
        let joinable = validAvailable
            .filter { !$0.isJoined }
            .sorted { ($0.lockTime ?? .distantFuture) < ($1.lockTime ?? .distantFuture) }
            .first

        if let joinable = joinable {
            return joinable
        }

        // Priority 2: Next already joined
        let joined = (validAvailable + validMine)
            .filter { $0.isJoined }
            .sorted { ($0.lockTime ?? .distantFuture) < ($1.lockTime ?? .distantFuture) }
            .first

        return joined
    }
}
