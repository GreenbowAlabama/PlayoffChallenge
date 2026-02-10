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
    case contestManagement
    case profile
    case rulesPreview(MockContest)
    case contestDetail(UUID)
    case leaderboard(MockContest)
}

/// Mock contest model for UI flow demonstration
struct MockContest: Identifiable, Hashable, Codable {
    let id: UUID
    let name: String
    let entryCount: Int
    let maxEntries: Int
    let status: String
    let creatorName: String
    let entryFee: Double
    let joinToken: String?
    let joinURL: URL?
    let isJoined: Bool
    let lockTime: Date?

    init(
        id: UUID = UUID(),
        name: String,
        entryCount: Int,
        maxEntries: Int,
        status: String,
        creatorName: String,
        entryFee: Double = 0.0,
        joinToken: String? = nil,
        joinURL: URL? = nil,
        isJoined: Bool = false,
        lockTime: Date? = nil
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

    var isFull: Bool {
        maxEntries > 0 && entryCount >= maxEntries
    }

    static let samples: [MockContest] = [
        MockContest(
            id: UUID(),
            name: "NFL Playoffs 2026",
            entryCount: 45,
            maxEntries: 100,
            status: "Open",
            creatorName: "Admin",
            entryFee: 50.00,
            joinToken: "nfl2026token"
        ),
        MockContest(
            id: UUID(),
            name: "Friends League",
            entryCount: 8,
            maxEntries: 20,
            status: "Open",
            creatorName: "JohnDoe",
            entryFee: 25.00,
            joinToken: "friendstoken"
        ),
        MockContest(
            id: UUID(),
            name: "Office Pool",
            entryCount: 12,
            maxEntries: 50,
            status: "Open",
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
            status: "Open",
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

    func navigateToContestManagement() {
        navigationPath.append(LandingDestination.contestManagement)
    }

    func navigateToProfile() {
        navigationPath.append(LandingDestination.profile)
    }

    func navigateToRulesPreview(contest: MockContest) {
        navigationPath.append(LandingDestination.rulesPreview(contest))
    }

    func navigateToContestDetail(contestId: UUID) {
        navigationPath.append(LandingDestination.contestDetail(contestId))
    }

    func navigateToLeaderboard(contest: MockContest) {
        navigationPath.append(LandingDestination.leaderboard(contest))
    }
}
