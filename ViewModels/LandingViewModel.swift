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

    static var myContests: [MockContest] = [
        MockContest(
            id: UUID(),
            name: "My Custom Contest",
            entryCount: 5,
            maxEntries: 25,
            status: .scheduled,
            creatorName: "Player1",
            entryFee: 20.00,
            joinToken: "mycustomtoken",
            isJoined: true
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

    /// Reset navigation to MyContests root.
    /// Used after lifecycle mutations (cancel contest, leave contest).
    func resetToMyContests() {
        navigationPath = NavigationPath()
        navigationPath.append(LandingDestination.myContests)
    }
}
